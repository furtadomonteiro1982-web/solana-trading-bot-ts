import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDb } from '../store/db.js';
import { PositionRepository } from '../store/positionRepository.js';
import { closeTimedOutPositions } from './timeoutManager.js';
import type { Executor, Fill, Order } from '../types.js';

let db: Database.Database;
let repo: PositionRepository;
let executor: Executor;
let executeMock: ReturnType<typeof vi.fn<(order: Order) => Promise<Fill>>>;

beforeEach(() => {
  db = createDb(':memory:');
  repo = new PositionRepository(db);
  executeMock = vi.fn<(order: Order) => Promise<Fill>>().mockImplementation(
    async (order: Order): Promise<Fill> => ({
      poolAddress: order.poolAddress,
      side: order.side,
      sizeUsd: order.sizeUsd,
      filledPriceUsd: order.priceUsd,
      filledAt: new Date(),
    })
  );
  executor = { execute: executeMock };
});

function openSnipe(openedAt: Date) {
  return repo.openPosition({
    poolAddress: 'MINT1',
    baseTokenAddress: 'MINT1',
    baseTokenSymbol: 'FOO',
    entryPriceUsd: 1,
    sizeUsd: 2,
    stopLossPrice: 0.6,
    takeProfitPrice: 2,
    trailingStopPct: 100,
    openedAt,
    strategy: 'snipe',
  });
}

describe('closeTimedOutPositions', () => {
  it('closes a snipe position held past maxHoldMs, at the looked-up price', async () => {
    const openedAt = new Date('2026-08-30T12:00:00.000Z');
    const position = openSnipe(openedAt);
    const now = new Date('2026-08-30T12:16:00.000Z'); // 16 min later
    const maxHoldMs = 15 * 60 * 1000;

    const closed = await closeTimedOutPositions(repo, maxHoldMs, async () => 1.1, executor, now);

    expect(closed).toHaveLength(1);
    expect(closed[0].id).toBe(position.id);
    expect(closed[0].closeReason).toBe('TIMEOUT');
    expect(closed[0].closePriceUsd).toBe(1.1);
    expect(repo.getOpenPositions()).toHaveLength(0);
  });

  it('leaves a snipe position open when it has not yet reached maxHoldMs', async () => {
    const openedAt = new Date('2026-08-30T12:00:00.000Z');
    openSnipe(openedAt);
    const now = new Date('2026-08-30T12:10:00.000Z'); // 10 min later
    const maxHoldMs = 15 * 60 * 1000;

    const closed = await closeTimedOutPositions(repo, maxHoldMs, async () => 1.1, executor, now);

    expect(closed).toHaveLength(0);
    expect(repo.getOpenPositions()).toHaveLength(1);
  });

  it('skips a timed-out position when the price lookup returns null, retrying next time', async () => {
    const openedAt = new Date('2026-08-30T12:00:00.000Z');
    openSnipe(openedAt);
    const now = new Date('2026-08-30T12:16:00.000Z');
    const maxHoldMs = 15 * 60 * 1000;

    const closed = await closeTimedOutPositions(repo, maxHoldMs, async () => null, executor, now);

    expect(closed).toHaveLength(0);
    expect(repo.getOpenPositions()).toHaveLength(1);
  });

  it('does not close at maxHoldMs a position that once pumped above the no-pump threshold', async () => {
    const openedAt = new Date('2026-08-30T12:00:00.000Z');
    const position = openSnipe(openedAt); // entry 1
    repo.updateHighestPrice(position.id, 1.25); // once reached +25%, above the 20% default threshold
    const now = new Date('2026-08-30T12:16:00.000Z'); // 16 min later, past maxHoldMs=15min
    const maxHoldMs = 15 * 60 * 1000;

    const closed = await closeTimedOutPositions(repo, maxHoldMs, async () => 1.05, executor, now);

    expect(closed).toHaveLength(0);
    expect(repo.getOpenPositions()).toHaveLength(1);
  });

  it('still closes a pumped position once the extended hold time is reached', async () => {
    const openedAt = new Date('2026-08-30T12:00:00.000Z');
    const position = openSnipe(openedAt); // entry 1
    repo.updateHighestPrice(position.id, 1.25);
    const maxHoldMs = 15 * 60 * 1000;
    // Default extension multiplier is 3x -> 45 min. 46 min later is past it.
    const now = new Date('2026-08-30T12:46:00.000Z');

    const closed = await closeTimedOutPositions(repo, maxHoldMs, async () => 1.05, executor, now);

    expect(closed).toHaveLength(1);
    expect(closed[0].closeReason).toBe('TIMEOUT');
  });

  it('closes at the normal maxHoldMs a position that only pumped up to the no-pump threshold (not above)', async () => {
    const openedAt = new Date('2026-08-30T12:00:00.000Z');
    const position = openSnipe(openedAt); // entry 1
    repo.updateHighestPrice(position.id, 1.2); // exactly +20%, not above the threshold
    const now = new Date('2026-08-30T12:16:00.000Z');
    const maxHoldMs = 15 * 60 * 1000;

    const closed = await closeTimedOutPositions(repo, maxHoldMs, async () => 1.05, executor, now);

    expect(closed).toHaveLength(1);
  });
});

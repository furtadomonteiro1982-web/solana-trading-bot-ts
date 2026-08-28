import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDb } from './store/db.js';
import { PositionRepository } from './store/positionRepository.js';
import { reviewOpenPositions } from './positionManager.js';
import type { Executor, Fill, Order } from './types.js';

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

function openTestPosition() {
  return repo.openPosition({
    poolAddress: 'POOL1',
    baseTokenSymbol: 'FOO',
    entryPriceUsd: 1,
    sizeUsd: 10,
    stopLossPrice: 0.8,
    takeProfitPrice: 1.5,
    trailingStopPct: 15,
    openedAt: new Date(),
  });
}

describe('reviewOpenPositions', () => {
  it('closes a position that reached take-profit', async () => {
    openTestPosition();
    const closed = await reviewOpenPositions(repo, async () => 1.6, executor);

    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({
      poolAddress: 'POOL1',
      closeReason: 'TAKE_PROFIT',
      closePriceUsd: 1.6,
    });
    expect(closed[0].pnlUsd).toBeCloseTo(6, 5); // (1.6-1)/1 * 10
    expect(repo.getOpenPositions()).toHaveLength(0);
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ poolAddress: 'POOL1', side: 'SELL' })
    );
  });

  it('closes a position that hit stop-loss', async () => {
    openTestPosition();
    const closed = await reviewOpenPositions(repo, async () => 0.7, executor);

    expect(closed).toHaveLength(1);
    expect(closed[0].closeReason).toBe('STOP_LOSS');
    expect(repo.getOpenPositions()[0]).toBeUndefined();
  });

  it('leaves a position open when price is between stop-loss and take-profit', async () => {
    openTestPosition();
    const closed = await reviewOpenPositions(repo, async () => 1.1, executor);

    expect(closed).toHaveLength(0);
    expect(repo.getOpenPositions()).toHaveLength(1);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('closes on trailing stop after the price rose then pulled back 15% from its peak', async () => {
    const position = openTestPosition();
    // Price rises to 1.3 first (peak), then pulls back to 1.3 * 0.85 = 1.105 or below.
    await reviewOpenPositions(repo, async () => 1.3, executor);
    expect(repo.getById(position.id)!.highestPriceUsd).toBe(1.3);

    const closed = await reviewOpenPositions(repo, async () => 1.1, executor);

    expect(closed).toHaveLength(1);
    expect(closed[0].closeReason).toBe('TRAILING_STOP');
  });

  it('skips a position when the price lookup returns null', async () => {
    openTestPosition();
    const closed = await reviewOpenPositions(repo, async () => null, executor);

    expect(closed).toHaveLength(0);
    expect(repo.getOpenPositions()).toHaveLength(1);
  });
});

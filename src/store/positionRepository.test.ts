// src/store/positionRepository.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDb } from './db.js';
import { PositionRepository } from './positionRepository.js';

let db: Database.Database;
let repo: PositionRepository;

beforeEach(() => {
  db = createDb(':memory:');
  repo = new PositionRepository(db);
});

describe('PositionRepository', () => {
  it('opens a position and can read it back among open positions', () => {
    const position = repo.openPosition({
      poolAddress: 'POOL1',
      baseTokenAddress: 'TOKEN1',
      baseTokenSymbol: 'FOO',
      entryPriceUsd: 1,
      sizeUsd: 10,
      stopLossPrice: 0.8,
      takeProfitPrice: 1.5,
      trailingStopPct: 15,
      openedAt: new Date('2026-08-27T00:00:00.000Z'),
    });

    expect(position.status).toBe('OPEN');
    expect(position.highestPriceUsd).toBe(1);
    expect(position.baseTokenAddress).toBe('TOKEN1');
    expect(repo.getOpenPositions()).toHaveLength(1);
  });

  it('updates the highest price seen', () => {
    const position = repo.openPosition({
      poolAddress: 'POOL1',
      baseTokenAddress: 'TOKEN1',
      baseTokenSymbol: 'FOO',
      entryPriceUsd: 1,
      sizeUsd: 10,
      stopLossPrice: 0.8,
      takeProfitPrice: 1.5,
      trailingStopPct: 15,
      openedAt: new Date(),
    });

    repo.updateHighestPrice(position.id, 1.3);

    expect(repo.getById(position.id)!.highestPriceUsd).toBe(1.3);
  });

  it('closes a position, computes PnL, and removes it from open positions', () => {
    const position = repo.openPosition({
      poolAddress: 'POOL1',
      baseTokenAddress: 'TOKEN1',
      baseTokenSymbol: 'FOO',
      entryPriceUsd: 1,
      sizeUsd: 10,
      stopLossPrice: 0.8,
      takeProfitPrice: 1.5,
      trailingStopPct: 15,
      openedAt: new Date(),
    });

    const closed = repo.closePosition(position.id, 1.5, 'TAKE_PROFIT', new Date('2026-08-27T01:00:00.000Z'));

    expect(closed.status).toBe('CLOSED');
    expect(closed.pnlUsd).toBeCloseTo(5, 5); // (1.5-1)/1 * 10
    expect(repo.getOpenPositions()).toHaveLength(0);
  });

  it('defaults strategy to "hourly" when not specified, and stores an explicit "snipe"', () => {
    const hourlyPosition = repo.openPosition({
      poolAddress: 'POOL1',
      baseTokenAddress: 'TOKEN1',
      baseTokenSymbol: 'FOO',
      entryPriceUsd: 1,
      sizeUsd: 10,
      stopLossPrice: 0.8,
      takeProfitPrice: 1.5,
      trailingStopPct: 15,
      openedAt: new Date(),
    });
    expect(hourlyPosition.strategy).toBe('hourly');

    const snipePosition = repo.openPosition({
      poolAddress: 'POOL2',
      baseTokenAddress: 'TOKEN2',
      baseTokenSymbol: 'BAR',
      entryPriceUsd: 1,
      sizeUsd: 2,
      stopLossPrice: 0.6,
      takeProfitPrice: 2,
      trailingStopPct: 100,
      openedAt: new Date(),
      strategy: 'snipe',
    });
    expect(snipePosition.strategy).toBe('snipe');
  });
});

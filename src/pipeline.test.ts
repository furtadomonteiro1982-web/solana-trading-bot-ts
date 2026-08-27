import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDb } from './store/db.js';
import { PositionRepository } from './store/positionRepository.js';
import { DecisionLogRepository } from './store/decisionLogRepository.js';
import { runCycle } from './pipeline.js';
import type { GeckoTerminalClient } from './geckoterminal/client.js';
import type { BotConfig } from './config.js';
import type { Candle, Executor, Fill, Order, Pool } from './types.js';

const config = {
  network: 'solana',
  filters: { minLiquidityUsd: 1000, minPoolAgeMinutes: 60 },
  indicators: {
    rsiPeriod: 2,
    rsiOversold: 50,
    smaPeriod: 2,
    momentumLookbackCandles: 1,
    momentumMinPct: 0,
  },
  risk: {
    simulatedCapitalUsd: 1000,
    maxPositionPct: 10,
    maxOpenPositions: 5,
    stopLossPct: 50,
    takeProfitPct: 10,
    trailingStopPct: 50,
  },
  geckoTerminal: { baseUrl: 'x', timeframe: 'hour', ohlcvLimit: 100 },
} as BotConfig;

const pool: Pool = {
  poolAddress: 'POOL1',
  baseTokenSymbol: 'FOO',
  baseTokenAddress: 'TOKEN1',
  priceUsd: 0.9,
  liquidityUsd: 50000,
  volume24hUsd: 10000,
  priceChange24hPct: 5,
  poolCreatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24h old
};

function candle(close: number, offsetMs: number): Candle {
  return { timestamp: new Date(offsetMs), open: close, high: close, low: close, close, volume: 100 };
}

// closes: 1.0, 0.9, 0.8, 0.9 -> RSI(2)=50, SMA(2)=0.85, momentum(1)=+12.5% -> BUY, entry 0.9
const buyCandles = [candle(1.0, 0), candle(0.9, 1), candle(0.8, 2), candle(0.9, 3)];

let db: Database.Database;
let positionRepo: PositionRepository;
let decisionLog: DecisionLogRepository;
let executor: Executor;
let executeMock: ReturnType<typeof vi.fn>;
let client: GeckoTerminalClient;

beforeEach(() => {
  db = createDb(':memory:');
  positionRepo = new PositionRepository(db);
  decisionLog = new DecisionLogRepository(db);
  executeMock = vi.fn().mockImplementation(
    async (order: Order): Promise<Fill> => ({
      poolAddress: order.poolAddress,
      side: order.side,
      sizeUsd: order.sizeUsd,
      filledPriceUsd: order.priceUsd,
      filledAt: new Date(),
    })
  );
  executor = { execute: executeMock };
  client = {
    fetchTrendingPools: vi.fn().mockResolvedValue([pool]),
    fetchOhlcv: vi.fn().mockResolvedValue(buyCandles),
    // Price stays between stop-loss (0.45) and take-profit (0.99): position stays open.
    fetchPoolPrice: vi.fn().mockResolvedValue(0.5),
  };
});

describe('runCycle', () => {
  it('scans, filters, signals, opens a position, and leaves it open', async () => {
    const summary = await runCycle({ client, positionRepo, decisionLog, executor, config });

    expect(summary).toEqual({
      poolsScanned: 1,
      poolsPassedFilter: 1,
      buySignals: 1,
      positionsOpened: 1,
      positionsClosed: 0,
    });
    expect(positionRepo.getOpenPositions()).toHaveLength(1);
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ poolAddress: 'POOL1', side: 'BUY', sizeUsd: 100 })
    );
    expect(decisionLog.getRecent(10).length).toBeGreaterThan(0);
  });

  it('rejects a pool that fails the filter without calling the client for OHLCV', async () => {
    client.fetchTrendingPools = vi.fn().mockResolvedValue([{ ...pool, liquidityUsd: 10 }]);

    const summary = await runCycle({ client, positionRepo, decisionLog, executor, config });

    expect(summary.poolsPassedFilter).toBe(0);
    expect(summary.buySignals).toBe(0);
    expect(client.fetchOhlcv).not.toHaveBeenCalled();
  });
});

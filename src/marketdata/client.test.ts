import { describe, expect, it, vi } from 'vitest';
import { createFallbackClient } from './client.js';
import type { MarketDataClient } from './client.js';
import type { Pool, Candle } from '../types.js';

function makePool(poolAddress: string): Pool {
  return {
    poolAddress,
    baseTokenSymbol: 'FOO',
    baseTokenAddress: poolAddress,
    priceUsd: 1,
    liquidityUsd: 10000,
    volume24hUsd: 5000,
    priceChange24hPct: 1,
    poolCreatedAt: new Date(),
  };
}

function makeCandle(): Candle {
  return { timestamp: new Date(), open: 1, high: 1, low: 1, close: 1, volume: 100 };
}

describe('createFallbackClient', () => {
  it('uses the primary client when it succeeds, without touching the secondary', async () => {
    const primary: MarketDataClient = {
      fetchTrendingPools: vi.fn().mockResolvedValue([makePool('A')]),
      fetchOhlcv: vi.fn().mockResolvedValue([makeCandle()]),
      fetchPool: vi.fn().mockResolvedValue(makePool('A')),
    };
    const secondary: MarketDataClient = {
      fetchTrendingPools: vi.fn(),
      fetchOhlcv: vi.fn(),
      fetchPool: vi.fn(),
    };
    const client = createFallbackClient(primary, secondary);

    await client.fetchTrendingPools('solana');
    await client.fetchOhlcv('solana', 'A', 'hour', 10);
    await client.fetchPool('solana', 'A');

    expect(secondary.fetchTrendingPools).not.toHaveBeenCalled();
    expect(secondary.fetchOhlcv).not.toHaveBeenCalled();
    expect(secondary.fetchPool).not.toHaveBeenCalled();
  });

  it('falls back to the secondary when fetchTrendingPools on the primary throws', async () => {
    const primary: MarketDataClient = {
      fetchTrendingPools: vi.fn().mockRejectedValue(new Error('quota épuisé')),
      fetchOhlcv: vi.fn(),
      fetchPool: vi.fn(),
    };
    const fallbackPools = [makePool('B')];
    const secondary: MarketDataClient = {
      fetchTrendingPools: vi.fn().mockResolvedValue(fallbackPools),
      fetchOhlcv: vi.fn(),
      fetchPool: vi.fn(),
    };
    const client = createFallbackClient(primary, secondary);

    const pools = await client.fetchTrendingPools('solana');

    expect(pools).toBe(fallbackPools);
    expect(secondary.fetchTrendingPools).toHaveBeenCalledWith('solana');
  });

  it('falls back to the secondary when fetchOhlcv on the primary throws, for that pool only', async () => {
    const primary: MarketDataClient = {
      fetchTrendingPools: vi.fn(),
      fetchOhlcv: vi.fn().mockRejectedValue(new Error('429 persistant')),
      fetchPool: vi.fn(),
    };
    const fallbackCandles = [makeCandle()];
    const secondary: MarketDataClient = {
      fetchTrendingPools: vi.fn(),
      fetchOhlcv: vi.fn().mockResolvedValue(fallbackCandles),
      fetchPool: vi.fn(),
    };
    const client = createFallbackClient(primary, secondary);

    const candles = await client.fetchOhlcv('solana', 'A', 'hour', 10);

    expect(candles).toBe(fallbackCandles);
    expect(secondary.fetchOhlcv).toHaveBeenCalledWith('solana', 'A', 'hour', 10);
  });

  it('falls back to the secondary when the primary fetchPool returns null (not just on throw)', async () => {
    const primary: MarketDataClient = {
      fetchTrendingPools: vi.fn(),
      fetchOhlcv: vi.fn(),
      fetchPool: vi.fn().mockResolvedValue(null),
    };
    const fallbackPool = makePool('B');
    const secondary: MarketDataClient = {
      fetchTrendingPools: vi.fn(),
      fetchOhlcv: vi.fn(),
      fetchPool: vi.fn().mockResolvedValue(fallbackPool),
    };
    const client = createFallbackClient(primary, secondary);

    const pool = await client.fetchPool('solana', 'B');

    expect(pool).toBe(fallbackPool);
  });

  it('returns null when both the primary and secondary fetchPool come up empty', async () => {
    const primary: MarketDataClient = {
      fetchTrendingPools: vi.fn(),
      fetchOhlcv: vi.fn(),
      fetchPool: vi.fn().mockResolvedValue(null),
    };
    const secondary: MarketDataClient = {
      fetchTrendingPools: vi.fn(),
      fetchOhlcv: vi.fn(),
      fetchPool: vi.fn().mockResolvedValue(null),
    };
    const client = createFallbackClient(primary, secondary);

    const pool = await client.fetchPool('solana', 'INCONNU');

    expect(pool).toBeNull();
  });

  it('propagates the error when both the primary and secondary fetchOhlcv fail', async () => {
    const primary: MarketDataClient = {
      fetchTrendingPools: vi.fn(),
      fetchOhlcv: vi.fn().mockRejectedValue(new Error('primaire cassée')),
      fetchPool: vi.fn(),
    };
    const secondary: MarketDataClient = {
      fetchTrendingPools: vi.fn(),
      fetchOhlcv: vi.fn().mockRejectedValue(new Error('secours cassé aussi')),
      fetchPool: vi.fn(),
    };
    const client = createFallbackClient(primary, secondary);

    await expect(client.fetchOhlcv('solana', 'A', 'hour', 10)).rejects.toThrow(/secours cassé aussi/);
  });
});

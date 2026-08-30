import { describe, expect, it, vi } from 'vitest';
import { createFallbackClient, createCachedClient } from './client.js';
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

describe('createCachedClient', () => {
  function makeUnderlying() {
    return {
      fetchTrendingPools: vi.fn().mockResolvedValue([makePool('A')]),
      fetchOhlcv: vi.fn().mockResolvedValue([makeCandle()]),
      fetchPool: vi.fn().mockResolvedValue(makePool('A')),
    } satisfies MarketDataClient;
  }

  it('serves fetchOhlcv from cache on a second call within the TTL, without hitting the underlying client again', async () => {
    const underlying = makeUnderlying();
    let currentTime = 0;
    const client = createCachedClient(underlying, 600_000, () => currentTime);

    const first = await client.fetchOhlcv('solana', 'A', 'hour', 100);
    currentTime += 300_000; // 5 min later, still within the 10-min TTL
    const second = await client.fetchOhlcv('solana', 'A', 'hour', 100);

    expect(second).toBe(first);
    expect(underlying.fetchOhlcv).toHaveBeenCalledTimes(1);
  });

  it('refetches once the TTL has expired', async () => {
    const underlying = makeUnderlying();
    let currentTime = 0;
    const client = createCachedClient(underlying, 600_000, () => currentTime);

    await client.fetchOhlcv('solana', 'A', 'hour', 100);
    currentTime += 600_001; // just past the TTL
    await client.fetchOhlcv('solana', 'A', 'hour', 100);

    expect(underlying.fetchOhlcv).toHaveBeenCalledTimes(2);
  });

  it('caches separately per pool address, so a different pool is never served another pool\'s candles', async () => {
    const underlying = makeUnderlying();
    const client = createCachedClient(underlying, 600_000, () => 0);

    await client.fetchOhlcv('solana', 'A', 'hour', 100);
    await client.fetchOhlcv('solana', 'B', 'hour', 100);

    expect(underlying.fetchOhlcv).toHaveBeenCalledTimes(2);
    expect(underlying.fetchOhlcv).toHaveBeenCalledWith('solana', 'A', 'hour', 100);
    expect(underlying.fetchOhlcv).toHaveBeenCalledWith('solana', 'B', 'hour', 100);
  });

  it('never caches fetchTrendingPools or fetchPool: they always hit the underlying client', async () => {
    const underlying = makeUnderlying();
    const client = createCachedClient(underlying, 600_000, () => 0);

    await client.fetchTrendingPools('solana');
    await client.fetchTrendingPools('solana');
    await client.fetchPool('solana', 'A');
    await client.fetchPool('solana', 'A');

    expect(underlying.fetchTrendingPools).toHaveBeenCalledTimes(2);
    expect(underlying.fetchPool).toHaveBeenCalledTimes(2);
  });
});

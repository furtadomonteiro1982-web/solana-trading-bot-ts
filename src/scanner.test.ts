import { describe, expect, it, vi } from 'vitest';
import { scanPools } from './scanner.js';
import type { MarketDataClient } from './marketdata/client.js';
import type { BotConfig } from './config.js';
import type { Pool } from './types.js';

function makePool(poolAddress: string): Pool {
  return {
    poolAddress,
    baseTokenSymbol: 'FOO',
    baseTokenAddress: 'token-' + poolAddress,
    priceUsd: 1,
    liquidityUsd: 10000,
    volume24hUsd: 5000,
    priceChange24hPct: 1,
    poolCreatedAt: new Date(),
  };
}

const config = { network: 'solana' } as BotConfig;

describe('scanPools', () => {
  it('returns the pools from the client', async () => {
    const client: MarketDataClient = {
      fetchTrendingPools: vi.fn().mockResolvedValue([makePool('A'), makePool('B')]),
      fetchOhlcv: vi.fn(),
      fetchPool: vi.fn(),
    };

    const pools = await scanPools(client, config);

    expect(pools.map((p) => p.poolAddress)).toEqual(['A', 'B']);
    expect(client.fetchTrendingPools).toHaveBeenCalledWith('solana');
  });

  it('deduplicates pools with the same address', async () => {
    const client: MarketDataClient = {
      fetchTrendingPools: vi.fn().mockResolvedValue([makePool('A'), makePool('A')]),
      fetchOhlcv: vi.fn(),
      fetchPool: vi.fn(),
    };

    const pools = await scanPools(client, config);

    expect(pools).toHaveLength(1);
  });
});

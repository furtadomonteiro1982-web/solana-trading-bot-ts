import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGeckoTerminalClient } from './client.js';

const trendingPoolsResponse = {
  data: [
    {
      id: 'solana_POOL1',
      attributes: {
        address: 'POOL1',
        base_token_price_usd: '0.5',
        pool_created_at: '2026-08-01T00:00:00.000Z',
        reserve_in_usd: '25000',
        volume_usd: { h24: '10000' },
        price_change_percentage: { h24: '5.5' },
      },
      relationships: {
        base_token: { data: { id: 'solana_TOKEN1' } },
      },
    },
  ],
  included: [
    {
      id: 'solana_TOKEN1',
      type: 'token',
      attributes: { symbol: 'FOO', name: 'Foo Token', address: 'TOKEN1' },
    },
  ],
};

const ohlcvResponse = {
  data: {
    attributes: {
      ohlcv_list: [
        [1000, 1.3, 1.4, 1.2, 1.35, 500],
        [900, 1.1, 1.2, 1.0, 1.2, 400],
        [800, 1.0, 1.1, 0.9, 1.1, 300],
      ],
    },
  },
};

const poolResponse = {
  data: { attributes: { base_token_price_usd: '0.42' } },
};

// Même forme que trending_pools, mais `data` est un objet unique et non un tableau.
const singlePoolResponse = {
  data: trendingPoolsResponse.data[0],
  included: trendingPoolsResponse.included,
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { get: () => null },
    json: async () => body,
  };
}

describe('GeckoTerminalHttpClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchTrendingPools maps the raw response into Pool objects, including the real creation date', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(trendingPoolsResponse)));
    const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2', 0);

    const pools = await client.fetchTrendingPools('solana');

    expect(pools).toEqual([
      {
        poolAddress: 'POOL1',
        baseTokenSymbol: 'FOO',
        baseTokenAddress: 'TOKEN1',
        priceUsd: 0.5,
        liquidityUsd: 25000,
        volume24hUsd: 10000,
        priceChange24hPct: 5.5,
        poolCreatedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ]);
  });

  it('fetchOhlcv reverses the newest-first list into chronological order', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(ohlcvResponse)));
    const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2', 0);

    const candles = await client.fetchOhlcv('solana', 'POOL1', 'hour', 3);

    expect(candles.map((c) => c.close)).toEqual([1.1, 1.2, 1.35]);
    expect(candles[0].timestamp).toEqual(new Date(800 * 1000));
  });

  it('fetchPool maps the single-pool response into a Pool object', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(singlePoolResponse)));
    const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2', 0);

    const pool = await client.fetchPool('solana', 'POOL1');

    expect(pool).toEqual({
      poolAddress: 'POOL1',
      baseTokenSymbol: 'FOO',
      baseTokenAddress: 'TOKEN1',
      priceUsd: 0.5,
      liquidityUsd: 25000,
      volume24hUsd: 10000,
      priceChange24hPct: 5.5,
      poolCreatedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
  });

  it('fetchPool returns null instead of throwing for an unknown pool address', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 404)));
    const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2', 0);

    const pool = await client.fetchPool('solana', 'INCONNU');

    expect(pool).toBeNull();
  });

  it('does not retry a 404', async () => {
    const notFoundFetch = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    vi.stubGlobal('fetch', notFoundFetch);
    const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2', 0);

    const pool = await client.fetchPool('solana', 'INCONNU');

    expect(pool).toBeNull();
    expect(notFoundFetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 400 or 401/403 (never resolves itself on retry)', async () => {
    for (const status of [400, 401, 403]) {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, status));
      vi.stubGlobal('fetch', fetchMock);
      const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2', 0);

      await expect(client.fetchOhlcv('solana', 'POOL1', 'hour', 3)).rejects.toThrow(/GeckoTerminal/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    }
  });

  it('retries only once on a persistent 429', async () => {
    vi.useFakeTimers();
    try {
      const rateLimited = vi.fn().mockResolvedValue(jsonResponse({}, 429));
      vi.stubGlobal('fetch', rateLimited);
      const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2', 0);

      const promise = client.fetchOhlcv('solana', 'POOL1', 'hour', 3);
      const assertion = expect(promise).rejects.toThrow(/GeckoTerminal/);
      await vi.runAllTimersAsync();
      await assertion;

      expect(rateLimited).toHaveBeenCalledTimes(2); // 1 essai initial + 1 seule retentative
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits at least minIntervalMs between two consecutive requests', async () => {
    vi.useFakeTimers();
    try {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(ohlcvResponse)));
      const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2', 500);

      const first = client.fetchOhlcv('solana', 'POOL1', 'hour', 3);
      await vi.advanceTimersByTimeAsync(0);
      await first;

      setTimeoutSpy.mockClear();
      const second = client.fetchOhlcv('solana', 'POOL2', 'hour', 3);
      await vi.advanceTimersByTimeAsync(0);
      const paceDelay = setTimeoutSpy.mock.calls.find(([, ms]) => (ms as number) >= 400);
      expect(paceDelay).toBeDefined();

      await vi.runAllTimersAsync();
      await second;
    } finally {
      vi.useRealTimers();
    }
  });
});

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

function mockFetchOnce(response: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: async () => response,
  });
}

describe('GeckoTerminalHttpClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchTrendingPools maps the raw response into Pool objects', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(trendingPoolsResponse));
    const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2');

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
    vi.stubGlobal('fetch', mockFetchOnce(ohlcvResponse));
    const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2');

    const candles = await client.fetchOhlcv('solana', 'POOL1', 'hour', 3);

    expect(candles.map((c) => c.close)).toEqual([1.1, 1.2, 1.35]);
    expect(candles[0].timestamp).toEqual(new Date(800 * 1000));
  });

  it('fetchPoolPrice parses the single-pool response', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(poolResponse));
    const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2');

    const price = await client.fetchPoolPrice('solana', 'POOL1');

    expect(price).toBe(0.42);
  });

  it('fetchPoolPrice returns null instead of throwing when the request keeps failing', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({}, false));
    const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2');

    const price = await client.fetchPoolPrice('solana', 'MISSING');

    expect(price).toBeNull();
  });

  it('fetchPool maps the single-pool response into a Pool object', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(singlePoolResponse));
    const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2');

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
    vi.stubGlobal('fetch', mockFetchOnce({}, false));
    const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2');

    const pool = await client.fetchPool('solana', 'INCONNU');

    expect(pool).toBeNull();
  });

  it('fetchTrendingPools retries on failure and eventually throws after exhausting retries', async () => {
    const failingFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', failingFetch);
    const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2');

    await expect(client.fetchTrendingPools('solana')).rejects.toThrow(/Échec de la requête/);
    expect(failingFetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it('does not retry a 404 — the resource genuinely does not exist', async () => {
    const notFoundFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', notFoundFetch);
    const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2');

    const pool = await client.fetchPool('solana', 'INCONNU');

    expect(pool).toBeNull();
    expect(notFoundFetch).toHaveBeenCalledTimes(1);
  });

  it('honors the Retry-After header when a 429 provides one', async () => {
    vi.useFakeTimers();
    try {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      const rateLimited = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: { get: (name: string) => (name === 'Retry-After' ? '3' : null) },
          json: async () => ({}),
        })
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', json: async () => trendingPoolsResponse });
      vi.stubGlobal('fetch', rateLimited);
      const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2');

      const promise = client.fetchTrendingPools('solana');
      await vi.advanceTimersByTimeAsync(0);

      const [, firstDelay] = setTimeoutSpy.mock.calls[0]!;
      expect(firstDelay).toBe(3000); // Retry-After: 3 -> 3000ms, not the default 500ms

      await vi.runAllTimersAsync();
      const pools = await promise;
      expect(pools).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('backs off longer for a 429 than for a generic error when no Retry-After is given', async () => {
    vi.useFakeTimers();
    try {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      const rateLimited = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: { get: () => null },
        json: async () => ({}),
      });
      vi.stubGlobal('fetch', rateLimited);
      const client = createGeckoTerminalClient('https://api.geckoterminal.com/api/v2');

      const promise = client.fetchTrendingPools('solana');
      await vi.advanceTimersByTimeAsync(0);

      const [, firstDelay] = setTimeoutSpy.mock.calls[0]!;
      expect(firstDelay).toBeGreaterThanOrEqual(2000); // vs. 500ms for a generic error at the same attempt

      // Attach the rejection assertion before advancing timers, so the promise never settles
      // unobserved (avoids a spurious unhandled-rejection warning from fake-timer flushing).
      const assertion = expect(promise).rejects.toThrow(/Échec de la requête/);
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBirdeyeClient } from './client.js';

const trendingResponse = {
  success: true,
  data: {
    tokens: [
      { address: 'TOKEN1', name: 'Foo Token', symbol: 'FOO', liquidity: 25000, volume24hUSD: 10000, rank: 0 },
    ],
    total: 1,
  },
};

const priceResponse = {
  success: true,
  data: { value: 0.5, priceChange24h: 5.5 },
};

const ohlcvResponse = {
  success: true,
  data: {
    items: [
      { o: 1.0, h: 1.1, l: 0.9, c: 1.1, v: 300, unixTime: 800 },
      { o: 1.1, h: 1.2, l: 1.0, c: 1.2, v: 400, unixTime: 900 },
      { o: 1.2, h: 1.4, l: 1.2, c: 1.35, v: 500, unixTime: 1000 },
    ],
  },
};

const overviewResponse = {
  success: true,
  data: { symbol: 'FOO', price: 0.42, liquidity: 25000 },
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

function routeByUrl(routes: Record<string, unknown>) {
  return vi.fn(async (url: string, _options?: RequestInit) => {
    for (const [fragment, body] of Object.entries(routes)) {
      if (url.includes(fragment)) return jsonResponse(body);
    }
    throw new Error(`URL inattendue dans le test : ${url}`);
  });
}

describe('BirdeyeClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchTrendingPools hydrates each trending token with its price', async () => {
    const fetchMock = routeByUrl({
      '/defi/token_trending': trendingResponse,
      '/defi/price': priceResponse,
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createBirdeyeClient('https://public-api.birdeye.so', 'key', 0);

    const pools = await client.fetchTrendingPools('solana');

    expect(pools).toEqual([
      {
        poolAddress: 'TOKEN1',
        baseTokenSymbol: 'FOO',
        baseTokenAddress: 'TOKEN1',
        priceUsd: 0.5,
        liquidityUsd: 25000,
        volume24hUsd: 10000,
        priceChange24hPct: 5.5,
        // Birdeye ne fournit pas la vraie date de création sur le plan gratuit : le client se
        // contente d'un placeholder "vu à l'instant", que le pipeline (FirstSeenRepository)
        // remplace ensuite par la première détection connue.
        poolCreatedAt: expect.any(Date),
      },
    ]);
  });

  it('sends the API key and chain headers on every request', async () => {
    const fetchMock = routeByUrl({
      '/defi/token_trending': trendingResponse,
      '/defi/price': priceResponse,
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createBirdeyeClient('https://public-api.birdeye.so', 'ma-cle', 0);

    await client.fetchTrendingPools('solana');

    const [, options] = fetchMock.mock.calls[0]!;
    expect((options as RequestInit).headers).toMatchObject({
      'X-API-KEY': 'ma-cle',
      'x-chain': 'solana',
    });
  });

  it('fetchOhlcv maps Birdeye items (already chronological) into Candle objects', async () => {
    vi.stubGlobal('fetch', routeByUrl({ '/defi/ohlcv': ohlcvResponse }));
    const client = createBirdeyeClient('https://public-api.birdeye.so', 'key', 0);

    const candles = await client.fetchOhlcv('solana', 'TOKEN1', 'hour', 3);

    expect(candles.map((c) => c.close)).toEqual([1.1, 1.2, 1.35]);
    expect(candles[0].timestamp).toEqual(new Date(800 * 1000));
  });

  it('fetchPool maps token_overview into a Pool object', async () => {
    vi.stubGlobal('fetch', routeByUrl({ '/defi/token_overview': overviewResponse }));
    const client = createBirdeyeClient('https://public-api.birdeye.so', 'key', 0);

    const pool = await client.fetchPool('solana', 'TOKEN1');

    expect(pool).toEqual({
      poolAddress: 'TOKEN1',
      baseTokenSymbol: 'FOO',
      baseTokenAddress: 'TOKEN1',
      priceUsd: 0.42,
      liquidityUsd: 25000,
      volume24hUsd: 0,
      priceChange24hPct: 0,
      poolCreatedAt: expect.any(Date),
    });
  });

  it('fetchPool returns null instead of throwing for an unknown address', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 404)));
    const client = createBirdeyeClient('https://public-api.birdeye.so', 'key', 0);

    const pool = await client.fetchPool('solana', 'INCONNU');

    expect(pool).toBeNull();
  });

  it('does not retry a 404 for OHLCV', async () => {
    const notFoundFetch = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    vi.stubGlobal('fetch', notFoundFetch);
    const client = createBirdeyeClient('https://public-api.birdeye.so', 'key', 0);

    await expect(client.fetchOhlcv('solana', 'TOKEN1', 'hour', 3)).rejects.toThrow(/Birdeye/);
    expect(notFoundFetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 401 — an API key permission problem never resolves itself', async () => {
    // Cas réel rencontré : un endpoint hors du plan gratuit renvoie 401 sur chaque tentative,
    // ce qui gaspillait 4 requêtes (et leur backoff) avant que ce comportement soit ajouté.
    const unauthorizedFetch = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    vi.stubGlobal('fetch', unauthorizedFetch);
    const client = createBirdeyeClient('https://public-api.birdeye.so', 'key', 0);

    await expect(client.fetchOhlcv('solana', 'TOKEN1', 'hour', 3)).rejects.toThrow(/Birdeye/);
    expect(unauthorizedFetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 400 — e.g. Birdeye\'s "Compute units usage limit exceeded" never resolves on retry', async () => {
    // Cas réel rencontré : le quota mensuel de 30 000 CU épuisé renvoie 400 sur chaque appel,
    // gaspillant 4 requêtes (et leur backoff) avant que ce comportement soit ajouté.
    const quotaExceededFetch = vi.fn().mockResolvedValue(jsonResponse({}, 400));
    vi.stubGlobal('fetch', quotaExceededFetch);
    const client = createBirdeyeClient('https://public-api.birdeye.so', 'key', 0);

    await expect(client.fetchOhlcv('solana', 'TOKEN1', 'hour', 3)).rejects.toThrow(/Birdeye/);
    expect(quotaExceededFetch).toHaveBeenCalledTimes(1);
  });

  it('retries only once on a persistent 429, like the GeckoTerminal client did', async () => {
    vi.useFakeTimers();
    try {
      const rateLimited = vi.fn().mockResolvedValue(jsonResponse({}, 429));
      vi.stubGlobal('fetch', rateLimited);
      const client = createBirdeyeClient('https://public-api.birdeye.so', 'key', 0);

      const promise = client.fetchOhlcv('solana', 'TOKEN1', 'hour', 3);
      const assertion = expect(promise).rejects.toThrow(/Birdeye/);
      await vi.runAllTimersAsync();
      await assertion;

      expect(rateLimited).toHaveBeenCalledTimes(2); // 1 essai initial + 1 seule retentative
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits at least minIntervalMs between two consecutive Birdeye requests', async () => {
    vi.useFakeTimers();
    try {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(ohlcvResponse)));
      const client = createBirdeyeClient('https://public-api.birdeye.so', 'key', 1100);

      // Premier appel : pas d'attente (rien avant lui).
      const first = client.fetchOhlcv('solana', 'TOKEN1', 'hour', 3);
      await vi.advanceTimersByTimeAsync(0);
      await first;

      setTimeoutSpy.mockClear();
      const second = client.fetchOhlcv('solana', 'TOKEN2', 'hour', 3);
      await vi.advanceTimersByTimeAsync(0);
      const paceDelay = setTimeoutSpy.mock.calls.find(([, ms]) => (ms as number) >= 1000);
      expect(paceDelay).toBeDefined();

      await vi.runAllTimersAsync();
      await second;
    } finally {
      vi.useRealTimers();
    }
  });
});

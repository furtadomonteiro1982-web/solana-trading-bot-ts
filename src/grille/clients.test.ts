import { describe, expect, it, vi } from 'vitest';
import { fetchMarkets } from './coingeckoClient.js';
import { DefiLlamaClient, tvlDaysAgo } from './defillamaClient.js';

const respond = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body });

describe('tvlDaysAgo', () => {
  const day = 86_400;
  const points = [0, 100, 200].map((d) => ({ date: d * day, totalLiquidityUSD: d }));

  it('prend le dernier point connu avant la date visée', () => {
    expect(tvlDaysAgo(points, 150)).toBe(0);
    expect(tvlDaysAgo(points, 100)).toBe(100);
  });

  it("renvoie null si l'historique est trop court", () => {
    expect(tvlDaysAgo(points, 300)).toBeNull();
    expect(tvlDaysAgo([], 10)).toBeNull();
  });
});

describe('DefiLlamaClient', () => {
  it('lit les projets parents et les frais', async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url.includes('/lite/protocols2')
        ? respond({ parentProtocols: [{ id: 'parent#a', name: 'A' }] })
        : respond({ protocols: [{ defillamaId: '1', total1y: 5 }] })
    );
    const client = new DefiLlamaClient('https://exemple.test', fetchFn);

    expect(await client.fetchParents()).toEqual([{ id: 'parent#a', name: 'A' }]);
    expect(await client.fetchFees('dailyRevenue')).toEqual([{ defillamaId: '1', total1y: 5 }]);
    expect(fetchFn.mock.calls[1]![0]).toContain('dataType=dailyRevenue');
  });
});

describe('fetchDefiTvlChangePct', () => {
  it("calcule l'évolution de la TVL totale de la DeFi", async () => {
    const day = 86_400;
    const points = [0, 100, 200].map((d) => ({ date: d * day, tvl: d === 0 ? 50 : d === 100 ? 100 : 90 }));
    const client = new DefiLlamaClient('https://exemple.test', async () => respond(points));

    expect(await client.fetchDefiTvlChangePct(100)).toBeCloseTo(-10);
    expect(await client.fetchDefiTvlChangePct(500)).toBeNull();
  });
});

describe('fetchMarkets', () => {
  const row = {
    id: 'foo',
    current_price: 2,
    market_cap: 1e9,
    fully_diluted_valuation: 2e9,
    total_volume: 5e7,
    circulating_supply: 5e8,
    total_supply: 1e9,
    max_supply: null,
    ath_date: '2021-11-10T00:00:00.000Z',
    atl_date: '2020-09-16T00:00:00.000Z',
  };

  it('convertit les champs et retient la plus ancienne date connue de cotation', async () => {
    const markets = await fetchMarkets(['foo'], { fetchFn: async () => respond([row]), pauseMs: 0 });

    expect(markets.get('foo')).toMatchObject({ marketCapUsd: 1e9, volume24hUsd: 5e7, tradedSince: '2020-09-16' });
  });

  it('découpe les identifiants par lots de 200', async () => {
    const fetchFn = vi.fn(async () => respond([]));
    const ids = Array.from({ length: 450 }, (_, i) => `id${i}`);

    await fetchMarkets(ids, { fetchFn, pauseMs: 0 });

    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('attend puis réessaie quand CoinGecko limite le débit', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(respond({}, 429)).mockResolvedValueOnce(respond([row]));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const markets = await fetchMarkets(['foo'], { fetchFn, pauseMs: 0, rateLimitWaitsMs: [1] });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(markets.has('foo')).toBe(true);
  });

  it('abandonne après les tentatives prévues', async () => {
    const fetchFn = vi.fn(async () => respond({}, 429));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(fetchMarkets(['foo'], { fetchFn, pauseMs: 0, rateLimitWaitsMs: [1] })).rejects.toThrow(/429/);
  });
});

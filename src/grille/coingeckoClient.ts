import { defaultFetch, getJson, type FetchLike } from './http.js';
import type { MarketData } from './types.js';

// API publique de CoinGecko : gratuite, sans clé, mais limitée à quelques requêtes par minute.
export const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
const IDS_PER_CALL = 200;

interface RawMarket {
  id: string;
  current_price: number | null;
  market_cap: number | null;
  fully_diluted_valuation: number | null;
  total_volume: number | null;
  circulating_supply: number | null;
  total_supply: number | null;
  max_supply: number | null;
  ath_date: string | null;
  atl_date: string | null;
}

export async function fetchMarkets(
  geckoIds: string[],
  options: { baseUrl?: string; fetchFn?: FetchLike; pauseMs?: number; rateLimitWaitsMs?: number[] } = {}
): Promise<Map<string, MarketData>> {
  const baseUrl = options.baseUrl ?? COINGECKO_BASE_URL;
  const fetchFn = options.fetchFn ?? defaultFetch();
  const pauseMs = options.pauseMs ?? 6000;
  const result = new Map<string, MarketData>();
  const ids = [...new Set(geckoIds)];

  for (let i = 0; i < ids.length; i += IDS_PER_CALL) {
    if (i > 0 && pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    const batch = ids.slice(i, i + IDS_PER_CALL);
    const url =
      `${baseUrl}/coins/markets?vs_currency=usd&per_page=${IDS_PER_CALL}&page=1` +
      `&ids=${batch.map(encodeURIComponent).join(',')}`;
    const rows = (await getJsonWithRateLimit(url, fetchFn, options.rateLimitWaitsMs ?? [30_000, 60_000, 120_000])) as RawMarket[];
    for (const row of rows) {
      if (!row.market_cap || !row.current_price) continue;
      result.set(row.id, {
        priceUsd: row.current_price,
        marketCapUsd: row.market_cap,
        fdvUsd: row.fully_diluted_valuation,
        volume24hUsd: row.total_volume ?? 0,
        circulatingSupply: row.circulating_supply,
        totalSupply: row.total_supply,
        maxSupply: row.max_supply,
        tradedSince: earliestDate(row.ath_date, row.atl_date),
      });
    }
  }
  return result;
}

/** Le plan gratuit renvoie 429 quand on va trop vite : on attend puis on réessaie. */
async function getJsonWithRateLimit(url: string, fetchFn: FetchLike, waitsMs: number[]): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getJson(url, fetchFn, 'CoinGecko');
    } catch (error) {
      const limited = error instanceof Error && error.message.includes('a répondu 429');
      if (!limited || attempt >= waitsMs.length) throw error;
      console.warn(`CoinGecko limite le débit : nouvelle tentative dans ${waitsMs[attempt]! / 1000} s…`);
      await new Promise((resolve) => setTimeout(resolve, waitsMs[attempt]));
    }
  }
}

function earliestDate(...dates: (string | null)[]): string | null {
  const valid = dates.filter((date): date is string => Boolean(date)).map((date) => date.slice(0, 10));
  return valid.length === 0 ? null : valid.sort()[0]!;
}

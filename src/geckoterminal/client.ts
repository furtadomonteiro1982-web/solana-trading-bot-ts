import type { Candle, Pool } from '../types.js';

export interface GeckoTerminalClient {
  fetchTrendingPools(network: string): Promise<Pool[]>;
  fetchOhlcv(
    network: string,
    poolAddress: string,
    timeframe: 'day' | 'hour' | 'minute',
    limit: number
  ): Promise<Candle[]>;
  fetchPoolPrice(network: string, poolAddress: string): Promise<number | null>;
}

interface RawTokenIncluded {
  id: string;
  type: string;
  attributes: { symbol: string; name: string; address: string };
}

interface RawPoolData {
  attributes: {
    address: string;
    base_token_price_usd: string;
    pool_created_at: string;
    reserve_in_usd: string;
    volume_usd: { h24: string };
    price_change_percentage: { h24: string };
  };
  relationships: {
    base_token: { data: { id: string } };
  };
}

export class GeckoTerminalHttpClient implements GeckoTerminalClient {
  constructor(private baseUrl: string) {}

  async fetchTrendingPools(network: string): Promise<Pool[]> {
    const url = `${this.baseUrl}/networks/${network}/trending_pools?include=base_token`;
    const json = await fetchJsonWithRetry(url);
    const tokensById = new Map<string, RawTokenIncluded>();
    for (const item of json.included ?? []) {
      if (item.type === 'token') tokensById.set(item.id, item);
    }
    return (json.data as RawPoolData[]).map((raw) => {
      const baseTokenId = raw.relationships.base_token.data.id;
      const baseToken = tokensById.get(baseTokenId);
      return {
        poolAddress: raw.attributes.address,
        baseTokenSymbol: baseToken?.attributes.symbol ?? 'UNKNOWN',
        baseTokenAddress: baseToken?.attributes.address ?? '',
        priceUsd: parseFloat(raw.attributes.base_token_price_usd),
        liquidityUsd: parseFloat(raw.attributes.reserve_in_usd),
        volume24hUsd: parseFloat(raw.attributes.volume_usd.h24),
        priceChange24hPct: parseFloat(raw.attributes.price_change_percentage.h24),
        poolCreatedAt: new Date(raw.attributes.pool_created_at),
      };
    });
  }

  async fetchOhlcv(
    network: string,
    poolAddress: string,
    timeframe: 'day' | 'hour' | 'minute',
    limit: number
  ): Promise<Candle[]> {
    const url = `${this.baseUrl}/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=1&limit=${limit}&currency=usd`;
    const json = await fetchJsonWithRetry(url);
    const list: number[][] = json.data.attributes.ohlcv_list;
    return list
      .map(([timestamp, open, high, low, close, volume]) => ({
        timestamp: new Date(timestamp * 1000),
        open,
        high,
        low,
        close,
        volume,
      }))
      .reverse();
  }

  async fetchPoolPrice(network: string, poolAddress: string): Promise<number | null> {
    try {
      const url = `${this.baseUrl}/networks/${network}/pools/${poolAddress}`;
      const json = await fetchJsonWithRetry(url);
      return parseFloat(json.data.attributes.base_token_price_usd);
    } catch {
      return null;
    }
  }
}

export function createGeckoTerminalClient(baseUrl: string): GeckoTerminalClient {
  return new GeckoTerminalHttpClient(baseUrl);
}

async function fetchJsonWithRetry(url: string, retries = 3): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`GeckoTerminal API error: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(500 * Math.pow(2, attempt));
      }
    }
  }
  throw new Error(`Échec de la requête GeckoTerminal après ${retries + 1} tentatives : ${String(lastError)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

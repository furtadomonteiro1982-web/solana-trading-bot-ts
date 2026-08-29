import type { MarketDataClient } from '../marketdata/client.js';
import type { Candle, Pool } from '../types.js';

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

export class GeckoTerminalHttpClient implements MarketDataClient {
  private lastRequestAt = 0;

  constructor(
    private baseUrl: string,
    private minIntervalMs: number
  ) {}

  async fetchTrendingPools(network: string): Promise<Pool[]> {
    const url = `${this.baseUrl}/networks/${network}/trending_pools?include=base_token`;
    const json = await this.get(url);
    const tokensById = indexTokens(json.included);
    return (json.data as RawPoolData[]).map((raw) => mapPool(raw, tokensById));
  }

  async fetchOhlcv(
    network: string,
    poolAddress: string,
    timeframe: 'day' | 'hour' | 'minute',
    limit: number
  ): Promise<Candle[]> {
    const url = `${this.baseUrl}/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=1&limit=${limit}&currency=usd`;
    const json = await this.get(url);
    const list: number[][] = json.data.attributes.ohlcv_list;
    // L'API renvoie les bougies de la plus récente à la plus ancienne : on inverse pour l'ordre
    // chronologique attendu par le reste du pipeline (contrairement à Birdeye, déjà chronologique).
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

  async fetchPool(network: string, poolAddress: string): Promise<Pool | null> {
    try {
      const url = `${this.baseUrl}/networks/${network}/pools/${poolAddress}?include=base_token`;
      const json = await this.get(url);
      // Même forme que trending_pools, sauf que `data` est un objet unique et non un tableau.
      return mapPool(json.data as RawPoolData, indexTokens(json.included));
    } catch (error) {
      console.warn(
        `Avertissement : impossible de récupérer le pool ${poolAddress} : ${String(error)}`
      );
      return null;
    }
  }

  private async get(url: string): Promise<any> {
    await this.pace();
    return fetchJsonWithRetry(url);
  }

  /** Espace les requêtes selon minIntervalMs pour rester sous la limite de débit du plan gratuit. */
  private async pace(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < this.minIntervalMs) {
      await sleep(this.minIntervalMs - elapsed);
    }
    this.lastRequestAt = Date.now();
  }
}

function indexTokens(included: RawTokenIncluded[] | undefined): Map<string, RawTokenIncluded> {
  const tokensById = new Map<string, RawTokenIncluded>();
  for (const item of included ?? []) {
    if (item.type === 'token') tokensById.set(item.id, item);
  }
  return tokensById;
}

function mapPool(raw: RawPoolData, tokensById: Map<string, RawTokenIncluded>): Pool {
  const baseToken = tokensById.get(raw.relationships.base_token.data.id);
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
}

export function createGeckoTerminalClient(baseUrl: string, minIntervalMs = 1100): MarketDataClient {
  return new GeckoTerminalHttpClient(baseUrl, minIntervalMs);
}

// Backoffs de base pour une erreur générique (réseau, 5xx) : 500ms, 1s, 2s.
const DEFAULT_RETRY_DELAYS_MS = [500, 1000, 2000];
// Un seul essai supplémentaire sur 429 : au-delà, le quota est déjà épuisé et marteler l'API avec
// un ladder complet n'aide pas (voir l'historique de ce même correctif sur le client Birdeye).
const MAX_RATE_LIMIT_RETRIES = 1;
const RATE_LIMIT_RETRY_DELAY_MS = 5000;

async function fetchJsonWithRetry(url: string, retries = 3): Promise<any> {
  let lastError: unknown;
  let rateLimitRetriesUsed = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(DEFAULT_RETRY_DELAYS_MS[attempt] ?? 2000);
      }
      continue;
    }

    if (response.ok) {
      return await response.json();
    }

    if (response.status === 404) {
      throw new Error(`GeckoTerminal API error: 404 Not Found`);
    }

    // 400/401/403 ne se résolvent jamais en retentant la même requête (requête malformée ou clé/
    // ressource non autorisée) — contrairement à un 429 ou une erreur réseau transitoire.
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new Error(`GeckoTerminal API error: ${response.status} ${response.statusText}`);
    }

    lastError = new Error(`GeckoTerminal API error: ${response.status} ${response.statusText}`);

    if (response.status === 429) {
      if (rateLimitRetriesUsed >= MAX_RATE_LIMIT_RETRIES) {
        throw new Error(`Échec de la requête GeckoTerminal (429 persistant) : ${String(lastError)}`);
      }
      rateLimitRetriesUsed += 1;
      await sleep(retryAfterMs(response) ?? RATE_LIMIT_RETRY_DELAY_MS);
      continue;
    }

    if (attempt < retries) {
      await sleep(DEFAULT_RETRY_DELAYS_MS[attempt] ?? 2000);
    }
  }
  throw new Error(`Échec de la requête GeckoTerminal après ${retries + 1} tentatives : ${String(lastError)}`);
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers?.get?.('Retry-After');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const dateMs = Date.parse(header);
  return Number.isNaN(dateMs) ? null : Math.max(0, dateMs - Date.now());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  /** Récupère n'importe quel pool par son adresse (pas seulement les pools trending). */
  fetchPool(network: string, poolAddress: string): Promise<Pool | null>;
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
    } catch (error) {
      // On renvoie null (le gestionnaire de positions ignorera cette position pour ce cycle)
      // mais on trace l'échec : sans cela, un endpoint durablement en panne rendrait une position
      // silencieusement invisible aux vérifications stop-loss / take-profit.
      console.warn(
        `Avertissement : impossible de récupérer le prix du pool ${poolAddress} : ${String(error)}`
      );
      return null;
    }
  }

  async fetchPool(network: string, poolAddress: string): Promise<Pool | null> {
    try {
      const url = `${this.baseUrl}/networks/${network}/pools/${poolAddress}?include=base_token`;
      const json = await fetchJsonWithRetry(url);
      // Même forme que trending_pools, sauf que `data` est un objet unique et non un tableau.
      return mapPool(json.data as RawPoolData, indexTokens(json.included));
    } catch (error) {
      console.warn(
        `Avertissement : impossible de récupérer le pool ${poolAddress} : ${String(error)}`
      );
      return null;
    }
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

export function createGeckoTerminalClient(baseUrl: string): GeckoTerminalClient {
  return new GeckoTerminalHttpClient(baseUrl);
}

// Backoffs de base pour une erreur générique (réseau, 5xx) : 500ms, 1s, 2s.
const DEFAULT_RETRY_DELAYS_MS = [500, 1000, 2000];
// Un 429 signifie que le quota est déjà dépassé pour la fenêtre en cours : retenter avec le
// même ladder qu'une erreur générique (jusqu'à 3 fois) ne fait qu'aggraver le rate-limit en
// envoyant encore plus de requêtes pendant qu'il est actif. On ne s'autorise donc qu'une seule
// retentative sur 429 (budget indépendant des retries génériques), avec un délai généreux —
// respecté en priorité via l'en-tête Retry-After s'il est présent.
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
      // La ressource n'existe pas : inutile de gaspiller des tentatives dessus.
      throw new Error(`GeckoTerminal API error: 404 Not Found`);
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

/** Lit l'en-tête Retry-After (secondes ou date HTTP) et le convertit en millisecondes. */
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

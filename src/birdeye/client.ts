import type { MarketDataClient } from '../marketdata/client.js';
import type { Candle, Pool } from '../types.js';

interface RawTrendingToken {
  address: string;
  symbol: string;
  liquidity: number;
  volume24hUSD: number;
}

const TIMEFRAME_TO_BIRDEYE_TYPE: Record<'day' | 'hour' | 'minute', string> = {
  minute: '1m',
  hour: '1H',
  day: '1D',
};

const TIMEFRAME_SECONDS: Record<'day' | 'hour' | 'minute', number> = {
  minute: 60,
  hour: 3600,
  day: 86400,
};

export class BirdeyeHttpClient implements MarketDataClient {
  private lastRequestAt = 0;

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private minIntervalMs: number
  ) {}

  async fetchTrendingPools(network: string): Promise<Pool[]> {
    const url = `${this.baseUrl}/defi/token_trending?sort_by=liquidity&sort_type=desc&offset=0&limit=20`;
    const json = await this.get(url, network);
    const tokens: RawTrendingToken[] = json.data.tokens;
    const pools: Pool[] = [];
    for (const token of tokens) {
      const price = await this.fetchPrice(network, token.address);
      if (price === null) continue;
      pools.push({
        poolAddress: token.address,
        baseTokenSymbol: token.symbol,
        baseTokenAddress: token.address,
        priceUsd: price.value,
        liquidityUsd: token.liquidity,
        volume24hUsd: token.volume24hUSD,
        priceChange24hPct: price.priceChange24h,
        // Birdeye ne donne pas la date de création réelle sur le plan gratuit
        // (`token_creation_info` renvoie 401 "insufficient permissions"). Le pipeline
        // (FirstSeenRepository) remplace cette valeur par la date de première détection connue
        // du token — ici on ne fait qu'indiquer "vu à l'instant", le meilleur défaut en l'absence
        // d'historique.
        poolCreatedAt: new Date(),
      });
    }
    return pools;
  }

  async fetchOhlcv(
    network: string,
    poolAddress: string,
    timeframe: 'day' | 'hour' | 'minute',
    limit: number
  ): Promise<Candle[]> {
    const now = Math.floor(Date.now() / 1000);
    const timeFrom = now - limit * TIMEFRAME_SECONDS[timeframe];
    const url =
      `${this.baseUrl}/defi/ohlcv?address=${poolAddress}&type=${TIMEFRAME_TO_BIRDEYE_TYPE[timeframe]}` +
      `&time_from=${timeFrom}&time_to=${now}&currency=usd`;
    const json = await this.get(url, network);
    const items: { o: number; h: number; l: number; c: number; v: number; unixTime: number }[] =
      json.data.items;
    // Birdeye renvoie déjà les bougies en ordre chronologique croissant (contrairement à
    // GeckoTerminal), donc pas de reverse() nécessaire ici.
    return items.map((item) => ({
      timestamp: new Date(item.unixTime * 1000),
      open: item.o,
      high: item.h,
      low: item.l,
      close: item.c,
      volume: item.v,
    }));
  }

  async fetchPool(network: string, poolAddress: string): Promise<Pool | null> {
    try {
      // token_overview (20 CU) donne symbol+price+liquidity en un seul appel, moins cher que
      // /defi/price + une source séparée pour le symbole quand on ne connaît pas déjà le token
      // (contrairement à fetchTrendingPools, où le symbole vient gratuitement de la liste trending).
      const overviewUrl = `${this.baseUrl}/defi/token_overview?address=${poolAddress}`;
      const overview = await this.get(overviewUrl, network);
      return {
        poolAddress,
        baseTokenSymbol: overview.data.symbol,
        baseTokenAddress: poolAddress,
        priceUsd: overview.data.price,
        liquidityUsd: overview.data.liquidity,
        volume24hUsd: 0,
        priceChange24hPct: 0,
        // Non utilisé par le backtest (runBacktest ne lit jamais poolCreatedAt) ; laissé à "vu à
        // l'instant" par cohérence avec fetchTrendingPools, faute de date de création réelle
        // disponible sur le plan gratuit.
        poolCreatedAt: new Date(),
      };
    } catch (error) {
      console.warn(`Avertissement : impossible de récupérer le token ${poolAddress} : ${String(error)}`);
      return null;
    }
  }

  private async fetchPrice(
    network: string,
    address: string
  ): Promise<{ value: number; priceChange24h: number } | null> {
    try {
      const url = `${this.baseUrl}/defi/price?address=${address}`;
      const json = await this.get(url, network);
      return { value: json.data.value, priceChange24h: json.data.priceChange24h ?? 0 };
    } catch (error) {
      console.warn(`Avertissement : impossible de récupérer le prix de ${address} : ${String(error)}`);
      return null;
    }
  }

  private async get(url: string, network: string): Promise<any> {
    await this.pace();
    return fetchJsonWithRetry(url, {
      accept: 'application/json',
      'x-chain': network,
      'X-API-KEY': this.apiKey,
    });
  }

  /** Respecte la limite de 1 requête/seconde du plan gratuit Birdeye, tous appels confondus. */
  private async pace(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < this.minIntervalMs) {
      await sleep(this.minIntervalMs - elapsed);
    }
    this.lastRequestAt = Date.now();
  }
}

export function createBirdeyeClient(
  baseUrl: string,
  apiKey: string,
  minIntervalMs = 1100
): MarketDataClient {
  return new BirdeyeHttpClient(baseUrl, apiKey, minIntervalMs);
}

// Backoffs de base pour une erreur générique (réseau, 5xx) : 500ms, 1s, 2s.
const DEFAULT_RETRY_DELAYS_MS = [500, 1000, 2000];
// Un seul essai supplémentaire sur 429 (voir src/geckoterminal/client.ts historique) : au-delà,
// le quota est déjà épuisé et marteler l'API avec un ladder complet n'aide pas.
const MAX_RATE_LIMIT_RETRIES = 1;
const RATE_LIMIT_RETRY_DELAY_MS = 5000;

async function fetchJsonWithRetry(
  url: string,
  headers: Record<string, string>,
  retries = 3
): Promise<any> {
  let lastError: unknown;
  let rateLimitRetriesUsed = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { headers });
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
      throw new Error(`Birdeye API error: 404 Not Found`);
    }

    // Un 401/403 signifie que la clé n'a pas accès à cette ressource (endpoint hors du plan
    // gratuit, par exemple) — retenter ne changera jamais le résultat, contrairement à un 429 ou
    // une erreur réseau transitoire. Un 400 est dans la même catégorie : rencontré en usage réel
    // pour "Compute units usage limit exceeded" (quota mensuel épuisé) — martelé 4 fois avant que
    // ce comportement soit ajouté, sans jamais réussir, pour la même raison qu'un 401 persistant.
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new Error(`Birdeye API error: ${response.status} ${response.statusText}`);
    }

    lastError = new Error(`Birdeye API error: ${response.status} ${response.statusText}`);

    if (response.status === 429) {
      if (rateLimitRetriesUsed >= MAX_RATE_LIMIT_RETRIES) {
        throw new Error(`Échec de la requête Birdeye (429 persistant) : ${String(lastError)}`);
      }
      rateLimitRetriesUsed += 1;
      await sleep(retryAfterMs(response) ?? RATE_LIMIT_RETRY_DELAY_MS);
      continue;
    }

    if (attempt < retries) {
      await sleep(DEFAULT_RETRY_DELAYS_MS[attempt] ?? 2000);
    }
  }
  throw new Error(`Échec de la requête Birdeye après ${retries + 1} tentatives : ${String(lastError)}`);
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

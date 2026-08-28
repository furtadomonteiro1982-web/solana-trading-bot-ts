import type { Candle, Pool } from '../types.js';

export interface MarketDataClient {
  fetchTrendingPools(network: string): Promise<Pool[]>;
  fetchOhlcv(
    network: string,
    poolAddress: string,
    timeframe: 'day' | 'hour' | 'minute',
    limit: number
  ): Promise<Candle[]>;
  /** Récupère n'importe quel token par son adresse (pas seulement les tokens trending). */
  fetchPool(network: string, poolAddress: string): Promise<Pool | null>;
}

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
  // Coûte 40 CU par adresse et la date de création ne change jamais : on ne la récupère
  // qu'une seule fois par token pour la durée de vie du processus.
  private creationDateCache = new Map<string, Date>();
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
      const [price, poolCreatedAt] = await Promise.all([
        this.fetchPrice(network, token.address),
        this.fetchCreationDate(network, token.address),
      ]);
      if (price === null || poolCreatedAt === null) continue;
      pools.push({
        poolAddress: token.address,
        baseTokenSymbol: token.symbol,
        baseTokenAddress: token.address,
        priceUsd: price.value,
        liquidityUsd: token.liquidity,
        volume24hUsd: token.volume24hUSD,
        priceChange24hPct: price.priceChange24h,
        poolCreatedAt,
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
      const poolCreatedAt = await this.fetchCreationDate(network, poolAddress);
      if (poolCreatedAt === null) return null;
      return {
        poolAddress,
        baseTokenSymbol: overview.data.symbol,
        baseTokenAddress: poolAddress,
        priceUsd: overview.data.price,
        liquidityUsd: overview.data.liquidity,
        volume24hUsd: 0,
        priceChange24hPct: 0,
        poolCreatedAt,
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

  private async fetchCreationDate(network: string, address: string): Promise<Date | null> {
    const cached = this.creationDateCache.get(address);
    if (cached) return cached;
    try {
      const url = `${this.baseUrl}/defi/token_creation_info?address=${address}`;
      const json = await this.get(url, network);
      const date = new Date(json.data.blockUnixTime * 1000);
      this.creationDateCache.set(address, date);
      return date;
    } catch (error) {
      console.warn(
        `Avertissement : impossible de récupérer la date de création de ${address} : ${String(error)}`
      );
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

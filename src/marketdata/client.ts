import type { Candle, Pool } from '../types.js';

export interface MarketDataClient {
  fetchTrendingPools(network: string): Promise<Pool[]>;
  fetchOhlcv(
    network: string,
    poolAddress: string,
    timeframe: 'day' | 'hour' | 'minute',
    limit: number
  ): Promise<Candle[]>;
  /** Récupère n'importe quel token/pool par son adresse (pas seulement ceux qui sont trending). */
  fetchPool(network: string, poolAddress: string): Promise<Pool | null>;
}

/**
 * Bascule automatiquement sur `secondary` quand `primary` échoue (429 persistant, panne, quota
 * épuisé...). Chaque méthode est indépendante : un échec sur fetchOhlcv pour un pool donné ne fait
 * pas basculer fetchTrendingPools pour le reste du cycle — chaque appel retente sa chance sur la
 * source principale.
 */
export function createFallbackClient(
  primary: MarketDataClient,
  secondary: MarketDataClient
): MarketDataClient {
  return {
    async fetchTrendingPools(network) {
      try {
        return await primary.fetchTrendingPools(network);
      } catch (error) {
        console.warn(`Source principale indisponible pour fetchTrendingPools, bascule sur le secours : ${String(error)}`);
        return secondary.fetchTrendingPools(network);
      }
    },
    async fetchOhlcv(network, poolAddress, timeframe, limit) {
      try {
        return await primary.fetchOhlcv(network, poolAddress, timeframe, limit);
      } catch (error) {
        console.warn(`Source principale indisponible pour fetchOhlcv, bascule sur le secours : ${String(error)}`);
        return secondary.fetchOhlcv(network, poolAddress, timeframe, limit);
      }
    },
    async fetchPool(network, poolAddress) {
      // fetchPool ne lève jamais (chaque implémentation avale ses propres erreurs et renvoie
      // null) : on bascule donc aussi sur un null, pas seulement sur une exception — un null peut
      // aussi bien signifier "en échec" que "introuvable sur cette source précise".
      const result = await primary.fetchPool(network, poolAddress);
      if (result !== null) return result;
      return secondary.fetchPool(network, poolAddress);
    },
  };
}

/**
 * Met en cache les réponses fetchOhlcv en mémoire, par (network, poolAddress, timeframe, limit),
 * pendant ttlMs. Avec un scan toutes les scanIntervalSeconds et un timeframe "hour", les bougies
 * changent à peine d'un cycle à l'autre — retélécharger l'historique complet à chaque cycle pour
 * les mêmes quelques pools gaspille une grosse partie du quota de débit de GeckoTerminal pour rien.
 * fetchTrendingPools et fetchPool ne sont pas mis en cache : leurs prix doivent rester à jour à
 * chaque cycle (scan, revue des positions).
 */
export function createCachedClient(
  client: MarketDataClient,
  ttlMs: number,
  now: () => number = Date.now
): MarketDataClient {
  const cache = new Map<string, { candles: Candle[]; cachedAt: number }>();
  return {
    fetchTrendingPools: (network) => client.fetchTrendingPools(network),
    fetchPool: (network, poolAddress) => client.fetchPool(network, poolAddress),
    async fetchOhlcv(network, poolAddress, timeframe, limit) {
      const key = `${network}:${poolAddress}:${timeframe}:${limit}`;
      const cached = cache.get(key);
      if (cached && now() - cached.cachedAt < ttlMs) {
        return cached.candles;
      }
      const candles = await client.fetchOhlcv(network, poolAddress, timeframe, limit);
      cache.set(key, { candles, cachedAt: now() });
      return candles;
    },
  };
}

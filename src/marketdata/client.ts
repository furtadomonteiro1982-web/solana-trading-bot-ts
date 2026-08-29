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

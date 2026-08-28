import type { BotConfig } from './config.js';
import type { FilterResult, Pool } from './types.js';

export function filterPools(pools: Pool[], config: BotConfig, now: Date = new Date()): FilterResult[] {
  return pools.map((pool) => {
    // Données incomplètes ou aberrantes -> pool écarté (exigence du cahier des charges).
    // Sans ce garde-fou, un prix NaN (champ absent côté API) traverserait le filtre : toute
    // comparaison numérique avec NaN vaut `false`, donc les seuils ci-dessous laisseraient
    // passer le pool au lieu de le rejeter.
    if (!Number.isFinite(pool.priceUsd) || pool.priceUsd <= 0) {
      return {
        pool,
        passed: false,
        reason: `Données aberrantes : prix invalide (${pool.priceUsd})`,
      };
    }
    if (!Number.isFinite(pool.liquidityUsd)) {
      return {
        pool,
        passed: false,
        reason: `Données aberrantes : liquidité invalide (${pool.liquidityUsd})`,
      };
    }
    if (Number.isNaN(pool.poolCreatedAt.getTime())) {
      return {
        pool,
        passed: false,
        reason: 'Données incomplètes : date de création du pool invalide',
      };
    }
    if (pool.liquidityUsd < config.filters.minLiquidityUsd) {
      return {
        pool,
        passed: false,
        reason: `Liquidité ${pool.liquidityUsd.toFixed(0)}$ < minimum ${config.filters.minLiquidityUsd}$`,
      };
    }
    const ageMinutes = (now.getTime() - pool.poolCreatedAt.getTime()) / 60000;
    if (ageMinutes < config.filters.minPoolAgeMinutes) {
      return {
        pool,
        passed: false,
        reason: `Pool âgé de ${ageMinutes.toFixed(1)} min < minimum ${config.filters.minPoolAgeMinutes} min`,
      };
    }
    return { pool, passed: true, reason: 'OK' };
  });
}

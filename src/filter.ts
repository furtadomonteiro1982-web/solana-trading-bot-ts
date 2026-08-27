import type { BotConfig } from './config.js';
import type { FilterResult, Pool } from './types.js';

export function filterPools(pools: Pool[], config: BotConfig, now: Date = new Date()): FilterResult[] {
  return pools.map((pool) => {
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

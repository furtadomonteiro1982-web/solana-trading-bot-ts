import type { BotConfig } from '../config.js';

export interface SnipeRiskDecision {
  approved: boolean;
  reason: string;
  positionSizeUsd?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

export function evaluateSnipeRisk(
  entryPriceUsd: number,
  openSnipesCount: number,
  config: BotConfig
): SnipeRiskDecision {
  if (openSnipesCount >= config.sniper.maxOpenSnipes) {
    return {
      approved: false,
      reason: `Nombre max de snipes ouverts atteint (${openSnipesCount}/${config.sniper.maxOpenSnipes})`,
    };
  }
  return {
    approved: true,
    reason: 'Approuvé',
    positionSizeUsd: config.sniper.stakeUsd,
    stopLossPrice: entryPriceUsd * (1 - config.sniper.stopLossPct / 100),
    takeProfitPrice: entryPriceUsd * (1 + config.sniper.takeProfitPct / 100),
  };
}

import type { BotConfig } from './config.js';
import type { RiskDecision, Signal } from './types.js';

export function evaluateRisk(
  signal: Signal,
  openPositionsCount: number,
  availableCapitalUsd: number,
  config: BotConfig
): RiskDecision {
  if (signal.decision !== 'BUY') {
    return { approved: false, reason: `Signal n'est pas BUY (${signal.decision})` };
  }
  if (openPositionsCount >= config.risk.maxOpenPositions) {
    return {
      approved: false,
      reason: `Nombre max de positions ouvertes atteint (${openPositionsCount}/${config.risk.maxOpenPositions})`,
    };
  }
  const positionSizeUsd = (availableCapitalUsd * config.risk.maxPositionPct) / 100;
  if (positionSizeUsd <= 0) {
    return { approved: false, reason: 'Capital disponible insuffisant' };
  }
  const entryPrice = signal.pool.priceUsd;
  const stopLossPrice = entryPrice * (1 - config.risk.stopLossPct / 100);
  const takeProfitPrice = entryPrice * (1 + config.risk.takeProfitPct / 100);
  return {
    approved: true,
    reason: 'Approuvé',
    positionSizeUsd,
    stopLossPrice,
    takeProfitPrice,
    trailingStopPct: config.risk.trailingStopPct,
  };
}

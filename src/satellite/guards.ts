import fs from 'node:fs';
import type { Position, PositionStrategy } from '../types.js';

// Garde-fous du satellite (docs/agents.md, « Règles du satellite » et « Règles communes ») :
// interrupteur STOP, coupe-circuit sur la perte du jour, exposition maximale. Ils ne bloquent que
// les OUVERTURES : fermer une position (stop, objectif, délai) réduit le risque, donc le Veilleur
// continue de le faire même quand STOP est présent ou que le coupe-circuit est déclenché.

export interface SatelliteGuardSettings {
  /** Perte réalisée maximale sur la journée (UTC), en % du capital de la stratégie. */
  maxDailyLossPct: number;
  /** Total des positions ouvertes maximal, en % du capital de la stratégie. */
  maxExposurePct: number;
  /** Fichier dont la seule présence bloque toute nouvelle position. */
  stopFile: string;
}

export const DEFAULT_SATELLITE_GUARDS: SatelliteGuardSettings = {
  maxDailyLossPct: 5,
  maxExposurePct: 50,
  stopFile: 'STOP',
};

export interface GuardInput {
  strategy: PositionStrategy;
  capitalUsd: number;
  newPositionSizeUsd: number;
  openPositions: Position[];
  closedToday: Position[];
  stopRequested: boolean;
  settings: SatelliteGuardSettings;
}

export type GuardDecision = { allowed: true } | { allowed: false; reason: string };

export function checkSatelliteGuards(input: GuardInput): GuardDecision {
  const { strategy, capitalUsd, settings } = input;
  if (input.stopRequested) {
    return { allowed: false, reason: `Interrupteur STOP présent (${settings.stopFile}) : aucune nouvelle position` };
  }

  const realizedTodayUsd = input.closedToday
    .filter((p) => p.strategy === strategy)
    .reduce((sum, p) => sum + (p.pnlUsd ?? 0), 0);
  const maxLossUsd = (capitalUsd * settings.maxDailyLossPct) / 100;
  if (-realizedTodayUsd >= maxLossUsd) {
    return {
      allowed: false,
      reason:
        `Coupe-circuit : perte réalisée aujourd'hui ${(-realizedTodayUsd).toFixed(2)}$ ≥ ${maxLossUsd.toFixed(2)}$ ` +
        `(${settings.maxDailyLossPct} % du capital), reprise demain (UTC)`,
    };
  }

  const exposureUsd = input.openPositions.filter((p) => p.strategy === strategy).reduce((sum, p) => sum + p.sizeUsd, 0);
  const maxExposureUsd = (capitalUsd * settings.maxExposurePct) / 100;
  if (exposureUsd + input.newPositionSizeUsd > maxExposureUsd + 1e-9) {
    return {
      allowed: false,
      reason:
        `Exposition maximale : ${exposureUsd.toFixed(2)}$ déjà engagés + ${input.newPositionSizeUsd.toFixed(2)}$ ` +
        `dépasseraient ${maxExposureUsd.toFixed(2)}$ (${settings.maxExposurePct} % du capital)`,
    };
  }
  return { allowed: true };
}

/** Début de la journée UTC de `now` : la perte du jour se compte à partir de là. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function isStopRequested(stopFile: string): boolean {
  return fs.existsSync(stopFile);
}

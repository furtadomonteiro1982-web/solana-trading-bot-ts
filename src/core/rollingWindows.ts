import { runCoreBacktest, runSingleAssetBenchmark } from './dcaBacktest.js';
import type { AlignedDay, CoreBacktestConfig } from './types.js';

export interface WindowResult {
  startDate: string;
  endDate: string;
  coreGainPct: number;
  coreMaxDrawdownPct: number;
  benchmarkGainPct: number;
  benchmarkMaxDrawdownPct: number;
  /** Critère de docs/agents.md : baisse maximale du cœur ≤ celle de la référence. */
  passesDrawdownCriterion: boolean;
}

export interface RollingSummary {
  windows: WindowResult[];
  /** Part des fenêtres qui passent le critère de baisse maximale, en %. */
  passRatePct: number;
  /** Part des fenêtres où le cœur gagne plus que la référence, en %. */
  beatsBenchmarkPct: number;
  coreGainPct: { min: number; median: number; max: number };
  benchmarkGainPct: { min: number; median: number; max: number };
  coreMaxDrawdownPct: { median: number; worst: number };
  benchmarkMaxDrawdownPct: { median: number; worst: number };
}

/**
 * Rejoue le cœur et la référence sur des fenêtres de `windowDays` jours qui démarrent tous les
 * `stepDays` jours : un seul départ juge la stratégie sur une période particulière, plusieurs
 * départs montrent si elle tient dans des marchés différents.
 */
export function runRollingWindows(
  days: AlignedDay[],
  windowDays: number,
  stepDays: number,
  config: CoreBacktestConfig,
  benchmarkAsset: string
): RollingSummary {
  if (!Number.isInteger(windowDays) || windowDays <= 0) throw new Error('windowDays doit être un entier positif.');
  if (!Number.isInteger(stepDays) || stepDays <= 0) throw new Error('stepDays doit être un entier positif.');
  if (days.length < windowDays) {
    throw new Error(
      `Historique trop court : ${days.length} jours communs à tous les actifs, ${windowDays} nécessaires pour une fenêtre.`
    );
  }

  const windows: WindowResult[] = [];
  for (let start = 0; start + windowDays <= days.length; start += stepDays) {
    const slice = days.slice(start, start + windowDays);
    const core = runCoreBacktest(slice, config);
    const benchmark = runSingleAssetBenchmark(slice, benchmarkAsset, config);
    windows.push({
      startDate: core.startDate,
      endDate: core.endDate,
      coreGainPct: core.gainPct,
      coreMaxDrawdownPct: core.maxDrawdownPct,
      benchmarkGainPct: benchmark.gainPct,
      benchmarkMaxDrawdownPct: benchmark.maxDrawdownPct,
      passesDrawdownCriterion: core.maxDrawdownPct <= benchmark.maxDrawdownPct,
    });
  }

  const share = (predicate: (w: WindowResult) => boolean) =>
    (windows.filter(predicate).length / windows.length) * 100;
  const spread = (values: number[]) => ({ min: Math.min(...values), median: median(values), max: Math.max(...values) });

  return {
    windows,
    passRatePct: share((w) => w.passesDrawdownCriterion),
    beatsBenchmarkPct: share((w) => w.coreGainPct > w.benchmarkGainPct),
    coreGainPct: spread(windows.map((w) => w.coreGainPct)),
    benchmarkGainPct: spread(windows.map((w) => w.benchmarkGainPct)),
    coreMaxDrawdownPct: {
      median: median(windows.map((w) => w.coreMaxDrawdownPct)),
      worst: Math.max(...windows.map((w) => w.coreMaxDrawdownPct)),
    },
    benchmarkMaxDrawdownPct: {
      median: median(windows.map((w) => w.benchmarkMaxDrawdownPct)),
      worst: Math.max(...windows.map((w) => w.benchmarkMaxDrawdownPct)),
    },
  };
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

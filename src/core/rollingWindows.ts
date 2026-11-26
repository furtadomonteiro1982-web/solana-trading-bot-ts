import { runCoreBacktest, runSingleAssetBenchmark } from './dcaBacktest.js';
import type { AlignedDay, CoreBacktestConfig } from './types.js';

export interface WindowResult {
  startDate: string;
  endDate: string;
  coreGainPct: number;
  coreMaxDrawdownPct: number;
  benchmarkGainPct: number;
  benchmarkMaxDrawdownPct: number;
}

export interface RollingSummary {
  windows: WindowResult[];
  /** Part des fenêtres où le cœur gagne plus que la référence, en %. */
  beatsBenchmarkPct: number;
  coreGainPct: { min: number; median: number; max: number };
  benchmarkGainPct: { min: number; median: number; max: number };
  coreMaxDrawdownPct: { median: number; worst: number };
  benchmarkMaxDrawdownPct: { median: number; worst: number };
  /** Part des fenêtres terminées en perte, en %. */
  coreLossPct: number;
  benchmarkLossPct: number;
  /**
   * Critère de docs/agents.md : baisse maximale médiane du cœur strictement plus faible que celle
   * de la référence, et part de fenêtres en perte pas plus grande. Jugé sur l'ensemble des
   * fenêtres : une fenêtre seule dépend trop de son point de départ.
   */
  passesCriterion: boolean;
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
    });
  }

  const share = (predicate: (w: WindowResult) => boolean) =>
    (windows.filter(predicate).length / windows.length) * 100;
  const spread = (values: number[]) => ({ min: Math.min(...values), median: median(values), max: Math.max(...values) });

  const coreMedianDrawdown = median(windows.map((w) => w.coreMaxDrawdownPct));
  const benchmarkMedianDrawdown = median(windows.map((w) => w.benchmarkMaxDrawdownPct));
  const coreLossPct = share((w) => w.coreGainPct < 0);
  const benchmarkLossPct = share((w) => w.benchmarkGainPct < 0);

  return {
    windows,
    beatsBenchmarkPct: share((w) => w.coreGainPct > w.benchmarkGainPct),
    coreGainPct: spread(windows.map((w) => w.coreGainPct)),
    benchmarkGainPct: spread(windows.map((w) => w.benchmarkGainPct)),
    coreMaxDrawdownPct: {
      median: coreMedianDrawdown,
      worst: Math.max(...windows.map((w) => w.coreMaxDrawdownPct)),
    },
    benchmarkMaxDrawdownPct: {
      median: benchmarkMedianDrawdown,
      worst: Math.max(...windows.map((w) => w.benchmarkMaxDrawdownPct)),
    },
    coreLossPct,
    benchmarkLossPct,
    passesCriterion: coreMedianDrawdown < benchmarkMedianDrawdown && coreLossPct <= benchmarkLossPct,
  };
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

import { runCoreBacktest, runSingleAssetBenchmark } from '../core/dcaBacktest.js';
import type { AlignedDay, CoreBacktestConfig } from '../core/types.js';
import type { ReportPeriod } from './period.js';

export interface PortfolioLine {
  label: string;
  capitalUsd: number;
  valueAtStartUsd: number;
  valueAtEndUsd: number;
}

/**
 * Le cœur simulé « en direct » : les mêmes achats hebdomadaires que le test sur le passé, rejoués
 * depuis la date de départ de la simulation jusqu'à la fin de la période. Sans état à garder :
 * avec les mêmes prix, le résultat est toujours le même.
 */
export function corePortfolioLines(
  days: AlignedDay[],
  simulationStart: string,
  period: ReportPeriod,
  config: CoreBacktestConfig,
  benchmarkAsset: string
): PortfolioLine[] {
  const window = days.filter((day) => day.date >= simulationStart && day.date <= period.end);
  if (window.length === 0 || window[window.length - 1]!.date !== period.end) {
    throw new Error(`Prix manquants : il faut les prix de tous les actifs du ${simulationStart} au ${period.end}.`);
  }
  if (window[0]!.date !== simulationStart) {
    throw new Error(
      `Prix manquants : l'historique commun à tous les actifs ne commence que le ${window[0]!.date}, ` +
        `après le départ de la simulation (${simulationStart}). Un actif était-il déjà coté ?`
    );
  }
  const valueOn = (values: { date: string; valueUsd: number }[], date: string, fallback: number) => {
    const before = values.filter((point) => point.date < date);
    return before.length === 0 ? fallback : before[before.length - 1]!.valueUsd;
  };
  const line = (label: string, result: ReturnType<typeof runCoreBacktest>): PortfolioLine => ({
    label,
    capitalUsd: config.capitalUsd,
    valueAtStartUsd: valueOn(result.dailyValues, period.start, config.capitalUsd),
    valueAtEndUsd: result.finalValueUsd,
  });
  return [
    line('Cœur', runCoreBacktest(window, config)),
    line(`${benchmarkAsset} seul, mêmes achats que le cœur`, runSingleAssetBenchmark(window, benchmarkAsset, config)),
  ];
}

/** `capitalUsd` placés d'un coup dans `asset` le jour du départ : la référence du satellite. */
export function lumpSumLine(
  days: AlignedDay[],
  asset: string,
  simulationStart: string,
  period: ReportPeriod,
  capitalUsd: number,
  label: string
): PortfolioLine {
  const priceOn = (date: string, strictlyBefore: boolean) => {
    const eligible = days.filter((day) => (strictlyBefore ? day.date < date : day.date <= date) && day.date >= simulationStart);
    return eligible.length === 0 ? null : eligible[eligible.length - 1]!.prices[asset]!;
  };
  const entry = days.find((day) => day.date >= simulationStart)?.prices[asset];
  const atEnd = priceOn(period.end, false);
  if (!entry || !atEnd) throw new Error(`Prix de ${asset} manquants pour la période.`);
  const atStart = priceOn(period.start, true) ?? entry;
  return {
    label,
    capitalUsd,
    valueAtStartUsd: (capitalUsd * atStart) / entry,
    valueAtEndUsd: (capitalUsd * atEnd) / entry,
  };
}

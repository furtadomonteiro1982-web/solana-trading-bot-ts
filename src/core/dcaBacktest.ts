import type { AlignedDay, CoreBacktestConfig, CoreBacktestResult, RebalanceEvent } from './types.js';

/**
 * Rejoue sur des prix passés la stratégie du cœur : achats hebdomadaires d'un montant fixe
 * répartis selon les parts cibles (DCA), puis rééquilibrage au premier jour de chaque trimestre
 * civil si un actif s'écarte de sa cible de plus de rebalanceThresholdPts.
 *
 * Les écarts sont mesurés sur la seule partie crypto, cibles ramenées à 100 % : la réserve USDC
 * ne bouge pas avec le marché, l'inclure ferait vendre des cryptos à chaque hausse.
 *
 * Déterministe et sans réseau : les prix viennent de l'appelant.
 */
export function runCoreBacktest(days: AlignedDay[], config: CoreBacktestConfig): CoreBacktestResult {
  validate(days, config);

  const assets = Object.keys(config.targets).filter((asset) => config.targets[asset]! > 0);
  const cryptoTargetSum = assets.reduce((sum, asset) => sum + config.targets[asset]!, 0);
  const normalizedTargets: Record<string, number> = {};
  for (const asset of assets) normalizedTargets[asset] = (config.targets[asset]! / cryptoTargetSum) * 100;

  const costRate = (config.feePct + config.slippagePct) / 100;
  const weeklyAmount = config.capitalUsd / config.dcaWeeks;
  const quantities: Record<string, number> = Object.fromEntries(assets.map((asset) => [asset, 0]));
  let uninvestedUsd = config.capitalUsd;
  let reserveUsd = 0;
  let feesUsd = 0;
  let buysDone = 0;
  const rebalances: RebalanceEvent[] = [];
  const dailyValues: { date: string; valueUsd: number }[] = [];

  const buy = (asset: string, spendUsd: number, price: number) => {
    const cost = spendUsd * costRate;
    feesUsd += cost;
    quantities[asset]! += (spendUsd - cost) / price;
  };

  for (let i = 0; i < days.length; i++) {
    const day = days[i]!;

    if (i > 0 && quarterOf(day.date) !== quarterOf(days[i - 1]!.date)) {
      const event = rebalanceIfNeeded(day, assets, normalizedTargets, quantities, config, costRate);
      if (event) {
        rebalances.push(event.event);
        feesUsd += event.feesUsd;
      }
    }

    if (i % 7 === 0 && buysDone < config.dcaWeeks) {
      for (const asset of assets) {
        buy(asset, (weeklyAmount * config.targets[asset]!) / 100, day.prices[asset]!);
      }
      reserveUsd += (weeklyAmount * (100 - cryptoTargetSum)) / 100;
      uninvestedUsd -= weeklyAmount;
      buysDone++;
    }

    dailyValues.push({
      date: day.date,
      valueUsd: cryptoValue(day, assets, quantities) + reserveUsd + uninvestedUsd,
    });
  }

  const lastDay = days[days.length - 1]!;
  const finalCrypto = cryptoValue(lastDay, assets, quantities);
  const finalValueUsd = finalCrypto + reserveUsd + uninvestedUsd;
  const finalWeightsPct: Record<string, number> = {};
  for (const asset of assets) {
    finalWeightsPct[asset] = finalCrypto > 0 ? ((quantities[asset]! * lastDay.prices[asset]!) / finalCrypto) * 100 : 0;
  }

  return {
    startDate: days[0]!.date,
    endDate: lastDay.date,
    buysDone,
    investedUsd: weeklyAmount * buysDone,
    finalValueUsd,
    gainPct: ((finalValueUsd - config.capitalUsd) / config.capitalUsd) * 100,
    maxDrawdownPct: maxDrawdownPct(dailyValues.map((d) => d.valueUsd)),
    feesUsd,
    rebalances,
    finalWeightsPct,
    reserveUsd,
    dailyValues,
  };
}

/** Même calendrier d'achats et mêmes coûts, mais 100 % dans un seul actif : la référence à battre. */
export function runSingleAssetBenchmark(
  days: AlignedDay[],
  asset: string,
  config: CoreBacktestConfig
): CoreBacktestResult {
  return runCoreBacktest(days, { ...config, targets: { [asset]: 100 } });
}

function rebalanceIfNeeded(
  day: AlignedDay,
  assets: string[],
  normalizedTargets: Record<string, number>,
  quantities: Record<string, number>,
  config: CoreBacktestConfig,
  costRate: number
): { event: RebalanceEvent; feesUsd: number } | null {
  const total = cryptoValue(day, assets, quantities);
  if (total <= 0) return null;

  let worstAsset = assets[0]!;
  let worstDeviation = 0;
  for (const asset of assets) {
    const weight = ((quantities[asset]! * day.prices[asset]!) / total) * 100;
    const deviation = Math.abs(weight - normalizedTargets[asset]!);
    if (deviation > worstDeviation) {
      worstDeviation = deviation;
      worstAsset = asset;
    }
  }
  if (worstDeviation <= config.rebalanceThresholdPts) return null;

  // Ventes d'abord, puis achats avec le produit net des ventes : les frais réduisent légèrement
  // ce qui peut être racheté, d'où la mise à l'échelle des achats.
  let feesUsd = 0;
  let proceeds = 0;
  const shortfalls: Record<string, number> = {};
  let totalShortfall = 0;
  for (const asset of assets) {
    const price = day.prices[asset]!;
    const diff = (total * normalizedTargets[asset]!) / 100 - quantities[asset]! * price;
    if (diff < 0) {
      const cost = -diff * costRate;
      feesUsd += cost;
      proceeds += -diff - cost;
      quantities[asset]! -= -diff / price;
    } else if (diff > 0) {
      shortfalls[asset] = diff;
      totalShortfall += diff;
    }
  }
  const scale = totalShortfall > 0 ? Math.min(1, proceeds / totalShortfall) : 0;
  for (const [asset, shortfall] of Object.entries(shortfalls)) {
    const spend = shortfall * scale;
    const cost = spend * costRate;
    feesUsd += cost;
    quantities[asset]! += (spend - cost) / day.prices[asset]!;
  }

  return { event: { date: day.date, worstAsset, deviationPts: worstDeviation }, feesUsd };
}

function cryptoValue(day: AlignedDay, assets: string[], quantities: Record<string, number>): number {
  return assets.reduce((sum, asset) => sum + quantities[asset]! * day.prices[asset]!, 0);
}

function quarterOf(date: string): string {
  const [year, month] = date.split('-');
  return `${year}-T${Math.floor((Number(month) - 1) / 3) + 1}`;
}

export function maxDrawdownPct(values: number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) worst = Math.max(worst, ((peak - value) / peak) * 100);
  }
  return worst;
}

function validate(days: AlignedDay[], config: CoreBacktestConfig): void {
  if (days.length === 0) throw new Error('Aucun jour de prix : impossible de rejouer le cœur.');
  if (config.capitalUsd <= 0) throw new Error('capitalUsd doit être positif.');
  if (!Number.isInteger(config.dcaWeeks) || config.dcaWeeks <= 0) {
    throw new Error('dcaWeeks doit être un entier positif.');
  }
  const entries = Object.entries(config.targets);
  if (entries.some(([, pct]) => pct < 0)) throw new Error('Une part cible ne peut pas être négative.');
  const sum = entries.reduce((total, [, pct]) => total + pct, 0);
  if (sum <= 0 || sum > 100 + 1e-9) {
    throw new Error(`La somme des parts cibles doit être entre 0 et 100 % (actuellement ${sum} %).`);
  }
  for (const [asset, pct] of entries) {
    if (pct === 0) continue;
    for (const day of days) {
      const price = day.prices[asset];
      if (price === undefined || !(price > 0)) {
        throw new Error(`Prix manquant ou invalide pour ${asset} le ${day.date}.`);
      }
    }
  }
}

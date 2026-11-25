import { describe, expect, it } from 'vitest';
import { maxDrawdownPct, runCoreBacktest, runSingleAssetBenchmark } from './dcaBacktest.js';
import type { AlignedDay, CoreBacktestConfig } from './types.js';

const baseConfig: CoreBacktestConfig = {
  capitalUsd: 480,
  targets: { BTC: 35, ETH: 25, SOL: 15, BNB: 5 },
  dcaWeeks: 52,
  rebalanceThresholdPts: 5,
  feePct: 0,
  slippagePct: 0,
};

/** `count` jours consécutifs à partir du 2024-01-01, prix donnés par `priceAt(asset, index)`. */
function makeDays(count: number, priceAt: (asset: string, index: number) => number): AlignedDay[] {
  const start = Date.UTC(2024, 0, 1);
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    prices: Object.fromEntries(['BTC', 'ETH', 'SOL', 'BNB'].map((asset) => [asset, priceAt(asset, i)])),
  }));
}

const flat = makeDays(400, () => 100);

describe('runCoreBacktest', () => {
  it('à prix constants et sans frais, conserve exactement le capital', () => {
    const result = runCoreBacktest(flat, baseConfig);

    expect(result.buysDone).toBe(52);
    expect(result.investedUsd).toBeCloseTo(480);
    expect(result.finalValueUsd).toBeCloseTo(480);
    expect(result.gainPct).toBeCloseTo(0);
    expect(result.maxDrawdownPct).toBeCloseTo(0);
    expect(result.rebalances).toHaveLength(0);
  });

  it('garde en réserve USDC la part non attribuée (20 %)', () => {
    const result = runCoreBacktest(flat, baseConfig);

    expect(result.reserveUsd).toBeCloseTo(96);
  });

  it('mesure les parts finales sur la seule partie crypto, cibles ramenées à 100 %', () => {
    const result = runCoreBacktest(flat, baseConfig);

    expect(result.finalWeightsPct.BTC).toBeCloseTo(43.75);
    expect(result.finalWeightsPct.ETH).toBeCloseTo(31.25);
    expect(result.finalWeightsPct.SOL).toBeCloseTo(18.75);
    expect(result.finalWeightsPct.BNB).toBeCloseTo(6.25);
  });

  it('déduit frais et slippage de chaque achat', () => {
    const result = runCoreBacktest(flat, { ...baseConfig, feePct: 0.1, slippagePct: 0.1 });

    // 80 % de 480 $ achetés en crypto, à 0,2 % de coût.
    expect(result.feesUsd).toBeCloseTo(384 * 0.002);
    expect(result.finalValueUsd).toBeCloseTo(480 - 384 * 0.002);
  });

  it("n'achète qu'une fois par semaine et signale un historique trop court", () => {
    const result = runCoreBacktest(flat.slice(0, 10), baseConfig);

    expect(result.buysDone).toBe(2);
    expect(result.investedUsd).toBeCloseTo((480 / 52) * 2);
    expect(result.finalValueUsd).toBeCloseTo(480);
  });

  it('rééquilibre au changement de trimestre quand un actif dépasse le seuil', () => {
    // ETH triple le 1er mars, puis tout reste stable : au 1er avril, ETH pèse bien trop lourd.
    const days = makeDays(400, (asset, i) => (asset === 'ETH' && i >= 60 ? 300 : 100));
    const result = runCoreBacktest(days, baseConfig);

    expect(result.rebalances[0]).toMatchObject({ date: '2024-04-01', worstAsset: 'ETH' });
    expect(result.rebalances[0]!.deviationPts).toBeGreaterThan(5);
  });

  it('ramène chaque actif à sa cible lors du rééquilibrage, sans créer de valeur', () => {
    const days = makeDays(92, (asset, i) => (asset === 'ETH' && i >= 60 ? 300 : 100));
    const beforeRebalance = runCoreBacktest(days.slice(0, 91), baseConfig);
    const afterRebalance = runCoreBacktest(days, baseConfig);

    expect(afterRebalance.rebalances).toHaveLength(1);
    expect(afterRebalance.finalWeightsPct.ETH).toBeCloseTo(31.25, 1);
    expect(afterRebalance.finalWeightsPct.BTC).toBeCloseTo(43.75, 1);
    // Sans frais, le rééquilibrage ne change pas la valeur (le 1er avril n'est pas un jour d'achat).
    expect(afterRebalance.finalValueUsd).toBeCloseTo(beforeRebalance.finalValueUsd);
  });

  it('les frais du rééquilibrage réduisent la valeur', () => {
    const days = makeDays(92, (asset, i) => (asset === 'ETH' && i >= 60 ? 300 : 100));
    const config = { ...baseConfig, feePct: 0.1, slippagePct: 0.1 };
    const before = runCoreBacktest(days.slice(0, 91), config);
    const after = runCoreBacktest(days, config);

    expect(after.feesUsd).toBeGreaterThan(before.feesUsd);
    expect(after.finalValueUsd).toBeLessThan(before.finalValueUsd);
  });

  it('ne rééquilibre pas sous le seuil', () => {
    const days = makeDays(200, (asset, i) => (asset === 'ETH' && i >= 60 ? 105 : 100));
    const result = runCoreBacktest(days, baseConfig);

    expect(result.rebalances).toHaveLength(0);
  });

  it('refuse des parts cibles dont la somme dépasse 100 %', () => {
    expect(() => runCoreBacktest(flat, { ...baseConfig, targets: { BTC: 60, ETH: 50 } })).toThrow(/somme/);
  });

  it('refuse un jour sans prix pour un actif ciblé', () => {
    const days = makeDays(10, () => 100);
    delete (days[3]!.prices as Record<string, number>).SOL;

    expect(() => runCoreBacktest(days, baseConfig)).toThrow(/SOL le 2024-01-04/);
  });
});

describe('runSingleAssetBenchmark', () => {
  it('investit tout dans le seul actif de référence', () => {
    const days = makeDays(400, (asset, i) => (asset === 'BTC' ? 100 + i : 100));
    const benchmark = runSingleAssetBenchmark(days, 'BTC', baseConfig);

    expect(Object.keys(benchmark.finalWeightsPct)).toEqual(['BTC']);
    expect(benchmark.reserveUsd).toBe(0);
    expect(benchmark.gainPct).toBeGreaterThan(0);
  });
});

describe('maxDrawdownPct', () => {
  it('mesure la plus forte baisse depuis un sommet', () => {
    expect(maxDrawdownPct([100, 120, 60, 130, 117])).toBeCloseTo(50);
  });

  it('vaut 0 pour une série qui ne baisse jamais', () => {
    expect(maxDrawdownPct([1, 2, 3])).toBe(0);
  });
});

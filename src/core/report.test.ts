import { describe, expect, it } from 'vitest';
import { runCoreBacktest, runSingleAssetBenchmark } from './dcaBacktest.js';
import { formatCoreReport } from './report.js';
import type { AlignedDay, CoreBacktestConfig } from './types.js';

const config: CoreBacktestConfig = {
  capitalUsd: 480,
  targets: { BTC: 35, ETH: 25, SOL: 15, BNB: 5 },
  dcaWeeks: 52,
  rebalanceThresholdPts: 5,
  feePct: 0.1,
  slippagePct: 0.1,
};

function makeDays(count: number, btcAt: (i: number) => number): AlignedDay[] {
  const start = Date.UTC(2024, 0, 1);
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    prices: { BTC: btcAt(i), ETH: 100, SOL: 100, BNB: 100 },
  }));
}

describe('formatCoreReport', () => {
  it('compare le cœur à la référence et applique le critère de baisse maximale', () => {
    // BTC chute de moitié puis remonte : le cœur, diversifié et avec 20 % de réserve, baisse moins.
    const days = makeDays(400, (i) => (i < 200 ? 100 - i / 4 : 50 + (i - 200) / 4));
    const report = formatCoreReport(
      runCoreBacktest(days, config),
      runSingleAssetBenchmark(days, 'BTC', config),
      'BTC',
      config
    );

    expect(report).toContain('du 2024-01-01 au 2025-02-03');
    expect(report).toContain('BTC seul');
    expect(report).toContain('Réserve USDC');
    expect(report).toContain('celle de BTC seul : OUI');
    expect(report).not.toContain('Attention');
  });

  it("prévient quand l'historique ne couvre pas tous les achats", () => {
    const days = makeDays(30, () => 100);
    const report = formatCoreReport(
      runCoreBacktest(days, config),
      runSingleAssetBenchmark(days, 'BTC', config),
      'BTC',
      config
    );

    expect(report).toContain('seulement 5 achats sur 52');
  });
});

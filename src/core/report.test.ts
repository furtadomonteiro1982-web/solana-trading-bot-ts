import { describe, expect, it } from 'vitest';
import { runCoreBacktest, runSingleAssetBenchmark } from './dcaBacktest.js';
import { formatCoreReport, formatRollingReport } from './report.js';
import { runRollingWindows } from './rollingWindows.js';
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
    expect(report).toContain('--rolling');
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

describe('formatRollingReport', () => {
  it('affiche les fenêtres en perte et le verdict du critère', () => {
    const btc = (i: number) => (i < 300 ? 100 : i < 400 ? 100 - (i - 300) / 2 : 50);
    const summary = runRollingWindows(makeDays(700, btc), 400, 100, config, 'BTC');
    const report = formatRollingReport(summary, 'BTC', 1);

    expect(report).toContain('Fenêtres en perte');
    expect(report).toContain('pas plus de fenêtres en perte : OUI');
  });
});

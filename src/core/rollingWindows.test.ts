import { describe, expect, it } from 'vitest';
import { median, runRollingWindows } from './rollingWindows.js';
import type { AlignedDay, CoreBacktestConfig } from './types.js';

const config: CoreBacktestConfig = {
  capitalUsd: 480,
  targets: { BTC: 35, ETH: 25, SOL: 15, BNB: 5 },
  dcaWeeks: 52,
  rebalanceThresholdPts: 5,
  feePct: 0,
  slippagePct: 0,
};

function makeDays(count: number, priceAt: (asset: string, i: number) => number): AlignedDay[] {
  const start = Date.UTC(2020, 0, 1);
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    prices: Object.fromEntries(['BTC', 'ETH', 'SOL', 'BNB'].map((asset) => [asset, priceAt(asset, i)])),
  }));
}

describe('runRollingWindows', () => {
  it('démarre une fenêtre tous les stepDays jours, sans dépasser la fin', () => {
    const summary = runRollingWindows(makeDays(500, () => 100), 400, 30, config, 'BTC');

    // Départs aux jours 0, 30, 60, 90 : le suivant (120) finirait après le jour 499.
    expect(summary.windows.map((w) => w.startDate)).toEqual(['2020-01-01', '2020-01-31', '2020-03-01', '2020-03-31']);
    expect(summary.windows[0]!.endDate).toBe('2021-02-03');
  });

  it('chaque fenêtre repart de zéro, avec tout le capital', () => {
    // BTC monte régulièrement : chaque fenêtre doit gagner, quel que soit son départ.
    const summary = runRollingWindows(makeDays(600, (a, i) => (a === 'BTC' ? 100 + i : 100)), 400, 50, config, 'BTC');

    expect(summary.windows.every((w) => w.benchmarkGainPct > 0)).toBe(true);
    expect(summary.beatsBenchmarkPct).toBe(0);
  });

  it('compte les fenêtres qui passent le critère de baisse maximale', () => {
    // BTC chute de moitié vers le milieu de l'historique, les autres restent stables.
    const btc = (i: number) => (i < 300 ? 100 : i < 400 ? 100 - (i - 300) / 2 : 50);
    const summary = runRollingWindows(makeDays(700, (a, i) => (a === 'BTC' ? btc(i) : 100)), 400, 100, config, 'BTC');

    expect(summary.passRatePct).toBe(100);
    expect(summary.coreMaxDrawdownPct.worst).toBeLessThan(summary.benchmarkMaxDrawdownPct.worst);
  });

  it("explique un historique plus court qu'une fenêtre", () => {
    expect(() => runRollingWindows(makeDays(100, () => 100), 400, 30, config, 'BTC')).toThrow(
      /100 jours communs.*400 nécessaires/
    );
  });

  it('refuse un pas nul', () => {
    expect(() => runRollingWindows(makeDays(500, () => 100), 400, 0, config, 'BTC')).toThrow(/stepDays/);
  });
});

describe('median', () => {
  it('prend la valeur du milieu, ou la moyenne des deux du milieu', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

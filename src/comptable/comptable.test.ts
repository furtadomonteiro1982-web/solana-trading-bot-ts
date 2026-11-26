import { describe, expect, it } from 'vitest';
import { createDb } from '../store/db.js';
import { PositionRepository } from '../store/positionRepository.js';
import type { AlignedDay, CoreBacktestConfig } from '../core/types.js';
import type { Position } from '../types.js';
import { corePortfolioLines, lumpSumLine } from './core.js';
import { currentMonth, reportPeriod } from './period.js';
import { formatMonthlyReport } from './report.js';
import { summarizeStrategy } from './satellite.js';

const today = new Date('2026-12-15T10:00:00Z');

describe('reportPeriod', () => {
  it('couvre un mois terminé en entier', () => {
    expect(reportPeriod('2026-10', '2026-01-01', today)).toEqual({
      month: '2026-10',
      start: '2026-10-01',
      end: '2026-10-31',
      isPartial: false,
    });
  });

  it("s'arrête à hier pour le mois en cours et commence au départ de la simulation", () => {
    expect(reportPeriod('2026-12', '2026-12-03', today)).toEqual({
      month: '2026-12',
      start: '2026-12-03',
      end: '2026-12-14',
      isPartial: true,
    });
  });

  it('explique un mois sans aucun jour à compter', () => {
    expect(() => reportPeriod('2026-12', '2026-12-15', today)).toThrow(/Rien à compter/);
    expect(() => reportPeriod('déc', '2026-01-01', today)).toThrow(/AAAA-MM/);
  });

  it('donne le mois en cours', () => {
    expect(currentMonth(today)).toBe('2026-12');
  });
});

function position(overrides: Partial<Position>): Position {
  return {
    id: 1,
    strategy: 'hourly',
    poolAddress: 'P',
    baseTokenAddress: 'T',
    baseTokenSymbol: 'FOO',
    entryPriceUsd: 1,
    sizeUsd: 10,
    stopLossPrice: 0.8,
    takeProfitPrice: 1.5,
    trailingStopPct: 15,
    highestPriceUsd: 1,
    openedAt: new Date('2026-10-02T00:00:00Z'),
    status: 'CLOSED',
    ...overrides,
  };
}

describe('summarizeStrategy', () => {
  const period = reportPeriod('2026-10', '2026-01-01', today);
  const positions = [
    position({ id: 1, closedAt: new Date('2026-09-20T00:00:00Z'), pnlUsd: -3 }),
    position({ id: 2, closedAt: new Date('2026-10-05T00:00:00Z'), pnlUsd: 4 }),
    position({ id: 3, closedAt: new Date('2026-10-31T23:00:00Z'), pnlUsd: -1 }),
    position({ id: 4, closedAt: new Date('2026-11-02T00:00:00Z'), pnlUsd: 9 }),
    position({ id: 5, status: 'OPEN', sizeUsd: 7 }),
    position({ id: 6, strategy: 'snipe', closedAt: new Date('2026-10-05T00:00:00Z'), pnlUsd: -2 }),
  ];

  it('sépare ce qui est réalisé avant et pendant la période, stratégie par stratégie', () => {
    const summary = summarizeStrategy(positions, 'hourly', 100, period);

    expect(summary).toMatchObject({
      realizedBeforePeriodUsd: -3,
      realizedInPeriodUsd: 3,
      closedInPeriod: 2,
      winsInPeriod: 1,
      valueAtStartUsd: 97,
      valueAtEndUsd: 100,
    });
  });

  it('compte comme ouverte une position fermée après la fin de la période', () => {
    const summary = summarizeStrategy(positions, 'hourly', 100, period);

    expect(summary.openAtEnd).toBe(2); // n° 4 (fermée en novembre) et n° 5 (toujours ouverte)
    expect(summary.openAtEndUsd).toBe(17);
  });

  it('ne mélange pas le sniper et le trading horaire', () => {
    expect(summarizeStrategy(positions, 'snipe', 20, period).valueAtEndUsd).toBe(18);
  });
});

function makeDays(count: number, btcAt: (i: number) => number, start = Date.UTC(2026, 0, 1)): AlignedDay[] {
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    prices: { BTC: btcAt(i), ETH: 100, SOL: 100, BNB: 100 },
  }));
}

const coreConfig: CoreBacktestConfig = {
  capitalUsd: 480,
  targets: { BTC: 50, ETH: 15, SOL: 10, BNB: 5 },
  dcaWeeks: 104,
  rebalanceThresholdPts: 5,
  feePct: 0,
  slippagePct: 0,
};

describe('corePortfolioLines', () => {
  it("rejoue le cœur depuis le départ et lit sa valeur au début et à la fin de la période", () => {
    const days = makeDays(400, () => 100);
    const period = reportPeriod('2026-10', '2026-01-01', today);

    const [core, btc] = corePortfolioLines(days, '2026-01-01', period, coreConfig, 'BTC');

    expect(core).toMatchObject({ label: 'Cœur', capitalUsd: 480 });
    expect(core!.valueAtStartUsd).toBeCloseTo(480);
    expect(core!.valueAtEndUsd).toBeCloseTo(480);
    expect(btc!.label).toContain('BTC seul');
  });

  it('refuse une période sans les prix jusqu’à sa fin', () => {
    const period = reportPeriod('2026-10', '2026-01-01', today);

    expect(() => corePortfolioLines(makeDays(100, () => 100), '2026-01-01', period, coreConfig, 'BTC')).toThrow(/Prix manquants/);
  });
});

describe('lumpSumLine', () => {
  it('suit la valeur de BTC acheté d’un coup au départ', () => {
    // BTC passe de 100 à 100 + i : 200 le 10 avril (jour 99).
    const days = makeDays(120, (i) => 100 + i);
    const period = reportPeriod('2026-04', '2026-01-01', today);

    const line = lumpSumLine(days, 'BTC', '2026-01-01', period, 120, 'BTC');

    expect(line.valueAtStartUsd).toBeCloseTo((120 * 189) / 100); // 31 mars, veille de la période
    expect(line.valueAtEndUsd).toBeCloseTo((120 * 219) / 100); // 30 avril
  });
});

describe('formatMonthlyReport', () => {
  const period = reportPeriod('2026-10', '2026-01-01', today);
  const base = {
    period,
    simulationStart: '2026-01-01',
    core: [{ label: 'Cœur', capitalUsd: 480, valueAtStartUsd: 500, valueAtEndUsd: 525 }],
    satelliteBenchmark: { label: 'BTC acheté d’un coup', capitalUsd: 120, valueAtStartUsd: 120, valueAtEndUsd: 108 },
    reservePct: 20,
  };

  it('affiche le gain sur la période et depuis le départ', () => {
    const report = formatMonthlyReport({ ...base, satellite: null });

    expect(report).toMatch(/Cœur\s+480\.00 \$\s+525\.00 \$\s+\+5\.0 %\s+\+9\.4 %/);
    expect(report).toContain('aucune donnée');
    expect(report).toContain('20 % « projets »');
  });

  it('détaille chaque stratégie du satellite', () => {
    const positions = [position({ closedAt: new Date('2026-10-05T00:00:00Z'), pnlUsd: 5 })];
    const report = formatMonthlyReport({ ...base, satellite: [summarizeStrategy(positions, 'hourly', 100, period)] });

    expect(report).toMatch(/Satellite — trading horaire\s+100\.00 \$\s+105\.00 \$/);
    expect(report).toContain('1 position(s) fermée(s) sur la période (100 % gagnants)');
  });
});

describe('PositionRepository.getAllPositions', () => {
  it('renvoie les positions ouvertes et fermées', () => {
    const repo = new PositionRepository(createDb(':memory:'));
    const data = {
      poolAddress: 'P', baseTokenAddress: 'T', baseTokenSymbol: 'FOO', entryPriceUsd: 1, sizeUsd: 10,
      stopLossPrice: 0.5, takeProfitPrice: 2, trailingStopPct: 10, openedAt: new Date(),
    };
    const first = repo.openPosition(data);
    repo.openPosition(data);
    repo.closePosition(first.id, 1.5, 'TAKE_PROFIT', new Date());

    expect(repo.getAllPositions().map((p) => p.status)).toEqual(['CLOSED', 'OPEN']);
  });
});

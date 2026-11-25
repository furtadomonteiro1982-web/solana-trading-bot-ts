import { describe, expect, it } from 'vitest';
import { alignSeries, lastDays, parseDailyCsv, toDailyCsv } from './priceSeries.js';

describe('alignSeries', () => {
  it('ne garde que les jours communs à tous les actifs, triés par date', () => {
    const days = alignSeries({
      BTC: [
        { date: '2024-01-03', close: 3 },
        { date: '2024-01-01', close: 1 },
        { date: '2024-01-02', close: 2 },
      ],
      ETH: [
        { date: '2024-01-01', close: 10 },
        { date: '2024-01-03', close: 30 },
      ],
    });

    expect(days).toEqual([
      { date: '2024-01-01', prices: { BTC: 1, ETH: 10 } },
      { date: '2024-01-03', prices: { BTC: 3, ETH: 30 } },
    ]);
  });

  it('renvoie une liste vide sans actif', () => {
    expect(alignSeries({})).toEqual([]);
  });
});

describe('lastDays', () => {
  it('garde les derniers jours', () => {
    const days = alignSeries({ BTC: [1, 2, 3].map((d) => ({ date: `2024-01-0${d}`, close: d })) });

    expect(lastDays(days, 2).map((day) => day.date)).toEqual(['2024-01-02', '2024-01-03']);
    expect(lastDays(days, 10)).toHaveLength(3);
  });
});

describe('CSV', () => {
  it('relit ce qu’il écrit', () => {
    const points = [
      { date: '2024-01-01', close: 42000.5 },
      { date: '2024-01-02', close: 43000 },
    ];

    expect(parseDailyCsv(toDailyCsv(points), 'test')).toEqual(points);
  });

  it('accepte un fichier sans en-tête et des fins de ligne Windows', () => {
    expect(parseDailyCsv('2024-01-01,1\r\n2024-01-02,2\r\n', 'test')).toHaveLength(2);
  });

  it('indique la ligne fautive', () => {
    expect(() => parseDailyCsv('date,close\n2024-01-01,abc\n', 'BTC.csv')).toThrow(/BTC\.csv, ligne 2/);
  });
});

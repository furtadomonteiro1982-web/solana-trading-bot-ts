import { describe, expect, it, vi } from 'vitest';
import { fetchDailyCloses } from './binanceClient.js';

const DAY_MS = 86_400_000;

/** Bougies Binance : [openTime, open, high, low, close, …], prix de clôture = numéro du jour. */
function candles(fromDay: number, count: number): unknown[][] {
  return Array.from({ length: count }, (_, i) => {
    const day = fromDay + i;
    return [day * DAY_MS, '0', '0', '0', String(day), '0', (day + 1) * DAY_MS - 1];
  });
}

function respond(body: unknown, status = 200) {
  return { ok: status === 200, status, json: async () => body };
}

describe('fetchDailyCloses', () => {
  const today = 20_000; // jour n° 20 000 depuis 1970, soit le 2024-10-04
  const now = new Date(today * DAY_MS + 5 * 3_600_000);

  it('demande la paire USDT et exclut la bougie du jour, pas encore clôturée', async () => {
    const fetchFn = vi.fn(async (_url: string) => respond(candles(today - 3, 4)));

    const points = await fetchDailyCloses('BTC', 3, { fetchFn, now, baseUrl: 'https://exemple.test' });

    expect(fetchFn.mock.calls[0]![0]).toContain('https://exemple.test/api/v3/klines?symbol=BTCUSDT&interval=1d');
    expect(fetchFn.mock.calls[0]![0]).toContain(`startTime=${(today - 3) * DAY_MS}`);
    expect(points.map((point) => point.close)).toEqual([today - 3, today - 2, today - 1]);
    expect(points[2]!.date).toBe('2024-10-03');
  });

  it('enchaîne les pages de 1000 bougies', async () => {
    const start = today - 1500;
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(respond(candles(start, 1000)))
      .mockResolvedValueOnce(respond(candles(start + 1000, 500)));

    const points = await fetchDailyCloses('ETH', 1500, { fetchFn, now });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[1]![0]).toContain(`startTime=${(start + 1000) * DAY_MS}`);
    expect(points).toHaveLength(1500);
  });

  it('explique une panne réseau et propose le mode hors ligne', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(fetchDailyCloses('BTC', 3, { fetchFn, now })).rejects.toThrow(/Impossible de joindre.*--csv/);
  });

  it('signale une erreur HTTP avec la paire concernée', async () => {
    const fetchFn = vi.fn(async () => respond({ msg: 'Invalid symbol' }, 400));

    await expect(fetchDailyCloses('XYZ', 3, { fetchFn, now })).rejects.toThrow(/400 pour XYZUSDT/);
  });
});

import type { DailyClose } from './priceSeries.js';

// Données de marché publiques de Binance : gratuites, sans clé API ni compte. Le miroir
// data-api.binance.vision ne sert que les données de marché (aucun ordre possible).
export const DEFAULT_BINANCE_BASE_URL = 'https://data-api.binance.vision';
const MAX_CANDLES_PER_CALL = 1000;
const DAY_MS = 86_400_000;

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Clôtures journalières en USD (paire contre USDT) de `symbol` sur les `days` derniers jours
 * complets. La bougie du jour en cours, pas encore clôturée, est exclue.
 */
export async function fetchDailyCloses(
  symbol: string,
  days: number,
  options: { baseUrl?: string; fetchFn?: FetchLike; now?: Date } = {}
): Promise<DailyClose[]> {
  const baseUrl = options.baseUrl ?? DEFAULT_BINANCE_BASE_URL;
  const fetchFn = options.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  const now = (options.now ?? new Date()).getTime();
  const todayStart = Math.floor(now / DAY_MS) * DAY_MS;
  let startTime = todayStart - days * DAY_MS;

  const points: DailyClose[] = [];
  while (startTime < todayStart) {
    const url =
      `${baseUrl}/api/v3/klines?symbol=${encodeURIComponent(symbol)}USDT&interval=1d` +
      `&startTime=${startTime}&limit=${MAX_CANDLES_PER_CALL}`;
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await fetchFn(url);
    } catch (error) {
      const cause = error instanceof Error && error.cause ? ` (${String(error.cause)})` : '';
      throw new Error(
        `Impossible de joindre ${baseUrl} pour ${symbol}USDT : ${String(error)}${cause}. ` +
          'Vérifiez la connexion, ou rejouez hors ligne avec --csv DOSSIER.'
      );
    }
    if (!response.ok) {
      throw new Error(`Binance a répondu ${response.status} pour ${symbol}USDT (${url}).`);
    }
    const candles = (await response.json()) as unknown[][];
    if (!Array.isArray(candles) || candles.length === 0) break;

    for (const candle of candles) {
      const openTime = Number(candle[0]);
      if (openTime >= todayStart) continue;
      points.push({ date: new Date(openTime).toISOString().slice(0, 10), close: Number(candle[4]) });
    }
    const lastOpen = Number(candles[candles.length - 1]![0]);
    if (candles.length < MAX_CANDLES_PER_CALL) break;
    startTime = lastOpen + DAY_MS;
  }
  return points;
}

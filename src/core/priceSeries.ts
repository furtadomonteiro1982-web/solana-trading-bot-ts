import type { AlignedDay } from './types.js';

export interface DailyClose {
  /** Date UTC au format AAAA-MM-JJ. */
  date: string;
  close: number;
}

/**
 * Ne garde que les jours où chaque actif a un prix, triés par date : un jour manquant pour un
 * seul actif fausserait les parts et les rééquilibrages.
 */
export function alignSeries(series: Record<string, DailyClose[]>): AlignedDay[] {
  const assets = Object.keys(series);
  if (assets.length === 0) return [];
  const byAsset = assets.map((asset) => new Map(series[asset]!.map((point) => [point.date, point.close])));
  const days: AlignedDay[] = [];
  for (const date of [...byAsset[0]!.keys()].sort()) {
    const prices: Record<string, number> = {};
    let complete = true;
    for (let i = 0; i < assets.length; i++) {
      const close = byAsset[i]!.get(date);
      if (close === undefined) {
        complete = false;
        break;
      }
      prices[assets[i]!] = close;
    }
    if (complete) days.push({ date, prices });
  }
  return days;
}

/** Garde les `days` derniers jours de l'historique. */
export function lastDays(days: AlignedDay[], count: number): AlignedDay[] {
  return days.slice(Math.max(0, days.length - count));
}

/** Lit un fichier CSV « date,close » (ligne d'en-tête facultative). */
export function parseDailyCsv(text: string, label: string): DailyClose[] {
  const points: DailyClose[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '' || (i === 0 && /^date\s*,/i.test(line))) continue;
    const [date, closeText] = line.split(',').map((cell) => cell.trim());
    const close = Number(closeText);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !(close > 0)) {
      throw new Error(`${label}, ligne ${i + 1} : attendu « AAAA-MM-JJ,prix », reçu « ${line} ».`);
    }
    points.push({ date, close });
  }
  return points;
}

export function toDailyCsv(points: DailyClose[]): string {
  return ['date,close', ...points.map((point) => `${point.date},${point.close}`)].join('\n') + '\n';
}

/** Un mois du rapport, borné par le début de la simulation et par hier (dernier jour clôturé). */
export interface ReportPeriod {
  /** AAAA-MM */
  month: string;
  /** Premier et dernier jour couverts, AAAA-MM-JJ inclus. */
  start: string;
  end: string;
  /** Vrai si le mois n'est pas terminé. */
  isPartial: boolean;
}

export function reportPeriod(month: string, simulationStart: string, today: Date): ReportPeriod {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`Mois attendu au format AAAA-MM, reçu « ${month} ».`);
  const [year, monthIndex] = month.split('-').map(Number) as [number, number];
  const firstDay = `${month}-01`;
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).toISOString().slice(0, 10);
  const yesterday = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10);
  const start = firstDay < simulationStart ? simulationStart : firstDay;
  const end = lastDay > yesterday ? yesterday : lastDay;
  if (end < start) {
    throw new Error(
      `Rien à compter pour ${month} : la simulation commence le ${simulationStart} et le dernier jour clôturé est le ${yesterday}.`
    );
  }
  return { month, start, end, isPartial: lastDay > yesterday };
}

export function currentMonth(today: Date): string {
  return today.toISOString().slice(0, 7);
}

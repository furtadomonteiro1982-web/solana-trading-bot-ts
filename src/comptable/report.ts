import type { PortfolioLine } from './core.js';
import type { ReportPeriod } from './period.js';
import type { StrategySummary } from './satellite.js';

const usd = (value: number) => `${value.toFixed(2)} $`;
const pct = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)} %`;

export function formatMonthlyReport(input: {
  period: ReportPeriod;
  simulationStart: string;
  core: PortfolioLine[];
  satellite: StrategySummary[] | null;
  satelliteBenchmark: PortfolioLine;
  reservePct: number;
}): string {
  const { period, simulationStart } = input;
  const lines: string[] = [];
  lines.push(
    `Rapport du Comptable — ${period.month}${period.isPartial ? ' (mois en cours)' : ''}, du ${period.start} au ${period.end}`
  );
  lines.push(`Simulation commencée le ${simulationStart}. Aucun argent réel.`);
  lines.push('');

  const rows: string[][] = [['', 'Capital', 'Fin de période', 'Sur la période', 'Depuis le départ']];
  const add = (label: string, capital: number, start: number, end: number) =>
    rows.push([label, usd(capital), usd(end), pct(start > 0 ? (end / start - 1) * 100 : 0), pct((end / capital - 1) * 100)]);

  for (const line of input.core) add(line.label, line.capitalUsd, line.valueAtStartUsd, line.valueAtEndUsd);
  if (input.satellite) {
    for (const s of input.satellite) {
      add(`Satellite — ${s.strategy === 'hourly' ? 'trading horaire' : 'sniper'}`, s.capitalUsd, s.valueAtStartUsd, s.valueAtEndUsd);
    }
  }
  const b = input.satelliteBenchmark;
  add(b.label, b.capitalUsd, b.valueAtStartUsd, b.valueAtEndUsd);

  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((row) => row[col]!.length)));
  for (const row of rows) {
    lines.push(row.map((cell, col) => (col === 0 ? cell.padEnd(widths[col]!) : cell.padStart(widths[col]!))).join('   '));
  }

  lines.push('');
  if (input.satellite) {
    for (const s of input.satellite) {
      const name = s.strategy === 'hourly' ? 'Trading horaire' : 'Sniper';
      const winRate = s.closedInPeriod > 0 ? ` (${((s.winsInPeriod / s.closedInPeriod) * 100).toFixed(0)} % gagnants)` : '';
      lines.push(
        `${name} : ${s.closedInPeriod} position(s) fermée(s) sur la période${winRate}, ` +
          `${s.openAtEnd} encore ouverte(s) pour ${usd(s.openAtEndUsd)}, comptée(s) à leur prix d'achat.`
      );
    }
  } else {
    lines.push("Satellite : aucune donnée (base data/bot.sqlite absente : le bot n'a pas tourné sur cette machine).");
  }
  if (input.reservePct > 0) {
    lines.push(`Les ${input.reservePct} % « projets » du cœur sont comptés en USDC, sans rendement.`);
  }

  lines.push('');
  lines.push(
    'Le cœur se compare à BTC seul acheté au même rythme ; le satellite, à BTC acheté en une fois au départ. ' +
      'Les gains du satellite sont nets des frais et du slippage simulés.'
  );
  lines.push("Résultats simulés : ils ne prédisent pas l'avenir et ne sont pas un conseil financier.");
  return lines.join('\n');
}

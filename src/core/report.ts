import type { RollingSummary } from './rollingWindows.js';
import type { CoreBacktestConfig, CoreBacktestResult } from './types.js';

/** Rapport des fenêtres glissantes : une ligne par départ, puis la synthèse. */
export function formatRollingReport(summary: RollingSummary, benchmarkAsset: string, windowYears: number): string {
  const pct = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)} %`.padStart(9);
  const dd = (value: number) => `-${value.toFixed(1)} %`.padStart(8);
  const first = summary.windows[0]!;
  const last = summary.windows[summary.windows.length - 1]!;
  const lines: string[] = [];

  lines.push(
    `Cœur long terme — ${summary.windows.length} fenêtres de ${windowYears} an(s), ` +
      `départs du ${first.startDate} au ${last.startDate}`
  );
  lines.push('');
  lines.push(`Départ       Fin           Cœur gain  baisse   ${benchmarkAsset} gain  baisse   Critère`);
  for (const w of summary.windows) {
    lines.push(
      `${w.startDate}   ${w.endDate}   ${pct(w.coreGainPct)} ${dd(w.coreMaxDrawdownPct)}  ` +
        `${pct(w.benchmarkGainPct)} ${dd(w.benchmarkMaxDrawdownPct)}   ${w.passesDrawdownCriterion ? 'OUI' : 'non'}`
    );
  }

  lines.push('');
  lines.push('Synthèse                          Cœur      ' + `${benchmarkAsset} seul`);
  lines.push(`Gain médian                  ${pct(summary.coreGainPct.median)}  ${pct(summary.benchmarkGainPct.median)}`);
  lines.push(`Pire gain                    ${pct(summary.coreGainPct.min)}  ${pct(summary.benchmarkGainPct.min)}`);
  lines.push(`Meilleur gain                ${pct(summary.coreGainPct.max)}  ${pct(summary.benchmarkGainPct.max)}`);
  lines.push(
    `Baisse maximale médiane       ${dd(summary.coreMaxDrawdownPct.median)}   ${dd(summary.benchmarkMaxDrawdownPct.median)}`
  );
  lines.push(
    `Pire baisse maximale          ${dd(summary.coreMaxDrawdownPct.worst)}   ${dd(summary.benchmarkMaxDrawdownPct.worst)}`
  );
  lines.push('');
  lines.push(`Fenêtres où le cœur passe le critère de baisse maximale : ${summary.passRatePct.toFixed(0)} %`);
  lines.push(`Fenêtres où le cœur gagne plus que ${benchmarkAsset} seul : ${summary.beatsBenchmarkPct.toFixed(0)} %`);
  lines.push('');
  lines.push(
    'Les fenêtres se chevauchent : ce ne sont pas des essais indépendants, et tout l\'historique ' +
      'commun reste court pour un placement de plusieurs années.'
  );
  lines.push('Résultats passés, simulés : ils ne prédisent pas l\'avenir et ne sont pas un conseil financier.');
  return lines.join('\n');
}

/** Rapport lisible du cœur comparé à la référence (un seul actif, mêmes achats). */
export function formatCoreReport(
  core: CoreBacktestResult,
  benchmark: CoreBacktestResult,
  benchmarkAsset: string,
  config: CoreBacktestConfig
): string {
  const usd = (value: number) => `${value.toFixed(2)} $`;
  const pct = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)} %`;
  const lines: string[] = [];

  lines.push(`Cœur long terme — simulation du ${core.startDate} au ${core.endDate}`);
  lines.push('');
  if (core.buysDone < config.dcaWeeks) {
    lines.push(
      `Attention : seulement ${core.buysDone} achats sur ${config.dcaWeeks} prévus (historique trop court) ; ` +
        `${usd(config.capitalUsd - core.investedUsd)} restent non investis.`
    );
    lines.push('');
  }

  const rows: [string, string, string][] = [
    ['', 'Cœur', `${benchmarkAsset} seul`],
    ['Capital', usd(config.capitalUsd), usd(config.capitalUsd)],
    ['Valeur finale', usd(core.finalValueUsd), usd(benchmark.finalValueUsd)],
    ['Gain ou perte', pct(core.gainPct), pct(benchmark.gainPct)],
    ['Baisse maximale', `-${core.maxDrawdownPct.toFixed(1)} %`, `-${benchmark.maxDrawdownPct.toFixed(1)} %`],
    ['Frais et slippage', usd(core.feesUsd), usd(benchmark.feesUsd)],
    ['Rééquilibrages', String(core.rebalances.length), '—'],
  ];
  const widths = [0, 1, 2].map((col) => Math.max(...rows.map((row) => row[col]!.length)));
  for (const row of rows) {
    lines.push(row.map((cell, col) => (col === 0 ? cell.padEnd(widths[col]!) : cell.padStart(widths[col]!))).join('   '));
  }

  lines.push('');
  lines.push('Parts finales de la partie crypto :');
  for (const [asset, weight] of Object.entries(core.finalWeightsPct)) {
    lines.push(`  ${asset.padEnd(5)} ${weight.toFixed(1).padStart(5)} %`);
  }
  if (core.reserveUsd > 0) {
    lines.push(`Réserve USDC pour les futurs projets de la grille : ${usd(core.reserveUsd)} (sans rendement).`);
  }

  lines.push('');
  const passes = core.maxDrawdownPct <= benchmark.maxDrawdownPct;
  lines.push(
    `Critère de passage (docs/agents.md) — baisse maximale du cœur inférieure ou égale à celle de ` +
      `${benchmarkAsset} seul : ${passes ? 'OUI' : 'NON'}.`
  );
  lines.push('Résultat passé, simulé : il ne prédit pas l\'avenir et n\'est pas un conseil financier.');
  return lines.join('\n');
}

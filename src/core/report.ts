import type { CoreBacktestConfig, CoreBacktestResult } from './types.js';

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

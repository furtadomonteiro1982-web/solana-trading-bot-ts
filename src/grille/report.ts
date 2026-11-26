import { formatUsd } from './scoring.js';
import type { ScoredCandidate } from './types.js';

export function formatGrilleReport(
  ranked: ScoredCandidate[],
  picks: ScoredCandidate[],
  reservePct: number,
  pctEach: number,
  date: string,
  show = 15
): string {
  const lines: string[] = [];
  const eligible = ranked.filter((scored) => scored.eligible);
  lines.push(`Grille de notation du cœur — ${date}`);
  lines.push(`${ranked.length} projets examinés, ${eligible.length} remplissent les règles d'entrée.`);
  lines.push('');
  lines.push('Rang  Projet                 Note   Revenus Adoption Tokenom. Marché Sécurité');
  eligible.slice(0, show).forEach((scored, index) => {
    const p = scored.parts;
    const name = `${scored.candidate.name} (${scored.candidate.symbol})`.slice(0, 22).padEnd(22);
    lines.push(
      `${String(index + 1).padStart(4)}  ${name} ${scored.total.toFixed(0).padStart(4)}  ` +
        [p.revenus, p.adoption, p.tokenomics, p.marche, p.securite]
          .map((value, i) => value.toFixed(0).padStart([7, 9, 9, 7, 9][i]!))
          .join('')
    );
  });
  lines.push('     (maximum : 100 = revenus 25 + adoption 30 + tokenomics 20 + marché 15 + sécurité 10)');

  lines.push('');
  if (picks.length === 0) {
    lines.push('Aucun projet retenu : toute la part « projets » reste en USDC.');
  } else {
    lines.push(`Projets retenus pour le cœur (${pctEach} % chacun) :`);
    for (const scored of picks) {
      const market = scored.candidate.market!;
      lines.push(
        `  • ${scored.candidate.name} (${scored.candidate.symbol}) — note ${scored.total.toFixed(0)}/100, ` +
          `capitalisation ${formatUsd(market.marketCapUsd)}`
      );
      for (const note of scored.notes) lines.push(`      ${note}`);
    }
    if (reservePct > 0) lines.push(`  • ${reservePct} % restent en USDC (pas assez de projets éligibles).`);
  }

  const reasons = new Map<string, number>();
  for (const scored of ranked) {
    for (const reason of scored.rejections) {
      const kind = reason.split(' : ')[0]!;
      reasons.set(kind, (reasons.get(kind) ?? 0) + 1);
    }
  }
  lines.push('');
  lines.push('Raisons de refus les plus fréquentes :');
  for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    lines.push(`  ${String(count).padStart(5)}  ${reason}`);
  }

  lines.push('');
  lines.push(
    'À vérifier par le Chercheur avant tout achat réel : audits (liens), calendrier de déblocage des ' +
      "jetons sur 6 mois, actualité. Il pourra exclure un projet ou baisser sa note, jamais la relever."
  );
  lines.push('Note calculée sur des données publiques à une date donnée : ce n\'est pas un conseil financier.');
  return lines.join('\n');
}

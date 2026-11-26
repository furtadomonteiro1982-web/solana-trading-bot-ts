import fs from 'node:fs';
import { z } from 'zod';
import type { GrilleSettings, ScoredCandidate } from './types.js';

// Verdicts du Chercheur (docs/agents.md, « 2. Chercheur ») : écrits après lecture des audits, du
// calendrier des déblocages et de l'actualité, avec leurs sources. Ils peuvent valider un projet,
// baisser sa note ou l'exclure, jamais la relever. Un projet bien classé sans verdict n'est pas
// acheté : sa part reste en USDC jusqu'à ce qu'il soit étudié.

const VerdictSchema = z.object({
  geckoId: z.string().min(1),
  projet: z.string().min(1),
  decision: z.enum(['valider', 'baisser', 'exclure']),
  /** Points retirés de la note : obligatoire et positif pour « baisser », interdit sinon. */
  points: z.number().positive().optional(),
  raison: z.string().min(1),
  sources: z.array(z.url()).min(1),
});

export const ChercheurFileSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  verdicts: z.array(VerdictSchema).superRefine((verdicts, ctx) => {
    verdicts.forEach((verdict, i) => {
      if (verdict.decision === 'baisser' && verdict.points === undefined) {
        ctx.addIssue({ code: 'custom', path: [i, 'points'], message: '« baisser » demande un nombre de points' });
      }
      if (verdict.decision !== 'baisser' && verdict.points !== undefined) {
        ctx.addIssue({ code: 'custom', path: [i, 'points'], message: 'seul « baisser » prend des points' });
      }
    });
  }),
});

export type ChercheurFile = z.infer<typeof ChercheurFileSchema>;
export type Verdict = ChercheurFile['verdicts'][number];

export function loadChercheurFile(path: string): ChercheurFile | null {
  if (!fs.existsSync(path)) return null;
  const result = ChercheurFileSchema.safeParse(JSON.parse(fs.readFileSync(path, 'utf-8')));
  if (!result.success) throw new Error(`Verdicts du Chercheur invalides dans ${path} : ${result.error.message}`);
  return result.data;
}

/** Applique les verdicts et reclasse : éligibles d'abord, puis par note. */
export function applyVerdicts(ranked: ScoredCandidate[], verdicts: Verdict[]): ScoredCandidate[] {
  const byId = new Map(verdicts.map((verdict) => [verdict.geckoId, verdict]));
  return ranked
    .map((scored) => {
      const verdict = byId.get(scored.candidate.geckoId);
      if (!verdict) return scored;
      const research = { decision: verdict.decision, raison: verdict.raison, sources: verdict.sources };
      if (verdict.decision === 'exclure') {
        return { ...scored, eligible: false, rejections: [...scored.rejections, `exclu par le Chercheur : ${verdict.raison}`], research };
      }
      if (verdict.decision === 'baisser') {
        return { ...scored, total: Math.max(0, scored.total - verdict.points!), research };
      }
      return { ...scored, research };
    })
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.total - a.total);
}

/**
 * Parmi les `picks` premiers éligibles, seuls ceux que le Chercheur a validés (ou baissés sans les
 * exclure) reçoivent leur part ; les autres attendent leur recherche, et leur part reste en USDC.
 */
export function allocateResearched(
  ranked: ScoredCandidate[],
  settings: GrilleSettings
): { picks: ScoredCandidate[]; awaiting: ScoredCandidate[]; reservePct: number } {
  const top = ranked.filter((scored) => scored.eligible).slice(0, settings.picks);
  const picks = top.filter((scored) => scored.research !== undefined);
  const awaiting = top.filter((scored) => scored.research === undefined);
  return { picks, awaiting, reservePct: (settings.picks - picks.length) * settings.pctEach };
}

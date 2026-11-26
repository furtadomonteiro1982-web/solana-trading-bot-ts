import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allocateResearched, applyVerdicts, ChercheurFileSchema, loadChercheurFile, type Verdict } from './chercheur.js';
import { rankCandidates } from './scoring.js';
import { candidate, now, settings } from './testFixtures.js';

const source = ['https://exemple.test/source'];
const verdict = (geckoId: string, decision: Verdict['decision'], points?: number): Verdict => ({
  geckoId,
  projet: geckoId,
  decision,
  points,
  raison: 'raison',
  sources: source,
});

const ranked = rankCandidates(
  [
    candidate({ key: 'a', geckoId: 'a', revenue1yUsd: 300e6 }),
    candidate({ key: 'b', geckoId: 'b', revenue1yUsd: 200e6 }),
    candidate({ key: 'c', geckoId: 'c', revenue1yUsd: 100e6 }),
    candidate({ key: 'd', geckoId: 'd', revenue1yUsd: 50e6 }),
    candidate({ key: 'e', geckoId: 'e', revenue1yUsd: 20e6 }),
  ],
  settings,
  now
);

describe('applyVerdicts', () => {
  it('exclut un projet et en donne la raison', () => {
    const result = applyVerdicts(ranked, [verdict('a', 'exclure')]);
    const a = result.find((scored) => scored.candidate.geckoId === 'a')!;

    expect(a.eligible).toBe(false);
    expect(a.rejections).toContain('exclu par le Chercheur : raison');
    expect(result[result.length - 1]!.candidate.geckoId).toBe('a');
  });

  it('baisse une note et reclasse', () => {
    const before = ranked.find((scored) => scored.candidate.geckoId === 'a')!.total;
    const result = applyVerdicts(ranked, [verdict('a', 'baisser', 50)]);

    expect(result.find((scored) => scored.candidate.geckoId === 'a')!.total).toBeCloseTo(before - 50);
    expect(result[0]!.candidate.geckoId).toBe('b');
  });

  it('ne touche pas la note d’un projet validé', () => {
    const result = applyVerdicts(ranked, [verdict('a', 'valider')]);

    expect(result[0]!.total).toBe(ranked[0]!.total);
    expect(result[0]!.research?.decision).toBe('valider');
  });
});

describe('allocateResearched', () => {
  it('ne donne une part qu’aux projets étudiés parmi les 4 premiers', () => {
    const result = applyVerdicts(ranked, [verdict('a', 'valider'), verdict('c', 'baisser', 1), verdict('e', 'valider')]);

    const { picks, awaiting, reservePct } = allocateResearched(result, settings);

    expect(picks.map((scored) => scored.candidate.geckoId)).toEqual(['a', 'c']);
    expect(awaiting.map((scored) => scored.candidate.geckoId)).toEqual(['b', 'd']);
    // « e » est validé mais classé 5e : il ne passe pas devant les projets en attente.
    expect(reservePct).toBe(10);
  });

  it('fait monter le suivant quand un projet est exclu', () => {
    const result = applyVerdicts(ranked, [verdict('a', 'exclure'), ...['b', 'c', 'd', 'e'].map((id) => verdict(id, 'valider'))]);

    expect(allocateResearched(result, settings).picks.map((scored) => scored.candidate.geckoId)).toEqual(['b', 'c', 'd', 'e']);
  });
});

describe('ChercheurFileSchema', () => {
  it('exige des points pour « baisser », et seulement pour lui', () => {
    expect(ChercheurFileSchema.safeParse({ date: '2026-11-26', verdicts: [verdict('a', 'baisser')] }).success).toBe(false);
    expect(ChercheurFileSchema.safeParse({ date: '2026-11-26', verdicts: [verdict('a', 'valider', 5)] }).success).toBe(false);
  });

  it('refuse des points négatifs : le Chercheur ne relève jamais une note', () => {
    expect(ChercheurFileSchema.safeParse({ date: '2026-11-26', verdicts: [verdict('a', 'baisser', -5)] }).success).toBe(false);
  });

  it('exige au moins une source', () => {
    const noSource = { ...verdict('a', 'valider'), sources: [] };

    expect(ChercheurFileSchema.safeParse({ date: '2026-11-26', verdicts: [noSource] }).success).toBe(false);
  });

  it('accepte le fichier du dépôt', () => {
    expect(loadChercheurFile('config/chercheur.json')?.verdicts.length).toBeGreaterThan(0);
  });

  it('renvoie null sans fichier', () => {
    expect(loadChercheurFile(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ch-')), 'absent.json'))).toBeNull();
  });
});

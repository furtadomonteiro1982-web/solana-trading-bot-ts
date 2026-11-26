import { describe, expect, it } from 'vitest';
import { formatGrilleReport } from './report.js';
import { allocate, rankCandidates } from './scoring.js';
import { candidate, now, settings } from './testFixtures.js';

describe('formatGrilleReport', () => {
  it('liste le classement, les projets retenus et les raisons de refus', () => {
    const ranked = rankCandidates(
      [candidate({ key: 'a', name: 'Alpha' }), candidate({ key: 'b', name: 'Beta', audited: false })],
      settings,
      now
    );
    const { picks, reservePct } = allocate(ranked, settings);

    const report = formatGrilleReport(ranked, picks, reservePct, settings.pctEach, '2026-11-26');

    expect(report).toContain('2 projets examinés, 1 remplissent');
    expect(report).toContain('• Alpha (GOOD)');
    expect(report).toContain('15 % au total restent en USDC');
    expect(report).toMatch(/1 {2}sans audit/);
  });

  it('signale les projets en attente de recherche', () => {
    const ranked = rankCandidates([candidate({ name: 'Gamma' })], settings, now);

    const report = formatGrilleReport(ranked, [], 20, 5, '2026-11-26', { awaiting: ranked, researchDate: '2026-11-20' });

    expect(report).toContain('Gamma (GOOD), note');
    expect(report).toContain('en attente de recherche');
    expect(report).toContain('datés du 2026-11-20');
  });

  it("dit clairement quand aucun projet n'est retenu", () => {
    const ranked = rankCandidates([candidate({ audited: false })], settings, now);

    expect(formatGrilleReport(ranked, [], 20, 5, '2026-11-26')).toContain('Aucun projet retenu');
  });
});

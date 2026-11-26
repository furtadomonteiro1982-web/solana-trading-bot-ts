import { describe, expect, it } from 'vitest';
import { allocate, circulatingShare, entryRejections, rankCandidates, scoreCandidate, tvlChangeVsMarketPct } from './scoring.js';
import { candidate, now, settings } from './testFixtures.js';

const withMarket = (overrides: object) => candidate({ market: { ...candidate().market!, ...overrides } });

describe('entryRejections', () => {
  it('accepte un projet qui remplit toutes les règles', () => {
    expect(entryRejections(candidate(), settings, now)).toEqual([]);
  });

  it.each([
    ['trop récent', withMarket({ tradedSince: '2026-06-01' })],
    ['trop récent', withMarket({ tradedSince: null })],
    ['sans audit', candidate({ audited: false })],
    ['volume trop faible', withMarket({ volume24hUsd: 500_000 })],
    ['piratage récent', candidate({ hacks: [{ date: '2026-03-01', amountUsd: 5_000_000 }] })],
    ['déblocages à venir', withMarket({ circulatingSupply: 300 })],
    ['offre inconnue', withMarket({ circulatingSupply: null, totalSupply: null, maxSupply: null, fdvUsd: null })],
    ['sans données de marché', candidate({ market: undefined })],
  ])('refuse : %s', (kind, project) => {
    const reasons = entryRejections(project, settings, now);

    expect(reasons.some((reason) => reason.startsWith(kind))).toBe(true);
  });

  it('exclut un projet dont la TVL perd plus de 30 % par rapport au marché sur 6 mois', () => {
    // −50 % en brut quand la DeFi fait −10 % : environ −44 % par rapport au marché.
    const leaving = candidate({ tvlUsd: 500e6, tvl6mAgoUsd: 1e9 });

    const reasons = entryRejections(leaving, settings, now, { defiTvlChange6mPct: -10 });

    expect(reasons.some((reason) => reason.startsWith('fuite des utilisateurs : TVL -44 %'))).toBe(true);
  });

  it('garde un projet qui baisse avec le marché', () => {
    const followsMarket = candidate({ tvlUsd: 750e6, tvl6mAgoUsd: 1e9 });

    expect(entryRejections(followsMarket, settings, now, { defiTvlChange6mPct: -30 })).toEqual([]);
  });

  it('tolère un piratage de plus de 12 mois', () => {
    expect(entryRejections(candidate({ hacks: [{ date: '2024-01-01', amountUsd: 1e6 }] }), settings, now)).toEqual([]);
  });
});

describe('tvlChangeVsMarketPct', () => {
  it("compare l'évolution du projet à celle de toute la DeFi", () => {
    const project = candidate({ tvlUsd: 900e6, tvl6mAgoUsd: 1e9 }); // −10 % en brut

    expect(tvlChangeVsMarketPct(project, { defiTvlChange6mPct: -10 })).toBeCloseTo(0);
    expect(tvlChangeVsMarketPct(project, { defiTvlChange6mPct: 20 })).toBeCloseTo(-25);
    expect(tvlChangeVsMarketPct(project)).toBeCloseTo(-10); // marché inconnu : comparaison brute
  });

  it("renvoie null sans historique", () => {
    expect(tvlChangeVsMarketPct(candidate())).toBeNull();
  });
});

describe('circulatingShare', () => {
  it("rapporte l'offre en circulation au maximum, sinon au total, sinon passe par la FDV", () => {
    expect(circulatingShare(candidate())).toBeCloseTo(0.9);
    expect(circulatingShare(withMarket({ maxSupply: null, totalSupply: 2000 }))).toBeCloseTo(0.45);
    expect(
      circulatingShare(withMarket({ circulatingSupply: null, maxSupply: null, totalSupply: null, fdvUsd: 2e9 }))
    ).toBeCloseTo(0.5);
  });
});

describe('scoreCandidate', () => {
  it('reste entre 0 et 100, chaque partie sous son maximum', () => {
    const { parts, total } = scoreCandidate(candidate({ tvl6mAgoUsd: 100_000_000 }), settings, now);

    expect(parts.revenus).toBeLessThanOrEqual(25);
    expect(parts.adoption).toBeLessThanOrEqual(30);
    expect(parts.tokenomics).toBeLessThanOrEqual(20);
    expect(parts.marche).toBeLessThanOrEqual(15);
    expect(parts.securite).toBeLessThanOrEqual(10);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(100);
  });

  it('donne le maximum des revenus quand la capitalisation vaut 5 fois les revenus ou moins', () => {
    expect(scoreCandidate(candidate({ revenue1yUsd: 200_000_000 }), settings, now).parts.revenus).toBeCloseTo(25);
  });

  it('ne donne aucun point de revenus à un projet sans revenus', () => {
    expect(scoreCandidate(candidate({ revenue1yUsd: 0 }), settings, now).parts.revenus).toBe(0);
  });

  it('ne pénalise pas un projet qui baisse comme le marché', () => {
    const project = candidate({ tvlUsd: 800e6, tvl6mAgoUsd: 1e9 });

    const vsMarket = scoreCandidate(project, settings, now, { defiTvlChange6mPct: -20 }).parts.adoption;
    // Même TVL actuelle, sans historique : évolution comptée neutre.
    const neutral = scoreCandidate(candidate({ tvlUsd: 800e6 }), settings, now).parts.adoption;

    expect(vsMarket).toBeCloseTo(neutral);
  });

  it("récompense une TVL en hausse sur 6 mois et compte neutre une évolution inconnue", () => {
    const rising = scoreCandidate(candidate({ tvl6mAgoUsd: 500_000_000 }), settings, now).parts.adoption;
    const falling = scoreCandidate(candidate({ tvl6mAgoUsd: 2_000_000_000 }), settings, now).parts.adoption;
    const unknown = scoreCandidate(candidate(), settings, now).parts.adoption;

    expect(rising).toBeGreaterThan(unknown);
    expect(unknown).toBeGreaterThan(falling);
  });

  it('retire des points de sécurité pour un piratage ancien', () => {
    const clean = scoreCandidate(candidate(), settings, now).parts.securite;
    const hacked = scoreCandidate(candidate({ hacks: [{ date: '2023-01-01', amountUsd: 1e6 }] }), settings, now).parts.securite;

    expect(clean).toBe(10);
    expect(hacked).toBe(7);
  });
});

describe('rankCandidates et allocate', () => {
  it('classe les éligibles avant les autres, puis par note', () => {
    const ranked = rankCandidates(
      [
        candidate({ key: 'weak', revenue1yUsd: 1_000_000 }),
        candidate({ key: 'rejected', audited: false, revenue1yUsd: 500_000_000 }),
        candidate({ key: 'strong' }),
      ],
      settings,
      now
    );

    expect(ranked.map((scored) => scored.candidate.key)).toEqual(['strong', 'weak', 'rejected']);
  });

  it('retient au plus 4 projets éligibles et laisse le reste en USDC', () => {
    const ranked = rankCandidates(
      [candidate({ key: 'a' }), candidate({ key: 'b' }), candidate({ key: 'c', audited: false })],
      settings,
      now
    );

    const { picks, reservePct } = allocate(ranked, settings);

    expect(picks.map((scored) => scored.candidate.key)).toEqual(['a', 'b']);
    expect(reservePct).toBe(10);
  });
});

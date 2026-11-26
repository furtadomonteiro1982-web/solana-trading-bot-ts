import type { Candidate, GrilleContext, GrilleSettings, ScoredCandidate, ScoreParts } from './types.js';

// Note sur 100 calculée uniquement à partir de chiffres (docs/agents.md, « 3. Analyste ») :
// revenus 25, adoption 30, tokenomics 20, marché 15, sécurité 10. Les seuils des échelles sont des
// choix de départ, réglables ici ; Claude (le Chercheur) pourra plus tard exclure ou baisser une
// note, jamais la relever.

const DAY_MS = 86_400_000;

/** Interpolation linéaire bornée : `low` → 0 point, `high` → `max` points. */
function scale(value: number, low: number, high: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  const ratio = (value - low) / (high - low);
  return max * Math.min(1, Math.max(0, ratio));
}

const log10 = (value: number) => (value > 0 ? Math.log10(value) : -Infinity);

/** Part de l'offre en circulation : par rapport au maximum, sinon au total, sinon via la FDV. */
export function circulatingShare(candidate: Candidate): number | null {
  const market = candidate.market;
  if (!market) return null;
  const supplyCap = market.maxSupply ?? market.totalSupply;
  if (market.circulatingSupply && supplyCap && supplyCap > 0) return Math.min(1, market.circulatingSupply / supplyCap);
  if (market.fdvUsd && market.fdvUsd > 0) return Math.min(1, market.marketCapUsd / market.fdvUsd);
  return null;
}

/**
 * Évolution de la TVL du projet sur 6 mois par rapport à toute la DeFi, en % : 0 veut dire « comme
 * le marché ». La TVL se compte en dollars et suit les prix : sans cette comparaison, une baisse
 * générale du marché pénaliserait tous les projets de la même façon. Null sans historique.
 */
export function tvlChangeVsMarketPct(candidate: Candidate, context: GrilleContext = {}): number | null {
  if (!candidate.tvl6mAgoUsd || candidate.tvl6mAgoUsd <= 0) return null;
  const own = candidate.tvlUsd / candidate.tvl6mAgoUsd;
  const market = 1 + (context.defiTvlChange6mPct ?? 0) / 100;
  return (own / market - 1) * 100;
}

export function entryRejections(
  candidate: Candidate,
  settings: GrilleSettings,
  now: Date,
  context: GrilleContext = {}
): string[] {
  const reasons: string[] = [];
  const market = candidate.market;
  if (!market) return ['sans données de marché : jeton absent de CoinGecko'];

  const ageDays = market.tradedSince ? (now.getTime() - Date.parse(market.tradedSince)) / DAY_MS : 0;
  if (ageDays < settings.minAgeDays) {
    reasons.push(`trop récent : coté depuis moins de ${settings.minAgeDays} jours, ou date inconnue`);
  }
  if (!candidate.audited) reasons.push("sans audit : aucun audit déclaré sur DefiLlama");
  if (market.volume24hUsd < settings.minVolume24hUsd) {
    reasons.push(`volume trop faible : ${formatUsd(market.volume24hUsd)} sur 24 h < ${formatUsd(settings.minVolume24hUsd)}`);
  }
  const lookbackStart = new Date(now.getTime() - settings.hackLookbackDays * DAY_MS).toISOString().slice(0, 10);
  const recentHack = candidate.hacks.find((hack) => hack.date >= lookbackStart);
  if (recentHack) reasons.push(`piratage récent : le ${recentHack.date}, ${formatUsd(recentHack.amountUsd)}`);
  const vsMarket = tvlChangeVsMarketPct(candidate, context);
  if (vsMarket !== null && vsMarket < -settings.maxTvlDropVsMarketPct) {
    reasons.push(
      `fuite des utilisateurs : TVL ${vsMarket.toFixed(0)} % par rapport au marché sur 6 mois ` +
        `(limite −${settings.maxTvlDropVsMarketPct} %)`
    );
  }
  const share = circulatingShare(candidate);
  if (share === null) {
    reasons.push("offre inconnue : part en circulation inconnue, déblocages impossibles à estimer");
  } else if (share * 100 < settings.minCirculatingPct) {
    reasons.push(
      `déblocages à venir : seulement ${(share * 100).toFixed(0)} % de l'offre en circulation ` +
        `(minimum ${settings.minCirculatingPct} %)`
    );
  }
  return reasons;
}

export function scoreCandidate(
  candidate: Candidate,
  settings: GrilleSettings,
  now: Date,
  context: GrilleContext = {}
): ScoredCandidate {
  const notes: string[] = [];
  const market = candidate.market;
  const marketCap = market?.marketCapUsd ?? 0;

  // Revenus (25) : capitalisation / revenus annuels. 5 ou moins → 25 points, 200 ou plus → 0.
  let revenus = 0;
  if (candidate.revenue1yUsd > 0 && marketCap > 0) {
    const ratio = marketCap / candidate.revenue1yUsd;
    revenus = scale(-log10(ratio), -log10(200), -log10(5), 25);
    notes.push(`capitalisation = ${ratio.toFixed(1)} × les revenus annuels (${formatUsd(candidate.revenue1yUsd)})`);
  } else {
    notes.push('aucun revenu mesuré sur 1 an');
  }

  // Adoption (30) : taille de la TVL (10 pts, 10 M$ → 0, 10 Md$ → 10) et son évolution sur 6 mois
  // par rapport à toute la DeFi (20 pts, −50 % → 0, +50 % → 20 ; neutre à 10 sans historique).
  const tvlSize = scale(log10(candidate.tvlUsd), 7, 10, 10);
  let tvlTrend = 10;
  const vsMarket = tvlChangeVsMarketPct(candidate, context);
  if (vsMarket !== null) {
    tvlTrend = scale(vsMarket, -50, 50, 20);
    const own = (candidate.tvlUsd / candidate.tvl6mAgoUsd! - 1) * 100;
    const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(0)} %`;
    notes.push(
      `TVL ${formatUsd(candidate.tvlUsd)}, ${signed(own)} sur 6 mois` +
        (context.defiTvlChange6mPct === undefined
          ? ' (DeFi totale inconnue : comparaison brute)'
          : `, soit ${signed(vsMarket)} par rapport à la DeFi (${signed(context.defiTvlChange6mPct)})`)
    );
  } else {
    notes.push(`TVL ${formatUsd(candidate.tvlUsd)}, évolution sur 6 mois non chargée (comptée neutre)`);
  }
  const adoption = tvlSize + tvlTrend;

  // Tokenomics (20) : part de l'offre déjà en circulation, 40 % → 0, 100 % → 20.
  const share = circulatingShare(candidate);
  const tokenomics = share === null ? 0 : scale(share * 100, 40, 100, 20);
  if (share !== null) notes.push(`${(share * 100).toFixed(0)} % de l'offre en circulation`);

  // Marché (15) : volume 24 h (7,5 pts, 1 M$ → 0, 100 M$ → 7,5) et ancienneté (7,5 pts, 1 → 5 ans).
  const volume = scale(log10(market?.volume24hUsd ?? 0), 6, 8, 7.5);
  const ageYears = market?.tradedSince ? (now.getTime() - Date.parse(market.tradedSince)) / (365 * DAY_MS) : 0;
  const marche = volume + scale(ageYears, 1, 5, 7.5);

  // Sécurité (10) : audit déclaré (5) et historique de piratages (5 sans aucun, 2 s'ils sont anciens).
  const securite = (candidate.audited ? 5 : 0) + (candidate.hacks.length === 0 ? 5 : 2);
  if (candidate.hacks.length > 0) notes.push(`${candidate.hacks.length} piratage(s) dans l'historique`);

  const parts: ScoreParts = { revenus, adoption, tokenomics, marche, securite };
  const rejections = entryRejections(candidate, settings, now, context);
  return {
    candidate,
    eligible: rejections.length === 0,
    rejections,
    parts,
    total: revenus + adoption + tokenomics + marche + securite,
    notes,
  };
}

/** Classe les projets : éligibles d'abord, puis par note décroissante. */
export function rankCandidates(
  candidates: Candidate[],
  settings: GrilleSettings,
  now: Date,
  context: GrilleContext = {}
): ScoredCandidate[] {
  return candidates
    .map((candidate) => scoreCandidate(candidate, settings, now, context))
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.total - a.total);
}

/** Les `picks` meilleurs projets éligibles reçoivent chacun `pctEach` % ; le reste reste en USDC. */
export function allocate(ranked: ScoredCandidate[], settings: GrilleSettings): { picks: ScoredCandidate[]; reservePct: number } {
  const picks = ranked.filter((scored) => scored.eligible).slice(0, settings.picks);
  return { picks, reservePct: (settings.picks - picks.length) * settings.pctEach };
}

export function formatUsd(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)} Md$`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)} M$`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)} k$`;
  return `${value.toFixed(0)} $`;
}

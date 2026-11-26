// Types de la grille de notation des projets du cœur (docs/agents.md, « 3. Analyste »).

export interface HackRecord {
  /** Date UTC AAAA-MM-JJ. */
  date: string;
  amountUsd: number;
}

export interface MarketData {
  priceUsd: number;
  marketCapUsd: number;
  fdvUsd: number | null;
  volume24hUsd: number;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  /**
   * Date la plus ancienne connue de cotation : la plus ancienne entre le plus haut et le plus bas
   * historiques. Le jeton est coté depuis au moins cette date, peut-être avant : un minorant.
   */
  tradedSince: string | null;
}

/** Un projet regroupé (toutes ses versions : Aave V2, V3… ne font qu'un). */
export interface Candidate {
  key: string;
  name: string;
  symbol: string;
  geckoId: string;
  /**
   * Identifiants DefiLlama possibles pour l'historique de TVL (`/protocol/{slug}`), du plus probable
   * au moins probable : un projet parent s'y nomme d'après son nom actuel (« sky »), parfois
   * d'après son ancien identifiant (« maker »).
   */
  slugs: string[];
  category: string;
  chains: string[];
  tvlUsd: number;
  /** TVL il y a environ 6 mois, si l'historique a été chargé. */
  tvl6mAgoUsd?: number;
  audited: boolean;
  hacks: HackRecord[];
  fees1yUsd: number;
  revenue1yUsd: number;
  market?: MarketData;
}

export interface GrilleSettings {
  /** Réseaux retenus, tels que DefiLlama les nomme (« Binance » pour BNB Chain). */
  chains: string[];
  /** Taille minimale pour être examiné : TVL OU revenus annuels au moins égaux à ces seuils. */
  minTvlUsd: number;
  minRevenue1yUsd: number;
  minVolume24hUsd: number;
  minAgeDays: number;
  hackLookbackDays: number;
  /**
   * Exclusion si la TVL a perdu, sur 6 mois, plus que ce nombre de points par rapport à toute la
   * DeFi : les utilisateurs quittent le projet.
   */
  maxTvlDropVsMarketPct: number;
  /** Part minimale de l'offre déjà en circulation (indicateur de déblocages à venir), en %. */
  minCirculatingPct: number;
  /** Nombre de projets retenus, et part du cœur donnée à chacun (en % du capital du cœur). */
  picks: number;
  pctEach: number;
  /** Nombre de projets dont on charge l'historique de TVL pour mesurer l'adoption sur 6 mois. */
  historyShortlist: number;
  excludedGeckoIds: string[];
  excludedCategories: string[];
}

/** Données de marché communes à tous les projets. */
export interface GrilleContext {
  /** Évolution de la TVL totale de la DeFi sur 6 mois, en %. Absente : comparaison brute. */
  defiTvlChange6mPct?: number;
}

export interface ScoreParts {
  revenus: number;
  adoption: number;
  tokenomics: number;
  marche: number;
  securite: number;
}

export interface ScoredCandidate {
  candidate: Candidate;
  eligible: boolean;
  /** Règles d'entrée non remplies ; vide si le projet est éligible. */
  rejections: string[];
  parts: ScoreParts;
  total: number;
  /** Explications courtes des points attribués. */
  notes: string[];
}

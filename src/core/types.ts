// Types du cœur (long terme) : voir docs/agents.md, section « Règles du cœur ».

/** Un jour de cotation où tous les actifs suivis ont un prix de clôture en USD. */
export interface AlignedDay {
  /** Date UTC au format AAAA-MM-JJ. */
  date: string;
  /** Prix de clôture en USD par symbole (BTC, ETH, SOL, BNB…). */
  prices: Record<string, number>;
}

export interface CoreBacktestConfig {
  /** Capital total à investir progressivement, en USD. */
  capitalUsd: number;
  /**
   * Part cible de chaque actif, en % du capital. La somme peut être inférieure à 100 : le reste
   * est gardé en USDC (réserve pour les projets que la grille de notation sélectionnera plus
   * tard), sans rendement et hors rééquilibrage.
   */
  targets: Record<string, number>;
  /** Nombre d'achats hebdomadaires sur lesquels le capital est réparti. */
  dcaWeeks: number;
  /** Écart, en points, au-delà duquel le rééquilibrage trimestriel s'applique. */
  rebalanceThresholdPts: number;
  /** Frais de la plateforme, en % de chaque achat ou vente. */
  feePct: number;
  /** Glissement de prix (slippage) simulé, en % de chaque achat ou vente. */
  slippagePct: number;
}

export interface RebalanceEvent {
  date: string;
  /** Actif le plus éloigné de sa cible au moment du contrôle, et son écart en points. */
  worstAsset: string;
  deviationPts: number;
}

export interface CoreBacktestResult {
  startDate: string;
  endDate: string;
  /** Achats hebdomadaires réellement effectués (moins que dcaWeeks si l'historique est court). */
  buysDone: number;
  /** Capital effectivement engagé dans les achats, en USD. */
  investedUsd: number;
  /** Valeur finale : cryptos + réserve USDC + capital pas encore investi. */
  finalValueUsd: number;
  /** (valeur finale − capital) / capital, en %. */
  gainPct: number;
  /** Plus forte baisse de la valeur totale depuis un sommet, en % (valeur positive). */
  maxDrawdownPct: number;
  feesUsd: number;
  rebalances: RebalanceEvent[];
  /** Part finale de chaque actif dans la partie crypto du portefeuille, en %. */
  finalWeightsPct: Record<string, number>;
  reserveUsd: number;
  /** Valeur totale jour par jour, pour tracer une courbe ou calculer d'autres mesures. */
  dailyValues: { date: string; valueUsd: number }[];
}

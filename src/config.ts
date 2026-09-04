import fs from 'node:fs';
import { z } from 'zod';

export const BotConfigSchema = z.object({
  scanIntervalSeconds: z.number().positive(),
  network: z.string().min(1),
  // Nombre max de pools (parmi ceux qui passent le filtre) réellement évalués par cycle — les
  // autres sont journalisés (THROTTLE) et repris au cycle suivant. Absent = pas de limite (tous
  // les pools filtrés sont évalués, comportement historique). Réduit la consommation de quota API
  // par cycle indépendamment de perPoolDelayMs.
  maxPoolsPerCycle: z.number().int().positive().optional(),
  // Partagé entre GeckoTerminal et Birdeye (même domaine, deux fournisseurs) : pas de raison de
  // dupliquer ce réglage par fournisseur alors que le pipeline demande toujours la même chose.
  timeframe: z.enum(['day', 'hour', 'minute']),
  ohlcvLimit: z.number().int().positive(),
  // Réutilise les bougies déjà téléchargées pendant ce délai au lieu de rappeler l'API à chaque
  // cycle pour les mêmes pools : avec un timeframe "hour", les bougies changent à peine sur
  // quelques minutes, donc cette fenêtre coupe une grosse part du volume d'appels fetchOhlcv sans
  // perte de pertinence pour les indicateurs.
  ohlcvCacheTtlMs: z.number().nonnegative().default(600_000),
  filters: z.object({
    minLiquidityUsd: z.number().nonnegative(),
    minPoolAgeMinutes: z.number().nonnegative(),
  }),
  indicators: z.object({
    rsiPeriod: z.number().int().positive(),
    rsiOversold: z.number().min(0).max(100),
    smaPeriod: z.number().int().positive(),
    momentumLookbackCandles: z.number().int().positive(),
    momentumMinPct: z.number(),
    // meanReversion (historique) : achète le creux (RSI <= rsiOversold) dans une tendance haussière.
    // momentum : achète la force déjà là (RSI >= rsiOversold) plutôt que le creux — suit un
    // mouvement en cours au lieu d'anticiper un rebond. Réutilise rsiOversold comme seuil miroir
    // plutôt qu'un nouveau champ, pour rester un changement contenu.
    strategy: z.enum(['meanReversion', 'momentum']).default('meanReversion'),
  }),
  risk: z.object({
    simulatedCapitalUsd: z.number().positive(),
    maxPositionPct: z.number().positive().max(100),
    maxOpenPositions: z.number().int().positive(),
    stopLossPct: z.number().positive().max(100),
    takeProfitPct: z.number().positive(),
    trailingStopPct: z.number().positive().max(100),
  }),
  // Source principale : gratuite, sans clé API, pas de plafond mensuel (juste une limite de
  // débit qui se régénère en continu).
  geckoTerminal: z.object({
    baseUrl: z.url(),
    minIntervalMs: z.number().nonnegative().default(1100),
  }),
  // Secours automatique si GeckoTerminal échoue (voir MarketDataClient.createFallbackClient) —
  // nécessite une clé API et un quota mensuel en Compute Units, donc utilisé seulement en repli.
  birdeye: z.object({
    baseUrl: z.url(),
    minIntervalMs: z.number().nonnegative().default(1100),
  }),
  jupiter: z.object({
    baseUrl: z.url(),
  }),
  // Sniper temps réel sur les nouveaux tokens pump.fun (paper trading uniquement) — indépendant
  // de la stratégie horaire : capital simulé et plafond de positions séparés, voir
  // docs/superpowers/specs/2026-08-30-pumpfun-sniper-design.md.
  sniper: z
    .object({
      enabled: z.boolean().default(true),
      pumpPortalWsUrl: z.string().default('wss://pumpportal.fun/api/data'),
      simulatedCapitalUsd: z.number().positive().default(20),
      stakeUsd: z.number().positive().default(2),
      maxOpenSnipes: z.number().int().positive().default(5),
      stopLossPct: z.number().positive().max(100).default(40),
      takeProfitPct: z.number().positive().default(100),
      maxHoldMinutes: z.number().positive().default(15),
      reviewIntervalSeconds: z.number().positive().default(8),
      // Après la première lecture de prix (2s après création), on revérifie une seconde fois ce
      // délai plus tard : sans aucun trade organique entre les deux, le prix d'une bonding curve
      // pump.fun est parfaitement stable. minMomentumIncreasePct sert de seuil anti-bruit flottant
      // plutôt qu'une égalité stricte — voir momentumFilter.ts.
      momentumCheckDelayMs: z.number().positive().default(8000),
      minMomentumIncreasePct: z.number().positive().default(1),
      // Time-stop conditionnel (inspiré de solana_memecoin_bot/risk.py) : un token qui a déjà
      // dépassé ce seuil de hausse (même s'il a reflué depuis) obtient pumpedHoldExtensionMultiplier
      // fois plus de temps avant timeout, au lieu d'être coupé au même délai qu'un token resté plat.
      noPumpThresholdPct: z.number().positive().default(20),
      pumpedHoldExtensionMultiplier: z.number().positive().default(3),
      filters: z
        .object({
          requireSocialLink: z.boolean().default(true),
          bannedNamePatterns: z
            .array(z.string())
            .default(['test', 'scam', 'rug', 'airdrop', 'giveaway', 'presale', 'whitelist', '1000x']),
          minCreatorInitialBuyPct: z.number().min(0).max(100).default(1),
          maxCreatorInitialBuyPct: z.number().positive().max(100).default(10),
        })
        .default({
          requireSocialLink: true,
          bannedNamePatterns: ['test', 'scam', 'rug', 'airdrop', 'giveaway', 'presale', 'whitelist', '1000x'],
          minCreatorInitialBuyPct: 1,
          maxCreatorInitialBuyPct: 10,
        }),
    })
    .default({
      enabled: true,
      pumpPortalWsUrl: 'wss://pumpportal.fun/api/data',
      simulatedCapitalUsd: 20,
      stakeUsd: 2,
      maxOpenSnipes: 5,
      stopLossPct: 40,
      takeProfitPct: 100,
      maxHoldMinutes: 15,
      reviewIntervalSeconds: 8,
      momentumCheckDelayMs: 8000,
      minMomentumIncreasePct: 1,
      noPumpThresholdPct: 20,
      pumpedHoldExtensionMultiplier: 3,
      filters: {
        requireSocialLink: true,
        bannedNamePatterns: ['test', 'scam', 'rug', 'airdrop', 'giveaway', 'presale', 'whitelist', '1000x'],
        minCreatorInitialBuyPct: 1,
        maxCreatorInitialBuyPct: 10,
      },
    }),
});

export type BotConfig = z.infer<typeof BotConfigSchema>;

export function loadConfig(path: string): BotConfig {
  // Le fichier est édité à la main : une faute de frappe (virgule en trop, fichier absent) doit
  // produire un message clair et non une pile d'appels Node brute.
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(path, 'utf-8'));
  } catch (error) {
    throw new Error(`Impossible de lire ou parser la config ${path} : ${String(error)}`);
  }
  const result = BotConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Config invalide dans ${path} : ${result.error.message}`);
  }
  return result.data;
}

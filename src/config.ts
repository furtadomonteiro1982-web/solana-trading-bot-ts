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

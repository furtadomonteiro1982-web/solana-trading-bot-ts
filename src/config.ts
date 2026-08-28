import fs from 'node:fs';
import { z } from 'zod';

export const BotConfigSchema = z.object({
  scanIntervalSeconds: z.number().positive(),
  network: z.string().min(1),
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
  geckoTerminal: z.object({
    baseUrl: z.url(),
    timeframe: z.enum(['day', 'hour', 'minute']),
    ohlcvLimit: z.number().int().positive(),
    // Délai entre deux appels API pour des pools différents au sein d'un même cycle, pour rester
    // sous le quota du plan gratuit au lieu de rafaler tous les appels d'un coup.
    perPoolDelayMs: z.number().nonnegative().default(400),
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

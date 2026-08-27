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
    baseUrl: z.string().url(),
    timeframe: z.enum(['day', 'hour', 'minute']),
    ohlcvLimit: z.number().int().positive(),
  }),
});

export type BotConfig = z.infer<typeof BotConfigSchema>;

export function loadConfig(path: string): BotConfig {
  const raw = fs.readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw);
  const result = BotConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Config invalide dans ${path} : ${result.error.message}`);
  }
  return result.data;
}

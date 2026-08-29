import type { BotConfig } from './config.js';
import type { MarketDataClient } from './marketdata/client.js';
import type { Candle, Pool, Signal } from './types.js';
import { calculateRSI } from './indicators/rsi.js';
import { calculateSMA } from './indicators/sma.js';
import { calculateMomentumPct } from './indicators/momentum.js';

export function evaluateSignal(pool: Pool, candles: Candle[], config: BotConfig): Signal {
  const closes = candles.map((c) => c.close);
  const rsi = calculateRSI(closes, config.indicators.rsiPeriod);
  const sma = calculateSMA(closes, config.indicators.smaPeriod);
  const momentumPct = calculateMomentumPct(closes, config.indicators.momentumLookbackCandles);
  const indicators = { rsi, sma, momentumPct };

  if (rsi === null || sma === null || momentumPct === null) {
    return {
      pool,
      decision: 'SKIP',
      reason: 'Pas assez de données historiques pour calculer les indicateurs',
      indicators,
    };
  }

  const latestClose = closes[closes.length - 1];
  const isOversold = rsi <= config.indicators.rsiOversold;
  const hasMomentum = momentumPct >= config.indicators.momentumMinPct;
  const aboveTrend = latestClose > sma;

  if (isOversold && hasMomentum && aboveTrend) {
    return {
      pool,
      decision: 'BUY',
      reason: `RSI survendu (${rsi.toFixed(1)}) avec momentum positif (${momentumPct.toFixed(1)}%) et prix au-dessus de la SMA`,
      indicators,
    };
  }

  const reasons: string[] = [];
  if (!isOversold) reasons.push(`RSI ${rsi.toFixed(1)} > seuil ${config.indicators.rsiOversold}`);
  if (!hasMomentum) reasons.push(`momentum ${momentumPct.toFixed(1)}% < seuil ${config.indicators.momentumMinPct}%`);
  if (!aboveTrend) reasons.push('prix sous la SMA');

  return { pool, decision: 'HOLD', reason: reasons.join(' ; '), indicators };
}

export async function generateSignal(
  client: MarketDataClient,
  pool: Pool,
  config: BotConfig
): Promise<Signal> {
  const candles = await client.fetchOhlcv(
    config.network,
    pool.poolAddress,
    config.timeframe,
    config.ohlcvLimit
  );
  return evaluateSignal(pool, candles, config);
}

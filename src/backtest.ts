import type { BotConfig } from './config.js';
import type { Candle, Pool } from './types.js';
import { evaluateSignal } from './signal.js';
import { evaluateRisk } from './risk.js';

export interface BacktestTrade {
  poolAddress: string;
  entryPriceUsd: number;
  entryAt: Date;
  exitPriceUsd: number;
  exitAt: Date;
  exitReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | 'END_OF_DATA';
  pnlUsd: number;
  pnlPct: number;
}

export interface BacktestReport {
  trades: BacktestTrade[];
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  totalPnlUsd: number;
}

/**
 * Simplification: position sizing always uses config.risk.simulatedCapitalUsd
 * (not compounded with prior trade PnL), so results stay simple to reason about.
 */
export function runBacktest(pool: Pool, candles: Candle[], config: BotConfig): BacktestReport {
  const minCandles = Math.max(config.indicators.rsiPeriod, config.indicators.smaPeriod) + 1;
  const trades: BacktestTrade[] = [];

  let i = minCandles;
  while (i < candles.length) {
    const window = candles.slice(0, i + 1);
    const signal = evaluateSignal(pool, window, config);

    if (signal.decision === 'BUY') {
      const risk = evaluateRisk(signal, 0, config.risk.simulatedCapitalUsd, config);
      if (risk.approved && risk.positionSizeUsd && risk.stopLossPrice && risk.takeProfitPrice) {
        const entryCandle = candles[i];
        const trailingPct = risk.trailingStopPct ?? config.risk.trailingStopPct;
        let highestPrice = entryCandle.close;
        let exitIndex = candles.length - 1;
        let exitPrice = candles[candles.length - 1].close;
        let exitReason: BacktestTrade['exitReason'] = 'END_OF_DATA';

        for (let j = i + 1; j < candles.length; j++) {
          const candle = candles[j];
          if (candle.high > highestPrice) highestPrice = candle.high;

          if (candle.high >= risk.takeProfitPrice) {
            exitIndex = j;
            exitPrice = risk.takeProfitPrice;
            exitReason = 'TAKE_PROFIT';
            break;
          }
          if (candle.low <= risk.stopLossPrice) {
            exitIndex = j;
            exitPrice = risk.stopLossPrice;
            exitReason = 'STOP_LOSS';
            break;
          }
          const trailingStopPrice = highestPrice * (1 - trailingPct / 100);
          if (highestPrice > entryCandle.close && candle.low <= trailingStopPrice) {
            exitIndex = j;
            exitPrice = trailingStopPrice;
            exitReason = 'TRAILING_STOP';
            break;
          }
        }

        const exitCandle = candles[exitIndex];
        const pnlPct = ((exitPrice - entryCandle.close) / entryCandle.close) * 100;
        const pnlUsd = (pnlPct / 100) * risk.positionSizeUsd;

        trades.push({
          poolAddress: pool.poolAddress,
          entryPriceUsd: entryCandle.close,
          entryAt: entryCandle.timestamp,
          exitPriceUsd: exitPrice,
          exitAt: exitCandle.timestamp,
          exitReason,
          pnlUsd,
          pnlPct,
        });

        i = exitIndex + 1;
        continue;
      }
    }
    i += 1;
  }

  const wins = trades.filter((t) => t.pnlUsd > 0).length;
  const losses = trades.length - wins;
  const totalPnlUsd = trades.reduce((sum, t) => sum + t.pnlUsd, 0);

  return {
    trades,
    totalTrades: trades.length,
    wins,
    losses,
    winRatePct: trades.length > 0 ? (wins / trades.length) * 100 : 0,
    totalPnlUsd,
  };
}

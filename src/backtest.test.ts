import { describe, expect, it } from 'vitest';
import { runBacktest } from './backtest.js';
import type { BotConfig } from './config.js';
import type { Candle, Pool } from './types.js';

const config = {
  network: 'solana',
  indicators: {
    rsiPeriod: 2,
    rsiOversold: 50,
    smaPeriod: 2,
    momentumLookbackCandles: 1,
    momentumMinPct: 0,
  },
  risk: {
    simulatedCapitalUsd: 1000,
    maxPositionPct: 10,
    maxOpenPositions: 5,
    stopLossPct: 50,
    takeProfitPct: 10,
    trailingStopPct: 50,
  },
} as BotConfig;

const pool: Pool = {
  poolAddress: 'POOL1',
  baseTokenSymbol: 'FOO',
  baseTokenAddress: 'TOKEN1',
  // Deliberately far from every candle's close. evaluateRisk (Task 7) derives
  // stopLossPrice/takeProfitPrice from pool.priceUsd, so runBacktest must substitute a
  // point-in-time price (the entry candle's close) before calling evaluateSignal/evaluateRisk —
  // otherwise this static, unrealistic priceUsd would leak into the risk levels and the
  // assertions below (entryPriceUsd/exitPriceUsd/pnlUsd) would fail loudly.
  priceUsd: 999,
  liquidityUsd: 50000,
  volume24hUsd: 10000,
  priceChange24hPct: 5,
  poolCreatedAt: new Date(),
};

function candle(open: number, high: number, low: number, close: number, offsetMs: number): Candle {
  return { timestamp: new Date(offsetMs), open, high, low, close, volume: 100 };
}

describe('runBacktest', () => {
  it('opens exactly one trade on the BUY signal and closes it at take-profit', () => {
    // Index 0-3: warm-up candles (RSI/SMA period 2 -> minCandles = 3, first evaluation at index 3).
    // closes at index 0-3: 1.0, 0.9, 0.8, 0.9 -> RSI(2)=50, SMA(2)=0.85, momentum(1)=+12.5% -> BUY, entry 0.9
    // Index 4: high 1.6 hits take-profit price (0.9 * 1.10 = 0.99) -> exit at 0.99
    // Index 5: closes[0..5] recompute to a non-BUY signal (RSI no longer oversold) -> no second trade
    const candles = [
      candle(1.0, 1.0, 1.0, 1.0, 0),
      candle(1.0, 1.0, 0.9, 0.9, 1),
      candle(0.9, 0.9, 0.8, 0.8, 2),
      candle(0.8, 0.9, 0.8, 0.9, 3),
      candle(0.9, 1.6, 0.9, 1.5, 4),
      candle(1.5, 1.5, 1.4, 1.4, 5),
    ];

    const report = runBacktest(pool, candles, config);

    expect(report.totalTrades).toBe(1);
    expect(report.wins).toBe(1);
    expect(report.losses).toBe(0);
    expect(report.winRatePct).toBe(100);
    const [trade] = report.trades;
    expect(trade.entryPriceUsd).toBeCloseTo(0.9, 5);
    expect(trade.exitPriceUsd).toBeCloseTo(0.99, 5);
    expect(trade.exitReason).toBe('TAKE_PROFIT');
    expect(trade.pnlUsd).toBeCloseTo(10, 1); // 10% of the 100$ position (10% of 1000$ capital)
  });

  it('returns an empty report when no candle ever triggers a BUY', () => {
    const flatCandles = Array.from({ length: 10 }, (_, i) => candle(1, 1, 1, 1, i));

    const report = runBacktest(pool, flatCandles, config);

    expect(report.totalTrades).toBe(0);
    expect(report.winRatePct).toBe(0);
    expect(report.totalPnlUsd).toBe(0);
  });
});

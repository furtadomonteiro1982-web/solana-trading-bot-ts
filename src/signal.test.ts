import { describe, expect, it, vi } from 'vitest';
import { evaluateSignal, generateSignal } from './signal.js';
import type { MarketDataClient } from './marketdata/client.js';
import type { BotConfig } from './config.js';
import type { Candle, Pool } from './types.js';

const config = {
  network: 'solana',
  timeframe: 'hour',
  ohlcvLimit: 100,
  indicators: {
    rsiPeriod: 2,
    rsiOversold: 50,
    smaPeriod: 2,
    momentumLookbackCandles: 1,
    momentumMinPct: 0,
  },
} as BotConfig;

const pool: Pool = {
  poolAddress: 'POOL1',
  baseTokenSymbol: 'FOO',
  baseTokenAddress: 'TOKEN1',
  priceUsd: 0.9,
  liquidityUsd: 50000,
  volume24hUsd: 10000,
  priceChange24hPct: 5,
  poolCreatedAt: new Date(),
};

function candle(close: number, offsetMs: number): Candle {
  return { timestamp: new Date(offsetMs), open: close, high: close, low: close, close, volume: 100 };
}

describe('evaluateSignal', () => {
  it('returns SKIP when there is not enough history', () => {
    const candles = [candle(1, 0), candle(0.9, 1)];
    const signal = evaluateSignal(pool, candles, config);
    expect(signal.decision).toBe('SKIP');
  });

  it('returns BUY when RSI is oversold, momentum is positive, and price is above the SMA', () => {
    // closes: 1.0, 0.9, 0.8, 0.9 -> RSI(2)=50, SMA(2)=0.85, momentum(1)=+12.5%
    const candles = [candle(1.0, 0), candle(0.9, 1), candle(0.8, 2), candle(0.9, 3)];
    const signal = evaluateSignal(pool, candles, config);
    expect(signal.decision).toBe('BUY');
    expect(signal.indicators.rsi).toBeCloseTo(50, 5);
    expect(signal.indicators.sma).toBeCloseTo(0.85, 5);
    expect(signal.indicators.momentumPct).toBeCloseTo(12.5, 5);
  });

  it('returns HOLD when conditions are not all met', () => {
    // closes: 1.0, 1.1, 1.2, 1.4 -> RSI(2) will be high (not oversold)
    const candles = [candle(1.0, 0), candle(1.1, 1), candle(1.2, 2), candle(1.4, 3)];
    const signal = evaluateSignal(pool, candles, config);
    expect(signal.decision).toBe('HOLD');
  });

  it('momentum strategy: returns BUY on a strong rising trend that meanReversion would HOLD on', () => {
    const momentumConfig = { ...config, indicators: { ...config.indicators, strategy: 'momentum' } } as BotConfig;
    // Même bougies que le cas HOLD ci-dessus : RSI haut (pas survendu), mais c'est justement ce
    // que le mode momentum recherche (force déjà là) plutôt que ce qu'il rejette.
    const candles = [candle(1.0, 0), candle(1.1, 1), candle(1.2, 2), candle(1.4, 3)];
    const signal = evaluateSignal(pool, candles, momentumConfig);
    expect(signal.decision).toBe('BUY');
  });

  it('momentum strategy: still returns HOLD when price is below the SMA despite high RSI', () => {
    const momentumConfig = { ...config, indicators: { ...config.indicators, strategy: 'momentum' } } as BotConfig;
    // closes descendantes : RSI bas, prix sous la SMA -> ne doit pas acheter dans aucun des deux modes.
    const candles = [candle(1.4, 0), candle(1.2, 1), candle(1.1, 2), candle(1.0, 3)];
    const signal = evaluateSignal(pool, candles, momentumConfig);
    expect(signal.decision).toBe('HOLD');
  });

  it('meanReversion strategy is the default when config.indicators.strategy is absent', () => {
    const { strategy, ...indicatorsWithoutStrategy } = config.indicators as typeof config.indicators & { strategy?: string };
    const configWithoutStrategy = { ...config, indicators: indicatorsWithoutStrategy } as BotConfig;
    const candles = [candle(1.0, 0), candle(0.9, 1), candle(0.8, 2), candle(0.9, 3)];
    const signal = evaluateSignal(pool, candles, configWithoutStrategy);
    expect(signal.decision).toBe('BUY');
  });
});

describe('generateSignal', () => {
  it('fetches OHLCV from the client and delegates to evaluateSignal', async () => {
    const candles = [candle(1.0, 0), candle(0.9, 1), candle(0.8, 2), candle(0.9, 3)];
    const client: MarketDataClient = {
      fetchTrendingPools: vi.fn(),
      fetchOhlcv: vi.fn().mockResolvedValue(candles),
      fetchPool: vi.fn(),
    };

    const signal = await generateSignal(client, pool, config);

    expect(client.fetchOhlcv).toHaveBeenCalledWith('solana', 'POOL1', 'hour', 100);
    expect(signal.decision).toBe('BUY');
  });
});

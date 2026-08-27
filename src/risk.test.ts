import { describe, expect, it } from 'vitest';
import { evaluateRisk } from './risk.js';
import type { BotConfig } from './config.js';
import type { Pool, Signal } from './types.js';

const config = {
  risk: {
    simulatedCapitalUsd: 100,
    maxPositionPct: 10,
    maxOpenPositions: 3,
    stopLossPct: 20,
    takeProfitPct: 50,
    trailingStopPct: 15,
  },
} as BotConfig;

const pool: Pool = {
  poolAddress: 'POOL1',
  baseTokenSymbol: 'FOO',
  baseTokenAddress: 'TOKEN1',
  priceUsd: 1,
  liquidityUsd: 50000,
  volume24hUsd: 10000,
  priceChange24hPct: 5,
  poolCreatedAt: new Date(),
};

const buySignal: Signal = {
  pool,
  decision: 'BUY',
  reason: 'test',
  indicators: { rsi: 30, sma: 0.9, momentumPct: 5 },
};

describe('evaluateRisk', () => {
  it('approves a BUY signal and computes size, stop-loss, and take-profit', () => {
    const decision = evaluateRisk(buySignal, 0, 100, config);
    expect(decision.approved).toBe(true);
    expect(decision.positionSizeUsd).toBeCloseTo(10, 5); // 10% of 100
    expect(decision.stopLossPrice).toBeCloseTo(0.8, 5); // 1 * (1 - 0.20)
    expect(decision.takeProfitPrice).toBeCloseTo(1.5, 5); // 1 * (1 + 0.50)
    expect(decision.trailingStopPct).toBe(15);
  });

  it('rejects when the signal is not BUY', () => {
    const decision = evaluateRisk({ ...buySignal, decision: 'HOLD' }, 0, 100, config);
    expect(decision.approved).toBe(false);
  });

  it('rejects when the max number of open positions is reached', () => {
    const decision = evaluateRisk(buySignal, 3, 100, config);
    expect(decision.approved).toBe(false);
    expect(decision.reason).toMatch(/max de positions/);
  });
});

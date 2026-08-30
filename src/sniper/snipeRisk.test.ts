import { describe, expect, it } from 'vitest';
import { evaluateSnipeRisk } from './snipeRisk.js';
import type { BotConfig } from '../config.js';

const config = {
  sniper: {
    stakeUsd: 2,
    maxOpenSnipes: 5,
    stopLossPct: 40,
    takeProfitPct: 100,
  },
} as BotConfig;

describe('evaluateSnipeRisk', () => {
  it('approves with a fixed stake and TP/SL derived from entry price', () => {
    const decision = evaluateSnipeRisk(0.001, 2, config);
    expect(decision.approved).toBe(true);
    expect(decision.positionSizeUsd).toBe(2);
    expect(decision.stopLossPrice).toBeCloseTo(0.0006, 10); // 0.001 * (1 - 0.40)
    expect(decision.takeProfitPrice).toBeCloseTo(0.002, 10); // 0.001 * (1 + 1.00)
  });

  it('rejects when the open-snipe cap is already reached', () => {
    const decision = evaluateSnipeRisk(0.001, 5, config);
    expect(decision.approved).toBe(false);
    expect(decision.reason).toMatch(/5\/5/);
  });
});

import { describe, expect, it } from 'vitest';
import { calculateMomentumPct } from './momentum.js';

describe('calculateMomentumPct', () => {
  it('returns null when there are not enough closes for the lookback', () => {
    expect(calculateMomentumPct([1, 2], 5)).toBeNull();
  });

  it('computes the percent change vs. `lookback` candles ago', () => {
    expect(calculateMomentumPct([100, 105, 110], 2)).toBeCloseTo(10, 5);
  });

  it('returns a negative value when the price dropped', () => {
    expect(calculateMomentumPct([100, 95, 90], 2)).toBeCloseTo(-10, 5);
  });
});

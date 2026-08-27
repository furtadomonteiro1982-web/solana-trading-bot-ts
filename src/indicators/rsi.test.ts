import { describe, expect, it } from 'vitest';
import { calculateRSI } from './rsi.js';

describe('calculateRSI', () => {
  it('returns null when there are fewer than period+1 closes', () => {
    expect(calculateRSI([1, 2, 3], 14)).toBeNull();
  });

  it('matches the classic 14-period RSI textbook example (~70.46)', () => {
    const closes = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
      45.89, 46.03, 45.61, 46.28, 46.28,
    ];
    expect(calculateRSI(closes, 14)).toBeCloseTo(70.46, 1);
  });

  it('returns 100 when there are no losses in the period', () => {
    expect(calculateRSI([1, 2, 3, 4], 3)).toBe(100);
  });
});

import { describe, expect, it } from 'vitest';
import { calculateSMA } from './sma.js';

describe('calculateSMA', () => {
  it('returns null when there are fewer closes than the period', () => {
    expect(calculateSMA([1, 2], 5)).toBeNull();
  });

  it('averages the last `period` closes', () => {
    expect(calculateSMA([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(calculateSMA([10, 1, 2, 3, 4, 5], 5)).toBe(3); // ignores the older leading value
  });
});

import { describe, expect, it } from 'vitest';
import { hasOrganicMomentum } from './momentumFilter.js';

describe('hasOrganicMomentum', () => {
  it('accepts when the price rose above the required threshold', () => {
    expect(hasOrganicMomentum(1, 1.02, 1)).toBe(true);
  });

  it('accepts exactly at the required threshold', () => {
    expect(hasOrganicMomentum(1, 1.01, 1)).toBe(true);
  });

  it('rejects when the price is unchanged (no organic activity)', () => {
    expect(hasOrganicMomentum(1, 1, 1)).toBe(false);
  });

  it('rejects when the price rose but below the required threshold', () => {
    expect(hasOrganicMomentum(1, 1.005, 1)).toBe(false);
  });

  it('rejects when the price dropped', () => {
    expect(hasOrganicMomentum(1, 0.9, 1)).toBe(false);
  });
});

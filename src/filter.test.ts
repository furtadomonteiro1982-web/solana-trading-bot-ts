import { describe, expect, it } from 'vitest';
import { filterPools } from './filter.js';
import type { BotConfig } from './config.js';
import type { Pool } from './types.js';

const config = {
  filters: { minLiquidityUsd: 10000, minPoolAgeMinutes: 60 },
} as BotConfig;

const now = new Date('2026-08-27T12:00:00.000Z');

function makePool(overrides: Partial<Pool>): Pool {
  return {
    poolAddress: 'A',
    baseTokenSymbol: 'FOO',
    baseTokenAddress: 'token-A',
    priceUsd: 1,
    liquidityUsd: 20000,
    volume24hUsd: 5000,
    priceChange24hPct: 1,
    poolCreatedAt: new Date('2026-08-27T10:00:00.000Z'), // 2h before `now`
    ...overrides,
  };
}

describe('filterPools', () => {
  it('passes a pool that meets both thresholds', () => {
    const [result] = filterPools([makePool({})], config, now);
    expect(result.passed).toBe(true);
  });

  it('rejects a pool with insufficient liquidity', () => {
    const [result] = filterPools([makePool({ liquidityUsd: 5000 })], config, now);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/Liquidité/);
  });

  it('rejects a pool whose price is not a usable number', () => {
    const [result] = filterPools([makePool({ priceUsd: NaN })], config, now);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/aberrantes|incomplètes/);
    expect(result.reason).not.toMatch(/Liquidité|âgé/);
  });

  it('rejects a pool with a zero price', () => {
    const [result] = filterPools([makePool({ priceUsd: 0 })], config, now);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/aberrantes|incomplètes/);
  });

  it('rejects a pool with a non-finite liquidity', () => {
    const [result] = filterPools([makePool({ liquidityUsd: NaN })], config, now);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/aberrantes|incomplètes/);
  });

  it('rejects a pool with an unparseable creation date', () => {
    const [result] = filterPools([makePool({ poolCreatedAt: new Date('pas-une-date') })], config, now);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/aberrantes|incomplètes/);
  });

  it('rejects a pool that is too young', () => {
    const [result] = filterPools(
      [makePool({ poolCreatedAt: new Date('2026-08-27T11:30:00.000Z') })], // 30 min before now
      config,
      now
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/âgé/);
  });
});

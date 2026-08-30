import { describe, expect, it } from 'vitest';
import { shouldSnipe } from './snipeFilter.js';
import type { NewTokenEvent, SnipeFilterConfig } from './snipeFilter.js';

const config: SnipeFilterConfig = {
  requireSocialLink: true,
  bannedNamePatterns: ['test', 'scam', 'rug'],
  maxCreatorInitialBuyPct: 20,
};

function makeEvent(overrides: Partial<NewTokenEvent> = {}): NewTokenEvent {
  return {
    tokenAddress: 'MINT1',
    symbol: 'FOO',
    name: 'Foo Coin',
    creatorAddress: 'CREATOR1',
    hasSocialLink: true,
    creatorInitialBuyPct: 5,
    ...overrides,
  };
}

describe('shouldSnipe', () => {
  it('accepts a token with a social link, a clean name, and a modest creator buy', () => {
    const result = shouldSnipe(makeEvent(), config);
    expect(result.passed).toBe(true);
  });

  it('rejects a token with no social link when requireSocialLink is true', () => {
    const result = shouldSnipe(makeEvent({ hasSocialLink: false }), config);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/lien social/i);
  });

  it('accepts a token with no social link when requireSocialLink is false', () => {
    const result = shouldSnipe(makeEvent({ hasSocialLink: false }), { ...config, requireSocialLink: false });
    expect(result.passed).toBe(true);
  });

  it('rejects a name matching a banned pattern, case-insensitively', () => {
    const result = shouldSnipe(makeEvent({ name: 'Definitely Not A Scam Coin' }), config);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/scam/i);
  });

  it('rejects a symbol matching a banned pattern', () => {
    const result = shouldSnipe(makeEvent({ symbol: 'RUG' }), config);
    expect(result.passed).toBe(false);
  });

  it('rejects when the creator initial buy exceeds the configured maximum', () => {
    const result = shouldSnipe(makeEvent({ creatorInitialBuyPct: 25 }), config);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/25/);
  });

  it('accepts when the creator initial buy is exactly at the configured maximum', () => {
    const result = shouldSnipe(makeEvent({ creatorInitialBuyPct: 20 }), config);
    expect(result.passed).toBe(true);
  });
});

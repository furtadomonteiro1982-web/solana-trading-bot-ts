import type { Candidate, GrilleSettings } from './types.js';

export const settings: GrilleSettings = {
  chains: ['Ethereum', 'Solana', 'Binance'],
  minTvlUsd: 10_000_000,
  minRevenue1yUsd: 1_000_000,
  minVolume24hUsd: 1_000_000,
  minAgeDays: 365,
  hackLookbackDays: 365,
  minCirculatingPct: 50,
  picks: 4,
  pctEach: 5,
  historyShortlist: 12,
  excludedGeckoIds: ['bitcoin', 'ethereum', 'tether'],
  excludedCategories: ['CEX', 'Chain'],
};

export const now = new Date('2026-11-26T12:00:00Z');

/** Un bon projet : éligible, revenus élevés, offre presque entièrement en circulation. */
export function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    key: 'parent#good',
    name: 'Good',
    symbol: 'GOOD',
    geckoId: 'good',
    slugs: ['good'],
    category: 'Dexs',
    chains: ['Ethereum'],
    tvlUsd: 1_000_000_000,
    audited: true,
    hacks: [],
    fees1yUsd: 200_000_000,
    revenue1yUsd: 100_000_000,
    market: {
      priceUsd: 1,
      marketCapUsd: 1_000_000_000,
      fdvUsd: 1_100_000_000,
      volume24hUsd: 50_000_000,
      circulatingSupply: 900,
      totalSupply: 1000,
      maxSupply: 1000,
      tradedSince: '2021-01-01',
    },
    ...overrides,
  };
}

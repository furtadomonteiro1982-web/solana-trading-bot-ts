import { describe, expect, it } from 'vitest';
import { buildCandidates, slugify } from './buildCandidates.js';
import { settings } from './testFixtures.js';
import type { LlamaProtocol } from './defillamaClient.js';

const protocols: LlamaProtocol[] = [
  { id: '1', name: 'Foo V2', slug: 'foo-v2', category: 'Dexs', chains: ['Ethereum'], tvl: 30e6, parentProtocol: 'parent#foo', audits: '2' },
  { id: '2', name: 'Foo V3', slug: 'foo-v3', category: 'Lending', chains: ['Solana'], tvl: 70e6, parentProtocol: 'parent#foo', audits: '0' },
  { id: '3', name: 'Solo', slug: 'solo', category: 'Dexs', chains: ['Binance'], tvl: 50e6, gecko_id: 'solo-token', audits: '1' },
  { id: '4', name: 'NoToken', slug: 'notoken', category: 'Dexs', chains: ['Ethereum'], tvl: 90e6 },
  { id: '5', name: 'Elsewhere', slug: 'elsewhere', category: 'Dexs', chains: ['Tron'], tvl: 90e6, gecko_id: 'elsewhere' },
  { id: '6', name: 'Exchange', slug: 'exchange', category: 'CEX', chains: ['Ethereum'], tvl: 9e9, gecko_id: 'exchange' },
  { id: '7', name: 'Tiny', slug: 'tiny', category: 'Dexs', chains: ['Ethereum'], tvl: 1e6, gecko_id: 'tiny' },
  { id: '8', name: 'Tether', slug: 'tether', category: 'Dexs', chains: ['Ethereum'], tvl: 9e9, gecko_id: 'tether' },
];
const parents = [{ id: 'parent#foo', name: 'Foo Finance', symbol: 'foo', gecko_id: 'foo-token' }];

describe('buildCandidates', () => {
  const candidates = buildCandidates(
    protocols,
    parents,
    [{ defillamaId: '1', total1y: 10e6 }, { defillamaId: '2', total1y: 5e6 }, { defillamaId: '7', total1y: 3e6 }],
    [{ defillamaId: '2', total1y: 2e6 }, { defillamaId: '7', total1y: 2e6 }],
    [{ date: Date.UTC(2025, 5, 1) / 1000, amount: 1e6, defillamaId: '1' }],
    settings
  );
  const byKey = new Map(candidates.map((c) => [c.key, c]));

  it('regroupe les versions sous leur projet parent et additionne leurs chiffres', () => {
    const foo = byKey.get('parent#foo')!;

    expect(foo).toMatchObject({ name: 'Foo Finance', symbol: 'FOO', geckoId: 'foo-token', tvlUsd: 100e6 });
    expect(foo.fees1yUsd).toBe(15e6);
    expect(foo.revenue1yUsd).toBe(2e6);
    expect(foo.chains.sort()).toEqual(['Ethereum', 'Solana']);
    expect(foo.category).toBe('Lending'); // celle de la plus grosse version
    expect(foo.slugs).toEqual(['foo-finance', 'foo']);
  });

  it("considère un projet audité si l'une de ses versions l'est (niveau 2 ou plus)", () => {
    expect(byKey.get('parent#foo')!.audited).toBe(true);
    expect(byKey.get('3')!.audited).toBe(false);
  });

  it('rattache les piratages au projet', () => {
    expect(byKey.get('parent#foo')!.hacks).toEqual([{ date: '2025-06-01', amountUsd: 1e6 }]);
  });

  it('écarte les projets sans jeton, hors réseaux suivis, exclus ou trop petits', () => {
    expect([...byKey.keys()].sort()).toEqual(['3', '7', 'parent#foo']);
    // « Tiny » n'a que 1 M$ de TVL, mais ses 2 M$ de revenus annuels le gardent.
  });
});

describe('slugify', () => {
  it('produit un identifiant DefiLlama', () => {
    expect(slugify('Sky')).toBe('sky');
    expect(slugify('Curve DEX & Co.')).toBe('curve-dex-co');
    expect(slugify('Échange Été')).toBe('echange-ete');
  });
});

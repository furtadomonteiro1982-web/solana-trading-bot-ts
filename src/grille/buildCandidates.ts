import type { LlamaFeeEntry, LlamaHack, LlamaParent, LlamaProtocol } from './defillamaClient.js';
import type { Candidate, GrilleSettings } from './types.js';

/**
 * Regroupe les protocoles DefiLlama par projet (le parent s'il existe : Aave V2 et V3 forment
 * « Aave »), additionne TVL, frais et revenus, rattache les piratages, et ne garde que les
 * projets présents sur les réseaux suivis, liés à un jeton coté sur CoinGecko et d'une taille
 * minimale (TVL ou revenus) : les milliers de petits projets inactifs ne sont pas examinés.
 */
export function buildCandidates(
  protocols: LlamaProtocol[],
  parents: LlamaParent[],
  fees: LlamaFeeEntry[],
  revenues: LlamaFeeEntry[],
  hacks: LlamaHack[],
  settings: GrilleSettings
): Candidate[] {
  const parentById = new Map(parents.map((parent) => [parent.id, parent]));
  const groupOfProtocol = new Map<string, string>();
  const groups = new Map<string, Candidate>();
  const wantedChains = new Set(settings.chains);
  const excludedCategories = new Set(settings.excludedCategories);

  for (const protocol of protocols) {
    const parent = protocol.parentProtocol ? parentById.get(protocol.parentProtocol) : undefined;
    const key = parent ? parent.id : protocol.id;
    groupOfProtocol.set(protocol.id, key);

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        name: parent?.name ?? protocol.name,
        symbol: (parent?.symbol ?? protocol.symbol ?? '').toUpperCase(),
        geckoId: parent?.gecko_id ?? protocol.gecko_id ?? '',
        slugs: parent
          ? [...new Set([slugify(parent.name), parent.id.replace(/^parent#/, '')])]
          : [protocol.slug],
        category: protocol.category ?? '',
        chains: [],
        tvlUsd: 0,
        audited: false,
        hacks: [],
        fees1yUsd: 0,
        revenue1yUsd: 0,
      };
      groups.set(key, group);
    }
    if (!group.geckoId && protocol.gecko_id) group.geckoId = protocol.gecko_id;
    // La catégorie retenue est celle de la version la plus grosse (TVL).
    if ((protocol.tvl ?? 0) > group.tvlUsd && protocol.category) group.category = protocol.category;
    group.tvlUsd += protocol.tvl ?? 0;
    // Audits DefiLlama : "0" aucun, "1" partiel ou en cours, "2" et plus audité.
    if (Number(protocol.audits ?? 0) >= 2) group.audited = true;
    for (const chain of protocol.chains ?? []) if (!group.chains.includes(chain)) group.chains.push(chain);
  }

  const addAmounts = (entries: LlamaFeeEntry[], field: 'fees1yUsd' | 'revenue1yUsd') => {
    for (const entry of entries) {
      const key = entry.defillamaId ? groupOfProtocol.get(entry.defillamaId) : undefined;
      const group = key ? groups.get(key) : undefined;
      if (group) group[field] += entry.total1y ?? 0;
    }
  };
  addAmounts(fees, 'fees1yUsd');
  addAmounts(revenues, 'revenue1yUsd');

  for (const hack of hacks) {
    const key = hack.defillamaId ? groupOfProtocol.get(String(hack.defillamaId)) : undefined;
    const group = key ? groups.get(key) : undefined;
    if (group) {
      group.hacks.push({ date: new Date(hack.date * 1000).toISOString().slice(0, 10), amountUsd: hack.amount ?? 0 });
    }
  }

  const excludedIds = new Set(settings.excludedGeckoIds);
  return [...groups.values()].filter(
    (group) =>
      group.geckoId !== '' &&
      !excludedIds.has(group.geckoId) &&
      !excludedCategories.has(group.category) &&
      group.chains.some((chain) => wantedChains.has(chain)) &&
      (group.tvlUsd >= settings.minTvlUsd || group.revenue1yUsd >= settings.minRevenue1yUsd)
  );
}

export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

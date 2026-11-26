import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { buildCandidates } from './grille/buildCandidates.js';
import { fetchMarkets } from './grille/coingeckoClient.js';
import { DefiLlamaClient } from './grille/defillamaClient.js';
import { formatGrilleReport } from './grille/report.js';
import { allocateResearched, applyVerdicts, loadChercheurFile } from './grille/chercheur.js';
import { rankCandidates } from './grille/scoring.js';

// Note les projets candidats pour la part « projets » du cœur (docs/agents.md). Données publiques
// DefiLlama et CoinGecko, gratuites et sans clé. Aucun ordre n'est passé.
//
//   npm run grille

async function main() {
  const settings = loadConfig('config/config.json').grille;
  const now = new Date();
  const llama = new DefiLlamaClient();

  console.log('Téléchargement des données DefiLlama (protocoles, frais, revenus, piratages)…');
  const protocols = await llama.fetchProtocols();
  const parents = await llama.fetchParents();
  const fees = await llama.fetchFees('dailyFees');
  const revenues = await llama.fetchFees('dailyRevenue');
  const hacks = await llama.fetchHacks();
  const candidates = buildCandidates(protocols, parents, fees, revenues, hacks, settings);

  console.log(`Téléchargement des données de marché CoinGecko pour ${candidates.length} projets…`);
  const markets = await fetchMarkets(candidates.map((candidate) => candidate.geckoId));
  for (const candidate of candidates) candidate.market = markets.get(candidate.geckoId);

  // L'historique de TVL coûte une requête lourde par projet : on ne le charge que pour les mieux
  // placés, puis on reclasse.
  const shortlist = rankCandidates(candidates, settings, now)
    .filter((scored) => scored.eligible)
    .slice(0, settings.historyShortlist);
  console.log(`Historique de TVL sur 6 mois pour les ${shortlist.length} premiers…`);
  for (const scored of shortlist) {
    const errors: string[] = [];
    for (const slug of scored.candidate.slugs) {
      try {
        scored.candidate.tvl6mAgoUsd = (await llama.fetchTvlDaysAgo(slug, 182)) ?? undefined;
        errors.length = 0;
        break;
      } catch (error) {
        errors.push(String(error));
      }
    }
    if (errors.length > 0) console.warn(`  ${scored.candidate.name} : historique indisponible (${errors.join(' ; ')})`);
  }

  let context = {};
  try {
    const change = await llama.fetchDefiTvlChangePct(182);
    if (change !== null) {
      context = { defiTvlChange6mPct: change };
      console.log(`TVL totale de la DeFi sur 6 mois : ${change >= 0 ? '+' : ''}${change.toFixed(1)} %.`);
    }
  } catch (error) {
    console.warn(`TVL totale de la DeFi indisponible, évolutions comparées en brut (${String(error)})`);
  }

  const research = loadChercheurFile('config/chercheur.json');
  const ranked = applyVerdicts(rankCandidates(candidates, settings, now, context), research?.verdicts ?? []);
  const { picks, awaiting, reservePct } = allocateResearched(ranked, settings);
  const date = now.toISOString().slice(0, 10);
  console.log('');
  console.log(formatGrilleReport(ranked, picks, reservePct, settings.pctEach, date, { awaiting, researchDate: research?.date }));

  const dir = 'data/grille';
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${date}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        date,
        settings,
        awaiting: awaiting.map((scored) => scored.candidate.name),
        picks: picks.map((scored) => ({ name: scored.candidate.name, symbol: scored.candidate.symbol, geckoId: scored.candidate.geckoId, total: scored.total, pct: settings.pctEach })),
        ranked: ranked.map((scored) => ({ ...scored, candidate: { ...scored.candidate, hacks: scored.candidate.hacks } })),
      },
      null,
      2
    )
  );
  console.log(`\nDétail complet enregistré dans ${file}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

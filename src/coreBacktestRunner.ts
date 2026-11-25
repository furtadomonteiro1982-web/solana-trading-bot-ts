import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { fetchDailyCloses } from './core/binanceClient.js';
import { runCoreBacktest, runSingleAssetBenchmark } from './core/dcaBacktest.js';
import { alignSeries, lastDays, parseDailyCsv, toDailyCsv, type DailyClose } from './core/priceSeries.js';
import { formatCoreReport } from './core/report.js';

// Rejoue le cœur long terme sur des prix passés. Simulation pure : aucun ordre, aucune clé.
//
//   npm run backtest:core                     3 ans de prix téléchargés chez Binance
//   npm run backtest:core -- --years 2
//   npm run backtest:core -- --save data/prix  télécharge et garde les prix en CSV
//   npm run backtest:core -- --csv data/prix   rejoue hors ligne depuis BTC.csv, ETH.csv…

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig('config/config.json').core;
  const assets = [...new Set([...Object.keys(config.targets), config.benchmarkAsset])];
  const windowDays = Math.round(args.years * 365);

  const series: Record<string, DailyClose[]> = {};
  for (const asset of assets) {
    if (args.csvDir) {
      const file = path.join(args.csvDir, `${asset}.csv`);
      series[asset] = parseDailyCsv(fs.readFileSync(file, 'utf-8'), file);
    } else {
      console.log(`Téléchargement des prix de ${asset}…`);
      series[asset] = await fetchDailyCloses(asset, windowDays, { baseUrl: config.binanceBaseUrl });
      if (args.saveDir) {
        fs.mkdirSync(args.saveDir, { recursive: true });
        fs.writeFileSync(path.join(args.saveDir, `${asset}.csv`), toDailyCsv(series[asset]!));
      }
    }
  }

  const days = lastDays(alignSeries(series), windowDays);
  const backtestConfig = {
    capitalUsd: config.capitalUsd,
    targets: config.targets,
    dcaWeeks: config.dcaWeeks,
    rebalanceThresholdPts: config.rebalanceThresholdPts,
    feePct: config.feePct,
    slippagePct: config.slippagePct,
  };
  const core = runCoreBacktest(days, backtestConfig);
  const benchmark = runSingleAssetBenchmark(days, config.benchmarkAsset, backtestConfig);
  console.log(formatCoreReport(core, benchmark, config.benchmarkAsset, backtestConfig));
}

function parseArgs(argv: string[]): { years: number; csvDir?: string; saveDir?: string } {
  const result: { years: number; csvDir?: string; saveDir?: string } = { years: 3 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--years' && value) {
      result.years = Number(value);
      if (!(result.years > 0)) throw new Error(`--years attend un nombre positif, reçu « ${value} ».`);
      i++;
    } else if (flag === '--csv' && value) {
      result.csvDir = value;
      i++;
    } else if (flag === '--save' && value) {
      result.saveDir = value;
      i++;
    } else {
      throw new Error(`Option inconnue ou incomplète : « ${flag} ». Options : --years N, --csv DOSSIER, --save DOSSIER.`);
    }
  }
  return result;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

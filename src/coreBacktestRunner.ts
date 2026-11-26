import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { fetchDailyCloses } from './core/binanceClient.js';
import { runCoreBacktest, runSingleAssetBenchmark } from './core/dcaBacktest.js';
import { alignSeries, lastDays, parseDailyCsv, toDailyCsv, type DailyClose } from './core/priceSeries.js';
import { formatCoreReport, formatRollingReport } from './core/report.js';
import { coreBacktestConfig } from './core/settings.js';
import { runRollingWindows } from './core/rollingWindows.js';

// Rejoue le cœur long terme sur des prix passés. Simulation pure : aucun ordre, aucune clé.
//
//   npm run backtest:core                     3 ans de prix téléchargés chez Binance
//   npm run backtest:core -- --years 2
//   npm run backtest:core -- --save data/prix  télécharge et garde les prix en CSV
//   npm run backtest:core -- --csv data/prix   rejoue hors ligne depuis BTC.csv, ETH.csv…
//   npm run backtest:core -- --rolling         fenêtres de 3 ans glissantes sur tout l'historique
//   npm run backtest:core -- --rolling --step-days 91 --history-years 8
//   npm run backtest:core -- --avec-projets   ajoute les projets de la grille (historique plus court)

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fullConfig = loadConfig('config/config.json');
  const config = fullConfig.core;
  const backtestConfig = coreBacktestConfig(fullConfig, { withProjects: args.withProjects });
  const assets = [...new Set([...Object.keys(backtestConfig.targets), config.benchmarkAsset])];
  const windowDays = Math.round(args.years * 365);
  const downloadDays = args.rolling ? Math.round(args.historyYears * 365) : windowDays;

  const series: Record<string, DailyClose[]> = {};
  for (const asset of assets) {
    if (args.csvDir) {
      const file = path.join(args.csvDir, `${asset}.csv`);
      series[asset] = parseDailyCsv(fs.readFileSync(file, 'utf-8'), file);
    } else {
      console.log(`Téléchargement des prix de ${asset}…`);
      series[asset] = await fetchDailyCloses(asset, downloadDays, { baseUrl: config.binanceBaseUrl });
      if (args.saveDir) {
        fs.mkdirSync(args.saveDir, { recursive: true });
        fs.writeFileSync(path.join(args.saveDir, `${asset}.csv`), toDailyCsv(series[asset]!));
      }
    }
  }

  const allDays = alignSeries(series);
  if (args.rolling) {
    const summary = runRollingWindows(allDays, windowDays, args.stepDays, backtestConfig, config.benchmarkAsset);
    console.log(formatRollingReport(summary, config.benchmarkAsset, args.years));
    return;
  }

  const days = lastDays(allDays, windowDays);
  const core = runCoreBacktest(days, backtestConfig);
  const benchmark = runSingleAssetBenchmark(days, config.benchmarkAsset, backtestConfig);
  console.log(formatCoreReport(core, benchmark, config.benchmarkAsset, backtestConfig));
}

interface RunnerArgs {
  years: number;
  rolling: boolean;
  stepDays: number;
  historyYears: number;
  withProjects: boolean;
  csvDir?: string;
  saveDir?: string;
}

function parseArgs(argv: string[]): RunnerArgs {
  const result: RunnerArgs = { years: 3, rolling: false, stepDays: 30, historyYears: 10, withProjects: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--years' && value) {
      result.years = Number(value);
      if (!(result.years > 0)) throw new Error(`--years attend un nombre positif, reçu « ${value} ».`);
      i++;
    } else if (flag === '--avec-projets') {
      result.withProjects = true;
    } else if (flag === '--rolling') {
      result.rolling = true;
    } else if (flag === '--step-days' && value) {
      result.stepDays = Number(value);
      if (!Number.isInteger(result.stepDays) || result.stepDays <= 0) {
        throw new Error(`--step-days attend un entier positif, reçu « ${value} ».`);
      }
      i++;
    } else if (flag === '--history-years' && value) {
      result.historyYears = Number(value);
      if (!(result.historyYears > 0)) throw new Error(`--history-years attend un nombre positif, reçu « ${value} ».`);
      i++;
    } else if (flag === '--csv' && value) {
      result.csvDir = value;
      i++;
    } else if (flag === '--save' && value) {
      result.saveDir = value;
      i++;
    } else {
      throw new Error(`Option inconnue ou incomplète : « ${flag} ». Options : --years N, --rolling, --avec-projets, --step-days N, --history-years N, --csv DOSSIER, --save DOSSIER.`);
    }
  }
  return result;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { fetchDailyCloses } from './core/binanceClient.js';
import { alignSeries, type DailyClose } from './core/priceSeries.js';
import { coreBacktestConfig, reservePct } from './core/settings.js';
import { corePortfolioLines, lumpSumLine } from './comptable/core.js';
import { currentMonth, reportPeriod } from './comptable/period.js';
import { formatMonthlyReport } from './comptable/report.js';
import { summarizeStrategy } from './comptable/satellite.js';
import { TelegramNotifier } from './notifier/telegramNotifier.js';
import { createDb } from './store/db.js';
import { PositionRepository } from './store/positionRepository.js';

// Rapport mensuel du Comptable (docs/agents.md, « 6. Comptable ») : cœur, satellite et BTC seul.
//
//   npm run comptable                         mois en cours
//   npm run comptable -- --mois 2026-12
//   npm run comptable -- --depuis 2025-01-01  fait comme si la simulation avait commencé à cette date

const DB_PATH = 'data/bot.sqlite';

async function main() {
  if (fs.existsSync('.env')) process.loadEnvFile('.env');
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig('config/config.json');
  const today = new Date();
  const simulationStart = args.since ?? config.core.simulationStartDate;
  const period = reportPeriod(args.month ?? currentMonth(today), simulationStart, today);

  const coreConfig = coreBacktestConfig(config, { withProjects: true });
  const assets = [...new Set([...Object.keys(coreConfig.targets), config.core.benchmarkAsset])];
  const daysNeeded = Math.ceil((today.getTime() - Date.parse(simulationStart)) / 86_400_000) + 2;
  const series: Record<string, DailyClose[]> = {};
  for (const asset of assets) {
    series[asset] = await fetchDailyCloses(asset, daysNeeded, { baseUrl: config.core.binanceBaseUrl });
  }
  const lateAssets = assets.filter((asset) => (series[asset]![0]?.date ?? '9999') > simulationStart);
  if (lateAssets.length > 0) {
    throw new Error(
      `Pas de prix au ${simulationStart} pour : ${lateAssets.map((a) => `${a} (coté depuis le ${series[a]![0]?.date ?? '?'})`).join(', ')}. ` +
        'Choisissez une date de départ plus récente.'
    );
  }
  const days = alignSeries(series);

  const core = corePortfolioLines(days, simulationStart, period, coreConfig, config.core.benchmarkAsset);

  const satelliteCapital = config.risk.simulatedCapitalUsd + config.sniper.simulatedCapitalUsd;
  let satellite = null;
  if (fs.existsSync(DB_PATH)) {
    const positions = new PositionRepository(createDb(DB_PATH))
      .getAllPositions()
      .filter((position) => position.openedAt.toISOString().slice(0, 10) >= simulationStart);
    satellite = [
      summarizeStrategy(positions, 'hourly', config.risk.simulatedCapitalUsd, period),
      summarizeStrategy(positions, 'snipe', config.sniper.simulatedCapitalUsd, period),
    ];
  }
  const satelliteBenchmark = lumpSumLine(
    days,
    config.core.benchmarkAsset,
    simulationStart,
    period,
    satelliteCapital,
    `${config.core.benchmarkAsset} acheté d'un coup (capital du satellite)`
  );
  const report = formatMonthlyReport({
    period,
    simulationStart,
    core,
    satellite,
    satelliteBenchmark,
    reservePct: reservePct(coreConfig),
    projects: Object.keys(config.core.projectTargets),
  });
  console.log(report);

  const dir = 'data/comptable';
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${period.month}${args.since ? `-depuis-${args.since}` : ''}.txt`);
  fs.writeFileSync(file, report + '\n');
  console.log(`\nRapport enregistré dans ${file}.`);

  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    await new TelegramNotifier(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID).notify(report);
    console.log('Rapport envoyé sur Telegram.');
  }
}

function parseArgs(argv: string[]): { month?: string; since?: string } {
  const result: { month?: string; since?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (flag === '--mois' && value) {
      result.month = value;
      i++;
    } else if (flag === '--depuis' && value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      result.since = value;
      i++;
    } else {
      throw new Error(`Option inconnue ou incomplète : « ${flag} ». Options : --mois AAAA-MM, --depuis AAAA-MM-JJ.`);
    }
  }
  return result;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

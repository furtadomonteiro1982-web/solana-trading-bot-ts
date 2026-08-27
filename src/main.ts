import { loadConfig } from './config.js';
import { createGeckoTerminalClient } from './geckoterminal/client.js';
import { createDb } from './store/db.js';
import { PositionRepository } from './store/positionRepository.js';
import { DecisionLogRepository } from './store/decisionLogRepository.js';
import { PaperExecutor } from './executor/paperExecutor.js';
import { runCycle } from './pipeline.js';

let stopRequested = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const config = loadConfig('config/config.json');
  const client = createGeckoTerminalClient(config.geckoTerminal.baseUrl);
  const db = createDb('data/bot.sqlite');
  const positionRepo = new PositionRepository(db);
  const decisionLog = new DecisionLogRepository(db);
  const executor = new PaperExecutor();

  process.on('SIGINT', () => {
    console.log('\nArrêt demandé, fin du cycle en cours...');
    stopRequested = true;
  });

  console.log(
    `Bot démarré (paper trading). Intervalle : ${config.scanIntervalSeconds}s. Ctrl+C pour arrêter proprement.`
  );

  while (!stopRequested) {
    const cycleStart = Date.now();
    try {
      const summary = await runCycle({ client, positionRepo, decisionLog, executor, config });
      console.log(
        `Cycle terminé : ${summary.poolsScanned} pools scannés, ${summary.poolsPassedFilter} retenus après filtre, ` +
          `${summary.buySignals} signaux BUY, ${summary.positionsOpened} position(s) ouverte(s), ` +
          `${summary.positionsClosed} position(s) clôturée(s).`
      );
    } catch (error) {
      console.error('Erreur pendant le cycle :', error);
    }
    const elapsedMs = Date.now() - cycleStart;
    const remainingMs = config.scanIntervalSeconds * 1000 - elapsedMs;
    if (remainingMs > 0 && !stopRequested) {
      await sleep(remainingMs);
    }
  }

  db.close();
  console.log('Bot arrêté proprement.');
}

main().catch((error) => {
  console.error('Erreur fatale :', error);
  process.exit(1);
});

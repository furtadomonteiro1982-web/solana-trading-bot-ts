import fs from 'node:fs';
import { loadConfig } from './config.js';
import { createGeckoTerminalClient } from './geckoterminal/client.js';
import { createDb } from './store/db.js';
import { PositionRepository } from './store/positionRepository.js';
import { DecisionLogRepository } from './store/decisionLogRepository.js';
import { PaperExecutor } from './executor/paperExecutor.js';
import { TelegramNotifier } from './notifier/telegramNotifier.js';
import { NullNotifier } from './notifier/nullNotifier.js';
import type { Notifier } from './notifier/notifier.js';
import { runCycle } from './pipeline.js';

// Après N cycles consécutifs avec au moins une erreur, on notifie une seule fois plutôt que de
// spammer à chaque cycle en erreur (un hoquet réseau isolé ne doit pas déclencher d'alerte).
const CONSECUTIVE_ERROR_CYCLES_BEFORE_ALERT = 3;

let stopRequested = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createNotifier(): Notifier {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (botToken && chatId) {
    console.log('Notifications Telegram activées.');
    return new TelegramNotifier(botToken, chatId);
  }
  console.log(
    'Notifications Telegram désactivées (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID absents de .env).'
  );
  return new NullNotifier();
}

async function main() {
  if (fs.existsSync('.env')) {
    process.loadEnvFile('.env');
  }

  const config = loadConfig('config/config.json');
  const client = createGeckoTerminalClient(config.geckoTerminal.baseUrl);
  const db = createDb('data/bot.sqlite');
  const positionRepo = new PositionRepository(db);
  const decisionLog = new DecisionLogRepository(db);
  const executor = new PaperExecutor();
  const notifier = createNotifier();

  process.on('SIGINT', () => {
    console.log('\nArrêt demandé, fin du cycle en cours...');
    stopRequested = true;
  });

  console.log(
    `Bot démarré (paper trading). Intervalle : ${config.scanIntervalSeconds}s. Ctrl+C pour arrêter proprement.`
  );

  let consecutiveErrorCycles = 0;

  while (!stopRequested) {
    const cycleStart = Date.now();
    try {
      const summary = await runCycle({ client, positionRepo, decisionLog, executor, notifier, config });
      console.log(
        `Cycle terminé : ${summary.poolsScanned} pools scannés, ${summary.poolsPassedFilter} retenus après filtre, ` +
          `${summary.buySignals} signaux BUY, ${summary.positionsOpened} position(s) ouverte(s), ` +
          `${summary.positionsClosed} position(s) clôturée(s), ${summary.errors} erreur(s).`
      );

      if (summary.errors > 0) {
        consecutiveErrorCycles += 1;
        if (consecutiveErrorCycles === CONSECUTIVE_ERROR_CYCLES_BEFORE_ALERT) {
          await notifier.notify(
            `⚠️ Le bot rencontre des erreurs depuis ${CONSECUTIVE_ERROR_CYCLES_BEFORE_ALERT} cycles consécutifs ` +
              `(voir decision_logs pour le détail).`
          );
        }
      } else {
        consecutiveErrorCycles = 0;
      }
    } catch (error) {
      // Ne devrait plus se produire (runCycle capture déjà ses propres erreurs), gardé par sécurité.
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

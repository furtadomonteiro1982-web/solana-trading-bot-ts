import fs from 'node:fs';
import { loadConfig } from './config.js';
import { createBirdeyeClient } from './birdeye/client.js';
import { createJupiterPriceClient } from './jupiter/priceClient.js';
import { createDb } from './store/db.js';
import { PositionRepository } from './store/positionRepository.js';
import { DecisionLogRepository } from './store/decisionLogRepository.js';
import { FirstSeenRepository } from './store/firstSeenRepository.js';
import { PaperExecutor } from './executor/paperExecutor.js';
import { TelegramNotifier } from './notifier/telegramNotifier.js';
import { NullNotifier } from './notifier/nullNotifier.js';
import type { Notifier } from './notifier/notifier.js';
import { runCycle } from './pipeline.js';

// Après N cycles consécutifs avec au moins une erreur, on notifie une seule fois plutôt que de
// spammer à chaque cycle en erreur (un hoquet réseau isolé ne doit pas déclencher d'alerte).
const CONSECUTIVE_ERROR_CYCLES_BEFORE_ALERT = 3;

let stopRequested = false;
// Déclaré au niveau module (pas dans main()) pour que le handler d'erreur fatale tout en bas
// puisse aussi notifier un crash inattendu, pas seulement l'arrêt propre en fin de main().
let notifier: Notifier = new NullNotifier();

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

  // Contrairement à Telegram (facultatif, dégrade vers NullNotifier), Birdeye est la seule
  // source de données du bot : sans clé API, il ne peut littéralement rien scanner.
  const birdeyeApiKey = process.env.BIRDEYE_API_KEY;
  if (!birdeyeApiKey) {
    console.error(
      "Erreur : BIRDEYE_API_KEY absent de .env. Créez une clé gratuite sur https://birdeye.so et ajoutez-la à .env (voir .env.example)."
    );
    process.exit(1);
  }

  const config = loadConfig('config/config.json');
  const client = createBirdeyeClient(config.birdeye.baseUrl, birdeyeApiKey, config.birdeye.minIntervalMs);
  const priceClient = createJupiterPriceClient(config.jupiter.baseUrl);
  const db = createDb('data/bot.sqlite');
  const positionRepo = new PositionRepository(db);
  const decisionLog = new DecisionLogRepository(db);
  const firstSeenRepo = new FirstSeenRepository(db);
  const executor = new PaperExecutor();
  notifier = createNotifier();

  process.on('SIGINT', () => {
    console.log('\nArrêt demandé, fin du cycle en cours...');
    stopRequested = true;
  });

  console.log(
    `Bot démarré (paper trading). Intervalle : ${config.scanIntervalSeconds}s. Ctrl+C pour arrêter proprement.`
  );
  await notifier.notify(`🤖 Bot démarré (paper trading). Intervalle : ${config.scanIntervalSeconds}s.`);

  let consecutiveErrorCycles = 0;

  while (!stopRequested) {
    const cycleStart = Date.now();
    try {
      const summary = await runCycle({
        client,
        priceClient,
        positionRepo,
        decisionLog,
        firstSeenRepo,
        executor,
        notifier,
        config,
      });
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
  await notifier.notify('🛑 Bot arrêté proprement.');
}

main().catch(async (error) => {
  console.error('Erreur fatale :', error);
  // Meilleur effort : si le crash survient avant que le notifier ne soit configuré (ex. config
  // invalide), notifier reste le NullNotifier par défaut et cet appel ne fait rien.
  await notifier.notify(`💥 Le bot s'est arrêté sur une erreur fatale : ${String(error)}`);
  process.exit(1);
});

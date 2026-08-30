import fs from 'node:fs';
import { loadConfig } from './config.js';
import { createGeckoTerminalClient } from './geckoterminal/client.js';
import { createBirdeyeClient } from './birdeye/client.js';
import { createFallbackClient, type MarketDataClient } from './marketdata/client.js';
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
import { createPumpPortalClient } from './sniper/pumpPortalClient.js';
import { handleNewToken, runSniperReviewCycle, type SniperDeps } from './sniper/sniperPipeline.js';

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

  const config = loadConfig('config/config.json');
  const geckoTerminalClient = createGeckoTerminalClient(
    config.geckoTerminal.baseUrl,
    config.geckoTerminal.minIntervalMs
  );

  // GeckoTerminal (gratuit, sans clé) est la source principale. Birdeye ne sert que de secours
  // automatique si GeckoTerminal échoue — comme Telegram, il est facultatif et dégrade proprement
  // (ici : pas de secours, pas un arrêt du bot) plutôt que de bloquer le démarrage.
  const birdeyeApiKey = process.env.BIRDEYE_API_KEY;
  let client: MarketDataClient = geckoTerminalClient;
  if (birdeyeApiKey) {
    console.log('Secours Birdeye activé si GeckoTerminal échoue.');
    const birdeyeClient = createBirdeyeClient(
      config.birdeye.baseUrl,
      birdeyeApiKey,
      config.birdeye.minIntervalMs
    );
    client = createFallbackClient(geckoTerminalClient, birdeyeClient);
  } else {
    console.log(
      'Secours Birdeye désactivé (BIRDEYE_API_KEY absent de .env, facultatif — voir .env.example).'
    );
  }

  const priceClient = createJupiterPriceClient(config.jupiter.baseUrl);
  const db = createDb('data/bot.sqlite');
  const positionRepo = new PositionRepository(db);
  const decisionLog = new DecisionLogRepository(db);
  const firstSeenRepo = new FirstSeenRepository(db);
  const nearStopLossWarned = new Set<number>();
  const executor = new PaperExecutor();
  notifier = createNotifier();

  process.on('SIGINT', () => {
    console.log('\nArrêt demandé, fin du cycle en cours...');
    stopRequested = true;
  });

  let pumpPortalClient: ReturnType<typeof createPumpPortalClient> | null = null;
  if (config.sniper.enabled) {
    const sniperDeps: SniperDeps = { positionRepo, decisionLog, executor, notifier, priceClient, config };

    pumpPortalClient = createPumpPortalClient(config.sniper.pumpPortalWsUrl);
    pumpPortalClient.onNewToken((event) => {
      // Le prix d'entrée n'est pas dans l'événement PumpPortal (qui ne fournit que des quantités
      // de bonding curve, pas un prix en dollars directement exploitable) : on utilise le prix
      // Jupiter dès que le token est indexé, avec un court délai pour lui laisser le temps de l'être.
      setTimeout(() => {
        void (async () => {
          const prices = await priceClient.fetchPrices([event.tokenAddress]);
          const entryPriceUsd = prices.get(event.tokenAddress);
          if (entryPriceUsd == null) return; // pas encore indexé par Jupiter, on rate ce snipe
          await handleNewToken(event, sniperDeps, entryPriceUsd);
        })();
      }, 2000);
    });
    pumpPortalClient.connect();
    console.log(`Sniper pump.fun activé (mise ${config.sniper.stakeUsd}$, ${config.sniper.maxOpenSnipes} max).`);

    void (async () => {
      while (!stopRequested) {
        try {
          await runSniperReviewCycle(sniperDeps);
        } catch (error) {
          console.error('Erreur pendant la revue des snipes :', error);
        }
        await sleep(config.sniper.reviewIntervalSeconds * 1000);
      }
    })();
  } else {
    console.log('Sniper pump.fun désactivé (config.sniper.enabled = false).');
  }

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
        nearStopLossWarned,
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
      // Contrairement aux erreurs ponctuelles sur un pool isolé (déjà couvertes par l'alerte à 3
      // cycles consécutifs ci-dessus), un cycle entier qui plante sans produire de résumé est
      // notifié immédiatement — c'est un raté complet, pas un simple hoquet.
      console.error('Erreur pendant le cycle :', error);
      await notifier.notify(`❌ Un cycle complet a échoué : ${String(error)}`);
    }
    const elapsedMs = Date.now() - cycleStart;
    const remainingMs = config.scanIntervalSeconds * 1000 - elapsedMs;
    if (remainingMs > 0 && !stopRequested) {
      await sleep(remainingMs);
    }
  }

  pumpPortalClient?.close();
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

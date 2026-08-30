import type { BotConfig } from './config.js';
import type { MarketDataClient } from './marketdata/client.js';
import type { PriceClient } from './jupiter/priceClient.js';
import type { PositionRepository } from './store/positionRepository.js';
import type { DecisionLogRepository } from './store/decisionLogRepository.js';
import type { FirstSeenRepository } from './store/firstSeenRepository.js';
import type { Executor, Position } from './types.js';
import type { Notifier } from './notifier/notifier.js';
import { scanPools } from './scanner.js';
import { filterPools } from './filter.js';
import { generateSignal } from './signal.js';
import { evaluateRisk } from './risk.js';
import { reviewOpenPositions } from './positionManager.js';

export interface PipelineDeps {
  client: MarketDataClient;
  priceClient: PriceClient;
  positionRepo: PositionRepository;
  decisionLog: DecisionLogRepository;
  firstSeenRepo: FirstSeenRepository;
  // Ensemble en mémoire (pas persisté) des ids de positions déjà averties : évite de renotifier
  // à chaque cycle tant que le prix reste dans la zone de danger. Réinitialisé si le bot redémarre
  // — acceptable pour une simple alerte informative, pas un état métier critique.
  nearStopLossWarned: Set<number>;
  executor: Executor;
  notifier: Notifier;
  config: BotConfig;
}

// Seuil d'alerte précoce : avertit quand le prix a parcouru 80% du chemin entre l'entrée et le
// stop-loss, avant que la clôture automatique (déjà notifiée séparément) ne se déclenche.
const NEAR_STOP_LOSS_RATIO = 0.8;

export interface CycleSummary {
  poolsScanned: number;
  poolsPassedFilter: number;
  buySignals: number;
  positionsOpened: number;
  positionsClosed: number;
  errors: number;
}

export async function runCycle(deps: PipelineDeps): Promise<CycleSummary> {
  const { client, priceClient, positionRepo, decisionLog, firstSeenRepo, nearStopLossWarned, executor, notifier, config } = deps;
  const now = new Date();

  let poolsScanned = 0;
  let poolsPassedFilter = 0;
  let buySignals = 0;
  let positionsOpened = 0;
  let positionsClosed = 0;
  let errors = 0;

  // La phase "scan et achat" et la revue des positions ouvertes sont isolées l'une de l'autre :
  // une erreur d'API pendant le scan ne doit jamais empêcher la vérification des stop-loss /
  // take-profit des positions déjà ouvertes (et inversement). Les erreurs sont journalisées au
  // lieu de faire remonter une exception hors de runCycle.
  try {
    const pools = await scanPools(client, config);
    poolsScanned = pools.length;
    // GeckoTerminal (source principale) fournit la vraie date de création du pool ; Birdeye
    // (secours) ne le peut pas et renvoie "maintenant" en attendant. Dans les deux cas,
    // FirstSeenRepository ne retient que la toute première valeur vue pour une adresse donnée —
    // si GeckoTerminal a déjà répondu une fois pour ce pool, sa vraie date gagne définitivement,
    // même si Birdeye prend le relais plus tard.
    const poolsWithFirstSeenAge = pools.map((pool) => ({
      ...pool,
      poolCreatedAt: firstSeenRepo.getOrRecordFirstSeen(pool.poolAddress, pool.poolCreatedAt),
    }));
    const filterResults = filterPools(poolsWithFirstSeenAge, config, now);
    // L'espacement entre requêtes Birdeye (1 req/s) est géré en interne par le client
    // (MarketDataClient), pas ici — ce compteur ne sert plus qu'à borner le nombre de pools
    // réellement évalués par cycle.
    let poolsEvaluatedThisCycle = 0;

    for (const result of filterResults) {
      try {
        if (!result.passed) {
          decisionLog.log({
            timestamp: now,
            poolAddress: result.pool.poolAddress,
            stage: 'FILTER',
            decision: 'REJECTED',
            reason: result.reason,
          });
          continue;
        }
        poolsPassedFilter += 1;

        // Limite le nombre de pools réellement évalués (et donc d'appels API) par cycle : les
        // pools au-delà de la limite sont repris au cycle suivant plutôt que de continuer à
        // consommer le quota API du cycle actuel.
        if (
          config.maxPoolsPerCycle !== undefined &&
          poolsEvaluatedThisCycle >= config.maxPoolsPerCycle
        ) {
          decisionLog.log({
            timestamp: now,
            poolAddress: result.pool.poolAddress,
            stage: 'THROTTLE',
            decision: 'SKIPPED',
            reason: `Limite de ${config.maxPoolsPerCycle} pools par cycle atteinte, repris au prochain cycle`,
          });
          continue;
        }
        poolsEvaluatedThisCycle += 1;

        const signal = await generateSignal(client, result.pool, config);
        decisionLog.log({
          timestamp: now,
          poolAddress: result.pool.poolAddress,
          stage: 'SIGNAL',
          decision: signal.decision,
          reason: signal.reason,
        });

        if (signal.decision !== 'BUY') continue;
        buySignals += 1;

        const openPositions = positionRepo.getOpenPositions();

        // Une seule position par pool : avec timeframe "hour" et un scan toutes les 60 s, le même
        // signal BUY se répète pendant des dizaines de cycles consécutifs (la fenêtre OHLCV bouge
        // à peine). Sans ce garde-fou, le bot empilerait plusieurs positions sur le même token au
        // même prix et saturerait maxOpenPositions au lieu de diversifier.
        if (openPositions.some((position) => position.poolAddress === result.pool.poolAddress)) {
          decisionLog.log({
            timestamp: now,
            poolAddress: result.pool.poolAddress,
            stage: 'RISK',
            decision: 'REJECTED',
            reason: 'Position déjà ouverte sur ce pool',
          });
          continue;
        }

        // Simplification assumée : le capital disponible est toujours le montant configuré en
        // entier. Il n'est ni réduit par les positions actuellement ouvertes, ni ajusté par le PnL
        // réalisé (même simplification que dans backtest.ts).
        const risk = evaluateRisk(
          signal,
          openPositions.length,
          config.risk.simulatedCapitalUsd,
          config
        );
        decisionLog.log({
          timestamp: now,
          poolAddress: result.pool.poolAddress,
          stage: 'RISK',
          decision: risk.approved ? 'APPROVED' : 'REJECTED',
          reason: risk.reason,
        });

        if (
          !risk.approved ||
          risk.positionSizeUsd === undefined ||
          risk.stopLossPrice === undefined ||
          risk.takeProfitPrice === undefined
        ) {
          continue;
        }

        // Le prix réellement exécuté vient du Fill, pas de l'ordre : avec le PaperExecutor les deux
        // sont identiques, mais un exécuteur réel (slippage) ferait diverger les deux valeurs.
        const fill = await executor.execute({
          poolAddress: result.pool.poolAddress,
          baseTokenSymbol: result.pool.baseTokenSymbol,
          side: 'BUY',
          sizeUsd: risk.positionSizeUsd,
          priceUsd: result.pool.priceUsd,
        });

        positionRepo.openPosition({
          poolAddress: result.pool.poolAddress,
          baseTokenAddress: result.pool.baseTokenAddress,
          baseTokenSymbol: result.pool.baseTokenSymbol,
          entryPriceUsd: fill.filledPriceUsd,
          sizeUsd: risk.positionSizeUsd,
          stopLossPrice: risk.stopLossPrice,
          takeProfitPrice: risk.takeProfitPrice,
          trailingStopPct: risk.trailingStopPct ?? config.risk.trailingStopPct,
          openedAt: now,
        });
        positionsOpened += 1;
        await notifier.notify(
          `🟢 Position ouverte : ${result.pool.baseTokenSymbol} (${result.pool.poolAddress})\n` +
            `Entrée : ${fill.filledPriceUsd}$ — Taille : ${risk.positionSizeUsd.toFixed(2)}$`
        );
      } catch (error) {
        errors += 1;
        decisionLog.log({
          timestamp: now,
          poolAddress: result.pool.poolAddress,
          stage: 'ERROR',
          decision: 'ERROR',
          reason: `Erreur lors du traitement du pool : ${String(error)}`,
        });
        continue;
      }
    }
  } catch (error) {
    errors += 1;
    decisionLog.log({
      timestamp: now,
      poolAddress: '-',
      stage: 'ERROR',
      decision: 'ERROR',
      reason: `Erreur lors du scan des pools : ${String(error)}`,
    });
  }

  try {
    // Un seul appel Jupiter batché pour toutes les positions ouvertes, au lieu d'un appel par
    // position — Jupiter accepte plusieurs adresses séparées par des virgules en une requête.
    // Jupiter Price API attend l'adresse du token (mint), pas l'adresse de la pool AMM : les deux
    // diffèrent, d'où l'usage de baseTokenAddress ici plutôt que poolAddress.
    const openAddresses = positionRepo.getOpenPositions().map((position) => position.baseTokenAddress);
    const prices = await priceClient.fetchPrices(openAddresses);
    const closedPositions = await reviewOpenPositions(
      positionRepo,
      async (baseTokenAddress) => prices.get(baseTokenAddress) ?? null,
      executor,
      now,
      'hourly'
    );
    positionsClosed = closedPositions.length;
    for (const position of closedPositions) {
      await notifyPositionClosed(notifier, position);
      // Une position fermée ne peut plus être "proche" de quoi que ce soit.
      nearStopLossWarned.delete(position.id);
    }

    // Alerte précoce sur les positions qui restent ouvertes après la revue ci-dessus : le prix
    // s'approche du stop-loss sans l'avoir encore atteint.
    for (const position of positionRepo.getOpenPositions()) {
      const currentPrice = prices.get(position.baseTokenAddress);
      if (currentPrice == null) continue;
      const dangerThreshold =
        position.entryPriceUsd - NEAR_STOP_LOSS_RATIO * (position.entryPriceUsd - position.stopLossPrice);
      const inDangerZone = currentPrice <= dangerThreshold && currentPrice > position.stopLossPrice;
      if (inDangerZone && !nearStopLossWarned.has(position.id)) {
        nearStopLossWarned.add(position.id);
        await notifier.notify(
          `⚠️ Position proche du stop-loss : ${position.baseTokenSymbol} (${position.poolAddress})\n` +
            `Prix actuel : ${currentPrice}$ — Stop-loss : ${position.stopLossPrice}$ (entrée : ${position.entryPriceUsd}$)`
        );
      } else if (!inDangerZone) {
        // Le prix a récupéré au-dessus du seuil de danger : on pourra réavertir s'il y redescend.
        nearStopLossWarned.delete(position.id);
      }
    }
  } catch (error) {
    errors += 1;
    decisionLog.log({
      timestamp: now,
      poolAddress: '-',
      stage: 'ERROR',
      decision: 'ERROR',
      reason: `Erreur lors de la revue des positions ouvertes : ${String(error)}`,
    });
  }

  return { poolsScanned, poolsPassedFilter, buySignals, positionsOpened, positionsClosed, errors };
}

async function notifyPositionClosed(notifier: Notifier, position: Position): Promise<void> {
  const pnl = position.pnlUsd ?? 0;
  const sign = pnl >= 0 ? '+' : '';
  await notifier.notify(
    `🔴 Position fermée : ${position.baseTokenSymbol} (${position.poolAddress})\n` +
      `Raison : ${position.closeReason} — PnL : ${sign}${pnl.toFixed(2)}$`
  );
}

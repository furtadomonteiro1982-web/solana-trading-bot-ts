import type { BotConfig } from './config.js';
import type { GeckoTerminalClient } from './geckoterminal/client.js';
import type { PositionRepository } from './store/positionRepository.js';
import type { DecisionLogRepository } from './store/decisionLogRepository.js';
import type { Executor, Position } from './types.js';
import type { Notifier } from './notifier/notifier.js';
import { scanPools } from './scanner.js';
import { filterPools } from './filter.js';
import { generateSignal } from './signal.js';
import { evaluateRisk } from './risk.js';
import { reviewOpenPositions } from './positionManager.js';

export interface PipelineDeps {
  client: GeckoTerminalClient;
  positionRepo: PositionRepository;
  decisionLog: DecisionLogRepository;
  executor: Executor;
  notifier: Notifier;
  config: BotConfig;
}

export interface CycleSummary {
  poolsScanned: number;
  poolsPassedFilter: number;
  buySignals: number;
  positionsOpened: number;
  positionsClosed: number;
  errors: number;
}

export async function runCycle(deps: PipelineDeps): Promise<CycleSummary> {
  const { client, positionRepo, decisionLog, executor, notifier, config } = deps;
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
    const filterResults = filterPools(pools, config, now);
    let apiCallsThisCycle = 0;

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

        // Espace les appels OHLCV entre pools (mais jamais avant le tout premier de ce cycle),
        // pour ne pas rafaler jusqu'à 20 requêtes en quelques secondes et se faire rate-limiter.
        if (apiCallsThisCycle > 0) {
          await sleep(config.geckoTerminal.perPoolDelayMs ?? 0);
        }
        apiCallsThisCycle += 1;

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
    const closedPositions = await reviewOpenPositions(
      positionRepo,
      (poolAddress) => client.fetchPoolPrice(config.network, poolAddress),
      executor,
      now
    );
    positionsClosed = closedPositions.length;
    for (const position of closedPositions) {
      await notifyPositionClosed(notifier, position);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

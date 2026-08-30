import type { BotConfig } from '../config.js';
import type { PositionRepository } from '../store/positionRepository.js';
import type { DecisionLogRepository } from '../store/decisionLogRepository.js';
import type { Executor, Position } from '../types.js';
import type { Notifier } from '../notifier/notifier.js';
import type { PriceClient } from '../jupiter/priceClient.js';
import { shouldSnipe, type NewTokenEvent } from './snipeFilter.js';
import { evaluateSnipeRisk } from './snipeRisk.js';
import { reviewOpenPositions } from '../positionManager.js';
import { closeTimedOutPositions } from './timeoutManager.js';

export interface SniperDeps {
  positionRepo: PositionRepository;
  decisionLog: DecisionLogRepository;
  executor: Executor;
  notifier: Notifier;
  priceClient: PriceClient;
  config: BotConfig;
}

export async function handleNewToken(
  event: NewTokenEvent,
  deps: SniperDeps,
  entryPriceUsd: number
): Promise<void> {
  const { positionRepo, decisionLog, executor, notifier, config } = deps;
  const now = new Date();

  const filterResult = shouldSnipe(event, config.sniper.filters);
  decisionLog.log({
    timestamp: now,
    poolAddress: event.tokenAddress,
    stage: 'SNIPE',
    decision: filterResult.passed ? 'APPROVED' : 'REJECTED',
    reason: filterResult.reason,
  });
  if (!filterResult.passed) return;

  const openSnipesCount = positionRepo.getOpenPositions().filter((p) => p.strategy === 'snipe').length;
  const risk = evaluateSnipeRisk(entryPriceUsd, openSnipesCount, config);
  if (!risk.approved || risk.positionSizeUsd === undefined || risk.stopLossPrice === undefined || risk.takeProfitPrice === undefined) {
    decisionLog.log({
      timestamp: now,
      poolAddress: event.tokenAddress,
      stage: 'SNIPE',
      decision: 'REJECTED',
      reason: risk.reason,
    });
    return;
  }

  const fill = await executor.execute({
    poolAddress: event.tokenAddress,
    baseTokenSymbol: event.symbol,
    side: 'BUY',
    sizeUsd: risk.positionSizeUsd,
    priceUsd: entryPriceUsd,
  });

  positionRepo.openPosition({
    poolAddress: event.tokenAddress,
    baseTokenAddress: event.tokenAddress,
    baseTokenSymbol: event.symbol,
    entryPriceUsd: fill.filledPriceUsd,
    sizeUsd: risk.positionSizeUsd,
    stopLossPrice: risk.stopLossPrice,
    takeProfitPrice: risk.takeProfitPrice,
    trailingStopPct: 100, // pas de trailing stop pour les snipes : TP/SL/timeout suffisent (voir spec)
    openedAt: now,
    strategy: 'snipe',
  });

  await notifier.notify(
    `🎯 Snipe ouvert : ${event.symbol} (${event.tokenAddress})\n` +
      `Entrée : ${fill.filledPriceUsd}$ — Mise : ${risk.positionSizeUsd.toFixed(2)}$`
  );
}

export async function runSniperReviewCycle(deps: SniperDeps): Promise<void> {
  const { positionRepo, notifier, priceClient, config } = deps;

  const openSnipeAddresses = positionRepo
    .getOpenPositions()
    .filter((p) => p.strategy === 'snipe')
    .map((p) => p.baseTokenAddress);
  const prices = await priceClient.fetchPrices(openSnipeAddresses);
  const priceLookup = async (baseTokenAddress: string) => prices.get(baseTokenAddress) ?? null;

  const closedOnTpSl = await reviewOpenPositions(positionRepo, priceLookup, deps.executor, new Date(), 'snipe');
  const closedOnTimeout = await closeTimedOutPositions(
    positionRepo,
    config.sniper.maxHoldMinutes * 60 * 1000,
    priceLookup,
    deps.executor
  );

  for (const position of [...closedOnTpSl, ...closedOnTimeout]) {
    await notifySnipeClosed(notifier, position);
  }
}

async function notifySnipeClosed(notifier: Notifier, position: Position): Promise<void> {
  const pnl = position.pnlUsd ?? 0;
  const sign = pnl >= 0 ? '+' : '';
  await notifier.notify(
    `🔴 Snipe fermé : ${position.baseTokenSymbol} (${position.baseTokenAddress})\n` +
      `Raison : ${position.closeReason} — PnL : ${sign}${pnl.toFixed(2)}$`
  );
}

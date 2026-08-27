import type { BotConfig } from './config.js';
import type { GeckoTerminalClient } from './geckoterminal/client.js';
import type { PositionRepository } from './store/positionRepository.js';
import type { DecisionLogRepository } from './store/decisionLogRepository.js';
import type { Executor } from './types.js';
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
  config: BotConfig;
}

export interface CycleSummary {
  poolsScanned: number;
  poolsPassedFilter: number;
  buySignals: number;
  positionsOpened: number;
  positionsClosed: number;
}

export async function runCycle(deps: PipelineDeps): Promise<CycleSummary> {
  const { client, positionRepo, decisionLog, executor, config } = deps;
  const now = new Date();

  const pools = await scanPools(client, config);
  const filterResults = filterPools(pools, config, now);

  let poolsPassedFilter = 0;
  let buySignals = 0;
  let positionsOpened = 0;

  for (const result of filterResults) {
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

    const openCount = positionRepo.getOpenPositions().length;
    const risk = evaluateRisk(signal, openCount, config.risk.simulatedCapitalUsd, config);
    decisionLog.log({
      timestamp: now,
      poolAddress: result.pool.poolAddress,
      stage: 'RISK',
      decision: risk.approved ? 'APPROVED' : 'REJECTED',
      reason: risk.reason,
    });

    if (!risk.approved || !risk.positionSizeUsd || !risk.stopLossPrice || !risk.takeProfitPrice) continue;

    await executor.execute({
      poolAddress: result.pool.poolAddress,
      baseTokenSymbol: result.pool.baseTokenSymbol,
      side: 'BUY',
      sizeUsd: risk.positionSizeUsd,
      priceUsd: result.pool.priceUsd,
    });

    positionRepo.openPosition({
      poolAddress: result.pool.poolAddress,
      baseTokenSymbol: result.pool.baseTokenSymbol,
      entryPriceUsd: result.pool.priceUsd,
      sizeUsd: risk.positionSizeUsd,
      stopLossPrice: risk.stopLossPrice,
      takeProfitPrice: risk.takeProfitPrice,
      trailingStopPct: risk.trailingStopPct ?? config.risk.trailingStopPct,
      openedAt: now,
    });
    positionsOpened += 1;
  }

  const positionsClosed = await reviewOpenPositions(
    positionRepo,
    (poolAddress) => client.fetchPoolPrice(config.network, poolAddress),
    executor,
    now
  );

  return { poolsScanned: pools.length, poolsPassedFilter, buySignals, positionsOpened, positionsClosed };
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDb } from './store/db.js';
import { PositionRepository } from './store/positionRepository.js';
import { DecisionLogRepository } from './store/decisionLogRepository.js';
import { runCycle } from './pipeline.js';
import type { GeckoTerminalClient } from './geckoterminal/client.js';
import type { BotConfig } from './config.js';
import type { Candle, Executor, Fill, Order, Pool } from './types.js';
import type { Notifier } from './notifier/notifier.js';

const config = {
  network: 'solana',
  filters: { minLiquidityUsd: 1000, minPoolAgeMinutes: 60 },
  indicators: {
    rsiPeriod: 2,
    rsiOversold: 50,
    smaPeriod: 2,
    momentumLookbackCandles: 1,
    momentumMinPct: 0,
  },
  risk: {
    simulatedCapitalUsd: 1000,
    maxPositionPct: 10,
    maxOpenPositions: 5,
    stopLossPct: 50,
    takeProfitPct: 10,
    trailingStopPct: 50,
  },
  geckoTerminal: { baseUrl: 'x', timeframe: 'hour', ohlcvLimit: 100 },
} as BotConfig;

const pool: Pool = {
  poolAddress: 'POOL1',
  baseTokenSymbol: 'FOO',
  baseTokenAddress: 'TOKEN1',
  priceUsd: 0.9,
  liquidityUsd: 50000,
  volume24hUsd: 10000,
  priceChange24hPct: 5,
  poolCreatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24h old
};

function candle(close: number, offsetMs: number): Candle {
  return { timestamp: new Date(offsetMs), open: close, high: close, low: close, close, volume: 100 };
}

// closes: 1.0, 0.9, 0.8, 0.9 -> RSI(2)=50, SMA(2)=0.85, momentum(1)=+12.5% -> BUY, entry 0.9
const buyCandles = [candle(1.0, 0), candle(0.9, 1), candle(0.8, 2), candle(0.9, 3)];

let db: Database.Database;
let positionRepo: PositionRepository;
let decisionLog: DecisionLogRepository;
let executor: Executor;
let executeMock: ReturnType<typeof vi.fn<(order: Order) => Promise<Fill>>>;
let client: GeckoTerminalClient;
let notifier: Notifier;
let notifyMock: ReturnType<typeof vi.fn<(message: string) => Promise<void>>>;

beforeEach(() => {
  db = createDb(':memory:');
  positionRepo = new PositionRepository(db);
  decisionLog = new DecisionLogRepository(db);
  executeMock = vi.fn<(order: Order) => Promise<Fill>>().mockImplementation(
    async (order: Order): Promise<Fill> => ({
      poolAddress: order.poolAddress,
      side: order.side,
      sizeUsd: order.sizeUsd,
      filledPriceUsd: order.priceUsd,
      filledAt: new Date(),
    })
  );
  executor = { execute: executeMock };
  notifyMock = vi.fn<(message: string) => Promise<void>>().mockResolvedValue(undefined);
  notifier = { notify: notifyMock };
  client = {
    fetchTrendingPools: vi.fn().mockResolvedValue([pool]),
    fetchOhlcv: vi.fn().mockResolvedValue(buyCandles),
    // Price stays between stop-loss (0.45) and take-profit (0.99): position stays open.
    fetchPoolPrice: vi.fn().mockResolvedValue(0.5),
    fetchPool: vi.fn().mockResolvedValue(pool),
  };
});

describe('runCycle', () => {
  it('scans, filters, signals, opens a position, and leaves it open', async () => {
    const summary = await runCycle({ client, positionRepo, decisionLog, executor, notifier, config });

    expect(summary).toEqual({
      poolsScanned: 1,
      poolsPassedFilter: 1,
      buySignals: 1,
      positionsOpened: 1,
      positionsClosed: 0,
      errors: 0,
    });
    expect(positionRepo.getOpenPositions()).toHaveLength(1);
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ poolAddress: 'POOL1', side: 'BUY', sizeUsd: 100 })
    );
    expect(decisionLog.getRecent(10).length).toBeGreaterThan(0);
    expect(notifyMock).toHaveBeenCalledWith(expect.stringMatching(/Position ouverte.*FOO/s));
  });

  it('rejects a pool that fails the filter without calling the client for OHLCV', async () => {
    client.fetchTrendingPools = vi.fn().mockResolvedValue([{ ...pool, liquidityUsd: 10 }]);

    const summary = await runCycle({ client, positionRepo, decisionLog, executor, notifier, config });

    expect(summary.poolsPassedFilter).toBe(0);
    expect(summary.buySignals).toBe(0);
    expect(client.fetchOhlcv).not.toHaveBeenCalled();
  });

  it('records the executor fill price as the entry price, not the requested order price', async () => {
    // Un exécuteur réel (slippage) remplit à un prix différent de celui demandé.
    executeMock.mockImplementation(async (order: Order): Promise<Fill> => ({
      poolAddress: order.poolAddress,
      side: order.side,
      sizeUsd: order.sizeUsd,
      filledPriceUsd: 0.95, // != order.priceUsd (0.9)
      filledAt: new Date(),
    }));

    await runCycle({ client, positionRepo, decisionLog, executor, notifier, config });

    const [position] = positionRepo.getOpenPositions();
    expect(position.entryPriceUsd).toBe(0.95);
    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({ priceUsd: 0.9 }));
  });

  it('does not open a second position on a pool that already has one open', async () => {
    // Premier cycle : la position est ouverte.
    await runCycle({ client, positionRepo, decisionLog, executor, notifier, config });
    expect(positionRepo.getOpenPositions()).toHaveLength(1);
    const buyCallsAfterFirstCycle = executeMock.mock.calls.filter((c) => c[0].side === 'BUY').length;
    expect(buyCallsAfterFirstCycle).toBe(1);

    // Deuxième cycle : le même signal BUY se reproduit sur le même pool.
    const summary = await runCycle({ client, positionRepo, decisionLog, executor, notifier, config });

    expect(summary.buySignals).toBe(1);
    expect(summary.positionsOpened).toBe(0);
    expect(positionRepo.getOpenPositions()).toHaveLength(1);
    expect(executeMock.mock.calls.filter((c) => c[0].side === 'BUY')).toHaveLength(1);
    expect(
      decisionLog.getRecent(20).some((entry) => /Position déjà ouverte/.test(entry.reason))
    ).toBe(true);
  });

  it('keeps processing other pools and still reviews open positions when one pool throws', async () => {
    const pool2: Pool = { ...pool, poolAddress: 'POOL2', baseTokenSymbol: 'BAR' };
    client.fetchTrendingPools = vi.fn().mockResolvedValue([pool, pool2]);
    client.fetchOhlcv = vi.fn().mockImplementation(async (_network, poolAddress) => {
      if (poolAddress === 'POOL1') throw new Error('API GeckoTerminal indisponible');
      return buyCandles;
    });
    // Une position déjà ouverte sur un troisième pool doit rester surveillée malgré l'erreur :
    // le prix (1.6) dépasse le take-profit (1.5), elle doit donc être clôturée dans ce cycle.
    positionRepo.openPosition({
      poolAddress: 'POOL3',
      baseTokenSymbol: 'BAZ',
      entryPriceUsd: 1,
      sizeUsd: 10,
      stopLossPrice: 0.8,
      takeProfitPrice: 1.5,
      trailingStopPct: 15,
      openedAt: new Date(),
    });
    client.fetchPoolPrice = vi.fn().mockResolvedValue(1.6);

    const summary = await runCycle({ client, positionRepo, decisionLog, executor, notifier, config });

    // Le second pool est traité malgré l'échec du premier.
    expect(summary.positionsOpened).toBe(1);
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ poolAddress: 'POOL2', side: 'BUY' })
    );
    // La revue des positions ouvertes a bien eu lieu : POOL3 (take-profit 1.5) est clôturée,
    // tout comme POOL2 ouverte dans ce même cycle (take-profit 0.99), le prix relevé étant 1.6.
    expect(client.fetchPoolPrice).toHaveBeenCalled();
    expect(summary.positionsClosed).toBe(2);
    expect(positionRepo.getOpenPositions()).toHaveLength(0);
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ poolAddress: 'POOL3', side: 'SELL' })
    );
    // L'erreur est tracée dans le journal des décisions et comptée dans le résumé.
    const errorEntry = decisionLog.getRecent(20).find((entry) => entry.stage === 'ERROR');
    expect(errorEntry?.poolAddress).toBe('POOL1');
    expect(errorEntry?.reason).toMatch(/API GeckoTerminal indisponible/);
    expect(summary.errors).toBe(1);
    // Une notification de clôture est envoyée pour chaque position fermée, avec la raison et le PnL.
    expect(notifyMock).toHaveBeenCalledWith(expect.stringMatching(/Position fermée.*BAZ.*TAKE_PROFIT/s));
    expect(notifyMock).toHaveBeenCalledWith(expect.stringMatching(/Position fermée.*BAR.*TAKE_PROFIT/s));
  });

  it('still reviews open positions when the scan itself throws', async () => {
    client.fetchTrendingPools = vi.fn().mockRejectedValue(new Error('scan cassé'));
    positionRepo.openPosition({
      poolAddress: 'POOL3',
      baseTokenSymbol: 'BAZ',
      entryPriceUsd: 1,
      sizeUsd: 10,
      stopLossPrice: 0.8,
      takeProfitPrice: 1.5,
      trailingStopPct: 15,
      openedAt: new Date(),
    });
    client.fetchPoolPrice = vi.fn().mockResolvedValue(1.6);

    const summary = await runCycle({ client, positionRepo, decisionLog, executor, notifier, config });

    expect(summary.poolsScanned).toBe(0);
    expect(summary.positionsClosed).toBe(1);
    expect(decisionLog.getRecent(20).some((entry) => entry.stage === 'ERROR')).toBe(true);
  });

  it('waits geckoTerminal.perPoolDelayMs between successive pool API calls within a cycle', async () => {
    vi.useFakeTimers();
    try {
      const pool2: Pool = { ...pool, poolAddress: 'POOL2', baseTokenSymbol: 'BAR' };
      client.fetchTrendingPools = vi.fn().mockResolvedValue([pool, pool2]);
      const spacedConfig = {
        ...config,
        geckoTerminal: { ...config.geckoTerminal, perPoolDelayMs: 300 },
      } as BotConfig;

      const promise = runCycle({
        client,
        positionRepo,
        decisionLog,
        executor,
        notifier,
        config: spacedConfig,
      });

      // Le premier pool de la boucle n'attend pas — inutile de retarder le tout premier appel.
      await vi.advanceTimersByTimeAsync(0);
      expect(client.fetchOhlcv).toHaveBeenCalledTimes(1);

      // Avant l'écoulement du délai, le second pool n'est pas encore traité.
      await vi.advanceTimersByTimeAsync(200);
      expect(client.fetchOhlcv).toHaveBeenCalledTimes(1);

      // Une fois le délai écoulé, le second pool est traité à son tour.
      await vi.advanceTimersByTimeAsync(150);
      expect(client.fetchOhlcv).toHaveBeenCalledTimes(2);

      await vi.runAllTimersAsync();
      await promise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not delay when geckoTerminal.perPoolDelayMs is absent (existing configs keep working)', async () => {
    const pool2: Pool = { ...pool, poolAddress: 'POOL2', baseTokenSymbol: 'BAR' };
    client.fetchTrendingPools = vi.fn().mockResolvedValue([pool, pool2]);

    const summary = await runCycle({ client, positionRepo, decisionLog, executor, notifier, config });

    expect(summary.poolsPassedFilter).toBe(2);
    expect(client.fetchOhlcv).toHaveBeenCalledTimes(2);
  });
});

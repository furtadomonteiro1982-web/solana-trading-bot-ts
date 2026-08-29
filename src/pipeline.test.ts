import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDb } from './store/db.js';
import { PositionRepository } from './store/positionRepository.js';
import { DecisionLogRepository } from './store/decisionLogRepository.js';
import { FirstSeenRepository } from './store/firstSeenRepository.js';
import { runCycle } from './pipeline.js';
import type { MarketDataClient } from './marketdata/client.js';
import type { PriceClient } from './jupiter/priceClient.js';
import type { BotConfig } from './config.js';
import type { Candle, Executor, Fill, Order, Pool } from './types.js';
import type { Notifier } from './notifier/notifier.js';

const config = {
  network: 'solana',
  timeframe: 'hour',
  ohlcvLimit: 100,
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
let firstSeenRepo: FirstSeenRepository;
let nearStopLossWarned: Set<number>;
let executor: Executor;
let executeMock: ReturnType<typeof vi.fn<(order: Order) => Promise<Fill>>>;
let client: MarketDataClient;
let priceClient: PriceClient;
let notifier: Notifier;
let notifyMock: ReturnType<typeof vi.fn<(message: string) => Promise<void>>>;

/** Simule un pool déjà connu du bot depuis longtemps, pour passer le filtre minPoolAgeMinutes
 *  (le client Birdeye ne fournit plus poolCreatedAt : le pipeline le déduit de FirstSeenRepository). */
function seedOldFirstSeen(address: string): void {
  firstSeenRepo.getOrRecordFirstSeen(address, new Date(Date.now() - 24 * 60 * 60 * 1000));
}

beforeEach(() => {
  db = createDb(':memory:');
  positionRepo = new PositionRepository(db);
  decisionLog = new DecisionLogRepository(db);
  firstSeenRepo = new FirstSeenRepository(db);
  nearStopLossWarned = new Set<number>();
  seedOldFirstSeen('POOL1');
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
    fetchPool: vi.fn().mockResolvedValue(pool),
  };
  // Price stays between stop-loss (0.45) and take-profit (0.99): position stays open.
  priceClient = { fetchPrices: vi.fn().mockResolvedValue(new Map([['POOL1', 0.5]])) };
});

describe('runCycle', () => {
  it('scans, filters, signals, opens a position, and leaves it open', async () => {
    const summary = await runCycle({ client, priceClient, positionRepo, decisionLog, firstSeenRepo, nearStopLossWarned, executor, notifier, config });

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

    const summary = await runCycle({ client, priceClient, positionRepo, decisionLog, firstSeenRepo, nearStopLossWarned, executor, notifier, config });

    expect(summary.poolsPassedFilter).toBe(0);
    expect(summary.buySignals).toBe(0);
    expect(client.fetchOhlcv).not.toHaveBeenCalled();
  });

  it('rejects a pool never seen before as too young, then accepts it once enough real time has passed', async () => {
    // Simule le cas Birdeye (secours) : pas de vraie date de création, le client renvoie "vu à
    // l'instant". Le pipeline doit alors s'appuyer sur FirstSeenRepository plutôt que de faire
    // passer le filtre automatiquement à un token jamais vu avant.
    const brandNewPool: Pool = { ...pool, poolAddress: 'POOL_NEW', poolCreatedAt: new Date() };
    client.fetchTrendingPools = vi.fn().mockResolvedValue([brandNewPool]);

    const summary = await runCycle({ client, priceClient, positionRepo, decisionLog, firstSeenRepo, nearStopLossWarned, executor, notifier, config });

    expect(summary.poolsPassedFilter).toBe(0);
    expect(
      decisionLog.getRecent(20).some((entry) => /min < minimum 60 min/.test(entry.reason))
    ).toBe(true);
  });

  it('honors a real creation date from the client immediately, without waiting on FirstSeenRepository', async () => {
    // Simule le cas GeckoTerminal (source principale) : une vraie date de création est déjà
    // fournie. Un pool jamais vu par ce bot avant, mais réellement vieux, doit passer le filtre
    // dès la première détection — pas seulement après une heure de suivi local.
    const genuinelyOldPool: Pool = {
      ...pool,
      poolAddress: 'POOL_REAL_AGE',
      poolCreatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    };
    client.fetchTrendingPools = vi.fn().mockResolvedValue([genuinelyOldPool]);

    const summary = await runCycle({ client, priceClient, positionRepo, decisionLog, firstSeenRepo, nearStopLossWarned, executor, notifier, config });

    expect(summary.poolsPassedFilter).toBe(1);
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

    await runCycle({ client, priceClient, positionRepo, decisionLog, firstSeenRepo, nearStopLossWarned, executor, notifier, config });

    const [position] = positionRepo.getOpenPositions();
    expect(position.entryPriceUsd).toBe(0.95);
    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({ priceUsd: 0.9 }));
  });

  it('does not open a second position on a pool that already has one open', async () => {
    // Premier cycle : la position est ouverte.
    await runCycle({ client, priceClient, positionRepo, decisionLog, firstSeenRepo, nearStopLossWarned, executor, notifier, config });
    expect(positionRepo.getOpenPositions()).toHaveLength(1);
    const buyCallsAfterFirstCycle = executeMock.mock.calls.filter((c) => c[0].side === 'BUY').length;
    expect(buyCallsAfterFirstCycle).toBe(1);

    // Deuxième cycle : le même signal BUY se reproduit sur le même pool.
    const summary = await runCycle({ client, priceClient, positionRepo, decisionLog, firstSeenRepo, nearStopLossWarned, executor, notifier, config });

    expect(summary.buySignals).toBe(1);
    expect(summary.positionsOpened).toBe(0);
    expect(positionRepo.getOpenPositions()).toHaveLength(1);
    expect(executeMock.mock.calls.filter((c) => c[0].side === 'BUY')).toHaveLength(1);
    expect(
      decisionLog.getRecent(20).some((entry) => /Position déjà ouverte/.test(entry.reason))
    ).toBe(true);
  });

  it('warns once when an open position nears its stop-loss without closing it', async () => {
    client.fetchTrendingPools = vi.fn().mockResolvedValue([]);
    positionRepo.openPosition({
      poolAddress: 'POOL3',
      baseTokenSymbol: 'BAZ',
      entryPriceUsd: 1,
      sizeUsd: 10,
      stopLossPrice: 0.5,
      takeProfitPrice: 100,
      trailingStopPct: 90,
      openedAt: new Date(),
    });
    // Zone de danger : entre le stop-loss (0.5) et 80% du chemin depuis l'entrée (0.6). 0.55 y est.
    priceClient.fetchPrices = vi.fn().mockResolvedValue(new Map([['POOL3', 0.55]]));

    const summary = await runCycle({ client, priceClient, positionRepo, decisionLog, firstSeenRepo, nearStopLossWarned, executor, notifier, config });

    expect(summary.positionsClosed).toBe(0);
    expect(positionRepo.getOpenPositions()).toHaveLength(1);
    expect(notifyMock).toHaveBeenCalledWith(expect.stringMatching(/proche du stop-loss.*BAZ/s));
  });

  it('does not repeat the near-stop-loss warning on a later cycle while still in the danger zone', async () => {
    client.fetchTrendingPools = vi.fn().mockResolvedValue([]);
    positionRepo.openPosition({
      poolAddress: 'POOL3',
      baseTokenSymbol: 'BAZ',
      entryPriceUsd: 1,
      sizeUsd: 10,
      stopLossPrice: 0.5,
      takeProfitPrice: 100,
      trailingStopPct: 90,
      openedAt: new Date(),
    });
    priceClient.fetchPrices = vi.fn().mockResolvedValue(new Map([['POOL3', 0.55]]));

    await runCycle({ client, priceClient, positionRepo, decisionLog, firstSeenRepo, nearStopLossWarned, executor, notifier, config });
    notifyMock.mockClear();
    await runCycle({ client, priceClient, positionRepo, decisionLog, firstSeenRepo, nearStopLossWarned, executor, notifier, config });

    expect(notifyMock).not.toHaveBeenCalledWith(expect.stringMatching(/proche du stop-loss/));
  });

  it('does not warn when an open position is not near its stop-loss', async () => {
    client.fetchTrendingPools = vi.fn().mockResolvedValue([]);
    positionRepo.openPosition({
      poolAddress: 'POOL3',
      baseTokenSymbol: 'BAZ',
      entryPriceUsd: 1,
      sizeUsd: 10,
      stopLossPrice: 0.5,
      takeProfitPrice: 100,
      trailingStopPct: 90,
      openedAt: new Date(),
    });
    // Confortablement au-dessus de la zone de danger (< 0.6).
    priceClient.fetchPrices = vi.fn().mockResolvedValue(new Map([['POOL3', 0.9]]));

    await runCycle({ client, priceClient, positionRepo, decisionLog, firstSeenRepo, nearStopLossWarned, executor, notifier, config });

    expect(notifyMock).not.toHaveBeenCalledWith(expect.stringMatching(/proche du stop-loss/));
  });

  it('keeps processing other pools and still reviews open positions when one pool throws', async () => {
    const pool2: Pool = { ...pool, poolAddress: 'POOL2', baseTokenSymbol: 'BAR' };
    seedOldFirstSeen('POOL2');
    client.fetchTrendingPools = vi.fn().mockResolvedValue([pool, pool2]);
    client.fetchOhlcv = vi.fn().mockImplementation(async (_network, poolAddress) => {
      if (poolAddress === 'POOL1') throw new Error('API Birdeye indisponible');
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
    priceClient.fetchPrices = vi.fn().mockResolvedValue(
      new Map([
        ['POOL2', 1.6],
        ['POOL3', 1.6],
      ])
    );

    const summary = await runCycle({ client, priceClient, positionRepo, decisionLog, firstSeenRepo, nearStopLossWarned, executor, notifier, config });

    // Le second pool est traité malgré l'échec du premier.
    expect(summary.positionsOpened).toBe(1);
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ poolAddress: 'POOL2', side: 'BUY' })
    );
    // La revue des positions ouvertes a bien eu lieu : POOL3 (take-profit 1.5) est clôturée,
    // tout comme POOL2 ouverte dans ce même cycle (take-profit 0.99), le prix relevé étant 1.6.
    expect(priceClient.fetchPrices).toHaveBeenCalled();
    expect(summary.positionsClosed).toBe(2);
    expect(positionRepo.getOpenPositions()).toHaveLength(0);
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ poolAddress: 'POOL3', side: 'SELL' })
    );
    // L'erreur est tracée dans le journal des décisions et comptée dans le résumé.
    const errorEntry = decisionLog.getRecent(20).find((entry) => entry.stage === 'ERROR');
    expect(errorEntry?.poolAddress).toBe('POOL1');
    expect(errorEntry?.reason).toMatch(/API Birdeye indisponible/);
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
    priceClient.fetchPrices = vi.fn().mockResolvedValue(new Map([['POOL3', 1.6]]));

    const summary = await runCycle({ client, priceClient, positionRepo, decisionLog, firstSeenRepo, nearStopLossWarned, executor, notifier, config });

    expect(summary.poolsScanned).toBe(0);
    expect(summary.positionsClosed).toBe(1);
    expect(decisionLog.getRecent(20).some((entry) => entry.stage === 'ERROR')).toBe(true);
  });

  it('batches every open position address into a single fetchPrices call', async () => {
    positionRepo.openPosition({
      poolAddress: 'POOL3',
      baseTokenSymbol: 'BAZ',
      entryPriceUsd: 1,
      sizeUsd: 10,
      stopLossPrice: 0.8,
      takeProfitPrice: 100,
      trailingStopPct: 15,
      openedAt: new Date(),
    });
    positionRepo.openPosition({
      poolAddress: 'POOL4',
      baseTokenSymbol: 'QUX',
      entryPriceUsd: 1,
      sizeUsd: 10,
      stopLossPrice: 0.8,
      takeProfitPrice: 100,
      trailingStopPct: 15,
      openedAt: new Date(),
    });
    client.fetchTrendingPools = vi.fn().mockResolvedValue([]);

    await runCycle({ client, priceClient, positionRepo, decisionLog, firstSeenRepo, nearStopLossWarned, executor, notifier, config });

    expect(priceClient.fetchPrices).toHaveBeenCalledTimes(1);
    expect(priceClient.fetchPrices).toHaveBeenCalledWith(expect.arrayContaining(['POOL3', 'POOL4']));
  });

  it('caps the number of pools evaluated per cycle at maxPoolsPerCycle, without calling the API for the rest', async () => {
    const pool2: Pool = { ...pool, poolAddress: 'POOL2', baseTokenSymbol: 'BAR' };
    const pool3: Pool = { ...pool, poolAddress: 'POOL3', baseTokenSymbol: 'BAZ' };
    seedOldFirstSeen('POOL2');
    seedOldFirstSeen('POOL3');
    client.fetchTrendingPools = vi.fn().mockResolvedValue([pool, pool2, pool3]);
    const cappedConfig = { ...config, maxPoolsPerCycle: 2 } as BotConfig;

    const summary = await runCycle({
      client,
      priceClient,
      positionRepo,
      decisionLog,
      firstSeenRepo,
      nearStopLossWarned,
      executor,
      notifier,
      config: cappedConfig,
    });

    // Toujours 3 pools retenus par le filtre — seul le nombre traités (appel OHLCV) est limité.
    expect(summary.poolsPassedFilter).toBe(3);
    expect(client.fetchOhlcv).toHaveBeenCalledTimes(2);
    const throttled = decisionLog.getRecent(20).find((entry) => entry.stage === 'THROTTLE');
    expect(throttled?.poolAddress).toBe('POOL3');
    expect(throttled?.reason).toMatch(/2 pools/);
  });

  it('processes every filtered pool when maxPoolsPerCycle is absent (existing configs keep working)', async () => {
    const pool2: Pool = { ...pool, poolAddress: 'POOL2', baseTokenSymbol: 'BAR' };
    const pool3: Pool = { ...pool, poolAddress: 'POOL3', baseTokenSymbol: 'BAZ' };
    seedOldFirstSeen('POOL2');
    seedOldFirstSeen('POOL3');
    client.fetchTrendingPools = vi.fn().mockResolvedValue([pool, pool2, pool3]);

    const summary = await runCycle({ client, priceClient, positionRepo, decisionLog, firstSeenRepo, nearStopLossWarned, executor, notifier, config });

    expect(summary.poolsPassedFilter).toBe(3);
    expect(client.fetchOhlcv).toHaveBeenCalledTimes(3);
  });
});

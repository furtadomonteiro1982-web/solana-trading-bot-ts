import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDb } from '../store/db.js';
import { PositionRepository } from '../store/positionRepository.js';
import { DecisionLogRepository } from '../store/decisionLogRepository.js';
import { handleNewToken, runSniperReviewCycle } from './sniperPipeline.js';
import type { SniperDeps } from './sniperPipeline.js';
import type { NewTokenEvent } from './snipeFilter.js';
import type { BotConfig } from '../config.js';
import type { Executor, Fill, Order } from '../types.js';
import type { PriceClient } from '../jupiter/priceClient.js';
import type { Notifier } from '../notifier/notifier.js';

const config = {
  sniper: {
    stakeUsd: 2,
    maxOpenSnipes: 2,
    stopLossPct: 40,
    takeProfitPct: 100,
    maxHoldMinutes: 15,
    filters: {
      requireSocialLink: true,
      bannedNamePatterns: ['scam'],
      maxCreatorInitialBuyPct: 20,
    },
  },
} as BotConfig;

function makeEvent(overrides: Partial<NewTokenEvent> = {}): NewTokenEvent {
  return {
    tokenAddress: 'MINT1',
    symbol: 'FOO',
    name: 'Foo Coin',
    creatorAddress: 'CREATOR1',
    hasSocialLink: true,
    creatorInitialBuyPct: 5,
    ...overrides,
  };
}

let db: Database.Database;
let positionRepo: PositionRepository;
let decisionLog: DecisionLogRepository;
let executor: Executor;
let executeMock: ReturnType<typeof vi.fn<(order: Order) => Promise<Fill>>>;
let notifier: Notifier;
let notifyMock: ReturnType<typeof vi.fn<(message: string) => Promise<void>>>;
let priceClient: PriceClient;
let deps: SniperDeps;

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
  priceClient = { fetchPrices: vi.fn().mockResolvedValue(new Map()) };
  deps = { positionRepo, decisionLog, executor, notifier, priceClient, config, pendingSnipes: new Set<string>() };
});

describe('handleNewToken', () => {
  it('opens a snipe position when the event passes the filter, at a fixed stake', async () => {
    await handleNewToken(makeEvent(), deps, 0.001);

    const [position] = positionRepo.getOpenPositions();
    expect(position).toBeDefined();
    expect(position.strategy).toBe('snipe');
    expect(position.sizeUsd).toBe(2);
    expect(position.baseTokenAddress).toBe('MINT1');
    expect(notifyMock).toHaveBeenCalledWith(expect.stringMatching(/Snipe ouvert.*FOO/s));
  });

  it('does not open a position when the event fails the filter, and logs the rejection', async () => {
    await handleNewToken(makeEvent({ name: 'Scam Coin' }), deps, 0.001);

    expect(positionRepo.getOpenPositions()).toHaveLength(0);
    expect(notifyMock).not.toHaveBeenCalled();
    const rejected = decisionLog.getRecent(5).find((entry) => entry.stage === 'SNIPE');
    expect(rejected?.decision).toBe('REJECTED');
  });

  it('does not open a position when maxOpenSnipes is already reached', async () => {
    await handleNewToken(makeEvent({ tokenAddress: 'MINT1', symbol: 'AAA' }), deps, 0.001);
    await handleNewToken(makeEvent({ tokenAddress: 'MINT2', symbol: 'BBB' }), deps, 0.001);

    await handleNewToken(makeEvent({ tokenAddress: 'MINT3', symbol: 'CCC' }), deps, 0.001);

    expect(positionRepo.getOpenPositions()).toHaveLength(2);
  });

  it('does not exceed maxOpenSnipes when two handleNewToken calls race past the cap check concurrently', async () => {
    const cappedConfig = {
      ...config,
      sniper: { ...config.sniper, maxOpenSnipes: 1 },
    } as BotConfig;
    const depsWithCap: SniperDeps = { ...deps, config: cappedConfig };

    let releaseGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    executeMock.mockImplementation(async (order: Order): Promise<Fill> => {
      await gate;
      return {
        poolAddress: order.poolAddress,
        side: order.side,
        sizeUsd: order.sizeUsd,
        filledPriceUsd: order.priceUsd,
        filledAt: new Date(),
      };
    });

    const first = handleNewToken(makeEvent({ tokenAddress: 'MINT1', symbol: 'AAA' }), depsWithCap, 0.001);
    const second = handleNewToken(makeEvent({ tokenAddress: 'MINT2', symbol: 'BBB' }), depsWithCap, 0.001);
    releaseGate?.();
    await Promise.all([first, second]);

    expect(positionRepo.getOpenPositions()).toHaveLength(1);
  });
});

describe('runSniperReviewCycle', () => {
  it('closes a snipe position on take-profit using the batched Jupiter price', async () => {
    await handleNewToken(makeEvent(), deps, 0.001); // TP at 0.002 (100%)
    priceClient.fetchPrices = vi.fn().mockResolvedValue(new Map([['MINT1', 0.0025]]));

    await runSniperReviewCycle(deps);

    expect(positionRepo.getOpenPositions()).toHaveLength(0);
    expect(notifyMock).toHaveBeenCalledWith(expect.stringMatching(/Snipe fermé.*FOO.*TAKE_PROFIT/s));
  });

  it('force-closes a snipe position past maxHoldMinutes even when price is flat', async () => {
    const openedAt = new Date(Date.now() - 16 * 60 * 1000);
    positionRepo.openPosition({
      poolAddress: 'MINT1',
      baseTokenAddress: 'MINT1',
      baseTokenSymbol: 'FOO',
      entryPriceUsd: 0.001,
      sizeUsd: 2,
      stopLossPrice: 0.0006,
      takeProfitPrice: 0.002,
      trailingStopPct: 100,
      openedAt,
      strategy: 'snipe',
    });
    priceClient.fetchPrices = vi.fn().mockResolvedValue(new Map([['MINT1', 0.001]])); // unchanged price

    await runSniperReviewCycle(deps);

    expect(positionRepo.getOpenPositions()).toHaveLength(0);
    expect(notifyMock).toHaveBeenCalledWith(expect.stringMatching(/Snipe fermé.*FOO.*TIMEOUT/s));
  });
});

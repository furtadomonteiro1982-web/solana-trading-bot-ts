import { describe, expect, it } from 'vitest';
import { PaperExecutor } from './paperExecutor.js';
import type { Order } from '../types.js';

const buyOrder: Order = {
  poolAddress: 'POOL1',
  baseTokenSymbol: 'FOO',
  side: 'BUY',
  sizeUsd: 10,
  priceUsd: 1,
};

const sellOrder: Order = { ...buyOrder, side: 'SELL' };

describe('PaperExecutor', () => {
  it('fills immediately at the exact order price when slippage/fees are all zero', async () => {
    const executor = new PaperExecutor({ slippageInPct: 0, slippageOutPct: 0, feeUsdPerTx: 0 });

    const before = Date.now();
    const fill = await executor.execute(buyOrder);
    const after = Date.now();

    expect(fill.poolAddress).toBe('POOL1');
    expect(fill.side).toBe('BUY');
    expect(fill.sizeUsd).toBe(10);
    expect(fill.filledPriceUsd).toBe(1);
    expect(fill.filledAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(fill.filledAt.getTime()).toBeLessThanOrEqual(after);
  });

  it('fills a BUY above the requested price (slippage-in + fee), by default', async () => {
    const executor = new PaperExecutor(); // default: slippageIn 3%, fee $0.2/trade
    const fill = await executor.execute(buyOrder); // fee as % of a $10 trade = 2% -> total 5%

    expect(fill.filledPriceUsd).toBeCloseTo(1.05, 5);
  });

  it('fills a SELL below the requested price (slippage-out + fee), by default', async () => {
    const executor = new PaperExecutor(); // default: slippageOut 5%, fee $0.2/trade
    const fill = await executor.execute(sellOrder); // fee as % of a $10 trade = 2% -> total 7%

    expect(fill.filledPriceUsd).toBeCloseTo(0.93, 5);
  });

  it('makes the fee a bigger relative hit on a smaller trade', async () => {
    const executor = new PaperExecutor({ slippageInPct: 0, slippageOutPct: 0, feeUsdPerTx: 0.2 });
    const smallOrder: Order = { ...buyOrder, sizeUsd: 2 }; // fee = 0.2/2 = 10%

    const fill = await executor.execute(smallOrder);

    expect(fill.filledPriceUsd).toBeCloseTo(1.1, 5);
  });
});

import { describe, expect, it } from 'vitest';
import { PaperExecutor } from './paperExecutor.js';
import type { Order } from '../types.js';

describe('PaperExecutor', () => {
  it('simulates an immediate fill at the order price', async () => {
    const executor = new PaperExecutor();
    const order: Order = {
      poolAddress: 'POOL1',
      baseTokenSymbol: 'FOO',
      side: 'BUY',
      sizeUsd: 10,
      priceUsd: 1.23,
    };

    const before = Date.now();
    const fill = await executor.execute(order);
    const after = Date.now();

    expect(fill.poolAddress).toBe('POOL1');
    expect(fill.side).toBe('BUY');
    expect(fill.sizeUsd).toBe(10);
    expect(fill.filledPriceUsd).toBe(1.23);
    expect(fill.filledAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(fill.filledAt.getTime()).toBeLessThanOrEqual(after);
  });
});

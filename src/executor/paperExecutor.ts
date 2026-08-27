import type { Executor, Fill, Order } from '../types.js';

export class PaperExecutor implements Executor {
  async execute(order: Order): Promise<Fill> {
    return {
      poolAddress: order.poolAddress,
      side: order.side,
      sizeUsd: order.sizeUsd,
      filledPriceUsd: order.priceUsd,
      filledAt: new Date(),
    };
  }
}

import type { Executor, Fill, Order } from '../types.js';

export interface PaperExecutorConfig {
  /** Coût simulé à l'achat (rempli plus cher que le prix demandé), en %. */
  slippageInPct: number;
  /** Coût simulé à la vente (rempli moins cher que le prix demandé), en %. */
  slippageOutPct: number;
  /** Frais fixes par transaction, convertis en % du montant de la position — pénalise
   * proportionnellement plus les petites mises, comme en réalité. */
  feeUsdPerTx: number;
}

const DEFAULT_CONFIG: PaperExecutorConfig = {
  slippageInPct: 3,
  slippageOutPct: 5,
  feeUsdPerTx: 0.2,
};

export class PaperExecutor implements Executor {
  constructor(private config: PaperExecutorConfig = DEFAULT_CONFIG) {}

  async execute(order: Order): Promise<Fill> {
    const feeAsPct = order.sizeUsd > 0 ? (this.config.feeUsdPerTx / order.sizeUsd) * 100 : 0;
    const slippagePct = order.side === 'BUY' ? this.config.slippageInPct : this.config.slippageOutPct;
    const totalCostPct = slippagePct + feeAsPct;
    const direction = order.side === 'BUY' ? 1 : -1;
    const filledPriceUsd = order.priceUsd * (1 + (direction * totalCostPct) / 100);

    return {
      poolAddress: order.poolAddress,
      side: order.side,
      sizeUsd: order.sizeUsd,
      filledPriceUsd,
      filledAt: new Date(),
    };
  }
}

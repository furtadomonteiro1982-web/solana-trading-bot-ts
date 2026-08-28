import type { Executor, Position } from './types.js';
import type { PositionRepository } from './store/positionRepository.js';

export type PriceLookup = (poolAddress: string) => Promise<number | null>;

export async function reviewOpenPositions(
  positionRepo: PositionRepository,
  priceLookup: PriceLookup,
  executor: Executor,
  now: Date = new Date()
): Promise<Position[]> {
  const openPositions = positionRepo.getOpenPositions();
  const closedPositions: Position[] = [];

  for (const position of openPositions) {
    const currentPrice = await priceLookup(position.poolAddress);
    if (currentPrice === null) continue;

    if (currentPrice > position.highestPriceUsd) {
      positionRepo.updateHighestPrice(position.id, currentPrice);
    }
    const highestPrice = Math.max(currentPrice, position.highestPriceUsd);

    let closeReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | null = null;
    if (currentPrice >= position.takeProfitPrice) {
      closeReason = 'TAKE_PROFIT';
    } else if (currentPrice <= position.stopLossPrice) {
      closeReason = 'STOP_LOSS';
    } else if (
      highestPrice > position.entryPriceUsd &&
      currentPrice <= highestPrice * (1 - position.trailingStopPct / 100)
    ) {
      closeReason = 'TRAILING_STOP';
    }

    if (closeReason) {
      // Le prix de clôture enregistré (et donc le PnL) vient du Fill réellement exécuté, pas du
      // prix demandé : identiques avec le PaperExecutor, divergents avec un exécuteur réel.
      const fill = await executor.execute({
        poolAddress: position.poolAddress,
        baseTokenSymbol: position.baseTokenSymbol,
        side: 'SELL',
        sizeUsd: position.sizeUsd,
        priceUsd: currentPrice,
      });
      const closed = positionRepo.closePosition(position.id, fill.filledPriceUsd, closeReason, now);
      closedPositions.push(closed);
    }
  }

  return closedPositions;
}

import type { Executor, Position } from '../types.js';
import type { PositionRepository } from '../store/positionRepository.js';
import type { PriceLookup } from '../positionManager.js';

export async function closeTimedOutPositions(
  positionRepo: PositionRepository,
  maxHoldMs: number,
  priceLookup: PriceLookup,
  executor: Executor,
  now: Date = new Date()
): Promise<Position[]> {
  const openSnipes = positionRepo.getOpenPositions().filter((position) => position.strategy === 'snipe');
  const closed: Position[] = [];

  for (const position of openSnipes) {
    const heldMs = now.getTime() - position.openedAt.getTime();
    if (heldMs < maxHoldMs) continue;

    const currentPrice = await priceLookup(position.baseTokenAddress);
    if (currentPrice === null) continue;

    const fill = await executor.execute({
      poolAddress: position.poolAddress,
      baseTokenSymbol: position.baseTokenSymbol,
      side: 'SELL',
      sizeUsd: position.sizeUsd,
      priceUsd: currentPrice,
    });
    closed.push(positionRepo.closePosition(position.id, fill.filledPriceUsd, 'TIMEOUT', now));
  }

  return closed;
}

import type { Executor, Position } from '../types.js';
import type { PositionRepository } from '../store/positionRepository.js';
import type { PriceLookup } from '../positionManager.js';

export async function closeTimedOutPositions(
  positionRepo: PositionRepository,
  maxHoldMs: number,
  priceLookup: PriceLookup,
  executor: Executor,
  now: Date = new Date(),
  // Un token qui a déjà pumpé (même s'il a depuis reflué) a une vraie chance de repartir — le
  // timeout normal servait surtout à couper les tokens morts qui dérivent lentement sans jamais
  // bouger. On lui laisse plus de temps au lieu de le sortir bêtement au même délai qu'un token
  // resté plat. Toujours borné (pumpedHoldExtensionMultiplier), jamais illimité.
  noPumpThresholdPct: number = 20,
  pumpedHoldExtensionMultiplier: number = 3
): Promise<Position[]> {
  const openSnipes = positionRepo.getOpenPositions().filter((position) => position.strategy === 'snipe');
  const closed: Position[] = [];

  for (const position of openSnipes) {
    const heldMs = now.getTime() - position.openedAt.getTime();
    const everPumped = position.highestPriceUsd > position.entryPriceUsd * (1 + noPumpThresholdPct / 100);
    const effectiveMaxHoldMs = everPumped ? maxHoldMs * pumpedHoldExtensionMultiplier : maxHoldMs;
    if (heldMs < effectiveMaxHoldMs) continue;

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

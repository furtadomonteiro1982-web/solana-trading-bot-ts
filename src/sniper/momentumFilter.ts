export function hasOrganicMomentum(
  priceAtFirstCheck: number,
  priceAtSecondCheck: number,
  minIncreasePct: number
): boolean {
  return priceAtSecondCheck >= priceAtFirstCheck * (1 + minIncreasePct / 100);
}

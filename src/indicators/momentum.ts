export function calculateMomentumPct(closes: number[], lookback: number): number | null {
  if (closes.length < lookback + 1) return null;
  const latest = closes[closes.length - 1];
  const past = closes[closes.length - 1 - lookback];
  if (past === 0) return null;
  return ((latest - past) / past) * 100;
}

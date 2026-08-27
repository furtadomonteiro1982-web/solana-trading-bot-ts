export function calculateSMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const recent = closes.slice(closes.length - period);
  const sum = recent.reduce((acc, v) => acc + v, 0);
  return sum / period;
}

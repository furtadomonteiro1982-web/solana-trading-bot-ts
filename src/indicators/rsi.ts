export function calculateRSI(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;
  const recent = closes.slice(closes.length - (period + 1));
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i] - recent[i - 1];
    if (diff > 0) gainSum += diff;
    else lossSum += Math.abs(diff);
  }
  const avgGain = gainSum / period;
  const avgLoss = lossSum / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

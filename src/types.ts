export interface Pool {
  poolAddress: string;
  baseTokenSymbol: string;
  baseTokenAddress: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  priceChange24hPct: number;
  poolCreatedAt: Date;
}

export interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FilterResult {
  pool: Pool;
  passed: boolean;
  reason: string;
}

export type SignalDecision = 'BUY' | 'HOLD' | 'SKIP';

export interface Signal {
  pool: Pool;
  decision: SignalDecision;
  reason: string;
  indicators: {
    rsi: number | null;
    sma: number | null;
    momentumPct: number | null;
  };
}

export interface RiskDecision {
  approved: boolean;
  reason: string;
  positionSizeUsd?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingStopPct?: number;
}

export interface Order {
  poolAddress: string;
  baseTokenSymbol: string;
  side: 'BUY' | 'SELL';
  sizeUsd: number;
  priceUsd: number;
}

export interface Fill {
  poolAddress: string;
  side: 'BUY' | 'SELL';
  sizeUsd: number;
  filledPriceUsd: number;
  filledAt: Date;
}

export interface Executor {
  execute(order: Order): Promise<Fill>;
}

export type CloseReason = 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP';

export interface Position {
  id: number;
  poolAddress: string;
  baseTokenSymbol: string;
  entryPriceUsd: number;
  sizeUsd: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  trailingStopPct: number;
  highestPriceUsd: number;
  openedAt: Date;
  status: 'OPEN' | 'CLOSED';
  closedAt?: Date;
  closePriceUsd?: number;
  closeReason?: CloseReason;
  pnlUsd?: number;
}

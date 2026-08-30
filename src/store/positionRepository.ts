import type Database from 'better-sqlite3';
import type { CloseReason, Position } from '../types.js';

export interface NewPositionData {
  poolAddress: string;
  baseTokenAddress: string;
  baseTokenSymbol: string;
  entryPriceUsd: number;
  sizeUsd: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  trailingStopPct: number;
  openedAt: Date;
}

export class PositionRepository {
  constructor(private db: Database.Database) {}

  openPosition(data: NewPositionData): Position {
    const stmt = this.db.prepare(`
      INSERT INTO positions
        (pool_address, base_token_address, base_token_symbol, entry_price_usd, size_usd,
         stop_loss_price, take_profit_price, trailing_stop_pct,
         highest_price_usd, opened_at, status)
      VALUES (@poolAddress, @baseTokenAddress, @baseTokenSymbol, @entryPriceUsd, @sizeUsd,
              @stopLossPrice, @takeProfitPrice, @trailingStopPct,
              @entryPriceUsd, @openedAt, 'OPEN')
    `);
    const result = stmt.run({
      poolAddress: data.poolAddress,
      baseTokenAddress: data.baseTokenAddress,
      baseTokenSymbol: data.baseTokenSymbol,
      entryPriceUsd: data.entryPriceUsd,
      sizeUsd: data.sizeUsd,
      stopLossPrice: data.stopLossPrice,
      takeProfitPrice: data.takeProfitPrice,
      trailingStopPct: data.trailingStopPct,
      openedAt: data.openedAt.toISOString(),
    });
    return this.getById(result.lastInsertRowid as number)!;
  }

  getById(id: number): Position | undefined {
    const row = this.db.prepare('SELECT * FROM positions WHERE id = ?').get(id);
    return row ? rowToPosition(row) : undefined;
  }

  getOpenPositions(): Position[] {
    const rows = this.db.prepare("SELECT * FROM positions WHERE status = 'OPEN'").all();
    return rows.map(rowToPosition);
  }

  updateHighestPrice(id: number, priceUsd: number): void {
    this.db.prepare('UPDATE positions SET highest_price_usd = ? WHERE id = ?').run(priceUsd, id);
  }

  closePosition(id: number, closePriceUsd: number, closeReason: CloseReason, closedAt: Date): Position {
    const position = this.getById(id);
    if (!position) throw new Error(`Position ${id} introuvable`);
    const pnlUsd = ((closePriceUsd - position.entryPriceUsd) / position.entryPriceUsd) * position.sizeUsd;
    this.db
      .prepare(
        `UPDATE positions
         SET status = 'CLOSED', closed_at = ?, close_price_usd = ?, close_reason = ?, pnl_usd = ?
         WHERE id = ?`
      )
      .run(closedAt.toISOString(), closePriceUsd, closeReason, pnlUsd, id);
    return this.getById(id)!;
  }
}

function rowToPosition(row: any): Position {
  return {
    id: row.id,
    poolAddress: row.pool_address,
    baseTokenAddress: row.base_token_address,
    baseTokenSymbol: row.base_token_symbol,
    entryPriceUsd: row.entry_price_usd,
    sizeUsd: row.size_usd,
    stopLossPrice: row.stop_loss_price,
    takeProfitPrice: row.take_profit_price,
    trailingStopPct: row.trailing_stop_pct,
    highestPriceUsd: row.highest_price_usd,
    openedAt: new Date(row.opened_at),
    status: row.status,
    closedAt: row.closed_at ? new Date(row.closed_at) : undefined,
    closePriceUsd: row.close_price_usd ?? undefined,
    closeReason: row.close_reason ?? undefined,
    pnlUsd: row.pnl_usd ?? undefined,
  };
}

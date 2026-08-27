import type Database from 'better-sqlite3';

export interface DecisionLogEntry {
  timestamp: Date;
  poolAddress: string;
  stage: 'FILTER' | 'SIGNAL' | 'RISK';
  decision: string;
  reason: string;
}

export class DecisionLogRepository {
  constructor(private db: Database.Database) {}

  log(entry: DecisionLogEntry): void {
    this.db
      .prepare(
        `INSERT INTO decision_logs (timestamp, pool_address, stage, decision, reason)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(entry.timestamp.toISOString(), entry.poolAddress, entry.stage, entry.decision, entry.reason);
  }

  getRecent(limit: number): DecisionLogEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM decision_logs ORDER BY id DESC LIMIT ?')
      .all(limit) as any[];
    return rows.map((row) => ({
      timestamp: new Date(row.timestamp),
      poolAddress: row.pool_address,
      stage: row.stage,
      decision: row.decision,
      reason: row.reason,
    }));
  }
}

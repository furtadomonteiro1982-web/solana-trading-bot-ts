import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function createDb(dbPath: string): Database.Database {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool_address TEXT NOT NULL,
      base_token_address TEXT NOT NULL DEFAULT '',
      base_token_symbol TEXT NOT NULL,
      entry_price_usd REAL NOT NULL,
      size_usd REAL NOT NULL,
      stop_loss_price REAL NOT NULL,
      take_profit_price REAL NOT NULL,
      trailing_stop_pct REAL NOT NULL,
      highest_price_usd REAL NOT NULL,
      opened_at TEXT NOT NULL,
      status TEXT NOT NULL,
      closed_at TEXT,
      close_price_usd REAL,
      close_reason TEXT,
      pnl_usd REAL
    );
    CREATE TABLE IF NOT EXISTS decision_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      pool_address TEXT NOT NULL,
      stage TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS first_seen (
      pool_address TEXT PRIMARY KEY,
      first_seen_at TEXT NOT NULL
    );
  `);
  // Migration : les bases créées avant l'ajout de base_token_address n'ont pas la colonne — Jupiter
  // Price API a besoin de l'adresse du token (mint), pas de l'adresse de la pool AMM, sinon la revue
  // des positions ouvertes échoue silencieusement à chaque cycle (voir positionManager.ts).
  const hasBaseTokenAddress = (db.prepare('PRAGMA table_info(positions)').all() as { name: string }[]).some(
    (column) => column.name === 'base_token_address'
  );
  if (!hasBaseTokenAddress) {
    db.exec(`ALTER TABLE positions ADD COLUMN base_token_address TEXT NOT NULL DEFAULT ''`);
  }
  return db;
}

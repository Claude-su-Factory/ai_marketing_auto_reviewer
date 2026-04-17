import Database from "better-sqlite3";

export type AppDb = Database.Database;

export function createDb(path = "server/data.db"): AppDb {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      customer_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      stripe_customer_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      license_id TEXT NOT NULL REFERENCES licenses(id),
      type TEXT NOT NULL,
      ai_cost_usd REAL NOT NULL DEFAULT 0,
      charged_usd REAL NOT NULL DEFAULT 0,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS billing_cycles (
      id TEXT PRIMARY KEY,
      license_id TEXT NOT NULL REFERENCES licenses(id),
      period_start DATETIME NOT NULL,
      period_end DATETIME NOT NULL,
      total_ai_cost_usd REAL DEFAULT 0,
      total_charged_usd REAL DEFAULT 0,
      stripe_invoice_id TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return db;
}

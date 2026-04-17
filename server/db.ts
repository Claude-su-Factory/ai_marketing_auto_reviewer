import Database from "better-sqlite3";

export type AppDb = Database.Database;

export function createDb(path = "server/data.db"): AppDb {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      customer_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      stripe_customer_id TEXT,
      balance_usd REAL NOT NULL DEFAULT 0,
      recharge_amount REAL NOT NULL DEFAULT 20,
      recharge_tier TEXT NOT NULL DEFAULT 'standard',
      stripe_payment_method_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      license_id TEXT NOT NULL REFERENCES licenses(id),
      type TEXT NOT NULL,
      ai_cost_usd REAL NOT NULL DEFAULT 0,
      charged_usd REAL NOT NULL DEFAULT 0,
      metadata TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
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

  const safeAlter = (sql: string) => { try { db.exec(sql); } catch {} };
  safeAlter("ALTER TABLE licenses ADD COLUMN balance_usd REAL NOT NULL DEFAULT 0");
  safeAlter("ALTER TABLE licenses ADD COLUMN recharge_amount REAL NOT NULL DEFAULT 20");
  safeAlter("ALTER TABLE licenses ADD COLUMN recharge_tier TEXT NOT NULL DEFAULT 'standard'");
  safeAlter("ALTER TABLE licenses ADD COLUMN stripe_payment_method_id TEXT");
  safeAlter("ALTER TABLE usage_events ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'");

  return db;
}

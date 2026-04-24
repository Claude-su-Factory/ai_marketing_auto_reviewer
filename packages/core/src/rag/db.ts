import Database from "better-sqlite3";

export type CreativesDb = Database.Database;

export function createCreativesDb(path = "data/creatives.db"): CreativesDb {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS winners (
      id TEXT PRIMARY KEY,
      creative_id TEXT NOT NULL,
      product_category TEXT,
      product_tags TEXT NOT NULL,
      product_description TEXT NOT NULL,
      headline TEXT NOT NULL,
      body TEXT NOT NULL,
      cta TEXT NOT NULL,
      variant_label TEXT NOT NULL,
      embedding_product BLOB NOT NULL,
      embedding_copy BLOB NOT NULL,
      qualified_at TEXT NOT NULL,
      impressions INTEGER NOT NULL,
      inline_link_click_ctr REAL NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_winners_category ON winners(product_category);
    CREATE INDEX IF NOT EXISTS idx_winners_creative ON winners(creative_id);
  `);

  const safeAlter = (sql: string) => { try { db.exec(sql); } catch {} };
  // Future schema migrations go here using safeAlter.
  void safeAlter;

  return db;
}

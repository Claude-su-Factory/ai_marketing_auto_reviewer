import { describe, it, expect, afterEach } from "vitest";
import { createCreativesDb } from "./db.js";
import { unlinkSync, existsSync } from "fs";

const TEST_DB = "/tmp/ad-ai-test-creatives.db";

describe("createCreativesDb", () => {
  afterEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    if (existsSync(`${TEST_DB}-wal`)) unlinkSync(`${TEST_DB}-wal`);
    if (existsSync(`${TEST_DB}-shm`)) unlinkSync(`${TEST_DB}-shm`);
  });

  it("creates winners table with required columns", () => {
    const db = createCreativesDb(TEST_DB);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='winners'")
      .get();
    expect(row).toBeTruthy();
    const cols = db.prepare("PRAGMA table_info(winners)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        "id", "creative_id", "product_category", "product_tags", "product_description",
        "headline", "body", "cta", "variant_label",
        "embedding_product", "embedding_copy",
        "qualified_at", "impressions", "inline_link_click_ctr",
      ].sort(),
    );
    db.close();
  });

  it("creates indexes on category and creative_id", () => {
    const db = createCreativesDb(TEST_DB);
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='winners'")
      .all() as Array<{ name: string }>;
    const idxNames = idx.map((r) => r.name);
    expect(idxNames).toContain("idx_winners_category");
    expect(idxNames).toContain("idx_winners_creative");
    db.close();
  });

  it("is idempotent (can be called twice on same file)", () => {
    const db1 = createCreativesDb(TEST_DB);
    db1.close();
    const db2 = createCreativesDb(TEST_DB);
    expect(
      db2.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='winners'").get(),
    ).toBeTruthy();
    db2.close();
  });
});

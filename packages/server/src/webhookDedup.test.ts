import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type AppDb } from "./db.js";
import { markEventProcessed } from "./webhookDedup.js";
import { unlinkSync, existsSync } from "fs";

const TEST_DB = "packages/server/src/test-dedup.db";
let db: AppDb;

beforeEach(() => { db = createDb(TEST_DB); });
afterEach(() => { db.close(); if (existsSync(TEST_DB)) unlinkSync(TEST_DB); });

describe("markEventProcessed", () => {
  it("returns true on first call with a new event_id", () => {
    expect(markEventProcessed(db, "evt_new_1")).toBe(true);
  });

  it("returns false on second call with the same event_id", () => {
    markEventProcessed(db, "evt_dup_1");
    expect(markEventProcessed(db, "evt_dup_1")).toBe(false);
  });

  it("persists the event_id so that subsequent calls still return false", () => {
    markEventProcessed(db, "evt_persist");
    markEventProcessed(db, "evt_persist");
    expect(markEventProcessed(db, "evt_persist")).toBe(false);
  });

  it("treats different event_ids independently", () => {
    expect(markEventProcessed(db, "evt_a")).toBe(true);
    expect(markEventProcessed(db, "evt_b")).toBe(true);
    expect(markEventProcessed(db, "evt_a")).toBe(false);
  });
});

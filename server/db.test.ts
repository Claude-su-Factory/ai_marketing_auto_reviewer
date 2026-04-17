import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type AppDb } from "./db.js";
import { unlinkSync, existsSync } from "fs";

const TEST_DB = "server/test.db";
let db: AppDb;
beforeEach(() => { db = createDb(TEST_DB); });
afterEach(() => { db.close(); if (existsSync(TEST_DB)) unlinkSync(TEST_DB); });

describe("createDb", () => {
  it("creates licenses table", () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain("licenses");
  });

  it("creates usage_events table", () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain("usage_events");
  });

  it("creates billing_cycles table", () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain("billing_cycles");
  });

  it("can insert and query a license", () => {
    db.prepare("INSERT INTO licenses (id, key, customer_email) VALUES (?, ?, ?)").run("id1", "AD-AI-TEST-1234", "test@example.com");
    const row = db.prepare("SELECT * FROM licenses WHERE key = ?").get("AD-AI-TEST-1234") as any;
    expect(row.customer_email).toBe("test@example.com");
    expect(row.status).toBe("active");
  });
});

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

  it("licenses table has balance_usd column", () => {
    db.prepare("INSERT INTO licenses (id, key, customer_email) VALUES (?, ?, ?)").run("id-bal", "AD-AI-BAL-TEST", "bal@test.com");
    const row = db.prepare("SELECT balance_usd, recharge_amount, recharge_tier FROM licenses WHERE id = ?").get("id-bal") as any;
    expect(row.balance_usd).toBe(0);
    expect(row.recharge_amount).toBe(20);
    expect(row.recharge_tier).toBe("standard");
  });

  it("usage_events table has status column", () => {
    db.prepare("INSERT INTO licenses (id, key, customer_email) VALUES (?, ?, ?)").run("id-st", "AD-AI-ST-TEST", "st@test.com");
    db.prepare("INSERT INTO usage_events (id, license_id, type, status) VALUES (?, ?, ?, ?)").run("ev1", "id-st", "copy_gen", "pending");
    const row = db.prepare("SELECT status FROM usage_events WHERE id = ?").get("ev1") as any;
    expect(row.status).toBe("pending");
  });

  it("creates stripe_events table with event_id primary key", () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain("stripe_events");

    const info = db.prepare("PRAGMA table_info(stripe_events)").all() as Array<{ name: string; pk: number }>;
    const pk = info.find((c) => c.pk === 1);
    expect(pk?.name).toBe("event_id");
  });

  it("stripe_events rejects duplicate event_id", () => {
    db.prepare("INSERT INTO stripe_events (event_id) VALUES (?)").run("evt_123");
    expect(() => db.prepare("INSERT INTO stripe_events (event_id) VALUES (?)").run("evt_123")).toThrow(/UNIQUE/);
  });
});

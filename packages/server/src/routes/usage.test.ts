import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type AppDb } from "../db.js";
import { PRICING } from "@ad-ai/core/billing/pricing.js";
import { randomUUID } from "crypto";
import { unlinkSync, existsSync } from "fs";

const TEST_DB = "packages/server/src/test-usage.db";
let db: AppDb;
let licenseId: string;

beforeEach(() => {
  db = createDb(TEST_DB);
  licenseId = randomUUID();
  db.prepare("INSERT INTO licenses (id, key, customer_email) VALUES (?, ?, ?)").run(licenseId, "AD-AI-TEST-1234", "test@test.com");
});

afterEach(() => {
  db.close();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
});

describe("usage recording", () => {
  it("records usage event with correct pricing", () => {
    const pricing = PRICING.copy_gen;
    db.prepare(
      "INSERT INTO usage_events (id, license_id, type, ai_cost_usd, charged_usd, metadata) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(randomUUID(), licenseId, "copy_gen", pricing.aiCost, pricing.charged, "{}");

    const row = db.prepare("SELECT * FROM usage_events WHERE license_id = ?").get(licenseId) as any;
    expect(row.type).toBe("copy_gen");
    expect(row.ai_cost_usd).toBe(0.003);
    expect(row.charged_usd).toBe(0.01);
  });

  it("calculates monthly summary correctly", () => {
    const types = ["copy_gen", "copy_gen", "image_gen"];
    for (const type of types) {
      const pricing = PRICING[type];
      db.prepare(
        "INSERT INTO usage_events (id, license_id, type, ai_cost_usd, charged_usd) VALUES (?, ?, ?, ?, ?)"
      ).run(randomUUID(), licenseId, type, pricing.aiCost, pricing.charged);
    }

    const events = db.prepare(
      "SELECT type, COUNT(*) as count, SUM(charged_usd) as total FROM usage_events WHERE license_id = ? GROUP BY type"
    ).all(licenseId) as Array<{ type: string; count: number; total: number }>;

    const copyEvents = events.find(e => e.type === "copy_gen");
    expect(copyEvents?.count).toBe(2);
    expect(copyEvents?.total).toBeCloseTo(0.02);

    const imageEvents = events.find(e => e.type === "image_gen");
    expect(imageEvents?.count).toBe(1);
    expect(imageEvents?.total).toBeCloseTo(0.05);
  });

  it("rejects unknown usage type (no pricing entry)", () => {
    const unknownType = "unknown_type";
    expect(PRICING[unknownType]).toBeUndefined();
  });
});

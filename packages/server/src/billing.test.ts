import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type AppDb } from "./db.js";
import { createBillingService } from "./billing.js";
import { randomUUID } from "crypto";
import { unlinkSync, existsSync } from "fs";

const TEST_DB = "packages/server/src/test-billing.db";
let db: AppDb;
let billing: ReturnType<typeof createBillingService>;
let licenseId: string;

beforeEach(() => {
  db = createDb(TEST_DB);
  billing = createBillingService(db);
  licenseId = randomUUID();
  db.prepare(
    "INSERT INTO licenses (id, key, customer_email, balance_usd, recharge_amount, recharge_tier) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(licenseId, "AD-AI-TEST-1234", "test@test.com", 10.0, 20, "standard");
});

afterEach(() => {
  db.close();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
});

describe("checkBalance", () => {
  it("returns true when sufficient", () => {
    expect(billing.checkBalance(licenseId, 5.0)).toBe(true);
  });
  it("returns false when insufficient", () => {
    expect(billing.checkBalance(licenseId, 15.0)).toBe(false);
  });
});

describe("deductAndRecord", () => {
  it("reduces balance and creates pending event", () => {
    const eventId = billing.deductAndRecord(licenseId, "copy_gen", 0.003, 0.01);
    const license = db.prepare("SELECT balance_usd FROM licenses WHERE id = ?").get(licenseId) as any;
    expect(license.balance_usd).toBeCloseTo(9.99);
    const event = db.prepare("SELECT * FROM usage_events WHERE id = ?").get(eventId) as any;
    expect(event.status).toBe("pending");
  });
});

describe("confirmUsage", () => {
  it("sets status to completed", () => {
    const eventId = billing.deductAndRecord(licenseId, "copy_gen", 0.003, 0.01);
    billing.confirmUsage(eventId);
    const event = db.prepare("SELECT status FROM usage_events WHERE id = ?").get(eventId) as any;
    expect(event.status).toBe("completed");
  });
});

describe("refund", () => {
  it("restores balance and marks refunded", () => {
    const eventId = billing.deductAndRecord(licenseId, "copy_gen", 0.003, 0.01);
    billing.refund(eventId, licenseId, 0.01);
    const license = db.prepare("SELECT balance_usd FROM licenses WHERE id = ?").get(licenseId) as any;
    expect(license.balance_usd).toBeCloseTo(10.0);
    const event = db.prepare("SELECT status FROM usage_events WHERE id = ?").get(eventId) as any;
    expect(event.status).toBe("refunded");
  });
});

describe("needsRecharge", () => {
  it("true when below $5", () => {
    db.prepare("UPDATE licenses SET balance_usd = 4.0 WHERE id = ?").run(licenseId);
    expect(billing.needsRecharge(licenseId)).toBe(true);
  });
  it("false when above $5", () => {
    expect(billing.needsRecharge(licenseId)).toBe(false);
  });
});

describe("addBalance", () => {
  it("increases balance", () => {
    billing.addBalance(licenseId, 20.0);
    const license = db.prepare("SELECT balance_usd FROM licenses WHERE id = ?").get(licenseId) as any;
    expect(license.balance_usd).toBeCloseTo(30.0);
  });
});

describe("cleanupOrphanedEvents", () => {
  it("refunds pending events", () => {
    const eventId = billing.deductAndRecord(licenseId, "copy_gen", 0.003, 0.01);
    // Simulate server restart — event is still pending
    const count = billing.cleanupOrphanedEvents();
    expect(count).toBe(1);
    const license = db.prepare("SELECT balance_usd FROM licenses WHERE id = ?").get(licenseId) as any;
    expect(license.balance_usd).toBeCloseTo(10.0);
    const event = db.prepare("SELECT status FROM usage_events WHERE id = ?").get(eventId) as any;
    expect(event.status).toBe("refunded");
  });
});

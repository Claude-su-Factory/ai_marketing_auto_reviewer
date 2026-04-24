import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type AppDb } from "../db.js";
import { createSessionStore, type SessionStore } from "../auth.js";
import { randomUUID } from "crypto";
import { unlinkSync, existsSync } from "fs";

const TEST_DB = "packages/server/src/test-license.db";
let db: AppDb;
let sessions: SessionStore;

beforeEach(() => {
  db = createDb(TEST_DB);
  sessions = createSessionStore();
});

afterEach(() => {
  db.close();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
});

describe("license validation logic", () => {
  it("active license returns session token", () => {
    const id = randomUUID();
    db.prepare("INSERT INTO licenses (id, key, customer_email) VALUES (?, ?, ?)").run(id, "AD-AI-TEST-1234", "test@test.com");

    const license = db.prepare("SELECT * FROM licenses WHERE key = ?").get("AD-AI-TEST-1234") as any;
    expect(license).not.toBeNull();
    expect(license.status).toBe("active");

    const { token } = sessions.create(license.id);
    expect(token).toBeTruthy();

    const validated = sessions.validate(token);
    expect(validated?.licenseId).toBe(id);
  });

  it("suspended license is rejected", () => {
    const id = randomUUID();
    db.prepare("INSERT INTO licenses (id, key, customer_email, status) VALUES (?, ?, ?, ?)").run(id, "AD-AI-SUSP-1234", "test@test.com", "suspended");

    const license = db.prepare("SELECT * FROM licenses WHERE key = ?").get("AD-AI-SUSP-1234") as any;
    expect(license.status).not.toBe("active");
  });

  it("non-existent key returns undefined", () => {
    const license = db.prepare("SELECT * FROM licenses WHERE key = ?").get("AD-AI-FAKE-0000");
    expect(license).toBeUndefined();
  });

  it("duplicate key insert fails", () => {
    db.prepare("INSERT INTO licenses (id, key, customer_email) VALUES (?, ?, ?)").run(randomUUID(), "AD-AI-DUP-1234", "a@test.com");
    expect(() => {
      db.prepare("INSERT INTO licenses (id, key, customer_email) VALUES (?, ?, ?)").run(randomUUID(), "AD-AI-DUP-1234", "b@test.com");
    }).toThrow();
  });
});

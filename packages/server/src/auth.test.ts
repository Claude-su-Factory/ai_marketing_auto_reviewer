import { describe, it, expect } from "vitest";
import { createSessionStore } from "./auth.js";

describe("SessionStore", () => {
  it("creates a session token for a license", () => {
    const store = createSessionStore();
    const { token, expiresAt } = store.create("license-1");
    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("validates a valid token", () => {
    const store = createSessionStore();
    const { token } = store.create("license-1");
    const result = store.validate(token);
    expect(result).not.toBeNull();
    expect(result!.licenseId).toBe("license-1");
  });

  it("returns null for invalid token", () => {
    const store = createSessionStore();
    expect(store.validate("invalid-token")).toBeNull();
  });

  it("returns null for expired token", () => {
    const store = createSessionStore(1);
    const { token } = store.create("license-1");
    // Wait for token to expire
    const startTime = Date.now();
    while (Date.now() - startTime < 5) {
      // Small busy wait to ensure expiration
    }
    expect(store.validate(token)).toBeNull();
  });
});

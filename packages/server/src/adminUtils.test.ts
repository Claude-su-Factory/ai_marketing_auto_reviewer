import { describe, it, expect } from "vitest";
import { generateKey, getFlag } from "./adminUtils.js";

describe("generateKey", () => {
  it("returns key in AD-AI-XXXX-YYYY format", () => {
    const key = generateKey();
    expect(key).toMatch(/^AD-AI-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("generates unique keys", () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateKey()));
    expect(keys.size).toBe(100);
  });
});

describe("getFlag", () => {
  it("extracts flag value", () => {
    expect(getFlag(["--email=test@example.com"], "email")).toBe("test@example.com");
  });

  it("returns undefined for missing flag", () => {
    expect(getFlag(["--other=value"], "email")).toBeUndefined();
  });

  it("returns undefined for empty args", () => {
    expect(getFlag([], "email")).toBeUndefined();
  });
});

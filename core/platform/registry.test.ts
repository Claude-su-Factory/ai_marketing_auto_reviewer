import { describe, it, expect } from "vitest";
import { parseActivePlatformNames, validatePlatformEnv } from "./registry.js";

describe("parseActivePlatformNames", () => {
  it("parses csv into trimmed lowercase array", () => {
    expect(parseActivePlatformNames("meta,tiktok")).toEqual(["meta", "tiktok"]);
    expect(parseActivePlatformNames(" META , TikTok ")).toEqual(["meta", "tiktok"]);
  });
  it("defaults to ['meta'] when undefined or empty", () => {
    expect(parseActivePlatformNames(undefined)).toEqual(["meta"]);
    expect(parseActivePlatformNames("")).toEqual(["meta"]);
  });
  it("de-duplicates entries", () => {
    expect(parseActivePlatformNames("meta,meta")).toEqual(["meta"]);
  });
});

describe("validatePlatformEnv", () => {
  it("returns ok=true when all required vars present", () => {
    const env = { META_ACCESS_TOKEN: "x", META_AD_ACCOUNT_ID: "y", META_PAGE_ID: "z" };
    const r = validatePlatformEnv("meta", env);
    expect(r.ok).toBe(true);
  });
  it("returns ok=false with missing list when some vars absent", () => {
    const env = { META_ACCESS_TOKEN: "x" };
    const r = validatePlatformEnv("meta", env);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toContain("META_AD_ACCOUNT_ID");
      expect(r.missing).toContain("META_PAGE_ID");
    }
  });
  it("rejects unknown platforms", () => {
    const r = validatePlatformEnv("tiktok", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing[0]).toMatch(/not yet supported/i);
  });
});

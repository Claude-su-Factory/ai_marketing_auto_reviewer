import { describe, it, expect } from "vitest";
import { validatePlatform } from "./registry.js";
import { setConfigForTesting } from "../config/index.js";
import { makeTestConfig } from "../config/testing.js";

describe("validatePlatform", () => {
  it("returns ok=true when all meta fields present", () => {
    const r = validatePlatform("meta", makeTestConfig());
    expect(r.ok).toBe(true);
  });

  it("returns ok=false with TOML path when meta section missing", () => {
    const r = validatePlatform("meta", makeTestConfig({}, ["platforms.meta"]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("platforms.meta");
  });

  it("rejects unknown platforms", () => {
    const r = validatePlatform("tiktok", makeTestConfig());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing[0]).toMatch(/not yet supported/i);
  });

  it("uses getConfig() when cfg arg omitted", () => {
    setConfigForTesting(makeTestConfig());
    const r = validatePlatform("meta");
    expect(r.ok).toBe(true);
  });
});

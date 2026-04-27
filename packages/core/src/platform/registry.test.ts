import { describe, it, expect } from "vitest";
import { validatePlatform, activePlatforms } from "./registry.js";
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

  it("accepts meta config without instagram_actor_id (optional field)", () => {
    const cfg = makeTestConfig({}, ["platforms.meta.instagram_actor_id"]);
    const r = validatePlatform("meta", cfg);
    expect(r.ok).toBe(true);
  });

  it("rejects unconfigured tiktok", () => {
    const r = validatePlatform("tiktok", makeTestConfig());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("platforms.tiktok");
  });

  it("rejects unconfigured google", () => {
    const r = validatePlatform("google", makeTestConfig());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("platforms.google");
  });

  it("rejects fully unknown platform names", () => {
    const r = validatePlatform("snapchat", makeTestConfig());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing[0]).toMatch(/not supported/i);
  });

  it("accepts tiktok when configured", () => {
    const cfg = makeTestConfig({
      platforms: {
        enabled: ["meta", "tiktok"],
        tiktok: { access_token: "x", advertiser_id: "1" },
      },
    });
    const r = validatePlatform("tiktok", cfg);
    expect(r.ok).toBe(true);
  });

  it("accepts google when configured", () => {
    const cfg = makeTestConfig({
      platforms: {
        enabled: ["meta", "google"],
        google: { developer_token: "x", customer_id: "123-456-7890" },
      },
    });
    const r = validatePlatform("google", cfg);
    expect(r.ok).toBe(true);
  });

  it("uses getConfig() when cfg arg omitted", () => {
    setConfigForTesting(makeTestConfig());
    const r = validatePlatform("meta");
    expect(r.ok).toBe(true);
  });
});

describe("activePlatforms", () => {
  it("returns only meta when only meta enabled", async () => {
    setConfigForTesting(makeTestConfig());
    const platforms = await activePlatforms();
    expect(platforms.map((p) => p.name)).toEqual(["meta"]);
  });

  it("skips scaffold-only platforms with warning", async () => {
    setConfigForTesting(
      makeTestConfig({
        platforms: {
          enabled: ["meta", "tiktok"],
          tiktok: { access_token: "x", advertiser_id: "1" },
        },
      }),
    );
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (m: string) => {
      warns.push(m);
    };
    try {
      const platforms = await activePlatforms();
      expect(platforms.map((p) => p.name)).toEqual(["meta"]);
      expect(warns.some((w) => w.includes("scaffold-only"))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });
});

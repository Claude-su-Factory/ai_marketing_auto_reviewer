import { describe, it, expect } from "vitest";
import { ConfigSchema } from "./schema.js";

describe("ConfigSchema", () => {
  const validBase = {
    platforms: {
      enabled: ["meta"],
      meta: {
        access_token: "tok",
        ad_account_id: "act_1234567890",
        page_id: "1234567890",
        instagram_actor_id: "1234567890",
      },
    },
    ai: { anthropic: { api_key: "k1" }, google: { api_key: "k2" } },
  };

  it("accepts valid config and applies defaults", () => {
    const result = ConfigSchema.parse(validBase);
    expect(result.platforms.meta?.access_token).toBe("tok");
    expect(result.server.port).toBe(3000);
    expect(result.server.base_url).toBe("http://localhost:3000");
    expect(result.defaults.daily_budget_krw).toBe(10000);
    expect(result.defaults.duration_days).toBe(14);
    expect(result.defaults.target_age_min).toBe(20);
    expect(result.defaults.target_age_max).toBe(45);
    expect(result.defaults.ctr_improvement_threshold).toBe(1.5);
  });

  it("rejects ad_account_id without 'act_' prefix", () => {
    const r = ConfigSchema.safeParse({
      ...validBase,
      platforms: {
        ...validBase.platforms,
        meta: { ...validBase.platforms.meta, ad_account_id: "1234567890" },
      },
    });
    expect(r.success).toBe(false);
  });

  it("rejects when no AI provider given", () => {
    const r = ConfigSchema.safeParse({ ...validBase, ai: {} });
    expect(r.success).toBe(false);
  });

  it("rejects when 'meta' enabled but [platforms.meta] missing", () => {
    const r = ConfigSchema.safeParse({
      platforms: { enabled: ["meta"] },
      ai: { anthropic: { api_key: "k" } },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join(".") === "platforms.meta")).toBe(true);
    }
  });

  it("rejects empty enabled array", () => {
    const r = ConfigSchema.safeParse({
      ...validBase,
      platforms: { enabled: [], meta: validBase.platforms.meta },
    });
    expect(r.success).toBe(false);
  });

  it("rejects when 'tiktok' enabled but [platforms.tiktok] missing", () => {
    const r = ConfigSchema.safeParse({
      platforms: { enabled: ["tiktok"], meta: validBase.platforms.meta },
      ai: { anthropic: { api_key: "k" } },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join(".") === "platforms.tiktok")).toBe(true);
    }
  });

  it("rejects when 'google' enabled but [platforms.google] missing", () => {
    const r = ConfigSchema.safeParse({
      platforms: { enabled: ["google"], meta: validBase.platforms.meta },
      ai: { anthropic: { api_key: "k" } },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join(".") === "platforms.google")).toBe(true);
    }
  });

  it("accepts tiktok + meta when both sections present", () => {
    const r = ConfigSchema.safeParse({
      ...validBase,
      platforms: {
        enabled: ["meta", "tiktok"],
        meta: validBase.platforms.meta,
        tiktok: { access_token: "t-tok", advertiser_id: "12345" },
      },
    });
    expect(r.success).toBe(true);
  });
});

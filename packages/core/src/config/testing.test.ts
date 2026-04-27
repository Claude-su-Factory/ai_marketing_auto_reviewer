import { describe, it, expect } from "vitest";
import { makeTestConfig } from "./testing.js";

describe("makeTestConfig", () => {
  it("returns valid base config without overrides", () => {
    const c = makeTestConfig();
    expect(c.platforms.meta?.access_token).toBe("test-meta-token");
    expect(c.ai.voyage?.api_key).toBe("test-voyage-key");
    expect(c.billing?.stripe?.secret_key).toBe("sk_test_xxx");
  });

  it("merges overrides over base", () => {
    const c = makeTestConfig({ ai: { voyage: { api_key: "custom" } } });
    expect(c.ai.voyage?.api_key).toBe("custom");
    expect(c.ai.anthropic?.api_key).toBe("test-anthropic-key");
  });

  it("omits billing when listed", () => {
    const c = makeTestConfig({}, ["billing"]);
    expect(c.billing).toBeUndefined();
    expect(c.platforms.meta).toBeDefined();
  });

  it("omits ai.voyage independently", () => {
    const c = makeTestConfig({}, ["ai.voyage"]);
    expect(c.ai.voyage).toBeUndefined();
    expect(c.ai.anthropic).toBeDefined();
  });

  it("omits platforms.meta.instagram_actor_id when in omit list, preserves other meta fields", () => {
    const cfg = makeTestConfig({}, ["platforms.meta.instagram_actor_id"]);
    expect(cfg.platforms.meta?.instagram_actor_id).toBeUndefined();
    expect(cfg.platforms.meta?.access_token).toBe("test-meta-token");
    expect(cfg.platforms.meta?.ad_account_id).toBe("act_0000000000");
    expect(cfg.platforms.meta?.page_id).toBe("0000000000");
  });
});

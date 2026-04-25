import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./loader.js";
import { resetConfigForTesting } from "./index.js";

const FIXTURE_DIR = "packages/core/src/config/__fixtures__";

describe("loadConfig", () => {
  beforeEach(() => {
    delete process.env.CONFIG_PATH;
    resetConfigForTesting(); // bypass vitest.setup.ts auto-injection
  });

  afterEach(() => {
    delete process.env.CONFIG_PATH;
  });

  it("loads valid config via CONFIG_PATH", () => {
    process.env.CONFIG_PATH = `${FIXTURE_DIR}/valid.toml`;
    const cfg = loadConfig();
    expect(cfg.platforms.meta?.access_token).toBe("test-token");
    expect(cfg.ai.anthropic?.api_key).toBe("sk-ant-test");
  });

  it("throws clear error when file missing", () => {
    process.env.CONFIG_PATH = "/tmp/does-not-exist.toml";
    expect(() => loadConfig()).toThrow(/Config file not found/);
  });

  it("throws Zod path-specific error for invalid value", () => {
    process.env.CONFIG_PATH = `${FIXTURE_DIR}/invalid.toml`;
    expect(() => loadConfig()).toThrow(/platforms\.meta\.ad_account_id/);
  });

  it("throws cross-validation error when meta enabled but section missing", () => {
    process.env.CONFIG_PATH = `${FIXTURE_DIR}/missing-meta.toml`;
    expect(() => loadConfig()).toThrow(/platforms\.meta/);
  });
});

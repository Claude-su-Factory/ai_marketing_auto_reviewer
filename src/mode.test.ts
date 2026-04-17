import { describe, it, expect, beforeEach } from "vitest";
import { detectMode } from "./mode.js";

describe("detectMode", () => {
  beforeEach(() => {
    delete process.env.AD_AI_MODE;
    delete process.env.AD_AI_LICENSE_KEY;
    delete process.env.AD_AI_SERVER_URL;
  });

  it("returns owner mode when no key and no mode env", () => {
    const config = detectMode([]);
    expect(config.mode).toBe("owner");
    expect(config.licenseKey).toBeUndefined();
  });

  it("returns customer mode when --key flag provided", () => {
    const config = detectMode(["--key=AD-AI-TEST-1234"]);
    expect(config.mode).toBe("customer");
    expect(config.licenseKey).toBe("AD-AI-TEST-1234");
  });

  it("returns customer mode when AD_AI_LICENSE_KEY env set", () => {
    process.env.AD_AI_LICENSE_KEY = "AD-AI-ENV-5678";
    const config = detectMode([]);
    expect(config.mode).toBe("customer");
    expect(config.licenseKey).toBe("AD-AI-ENV-5678");
  });

  it("returns customer mode when AD_AI_MODE=customer", () => {
    process.env.AD_AI_MODE = "customer";
    process.env.AD_AI_LICENSE_KEY = "AD-AI-MODE-TEST";
    const config = detectMode([]);
    expect(config.mode).toBe("customer");
  });

  it("returns owner mode when AD_AI_MODE=owner even if key exists", () => {
    process.env.AD_AI_MODE = "owner";
    process.env.AD_AI_LICENSE_KEY = "AD-AI-IGNORED";
    const config = detectMode([]);
    expect(config.mode).toBe("owner");
  });

  it("uses default server URL when not specified", () => {
    const config = detectMode(["--key=AD-AI-TEST-1234"]);
    expect(config.serverUrl).toBe("http://localhost:3000");
  });

  it("uses custom server URL from env", () => {
    process.env.AD_AI_SERVER_URL = "https://api.ad-ai.com";
    const config = detectMode(["--key=AD-AI-TEST-1234"]);
    expect(config.serverUrl).toBe("https://api.ad-ai.com");
  });

  it("sets tempDir to data/temp", () => {
    const config = detectMode([]);
    expect(config.tempDir).toBe("data/temp");
  });
});

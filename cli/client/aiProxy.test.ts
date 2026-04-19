import { describe, it, expect } from "vitest";
import { createAiProxy } from "./aiProxy.js";
import type { ModeConfig } from "../mode.js";

describe("createAiProxy", () => {
  it("owner mode returns proxy with all methods", () => {
    const config: ModeConfig = { mode: "owner", tempDir: "data/temp" };
    const proxy = createAiProxy(config);
    expect(typeof proxy.generateCopy).toBe("function");
    expect(typeof proxy.generateImage).toBe("function");
    expect(typeof proxy.generateVideo).toBe("function");
    expect(typeof proxy.parseProduct).toBe("function");
    expect(typeof proxy.analyzePerformance).toBe("function");
    expect(typeof proxy.reportUsage).toBe("function");
  });

  it("customer mode returns proxy with all methods", () => {
    const config: ModeConfig = {
      mode: "customer",
      licenseKey: "AD-AI-TEST",
      serverUrl: "http://localhost:3000",
      sessionToken: "test-token",
      tempDir: "data/temp",
    };
    const proxy = createAiProxy(config);
    expect(typeof proxy.generateCopy).toBe("function");
    expect(typeof proxy.generateImage).toBe("function");
    expect(typeof proxy.generateVideo).toBe("function");
    expect(typeof proxy.parseProduct).toBe("function");
    expect(typeof proxy.analyzePerformance).toBe("function");
    expect(typeof proxy.reportUsage).toBe("function");
  });
});

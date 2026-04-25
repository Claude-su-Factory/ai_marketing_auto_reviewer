import { describe, it, expect } from "vitest";
import { notImplemented } from "./notImplemented.js";

describe("notImplemented", () => {
  it("throws Error with platform name and method", () => {
    expect(() => notImplemented("tiktok", "launch")).toThrow(
      /\[tiktok\] launch — scaffold only/i,
    );
  });

  it("includes README pointer in message", () => {
    try {
      notImplemented("google", "fetchReports");
    } catch (e) {
      expect((e as Error).message).toContain(
        "packages/core/src/platform/google/README.md",
      );
    }
  });
});

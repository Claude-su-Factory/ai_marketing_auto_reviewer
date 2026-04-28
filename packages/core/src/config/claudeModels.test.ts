import { describe, it, expect } from "vitest";
import { MODEL_PARSER, MODEL_COPY, MODEL_ANALYSIS, MODEL_IMPROVER } from "./claudeModels.js";

describe("Claude model tier constants", () => {
  it("exports MODEL_PARSER as Haiku tier (low-stakes mechanical)", () => {
    expect(MODEL_PARSER).toMatch(/haiku/);
  });

  it("exports MODEL_COPY / MODEL_ANALYSIS / MODEL_IMPROVER as Sonnet tier (high-stakes Korean nuance + reasoning)", () => {
    expect(MODEL_COPY).toMatch(/sonnet/);
    expect(MODEL_ANALYSIS).toMatch(/sonnet/);
    expect(MODEL_IMPROVER).toMatch(/sonnet/);
  });

  it("all constants are non-empty Anthropic model IDs", () => {
    for (const id of [MODEL_PARSER, MODEL_COPY, MODEL_ANALYSIS, MODEL_IMPROVER]) {
      expect(id).toMatch(/^claude-/);
      expect(id.length).toBeGreaterThan(8);
    }
  });
});

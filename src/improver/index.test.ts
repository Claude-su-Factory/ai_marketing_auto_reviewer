import { describe, it, expect, vi } from "vitest";
import { buildImprovementPrompt, parseImprovements, shouldTriggerImprovement } from "./index.js";
import type { Report } from "../types.js";

const lowPerformanceReport: Report = {
  id: "r1", campaignId: "c1", productId: "product-1", date: "2026-04-15",
  impressions: 5000, clicks: 40, ctr: 0.8, spend: 60000,
  cpc: 1500, reach: 4500, frequency: 1.1,
};

const highPerformanceReport: Report = {
  id: "r2", campaignId: "c2", productId: "product-2", date: "2026-04-15",
  impressions: 10000, clicks: 420, ctr: 4.2, spend: 134400,
  cpc: 320, reach: 8500, frequency: 1.18,
};

describe("shouldTriggerImprovement", () => {
  it("returns true when CTR is below threshold", () => {
    expect(shouldTriggerImprovement(lowPerformanceReport)).toBe(true);
  });

  it("returns false when CTR is above threshold", () => {
    expect(shouldTriggerImprovement(highPerformanceReport)).toBe(false);
  });
});

describe("buildImprovementPrompt", () => {
  it("includes file content and performance context", () => {
    const prompt = buildImprovementPrompt(
      "src/generator/copy.ts",
      "const prompt = 'old prompt';",
      "CTR 0.8% — 임계값 1.5% 미달",
      "카피 헤드라인이 너무 추상적"
    );
    expect(prompt).toContain("old prompt");
    expect(prompt).toContain("0.8%");
  });
});

describe("parseImprovements", () => {
  it("extracts file edits from Claude response", () => {
    const response = `{
      "file": "src/generator/copy.ts",
      "oldCode": "const a = 1;",
      "newCode": "const a = 2;"
    }`;
    const result = parseImprovements(response);
    expect(result.file).toBe("src/generator/copy.ts");
    expect(result.newCode).toBe("const a = 2;");
  });
});

describe("buildImprovementPrompt safety", () => {
  it("explicitly prohibits modifying external platform pages", () => {
    const prompt = buildImprovementPrompt(
      "src/generator/copy.ts",
      "const x = 1;",
      "CTR 0.5%",
      "카피가 약함"
    );
    expect(prompt).toMatch(/인프런|class101|외부.*수정.*금지|절대.*수정/);
  });
});

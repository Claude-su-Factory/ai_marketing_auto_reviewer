import { describe, it, expect } from "vitest";
import {
  buildImprovementPrompt,
  parsePromptUpdate,
  shouldTriggerImprovement,
  isAllowedPromptKey,
  ALLOWED_PROMPT_KEYS,
} from "./index.js";
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

describe("isAllowedPromptKey", () => {
  it("accepts all 5 enum values", () => {
    expect(isAllowedPromptKey("copy.systemPrompt")).toBe(true);
    expect(isAllowedPromptKey("copy.userTemplate")).toBe(true);
    expect(isAllowedPromptKey("copy.angleHints.emotional")).toBe(true);
    expect(isAllowedPromptKey("copy.angleHints.numerical")).toBe(true);
    expect(isAllowedPromptKey("copy.angleHints.urgency")).toBe(true);
  });

  it("rejects unknown keys", () => {
    expect(isAllowedPromptKey("copy.unknown")).toBe(false);
    expect(isAllowedPromptKey("analysis.userTemplate")).toBe(false);
    expect(isAllowedPromptKey("")).toBe(false);
  });

  it("ALLOWED_PROMPT_KEYS contains exactly 5 entries", () => {
    expect(ALLOWED_PROMPT_KEYS).toHaveLength(5);
  });
});

describe("buildImprovementPrompt", () => {
  it("includes promptKey, currentValue, issue, suggestion, performanceContext", () => {
    const prompt = buildImprovementPrompt(
      "copy.angleHints.emotional",
      "기존 angle hint 값입니다",
      "감정 호소가 약함",
      "더 구체적인 페인 포인트 강조",
      "5개 캠페인 CTR 0.8% 미달",
    );
    expect(prompt).toContain("copy.angleHints.emotional");
    expect(prompt).toContain("기존 angle hint 값입니다");
    expect(prompt).toContain("감정 호소가 약함");
    expect(prompt).toContain("더 구체적인 페인 포인트");
    expect(prompt).toContain("5개 캠페인");
  });

  it("specifies userTemplate placeholder requirements", () => {
    const prompt = buildImprovementPrompt(
      "copy.userTemplate",
      "{{name}} {{description}}",
      "issue",
      "suggestion",
      "ctx",
    );
    expect(prompt).toContain("{{name}}");
    expect(prompt).toContain("{{description}}");
    expect(prompt).toContain("{{angleHint}}");
  });

  it("requires JSON response format", () => {
    const prompt = buildImprovementPrompt(
      "copy.systemPrompt",
      "v",
      "i",
      "s",
      "c",
    );
    expect(prompt).toContain("JSON 형식");
    expect(prompt).toContain('"promptKey"');
    expect(prompt).toContain('"newValue"');
  });

  it("explicitly forbids personalization and hyperbole in newValue", () => {
    const prompt = buildImprovementPrompt(
      "copy.systemPrompt",
      "v",
      "i",
      "s",
      "c",
    );
    expect(prompt).toMatch(/당신만을 위한|회원님|~님/);
    expect(prompt).toMatch(/100%|1위|최고|과장/);
  });
});

describe("parsePromptUpdate", () => {
  it("extracts promptKey/newValue/reason from Claude response", () => {
    const response = `{
      "promptKey": "copy.systemPrompt",
      "newValue": "새 시스템 프롬프트",
      "reason": "더 구체적으로"
    }`;
    const result = parsePromptUpdate(response);
    expect(result.promptKey).toBe("copy.systemPrompt");
    expect(result.newValue).toBe("새 시스템 프롬프트");
    expect(result.reason).toBe("더 구체적으로");
  });

  it("returns empty object when JSON malformed", () => {
    const result = parsePromptUpdate("not json");
    expect(result).toEqual({});
  });

  it("returns partial when fields missing", () => {
    const result = parsePromptUpdate(`{"promptKey": "copy.systemPrompt"}`);
    expect(result.promptKey).toBe("copy.systemPrompt");
    expect(result.newValue).toBeUndefined();
  });
});

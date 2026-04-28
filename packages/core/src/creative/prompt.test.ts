import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildCopyPrompt, VARIANT_LABELS } from "./prompt.js";
import type { Product } from "../types.js";
import { DEFAULT_PROMPTS, setPromptsForTesting } from "../learning/prompts.js";

beforeEach(() => {
  // 프로덕션 data/learned/prompts.json 이 self-learning 으로 변경된 상태에서도
  // 본 테스트가 안정적으로 placeholder 치환 동작을 검증하도록 DEFAULT_PROMPTS 강제 주입.
  setPromptsForTesting(DEFAULT_PROMPTS);
});

afterAll(() => {
  setPromptsForTesting(null);
});

const baseProduct: Product = {
  id: "p1",
  name: "React 완전정복",
  description: "React를 처음부터 배웁니다",
  targetUrl: "https://inflearn.com/course/react",
  currency: "KRW",
  price: 55000,
  category: "course",
  tags: ["react", "frontend"],
  learningOutcomes: [],
  differentiators: [],
  inputMethod: "scraped",
  createdAt: "2026-04-20T00:00:00.000Z",
};

describe("buildCopyPrompt", () => {
  it("injects emotional angle hint when variantLabel='emotional'", async () => {
    const prompt = await buildCopyPrompt(baseProduct, [], "emotional");
    expect(prompt).toContain("감정 호소");
  });

  it("injects numerical angle hint when variantLabel='numerical'", async () => {
    const prompt = await buildCopyPrompt(baseProduct, [], "numerical");
    expect(prompt).toContain("수치");
  });

  it("injects urgency angle hint when variantLabel='urgency'", async () => {
    const prompt = await buildCopyPrompt(baseProduct, [], "urgency");
    expect(prompt).toContain("긴급성");
  });

  it("does not render fewShot section when fewShot is empty", async () => {
    const prompt = await buildCopyPrompt(baseProduct, [], "emotional");
    expect(prompt).not.toContain("참고 예시");
  });

  it("renders fewShot section header when fewShot is non-empty", async () => {
    const prompt = await buildCopyPrompt(baseProduct, [{ headline: "h", body: "b", cta: "c" }], "emotional");
    expect(prompt).toContain("참고 예시");
  });

  it("includes product name, description, price, tags, and targetUrl", async () => {
    const prompt = await buildCopyPrompt(baseProduct, [], "emotional");
    expect(prompt).toContain("React 완전정복");
    expect(prompt).toContain("React를 처음부터 배웁니다");
    expect(prompt).toContain("55,000");
    expect(prompt).toContain("react");
    expect(prompt).toContain("https://inflearn.com/course/react");
  });

  it("uses '가격 미정' when product.price is undefined", async () => {
    const prompt = await buildCopyPrompt({ ...baseProduct, price: undefined }, [], "emotional");
    expect(prompt).toContain("가격 미정");
  });

  it("VARIANT_LABELS contains exactly 3 labels in the canonical order", () => {
    expect(VARIANT_LABELS).toEqual(["emotional", "numerical", "urgency"]);
  });

  it("substitutes all required placeholders (no {{...}} left in output)", async () => {
    const prompt = await buildCopyPrompt(baseProduct, [], "emotional");
    expect(prompt).not.toMatch(/\{\{(name|description|angleHint|priceText|category|tags|targetUrl|fewShotBlock|learningOutcomesBlock|differentiatorsBlock)\}\}/);
  });

  it("buildPriceText: shows discount when originalPrice > price", async () => {
    const product = { ...baseProduct, price: 99000, originalPrice: 198000 };
    const prompt = await buildCopyPrompt(product, [], "emotional");
    expect(prompt).toContain("99,000");
    expect(prompt).toContain("정가 KRW 198,000");
    expect(prompt).toContain("50% 할인");
  });

  it("buildPriceText: skips discount when originalPrice <= price (graceful for bad data)", async () => {
    const product = { ...baseProduct, price: 99000, originalPrice: 99000 };
    const prompt = await buildCopyPrompt(product, [], "emotional");
    expect(prompt).toContain("99,000");
    expect(prompt).not.toContain("할인");
  });

  it("buildPriceText: shows base price only when originalPrice undefined", async () => {
    const product = { ...baseProduct, price: 99000, originalPrice: undefined };
    const prompt = await buildCopyPrompt(product, [], "emotional");
    expect(prompt).toContain("99,000");
    expect(prompt).not.toContain("정가");
    expect(prompt).not.toContain("할인");
  });

  it("buildLearningOutcomesBlock: omits block when empty", async () => {
    const prompt = await buildCopyPrompt(baseProduct, [], "emotional");
    expect(prompt).not.toContain("학습 결과:");
  });

  it("buildLearningOutcomesBlock: renders header + dash bullets when populated", async () => {
    const product = { ...baseProduct, learningOutcomes: ["실시간 채팅 시스템 구현", "동시 접속 1000명 처리"] };
    const prompt = await buildCopyPrompt(product, [], "emotional");
    expect(prompt).toContain("학습 결과:");
    expect(prompt).toContain("- 실시간 채팅 시스템 구현");
    expect(prompt).toContain("- 동시 접속 1000명 처리");
  });

  it("buildDifferentiatorsBlock: omits block when empty", async () => {
    const prompt = await buildCopyPrompt(baseProduct, [], "emotional");
    expect(prompt).not.toContain("차별점:");
  });

  it("buildDifferentiatorsBlock: renders header + dash bullets when populated", async () => {
    const product = { ...baseProduct, differentiators: ["현직 카카오 시니어", "실 프로젝트 사례"] };
    const prompt = await buildCopyPrompt(product, [], "emotional");
    expect(prompt).toContain("차별점:");
    expect(prompt).toContain("- 현직 카카오 시니어");
    expect(prompt).toContain("- 실 프로젝트 사례");
  });
});

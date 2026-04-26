import { describe, it, expect } from "vitest";
import { buildCopyPrompt, VARIANT_LABELS } from "./prompt.js";
import type { Product } from "../types.js";

const baseProduct: Product = {
  id: "p1",
  name: "React 완전정복",
  description: "React를 처음부터 배웁니다",
  targetUrl: "https://inflearn.com/course/react",
  currency: "KRW",
  price: 55000,
  category: "course",
  tags: ["react", "frontend"],
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
    expect(prompt).not.toMatch(/\{\{(name|description|angleHint|priceText|category|tags|targetUrl|fewShotBlock)\}\}/);
  });
});

import { describe, it, expect } from "vitest";
import { buildProductEmbedText } from "./embeddingText.js";
import type { Product } from "../types.js";

const baseProduct: Product = {
  id: "p1",
  name: "Test",
  description: "기본 설명",
  targetUrl: "https://example.com",
  currency: "KRW",
  tags: [],
  learningOutcomes: [],
  differentiators: [],
  inputMethod: "manual",
  createdAt: "2026-04-28T00:00:00Z",
};

describe("buildProductEmbedText", () => {
  it("returns just description when both arrays empty", () => {
    const text = buildProductEmbedText(baseProduct);
    expect(text).toBe("기본 설명");
  });

  it("appends 학습 결과 line when learningOutcomes populated", () => {
    const product = { ...baseProduct, learningOutcomes: ["A", "B"] };
    const text = buildProductEmbedText(product);
    expect(text).toBe("기본 설명\n학습 결과: A, B");
  });

  it("appends both lines when both populated, in order outcomes then differentiators", () => {
    const product = {
      ...baseProduct,
      learningOutcomes: ["O1", "O2"],
      differentiators: ["D1", "D2"],
    };
    const text = buildProductEmbedText(product);
    expect(text).toBe("기본 설명\n학습 결과: O1, O2\n차별점: D1, D2");
  });
});

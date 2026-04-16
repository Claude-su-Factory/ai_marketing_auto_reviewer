import { describe, it, expect } from "vitest";
import { buildVideoPrompt } from "./video.js";
import type { Product } from "../types.js";

const mockProduct: Product = {
  id: "test-id", name: "TypeScript 입문", description: "타입스크립트를 배웁니다",
  imageUrl: "", targetUrl: "https://inflearn.com/course/typescript",
  category: "course", currency: "KRW", price: 49000, tags: ["typescript"],
  inputMethod: "scraped", createdAt: "2026-04-16T00:00:00.000Z",
};

describe("buildVideoPrompt", () => {
  it("generates a video prompt with product context", () => {
    const prompt = buildVideoPrompt(mockProduct);
    expect(prompt).toContain("TypeScript");
    expect(prompt.length).toBeGreaterThan(50);
  });
  it("includes vertical format instruction", () => {
    const prompt = buildVideoPrompt(mockProduct);
    expect(prompt.toLowerCase()).toContain("vertical");
  });
});

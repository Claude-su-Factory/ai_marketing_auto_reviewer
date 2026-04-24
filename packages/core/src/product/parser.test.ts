import { describe, it, expect, vi } from "vitest";
import { parseProductWithGemini, detectCategory } from "./parser.js";

describe("detectCategory", () => {
  it("detects course from inflearn URL", () => {
    expect(detectCategory("https://www.inflearn.com/course/typescript")).toBe("course");
  });
  it("detects course from class101 URL", () => {
    expect(detectCategory("https://class101.net/products/abc123")).toBe("course");
  });
  it("returns other for unknown URLs", () => {
    expect(detectCategory("https://example.com/product")).toBe("other");
  });
});

describe("parseProductWithGemini", () => {
  it("extracts structured product data from raw HTML", async () => {
    const mockGemini = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            name: "TypeScript 완전 정복",
            description: "TypeScript를 처음부터 끝까지",
            price: 55000,
            tags: ["typescript", "javascript"],
            imageUrl: "https://example.com/thumb.jpg",
          }),
        }),
      },
    };
    const result = await parseProductWithGemini(
      mockGemini as any,
      "https://www.inflearn.com/course/typescript",
      "<html>TypeScript 완전 정복 ₩55,000</html>"
    );
    expect(result.name).toBe("TypeScript 완전 정복");
    expect(result.price).toBe(55000);
    expect(result.category).toBe("course");
    expect(result.inputMethod).toBe("scraped");
    expect(result.currency).toBe("KRW");
  });
});

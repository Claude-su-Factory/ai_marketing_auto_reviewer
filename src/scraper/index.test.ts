import { describe, it, expect, vi } from "vitest";
import { parseCourseWithGemini } from "./index.js";

describe("parseCourseWithGemini", () => {
  it("extracts structured course data from raw HTML", async () => {
    const mockGemini = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            title: "TypeScript 완전 정복",
            description: "TypeScript를 처음부터 끝까지",
            price: 55000,
            tags: ["typescript", "javascript"],
            thumbnail: "https://example.com/thumb.jpg",
          }),
        }),
      },
    };

    const result = await parseCourseWithGemini(
      mockGemini as any,
      "https://www.inflearn.com/course/typescript",
      "<html>TypeScript 완전 정복 ₩55,000</html>"
    );

    expect(result.title).toBe("TypeScript 완전 정복");
    expect(result.price).toBe(55000);
    expect(result.platform).toBe("inflearn");
  });
});

import { describe, it, expect, vi } from "vitest";
import { generateCopy, COPY_SYSTEM_PROMPT } from "./copy.js";
import type { Product } from "../types.js";

const mockProduct: Product = {
  id: "test-id", name: "React 완전정복", description: "React를 처음부터 배웁니다",
  imageUrl: "https://example.com/thumb.jpg", targetUrl: "https://inflearn.com/course/react",
  category: "course", currency: "KRW", price: 55000, tags: ["react", "frontend"],
  inputMethod: "scraped", createdAt: "2026-04-16T00:00:00.000Z",
};

function mockClient(responseText: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: responseText }],
      }),
    },
  };
}

describe("generateCopy", () => {
  it("returns structured copy with all required fields", async () => {
    const client = mockClient(JSON.stringify({
      headline: "React를 3주 만에 마스터하세요",
      body: "현직 개발자가 알려주는 실전 React.",
      cta: "강의 보러가기",
      hashtags: ["#React", "#프론트엔드", "#개발공부"],
    }));
    const result = await generateCopy(client as any, mockProduct, [], "emotional");
    expect(result.headline).toBeTruthy();
    expect(result.body).toBeTruthy();
    expect(result.cta).toBeTruthy();
    expect(result.hashtags).toHaveLength(3);
  });

  it("injects variantLabel angle hint into the user message", async () => {
    const client = mockClient(JSON.stringify({
      headline: "h", body: "b", cta: "c", hashtags: ["a", "b", "c"],
    }));
    await generateCopy(client as any, mockProduct, [], "urgency");
    const call = (client.messages.create as any).mock.calls[0][0];
    const userContent = call.messages[0].content;
    expect(userContent).toContain("긴급성");
  });

  it("includes fewShot examples in the prompt when non-empty", async () => {
    const client = mockClient(JSON.stringify({
      headline: "h", body: "b", cta: "c", hashtags: ["a", "b", "c"],
    }));
    await generateCopy(
      client as any,
      mockProduct,
      [{ headline: "WINNER_HEADLINE", body: "WINNER_BODY", cta: "WINNER_CTA" }],
      "emotional",
    );
    const userContent = (client.messages.create as any).mock.calls[0][0].messages[0].content;
    expect(userContent).toContain("WINNER_HEADLINE");
  });

  it("COPY_SYSTEM_PROMPT does not mention 온라인 강의 specifically", () => {
    expect(COPY_SYSTEM_PROMPT).not.toContain("온라인 강의");
  });

  it("COPY_SYSTEM_PROMPT specifies 40-char headline limit", () => {
    expect(COPY_SYSTEM_PROMPT).toContain("40");
  });

  it("COPY_SYSTEM_PROMPT specifies 125-char body limit", () => {
    expect(COPY_SYSTEM_PROMPT).toContain("125");
  });

  it("COPY_SYSTEM_PROMPT specifies exactly 3 hashtags", () => {
    expect(COPY_SYSTEM_PROMPT).toContain("3");
  });
});

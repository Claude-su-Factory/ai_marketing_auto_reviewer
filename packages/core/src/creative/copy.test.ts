import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { generateCopy } from "./copy.js";
import { DEFAULT_PROMPTS, setPromptsForTesting } from "../learning/prompts.js";
import type { Product } from "../types.js";

beforeEach(() => {
  // 프로덕션 data/learned/prompts.json 이 self-learning 으로 변경된 상태에서도
  // 본 테스트가 DEFAULT_PROMPTS 와 동일성을 검증할 수 있도록 강제 주입.
  setPromptsForTesting(DEFAULT_PROMPTS);
});

afterAll(() => {
  setPromptsForTesting(null);
});

const mockProduct: Product = {
  id: "test-id", name: "React 완전정복", description: "React를 처음부터 배웁니다",
  imageUrl: "https://example.com/thumb.jpg", targetUrl: "https://inflearn.com/course/react",
  category: "course", currency: "KRW", price: 55000, tags: ["react", "frontend"],
  learningOutcomes: [], differentiators: [],
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

  it("DEFAULT_PROMPTS.copy.systemPrompt does not mention 온라인 강의 specifically", () => {
    expect(DEFAULT_PROMPTS.copy.systemPrompt).not.toContain("온라인 강의");
  });

  it("DEFAULT_PROMPTS.copy.systemPrompt specifies 40-char headline limit", () => {
    expect(DEFAULT_PROMPTS.copy.systemPrompt).toContain("40");
  });

  it("DEFAULT_PROMPTS.copy.systemPrompt specifies 125-char body limit", () => {
    expect(DEFAULT_PROMPTS.copy.systemPrompt).toContain("125");
  });

  it("DEFAULT_PROMPTS.copy.systemPrompt specifies exactly 3 hashtags", () => {
    expect(DEFAULT_PROMPTS.copy.systemPrompt).toContain("3");
  });

  it("passes loaded systemPrompt to Anthropic system field", async () => {
    const client = mockClient(JSON.stringify({
      headline: "h", body: "b", cta: "c", hashtags: ["a", "b", "c"],
    }));
    await generateCopy(client as any, mockProduct, [], "emotional");
    const call = (client.messages.create as any).mock.calls[0][0];
    expect(call.system[0].text).toBe(DEFAULT_PROMPTS.copy.systemPrompt);
  });
});

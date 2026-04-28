import { describe, it, expect, vi } from "vitest";
import { parseProductWithClaude, detectCategory } from "./parser.js";

function mockClient(responseText: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: responseText }],
      }),
    },
  };
}

describe("parseProductWithClaude", () => {
  it("parses JSON response into Product shape", async () => {
    const client = mockClient(JSON.stringify({
      name: "Redis 강의",
      description: "트래픽 처리 노하우",
      price: 99000,
      tags: ["Redis", "백엔드"],
      imageUrl: "https://example.com/cover.jpg",
    }));
    const product = await parseProductWithClaude(
      client as any,
      "https://www.inflearn.com/course/redis",
      "<html>...</html>",
    );
    expect(product.name).toBe("Redis 강의");
    expect(product.description).toBe("트래픽 처리 노하우");
    expect(product.price).toBe(99000);
    expect(product.tags).toEqual(["Redis", "백엔드"]);
    expect(product.imageUrl).toBe("https://example.com/cover.jpg");
    expect(product.targetUrl).toBe("https://www.inflearn.com/course/redis");
    expect(product.category).toBe("course");
    expect(product.currency).toBe("KRW");
    expect(product.inputMethod).toBe("scraped");
    expect(product.id).toBeTruthy();
    expect(product.createdAt).toBeTruthy();
  });

  it("falls back to safe defaults when Claude returns malformed JSON", async () => {
    const client = mockClient("not JSON at all");
    const product = await parseProductWithClaude(
      client as any,
      "https://example.com",
      "<html>...</html>",
    );
    expect(product.name).toBe("");
    expect(product.description).toBe("");
    expect(product.price).toBe(0);
    expect(product.tags).toEqual([]);
    expect(product.imageUrl).toBe("");
  });

  it("uses claude-sonnet-4-6 model with system prompt + ephemeral cache", async () => {
    const client = mockClient(JSON.stringify({ name: "x", description: "y", price: 0, tags: [] }));
    await parseProductWithClaude(client as any, "https://example.com", "<html>");
    const callArgs = (client.messages.create as any).mock.calls[0][0];
    expect(callArgs.model).toBe("claude-sonnet-4-6");
    expect(callArgs.system[0].text).toContain("JSON");
    expect(callArgs.system[0].text).toContain("learningOutcomes");
    expect(callArgs.system[0].text).toContain("differentiators");
    expect(callArgs.system[0].text).toContain("originalPrice");
    expect(callArgs.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(callArgs.messages[0].role).toBe("user");
    expect(callArgs.messages[0].content).toContain("HTML:");
  });

  it("extracts learningOutcomes / differentiators arrays", async () => {
    const client = mockClient(JSON.stringify({
      name: "Redis 강의",
      description: "d",
      price: 99000,
      tags: [],
      learningOutcomes: ["동시 접속 1000명 처리", "Redis Cluster 운영 노하우"],
      differentiators: ["현직 카카오 시니어", "실 면접관 경험"],
    }));
    const product = await parseProductWithClaude(
      client as any,
      "https://www.inflearn.com/course/redis",
      "<html>",
    );
    expect(product.learningOutcomes).toEqual(["동시 접속 1000명 처리", "Redis Cluster 운영 노하우"]);
    expect(product.differentiators).toEqual(["현직 카카오 시니어", "실 면접관 경험"]);
  });

  it("falls back to empty arrays for learningOutcomes/differentiators when missing", async () => {
    const client = mockClient(JSON.stringify({
      name: "x",
      description: "y",
      price: 0,
      tags: [],
    }));
    const product = await parseProductWithClaude(
      client as any,
      "https://example.com",
      "<html>",
    );
    expect(product.learningOutcomes).toEqual([]);
    expect(product.differentiators).toEqual([]);
  });

  it("converts originalPrice null → undefined; preserves number when present", async () => {
    const client1 = mockClient(JSON.stringify({ name: "x", description: "y", price: 99000, originalPrice: 198000, tags: [], learningOutcomes: [], differentiators: [] }));
    const product1 = await parseProductWithClaude(client1 as any, "https://example.com", "<html>");
    expect(product1.originalPrice).toBe(198000);

    const client2 = mockClient(JSON.stringify({ name: "x", description: "y", price: 99000, originalPrice: null, tags: [], learningOutcomes: [], differentiators: [] }));
    const product2 = await parseProductWithClaude(client2 as any, "https://example.com", "<html>");
    expect(product2.originalPrice).toBeUndefined();
  });
});

describe("detectCategory", () => {
  it("detects course for inflearn", () => {
    expect(detectCategory("https://www.inflearn.com/course/x")).toBe("course");
  });
  it("detects course for class101", () => {
    expect(detectCategory("https://class101.net/x")).toBe("course");
  });
  it("returns other for unknown", () => {
    expect(detectCategory("https://example.com")).toBe("other");
  });
});

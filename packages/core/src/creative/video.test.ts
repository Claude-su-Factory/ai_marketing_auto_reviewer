import { describe, it, expect, vi } from "vitest";
import { buildVideoPrompt, fetchVeoVideoData } from "./video.js";
import type { Product } from "../types.js";

const mockProduct: Product = {
  id: "test-id", name: "TypeScript 입문", description: "타입스크립트를 배웁니다",
  imageUrl: "", targetUrl: "https://inflearn.com/course/typescript",
  category: "course", currency: "KRW", price: 49000, tags: ["typescript"],
  learningOutcomes: [], differentiators: [],
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
  it("explicitly forbids people / faces / human figures", () => {
    const prompt = buildVideoPrompt(mockProduct);
    expect(prompt).toMatch(/NO people/);
    expect(prompt).toMatch(/no faces|no human/i);
  });
  it("explicitly forbids on-screen text rendering (Veo limitation — Korean/English garbles)", () => {
    const prompt = buildVideoPrompt(mockProduct);
    expect(prompt).toMatch(/NO on-screen text|no.*captions|no.*letters/i);
    expect(prompt.toLowerCase()).toMatch(/korean|english/);
  });
  it("specifies 8 seconds (matches Veo 4-8s API constraint)", () => {
    const prompt = buildVideoPrompt(mockProduct);
    expect(prompt).toMatch(/8 seconds/);
  });
  it("avoids 'cinematic' / 'dramatic' staging language (less artificial)", () => {
    const prompt = buildVideoPrompt(mockProduct);
    expect(prompt).not.toMatch(/cinematic quality/i);
    expect(prompt).toMatch(/natural|grounded|realistic/i);
  });
});

describe("fetchVeoVideoData (handles inline bytes vs URI dual response shape)", () => {
  it("returns videoBytes directly when present (older Veo response)", async () => {
    const data = await fetchVeoVideoData({ videoBytes: "BASE64_DATA" }, "k");
    expect(data).toBe("BASE64_DATA");
  });

  it("downloads URI with key= query param when only uri present (newer Veo)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 }),
    );
    const data = await fetchVeoVideoData({ uri: "https://example.com/video" }, "test-key");
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/video?key=test-key");
    expect(data).toBeInstanceOf(Uint8Array);
    expect((data as Uint8Array).length).toBe(4);
    fetchSpy.mockRestore();
  });

  it("appends key with '&' when uri already has query string", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([0]).buffer, { status: 200 }),
    );
    await fetchVeoVideoData({ uri: "https://example.com/video?token=abc" }, "k");
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/video?token=abc&key=k");
    fetchSpy.mockRestore();
  });

  it("throws actionable error when URI download fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("forbidden", { status: 403 }),
    );
    await expect(fetchVeoVideoData({ uri: "https://example.com/video" }, "k"))
      .rejects.toThrow(/Veo URI 다운로드 실패 403/);
    fetchSpy.mockRestore();
  });

  it("throws when neither videoBytes nor uri present", async () => {
    await expect(fetchVeoVideoData({}, "k")).rejects.toThrow(/videoBytes\/uri 모두 없음/);
  });

  it("prefers videoBytes when both present (avoids unnecessary network call)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const data = await fetchVeoVideoData({ videoBytes: "INLINE", uri: "https://x.com/v" }, "k");
    expect(data).toBe("INLINE");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

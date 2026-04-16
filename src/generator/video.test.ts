import { describe, it, expect } from "vitest";
import { buildVideoPrompt } from "./video.js";
import type { Course } from "../types.js";

const mockCourse: Course = {
  id: "test-id",
  title: "TypeScript 입문",
  description: "타입스크립트를 배웁니다",
  thumbnail: "",
  url: "https://inflearn.com/course/typescript",
  platform: "inflearn",
  price: 49000,
  tags: ["typescript"],
  scrapedAt: "2026-04-16T00:00:00.000Z",
};

describe("buildVideoPrompt", () => {
  it("generates a video prompt with course context", () => {
    const prompt = buildVideoPrompt(mockCourse);
    expect(prompt).toContain("TypeScript");
    expect(prompt.length).toBeGreaterThan(50);
  });

  it("includes vertical format instruction", () => {
    const prompt = buildVideoPrompt(mockCourse);
    expect(prompt.toLowerCase()).toContain("vertical");
  });
});

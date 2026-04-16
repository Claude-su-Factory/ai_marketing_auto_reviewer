import { describe, it, expect, vi } from "vitest";
import { generateCopy, COPY_SYSTEM_PROMPT } from "./copy.js";
import type { Course } from "../types.js";

const mockCourse: Course = {
  id: "test-id",
  title: "React 완전정복",
  description: "React를 처음부터 배웁니다",
  thumbnail: "https://example.com/thumb.jpg",
  url: "https://inflearn.com/course/react",
  platform: "inflearn",
  price: 55000,
  tags: ["react", "frontend"],
  scrapedAt: "2026-04-16T00:00:00.000Z",
};

describe("generateCopy", () => {
  it("returns structured copy with all required fields", async () => {
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                headline: "React를 3주 만에 마스터하세요",
                body: "현직 개발자가 알려주는 실전 React. 지금 바로 시작하세요.",
                cta: "강의 보러가기",
                hashtags: ["#React", "#프론트엔드", "#개발공부"],
              }),
            },
          ],
        }),
      },
    };

    const result = await generateCopy(mockClient as any, mockCourse);

    expect(result.headline).toBeTruthy();
    expect(result.body).toBeTruthy();
    expect(result.cta).toBeTruthy();
    expect(result.hashtags).toHaveLength(3);
  });

  it("COPY_SYSTEM_PROMPT is defined and non-empty", () => {
    expect(COPY_SYSTEM_PROMPT.length).toBeGreaterThan(50);
  });
});

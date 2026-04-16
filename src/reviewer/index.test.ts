import { describe, it, expect } from "vitest";
import { applyReviewDecision } from "./index.js";
import type { Creative } from "../types.js";

const mockCreative: Creative = {
  id: "creative-1",
  courseId: "course-1",
  copy: {
    headline: "TypeScript 마스터",
    body: "3주 만에 TypeScript 완성",
    cta: "지금 수강하기",
    hashtags: ["#TypeScript"],
  },
  imageLocalPath: "data/creatives/course-1-image.jpg",
  videoLocalPath: "data/creatives/course-1-video.mp4",
  status: "pending",
  createdAt: "2026-04-16T00:00:00.000Z",
};

describe("applyReviewDecision", () => {
  it("sets status to approved on approve", () => {
    const result = applyReviewDecision(mockCreative, { action: "approve" });
    expect(result.status).toBe("approved");
  });

  it("sets status to rejected with note on reject", () => {
    const result = applyReviewDecision(mockCreative, {
      action: "reject",
      note: "이미지 품질 낮음",
    });
    expect(result.status).toBe("rejected");
    expect(result.reviewNote).toBe("이미지 품질 낮음");
  });

  it("sets status to edited and updates copy on edit", () => {
    const result = applyReviewDecision(mockCreative, {
      action: "edit",
      field: "headline",
      value: "수정된 헤드라인",
    });
    expect(result.status).toBe("edited");
    expect(result.copy.headline).toBe("수정된 헤드라인");
  });
});

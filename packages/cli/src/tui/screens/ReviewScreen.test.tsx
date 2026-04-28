import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ReviewScreen } from "./ReviewScreen.js";

vi.mock("../hooks/useWorkerStatus.js", () => ({ useWorkerStatus: () => ({ active: false, checkedAt: 0 }) }));
vi.mock("../hooks/useTodayStats.js", () => ({ useTodayStats: () => ({ todayCount: 0, refresh: () => {}, bump: () => {} }) }));
vi.mock("../review/assetMeta.js", () => ({
  getAssetMeta: async (p: string) => p.endsWith(".mp4")
    ? { kind: "video", width: 1080, height: 1920, format: "mp4", sizeBytes: 4200000 }
    : { kind: "image", width: 1080, height: 1080, format: "jpeg", sizeBytes: 342000 },
  clearAssetMetaCache: () => {},
}));

const group = {
  variantGroupId: "g1",
  product: { id: "p1", name: "AI 부트캠프", description: "", targetUrl: "", currency: "KRW", tags: [], learningOutcomes: [], differentiators: [], inputMethod: "manual" as const, createdAt: "" },
  creatives: [
    { id: "c1", productId: "p1", variantGroupId: "g1",
      copy: { headline: "3개월 안에", body: "실전 프로젝트 12개", cta: "지금 신청", hashtags: ["AI"], variantLabel: "emotional" as const, assetLabel: "" },
      imageLocalPath: "img.jpg", videoLocalPath: "vid.mp4", status: "pending" as const, createdAt: "" },
  ],
};

describe("ReviewScreen badge + ASSETS", () => {
  it("renders status badge and asset meta after load", async () => {
    const { lastFrame } = render(React.createElement(ReviewScreen, {
      groups: [group], onApprove: () => {}, onReject: () => {}, onEdit: () => {},
    }));
    await new Promise((r) => setTimeout(r, 20));
    const f = lastFrame() ?? "";
    expect(f).toContain("pending");
    expect(f).toContain("1080×1080");
    expect(f).toContain("342KB");
    expect(f).toContain("mp4");
  });
});

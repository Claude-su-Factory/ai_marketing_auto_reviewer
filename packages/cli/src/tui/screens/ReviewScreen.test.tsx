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
      imageLocalPath: "img.jpg", status: "pending" as const, createdAt: "" },
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
  });
});

describe("ReviewScreen escape handling (browse mode trap fix)", () => {
  it("calls onCancel when Esc pressed in browse mode", async () => {
    const onCancel = vi.fn();
    const { stdin } = render(React.createElement(ReviewScreen, {
      groups: [group], onApprove: () => {}, onReject: () => {}, onEdit: () => {}, onCancel,
    }));
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x1b"); // Esc
    await new Promise((r) => setTimeout(r, 20));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when 'q' pressed in browse mode", async () => {
    const onCancel = vi.fn();
    const { stdin } = render(React.createElement(ReviewScreen, {
      groups: [group], onApprove: () => {}, onReject: () => {}, onEdit: () => {}, onCancel,
    }));
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("q");
    await new Promise((r) => setTimeout(r, 20));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Esc pressed in 'all complete' state (empty groups)", async () => {
    const onCancel = vi.fn();
    const { stdin } = render(React.createElement(ReviewScreen, {
      groups: [], onApprove: () => {}, onReject: () => {}, onEdit: () => {}, onCancel,
    }));
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x1b");
    await new Promise((r) => setTimeout(r, 20));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders 'Esc/q 메뉴로 돌아가기' hint when groups empty", () => {
    const { lastFrame } = render(React.createElement(ReviewScreen, {
      groups: [], onApprove: () => {}, onReject: () => {}, onEdit: () => {}, onCancel: () => {},
    }));
    const f = lastFrame() ?? "";
    expect(f).toContain("모든 검토 완료!");
    expect(f).toContain("Esc/q 메뉴로 돌아가기");
  });
});

describe("ReviewScreen browse-mode navigation (UX fix)", () => {
  const groupWith3Variants = {
    variantGroupId: "g1",
    product: group.product,
    creatives: [
      { id: "c1", productId: "p1", variantGroupId: "g1",
        copy: { headline: "h1", body: "b1", cta: "c1", hashtags: ["A"], variantLabel: "emotional" as const, assetLabel: "" },
        imageLocalPath: "img.jpg", status: "pending" as const, createdAt: "" },
      { id: "c2", productId: "p1", variantGroupId: "g1",
        copy: { headline: "h2", body: "b2", cta: "c2", hashtags: ["A"], variantLabel: "numerical" as const, assetLabel: "" },
        imageLocalPath: "img.jpg", status: "pending" as const, createdAt: "" },
      { id: "c3", productId: "p1", variantGroupId: "g1",
        copy: { headline: "h3", body: "b3", cta: "c3", hashtags: ["A"], variantLabel: "urgency" as const, assetLabel: "" },
        imageLocalPath: "img.jpg", status: "pending" as const, createdAt: "" },
    ],
  };

  it("down arrow navigates to next variant within current group", async () => {
    const { stdin, lastFrame } = render(React.createElement(ReviewScreen, {
      groups: [groupWith3Variants], onApprove: () => {}, onReject: () => {}, onEdit: () => {},
    }));
    await new Promise((r) => setTimeout(r, 20));
    // initial: variantIndex 0 → "▶ [1]"
    expect(lastFrame()).toContain("▶ [1] emotional");
    stdin.write("\x1b[B"); // down arrow
    await new Promise((r) => setTimeout(r, 20));
    expect(lastFrame()).toContain("▶ [2] numerical");
  });

  it("up arrow at variantIndex 0 stays at 0 (no underflow)", async () => {
    const { stdin, lastFrame } = render(React.createElement(ReviewScreen, {
      groups: [groupWith3Variants], onApprove: () => {}, onReject: () => {}, onEdit: () => {},
    }));
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x1b[A"); // up arrow
    await new Promise((r) => setTimeout(r, 20));
    expect(lastFrame()).toContain("▶ [1] emotional");
  });

  it("Enter key approves current pending variant", async () => {
    const onApprove = vi.fn();
    const { stdin } = render(React.createElement(ReviewScreen, {
      groups: [groupWith3Variants], onApprove, onReject: () => {}, onEdit: () => {},
    }));
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\r"); // Enter
    await new Promise((r) => setTimeout(r, 20));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledWith("g1", "c1");
  });

  it("renders updated help text including Enter / Tab", async () => {
    const { lastFrame } = render(React.createElement(ReviewScreen, {
      groups: [groupWith3Variants], onApprove: () => {}, onReject: () => {}, onEdit: () => {},
    }));
    await new Promise((r) => setTimeout(r, 20));
    const f = lastFrame() ?? "";
    expect(f).toContain("variant 이동");
    expect(f).toContain("Enter 승인");
    expect(f).toContain("Tab 그룹 이동");
  });
});

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ImproveScreen } from "./ImproveScreen.js";

vi.mock("../hooks/useWorkerStatus.js", () => ({ useWorkerStatus: () => ({ active: false, checkedAt: 0 }) }));
vi.mock("../hooks/useTodayStats.js", () => ({ useTodayStats: () => ({ todayCount: 0, refresh: () => {}, bump: () => {} }) }));
vi.mock("@ad-ai/core/storage.js", () => ({ listJson: async () => [] }));

describe("ImproveScreen", () => {
  it("renders 5-stage analyze icons", () => {
    const { lastFrame } = render(React.createElement(ImproveScreen, {
      progress: { message: "Claude 분석 중..." },
    }));
    const f = lastFrame() ?? "";
    expect(f).toContain("리포트 로드");
    expect(f).toContain("통계 계산");
    expect(f).toContain("Claude 분석");
    expect(f).toContain("improvements 저장");
    expect(f).toContain("winners 업데이트");
  });
});

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ScrapeScreen } from "./ScrapeScreen.js";

vi.mock("../hooks/useWorkerStatus.js", () => ({ useWorkerStatus: () => ({ active: false, checkedAt: 0 }) }));
vi.mock("../hooks/useTodayStats.js", () => ({ useTodayStats: () => ({ todayCount: 0, refresh: () => {}, bump: () => {} }) }));
vi.mock("@ad-ai/core/storage.js", () => ({ listJson: async () => [] }));

describe("ScrapeScreen", () => {
  it("renders URL prompt with generic Claude hint (no site whitelist)", () => {
    const { lastFrame } = render(React.createElement(ScrapeScreen, {
      stage: "input", inputValue: "", onSubmit: () => {}, onCancel: () => {},
    }));
    const f = lastFrame() ?? "";
    expect(f).toContain("URL");
    expect(f).toContain("Claude 파싱");
    expect(f).not.toContain("inflearn");
    expect(f).not.toContain("fastcampus");
  });
  it("renders 4-stage progress checklist during scrape", () => {
    const { lastFrame } = render(React.createElement(ScrapeScreen, {
      stage: "running", inputValue: "https://example.com",
      progress: { message: "Playwright 실행 중..." },
      onSubmit: () => {}, onCancel: () => {},
    }));
    const f = lastFrame() ?? "";
    expect(f).toContain("Playwright");
    expect(f).toContain("페이지 로드");
    expect(f).toContain("Claude 파싱");
    expect(f).toContain("제품 저장");
  });
});

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { PipelineScreen } from "./PipelineScreen.js";
import { icons } from "../theme/tokens.js";

vi.mock("../hooks/useWorkerStatus.js", () => ({ useWorkerStatus: () => ({ active: false, checkedAt: 0 }) }));
vi.mock("../hooks/useTodayStats.js", () => ({ useTodayStats: () => ({ todayCount: 0, refresh: () => {}, bump: () => {} }) }));
vi.mock("@ad-ai/core/storage.js", () => ({ listJson: async () => [] }));

describe("PipelineScreen", () => {
  it("scrape stage shows running scrape + pending generate", () => {
    const { lastFrame } = render(React.createElement(PipelineScreen, {
      progress: { message: "스크래핑 중..." },
      currentStage: "scrape",
    }));
    const f = lastFrame() ?? "";
    expect(f).toContain(icons.running);
    expect(f).toContain("[1] Scrape");
    expect(f).toContain(icons.pending);
    expect(f).toContain("[2] Generate");
    // running icon must appear before generate in the output
    const runningIdx = f.indexOf(icons.running);
    const scrapeIdx = f.indexOf("[1] Scrape");
    const pendingIdx = f.indexOf(icons.pending);
    const generateIdx = f.indexOf("[2] Generate");
    expect(runningIdx).toBeLessThan(scrapeIdx);
    expect(pendingIdx).toBeLessThan(generateIdx);
  });

  it("generate stage shows completed scrape + running generate", () => {
    const { lastFrame } = render(React.createElement(PipelineScreen, {
      progress: { message: "소재 생성 중..." },
      currentStage: "generate",
    }));
    const f = lastFrame() ?? "";
    expect(f).toContain(icons.success);
    expect(f).toContain("[1] Scrape");
    expect(f).toContain(icons.running);
    expect(f).toContain("[2] Generate");
    // success icon must appear before scrape label
    const successIdx = f.indexOf(icons.success);
    const scrapeIdx = f.indexOf("[1] Scrape");
    expect(successIdx).toBeLessThan(scrapeIdx);
  });

  it("displays progress message", () => {
    const { lastFrame } = render(React.createElement(PipelineScreen, {
      progress: { message: "test message" },
      currentStage: "scrape",
    }));
    const f = lastFrame() ?? "";
    expect(f).toContain("test message");
  });
});

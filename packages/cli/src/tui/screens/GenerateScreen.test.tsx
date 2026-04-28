import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { GenerateScreen } from "./GenerateScreen.js";
import type { RunProgress } from "../AppTypes.js";

vi.mock("../hooks/useWorkerStatus.js", () => ({ useWorkerStatus: () => ({ active: false, checkedAt: 0 }) }));
vi.mock("../hooks/useTodayStats.js", () => ({ useTodayStats: () => ({ todayCount: 5, refresh: () => {}, bump: () => {} }) }));
vi.mock("@ad-ai/core/storage.js", () => ({
  listJson: async () => [], readJson: async () => null, writeJson: async () => {},
}));

const baseProgress: RunProgress = {
  message: "",
  generate: {
    queue: ["done","running","pending"],
    currentProduct: { id: "p1", name: "AI 부트캠프" },
    tracks: {
      copy:  { status: "running", pct: 62, label: "variant 2/3" },
      image: { status: "done", pct: 100, label: "done (2.1s)" },
    },
    elapsedMs: 47_000,
  },
};

describe("GenerateScreen", () => {
  it("renders product name, queue count, 2 track labels, and elapsed", () => {
    const { lastFrame } = render(React.createElement(GenerateScreen, { progress: baseProgress }));
    const f = lastFrame() ?? "";
    expect(f).toContain("AI 부트캠프");
    expect(f).toContain("2/3");
    expect(f).toContain("카피");
    expect(f).toContain("이미지");
    expect(f).toContain("elapsed 47s");
  });
});

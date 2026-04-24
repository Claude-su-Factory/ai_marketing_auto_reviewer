import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { LaunchScreen } from "./LaunchScreen.js";

vi.mock("../hooks/useWorkerStatus.js", () => ({ useWorkerStatus: () => ({ active: false, checkedAt: 0 }) }));
vi.mock("../hooks/useTodayStats.js", () => ({ useTodayStats: () => ({ todayCount: 0, refresh: () => {}, bump: () => {} }) }));
vi.mock("@ad-ai/core/storage.js", () => ({ listJson: async () => [] }));

describe("LaunchScreen", () => {
  it("renders 4 Meta API step icons and last 3 log lines", () => {
    const { lastFrame } = render(React.createElement(LaunchScreen, {
      progress: {
        message: "POST /act/adsets → 200",
        launchLogs: [
          { ts: "14:32:04", method: "POST", path: "/act/campaigns", status: 200, refId: "c1" },
          { ts: "14:32:08", method: "POST", path: "/act/adsets",    status: 200, refId: "a1" },
        ],
      },
    }));
    const f = lastFrame() ?? "";
    expect(f).toContain("campaign");
    expect(f).toContain("adset");
    expect(f).toContain("creative");
    expect(f).toContain("ad");
    expect(f).toContain("14:32:08");
    expect(f).toContain("200");
  });
});

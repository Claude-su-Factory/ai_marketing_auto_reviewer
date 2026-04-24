import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { MonitorScreen } from "./MonitorScreen.js";

vi.mock("../hooks/useReports.js", () => ({
  useReports: () => ({
    reports: [
      { id: "r1", productId: "p1", variantLabel: "B", inlineLinkClickCtr: 0.0482, impressions: 22000, clicks: 1060, adQualityRanking: null, adEngagementRanking: null, adConversionRanking: null, campaignId: "c", variantGroupId: "g", metaAssetLabel: "m", platform: "meta", date: "2026-04-20" },
      { id: "r2", productId: "p2", variantLabel: "A", inlineLinkClickCtr: 0.0071, impressions: 9000, clicks: 64, adQualityRanking: null, adEngagementRanking: null, adConversionRanking: null, campaignId: "c", variantGroupId: "g", metaAssetLabel: "m", platform: "meta", date: "2026-04-20" },
    ],
    loading: false, lastRefreshAt: Date.now(),
  }),
}));
vi.mock("../hooks/useWorkerStatus.js", () => ({ useWorkerStatus: () => ({ active: true, checkedAt: 0 }) }));
vi.mock("../hooks/useTodayStats.js", () => ({ useTodayStats: () => ({ todayCount: 0, refresh: () => {}, bump: () => {} }) }));
vi.mock("@ad-ai/core/storage.js", () => ({ listJson: async () => [], readJson: async () => null }));

describe("MonitorScreen", () => {
  it("renders OVERVIEW, TOP, BOTTOM sections with impression/ctr/clicks", async () => {
    const { lastFrame } = render(React.createElement(MonitorScreen));
    const f = lastFrame() ?? "";
    expect(f).toContain("OVERVIEW");
    expect(f).toContain("TOP");
    expect(f).toContain("BOTTOM");
    expect(f).toContain("variants");
    expect(f).toContain("avg CTR");
    expect(f).toContain("impressions");
    expect(f).toContain("winners");
  });
});

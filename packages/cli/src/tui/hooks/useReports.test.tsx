import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { useReports } from "./useReports.js";
import { fsWatchEmitter } from "../../../../../tests/mocks/fsWatch.js";

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    watch: (path: string, cb: (ev: string, name: string) => void) => {
      const h = (name: string) => cb("change", name);
      fsWatchEmitter.on(`change:${path}`, h);
      return { close: () => fsWatchEmitter.off(`change:${path}`, h) };
    },
  };
});

vi.mock("@ad-ai/core/storage.js", () => ({
  listJson: vi.fn(async (_dir: string) => ["data/reports/2026-04-20.json"]),
  readJson: vi.fn(async (_p: string) => [{
    id: "v1", campaignId: "c1", variantGroupId: "g1", variantLabel: "A",
    metaAssetLabel: "g1::A", productId: "p1", platform: "meta", date: "2026-04-20",
    impressions: 10000, clicks: 200, inlineLinkClickCtr: 0.02,
    adQualityRanking: null, adEngagementRanking: null, adConversionRanking: null,
  }]),
}));

function Harness({ window }: { window: 7 | 14 | 30 }) {
  const { reports, loading } = useReports(window);
  return React.createElement(Text, null, loading ? "loading" : `reports:${reports.length}`);
}

describe("useReports", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it("loads reports on mount and counts them", async () => {
    const { lastFrame } = render(React.createElement(Harness, { window: 7 }));
    await vi.waitFor(() => expect(lastFrame()).toContain("reports:1"));
  });
});

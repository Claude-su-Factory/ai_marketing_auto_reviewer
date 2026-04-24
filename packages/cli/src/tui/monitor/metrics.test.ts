import { describe, it, expect } from "vitest";
import { aggregateVariantReports, sortByCtr } from "./metrics.js";
import type { VariantReport } from "@ad-ai/core/platform/types.js";

const r = (id: string, impressions: number, clicks: number, ctr: number): VariantReport => ({
  id, campaignId: "c", variantGroupId: "g", variantLabel: "A", metaAssetLabel: "m",
  productId: "p", platform: "meta", date: "2026-04-20",
  impressions, clicks, inlineLinkClickCtr: ctr,
  adQualityRanking: null, adEngagementRanking: null, adConversionRanking: null,
});

describe("aggregateVariantReports", () => {
  it("computes impression-weighted average CTR", () => {
    const out = aggregateVariantReports([r("a", 10000, 200, 0.02), r("b", 5000, 250, 0.05)]);
    expect(out.impressions).toBe(15000);
    expect(out.clicks).toBe(450);
    // (10000*0.02 + 5000*0.05) / 15000 = (200 + 250) / 15000 = 0.03
    expect(Math.abs(out.avgCtr - 0.03)).toBeLessThan(1e-9);
  });
  it("handles empty list", () => {
    const out = aggregateVariantReports([]);
    expect(out.impressions).toBe(0);
    expect(out.clicks).toBe(0);
    expect(out.avgCtr).toBe(0);
  });
});

describe("sortByCtr", () => {
  it("returns top/bottom N by CTR descending/ascending", () => {
    const xs = [r("a", 1000, 10, 0.01), r("b", 1000, 30, 0.03), r("c", 1000, 20, 0.02)];
    const sorted = sortByCtr(xs);
    expect(sorted[0].id).toBe("b");
    expect(sorted[2].id).toBe("a");
  });
});

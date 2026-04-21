import { describe, it, expect } from "vitest";
import {
  aggregateVariantReports,
  getMedianCtr,
  passesThreshold,
} from "./qualifier.js";
import type { VariantReport } from "../platform/types.js";

function mkReport(overrides: Partial<VariantReport>): VariantReport {
  return {
    id: "r1",
    campaignId: "c1",
    variantGroupId: "g1",
    variantLabel: "emotional",
    metaAssetLabel: "g1::emotional",
    productId: "p1",
    platform: "meta",
    date: "2026-04-20",
    impressions: 100,
    clicks: 2,
    inlineLinkClickCtr: 0.02,
    adQualityRanking: "AVERAGE",
    adEngagementRanking: "AVERAGE",
    adConversionRanking: "AVERAGE",
    ...overrides,
  };
}

describe("aggregateVariantReports", () => {
  it("groups rows by campaignId::variantLabel and sums impressions/clicks", () => {
    const reports = [
      mkReport({ campaignId: "c1", variantLabel: "emotional", impressions: 100, clicks: 2 }),
      mkReport({ campaignId: "c1", variantLabel: "emotional", impressions: 200, clicks: 5, date: "2026-04-21" }),
      mkReport({ campaignId: "c1", variantLabel: "numerical", impressions: 300, clicks: 4 }),
    ];
    const agg = aggregateVariantReports(reports);
    expect(agg).toHaveLength(2);
    const emo = agg.find((a) => a.variantLabel === "emotional")!;
    expect(emo.impressions).toBe(300);
    expect(emo.clicks).toBe(7);
    expect(emo.inlineLinkClickCtr).toBeCloseTo(7 / 300, 5);
  });

  it("copies ad-level ranking from the first row in each group", () => {
    const reports = [
      mkReport({ campaignId: "c1", variantLabel: "emotional", adQualityRanking: "BELOW_AVERAGE_20_30" }),
      mkReport({ campaignId: "c1", variantLabel: "emotional", adQualityRanking: "AVERAGE", date: "2026-04-21" }),
    ];
    const agg = aggregateVariantReports(reports);
    expect(agg[0].adQualityRanking).toBe("BELOW_AVERAGE_20_30");
  });

  it("returns [] for empty input", () => {
    expect(aggregateVariantReports([])).toEqual([]);
  });
});

describe("getMedianCtr", () => {
  it("returns 0.015 fallback when sample count < 10", () => {
    const reports = Array.from({ length: 5 }, () =>
      mkReport({ inlineLinkClickCtr: 0.05 }),
    );
    expect(getMedianCtr(reports)).toBe(0.015);
  });

  it("returns median for odd sample", () => {
    const ctrs = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.10, 0.11];
    const reports = ctrs.map((c) => mkReport({ inlineLinkClickCtr: c }));
    expect(getMedianCtr(reports)).toBeCloseTo(0.06, 5);
  });

  it("returns average of two middles for even sample", () => {
    const ctrs = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.10];
    const reports = ctrs.map((c) => mkReport({ inlineLinkClickCtr: c }));
    expect(getMedianCtr(reports)).toBeCloseTo((0.05 + 0.06) / 2, 5);
  });

  it("returns 0.015 fallback for empty array", () => {
    expect(getMedianCtr([])).toBe(0.015);
  });
});

describe("passesThreshold", () => {
  const medianCtr = 0.02;

  it("rejects impressions < 500", () => {
    const agg = {
      campaignId: "c1", variantLabel: "emotional", variantGroupId: "g1", productId: "p1",
      impressions: 499, clicks: 20, inlineLinkClickCtr: 0.04,
      adQualityRanking: "AVERAGE", adEngagementRanking: "AVERAGE", adConversionRanking: "AVERAGE",
    };
    expect(passesThreshold(agg, medianCtr)).toBe(false);
  });

  it("rejects when adQualityRanking is BELOW_AVERAGE_*", () => {
    const agg = {
      campaignId: "c1", variantLabel: "emotional", variantGroupId: "g1", productId: "p1",
      impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04,
      adQualityRanking: "BELOW_AVERAGE_20_30", adEngagementRanking: "AVERAGE", adConversionRanking: "AVERAGE",
    };
    expect(passesThreshold(agg, medianCtr)).toBe(false);
  });

  it("rejects when adEngagementRanking is BELOW_AVERAGE_*", () => {
    const agg = {
      campaignId: "c1", variantLabel: "emotional", variantGroupId: "g1", productId: "p1",
      impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04,
      adQualityRanking: "AVERAGE", adEngagementRanking: "BELOW_AVERAGE_35_50", adConversionRanking: "AVERAGE",
    };
    expect(passesThreshold(agg, medianCtr)).toBe(false);
  });

  it("rejects when CTR < median", () => {
    const agg = {
      campaignId: "c1", variantLabel: "emotional", variantGroupId: "g1", productId: "p1",
      impressions: 1000, clicks: 10, inlineLinkClickCtr: 0.01,
      adQualityRanking: "AVERAGE", adEngagementRanking: "AVERAGE", adConversionRanking: "AVERAGE",
    };
    expect(passesThreshold(agg, medianCtr)).toBe(false);
  });

  it("passes at boundary impressions=500 and CTR=median", () => {
    const agg = {
      campaignId: "c1", variantLabel: "emotional", variantGroupId: "g1", productId: "p1",
      impressions: 500, clicks: 10, inlineLinkClickCtr: 0.02,
      adQualityRanking: "AVERAGE", adEngagementRanking: "AVERAGE", adConversionRanking: "AVERAGE",
    };
    expect(passesThreshold(agg, medianCtr)).toBe(true);
  });
});

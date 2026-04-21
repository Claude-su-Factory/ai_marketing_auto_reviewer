import { describe, it, expect } from "vitest";
import {
  aggregateVariantReports,
  getMedianCtr,
  passesThreshold,
  shouldSkipInsert,
  qualifyWinners,
  pickBestPerVariantGroup,
} from "./qualifier.js";
import type { VariantReport } from "../platform/types.js";
import type { Creative, Product } from "../types.js";
import type { WinnerCreative, QualifyDeps, VariantAggregate } from "./types.js";

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

function mkWinnerQ(id: string, embedding: number[]): WinnerCreative {
  return {
    id, creativeId: `c-${id}`, productCategory: "course", productTags: [],
    productDescription: "d", headline: "h", body: "b", cta: "c",
    variantLabel: "emotional",
    embeddingProduct: embedding, embeddingCopy: embedding,
    qualifiedAt: "2026-04-20T00:00:00Z", impressions: 1000, inlineLinkClickCtr: 0.03,
  };
}

describe("shouldSkipInsert", () => {
  it("returns true when similar winner exists (cosine > 0.95)", () => {
    const existing = [mkWinnerQ("a", [1, 0, 0])];
    const candidate = [0.99, 0.01, 0];
    expect(shouldSkipInsert(candidate, existing)).toBe(true);
  });

  it("returns false when all existing winners are dissimilar", () => {
    const existing = [mkWinnerQ("a", [0, 1, 0]), mkWinnerQ("b", [0, 0, 1])];
    const candidate = [1, 0, 0];
    expect(shouldSkipInsert(candidate, existing)).toBe(false);
  });

  it("returns false for empty existing list", () => {
    expect(shouldSkipInsert([1, 0, 0], [])).toBe(false);
  });
});

function mkCreative(id: string, variantGroupId = "g1", variantLabel: Creative["copy"]["variantLabel"] = "emotional"): Creative {
  return {
    id, productId: "p1", variantGroupId,
    copy: {
      headline: `h-${id}`, body: `b-${id}`, cta: "SHOP_NOW",
      hashtags: ["tag"], variantLabel, metaAssetLabel: `${variantGroupId}::${variantLabel}`,
    },
    imageLocalPath: "/tmp/a.jpg", videoLocalPath: "/tmp/a.mp4",
    status: "approved", createdAt: "2026-04-20T00:00:00Z",
  };
}

function mkProd(id = "p1"): Product {
  return {
    id, name: "Test", description: "product description here",
    currency: "KRW", targetUrl: "https://example.com",
    tags: ["tag"], inputMethod: "manual", createdAt: "2026-04-20T00:00:00Z",
    category: "course",
  };
}

describe("qualifyWinners", () => {
  it("inserts threshold-passing variants into store with both embeddings", async () => {
    const reports = [
      mkReport({ variantGroupId: "g1", campaignId: "c1", variantLabel: "emotional", impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04 }),
      mkReport({ variantGroupId: "g2", campaignId: "c2", variantLabel: "numerical", impressions: 1000, clicks: 5, inlineLinkClickCtr: 0.005 }),
    ];
    const inserted: WinnerCreative[] = [];
    const deps: QualifyDeps = {
      findCreativeByVariant: async (gid, label) => {
        if (gid === "g1" && label === "emotional") return mkCreative("cr-g1-emo", "g1", "emotional");
        if (gid === "g2" && label === "numerical") return mkCreative("cr-g2-num", "g2", "numerical");
        return null;
      },
      loadProduct: async () => mkProd(),
      embed: async (texts) => texts.map((_, i) => Array.from({ length: 512 }, () => (i + 1) * 0.01)),
      store: {
        hasCreative: () => false,
        loadAll: () => [],
        insert: (w) => inserted.push(w),
      },
    };

    const res = await qualifyWinners(reports, deps);
    expect(res.inserted).toBe(1);
    expect(res.skipped).toBe(1);
    expect(inserted[0].variantLabel).toBe("emotional");
    expect(inserted[0].embeddingProduct).toHaveLength(512);
    expect(inserted[0].embeddingCopy).toHaveLength(512);
  });

  it("skips variants that already exist in store", async () => {
    const reports = [
      mkReport({ variantGroupId: "g1", campaignId: "c1", variantLabel: "emotional", impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04 }),
    ];
    const inserted: WinnerCreative[] = [];
    const deps: QualifyDeps = {
      findCreativeByVariant: async () => mkCreative("cr-g1-emo", "g1", "emotional"),
      loadProduct: async () => mkProd(),
      embed: async (texts) => texts.map(() => Array.from({ length: 512 }, () => 0.5)),
      store: {
        hasCreative: () => true,
        loadAll: () => [],
        insert: (w) => inserted.push(w),
      },
    };
    const res = await qualifyWinners(reports, deps);
    expect(res.skipped).toBe(1);
    expect(inserted).toHaveLength(0);
  });

  it("skips variants whose embedding is near-duplicate of existing", async () => {
    const existing: WinnerCreative[] = [{
      id: "w0", creativeId: "old", productCategory: "course", productTags: [],
      productDescription: "x", headline: "h", body: "b", cta: "c", variantLabel: "emotional",
      embeddingProduct: Array.from({ length: 512 }, () => 1),
      embeddingCopy: Array.from({ length: 512 }, () => 1),
      qualifiedAt: "2026-04-20T00:00:00Z", impressions: 1000, inlineLinkClickCtr: 0.04,
    }];
    const reports = [
      mkReport({ variantGroupId: "g1", campaignId: "c1", variantLabel: "emotional", impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04 }),
    ];
    const deps: QualifyDeps = {
      findCreativeByVariant: async () => mkCreative("cr-g1-emo", "g1", "emotional"),
      loadProduct: async () => mkProd(),
      embed: async (texts) => texts.map(() => Array.from({ length: 512 }, () => 1.0001)),
      store: {
        hasCreative: () => false,
        loadAll: () => existing,
        insert: () => { throw new Error("should not be called"); },
      },
    };
    const res = await qualifyWinners(reports, deps);
    expect(res.skipped).toBe(1);
    expect(res.inserted).toBe(0);
  });

  it("skips variants when findCreativeByVariant returns null", async () => {
    const reports = [
      mkReport({ variantGroupId: "g1", campaignId: "c1", variantLabel: "emotional", impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04 }),
    ];
    const inserted: WinnerCreative[] = [];
    const deps: QualifyDeps = {
      findCreativeByVariant: async () => null,
      loadProduct: async () => mkProd(),
      embed: async (texts) => texts.map(() => Array.from({ length: 512 }, () => 0.5)),
      store: {
        hasCreative: () => false,
        loadAll: () => [],
        insert: (w) => inserted.push(w),
      },
    };
    const res = await qualifyWinners(reports, deps);
    expect(res.skipped).toBe(1);
    expect(res.inserted).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it("Q1: filters below-threshold aggs before grouping", async () => {
    const reports = [
      mkReport({ variantGroupId: "g1", campaignId: "c1", variantLabel: "emotional", impressions: 300, clicks: 14, inlineLinkClickCtr: 0.048 }),
      mkReport({ variantGroupId: "g1", campaignId: "c2", variantLabel: "numerical", impressions: 800, clicks: 34, inlineLinkClickCtr: 0.043 }),
      mkReport({ variantGroupId: "g1", campaignId: "c3", variantLabel: "urgency", impressions: 900, clicks: 36, inlineLinkClickCtr: 0.04 }),
    ];
    const inserted: WinnerCreative[] = [];
    const deps: QualifyDeps = {
      findCreativeByVariant: async (_gid, label) => mkCreative(`cr-${label}`, "g1", label as Creative["copy"]["variantLabel"]),
      loadProduct: async () => mkProd(),
      embed: async (texts) => texts.map((_, i) => Array.from({ length: 512 }, () => (i + 1) * 0.01)),
      store: {
        hasCreative: () => false,
        loadAll: () => [],
        insert: (w) => inserted.push(w),
      },
    };
    const res = await qualifyWinners(reports, deps);
    expect(res.inserted).toBe(1);
    expect(inserted[0].variantLabel).toBe("numerical");
  });

  it("Q2: sibling chosen when best CTR variant fails threshold", async () => {
    const reports = [
      mkReport({ variantGroupId: "g1", campaignId: "c1", variantLabel: "emotional", impressions: 300, clicks: 15, inlineLinkClickCtr: 0.05 }),
      mkReport({ variantGroupId: "g1", campaignId: "c2", variantLabel: "numerical", impressions: 800, clicks: 24, inlineLinkClickCtr: 0.03 }),
    ];
    const inserted: WinnerCreative[] = [];
    const deps: QualifyDeps = {
      findCreativeByVariant: async (_gid, label) => mkCreative(`cr-${label}`, "g1", label as Creative["copy"]["variantLabel"]),
      loadProduct: async () => mkProd(),
      embed: async (texts) => texts.map((_, i) => Array.from({ length: 512 }, () => (i + 1) * 0.01)),
      store: {
        hasCreative: () => false,
        loadAll: () => [],
        insert: (w) => inserted.push(w),
      },
    };
    const res = await qualifyWinners(reports, deps);
    expect(res.inserted).toBe(1);
    expect(inserted[0].variantLabel).toBe("numerical");
  });
});

function mkAgg(overrides: Partial<VariantAggregate>): VariantAggregate {
  return {
    campaignId: "c1",
    variantLabel: "emotional",
    variantGroupId: "g1",
    productId: "p1",
    impressions: 1000,
    clicks: 50,
    inlineLinkClickCtr: 0.05,
    adQualityRanking: "AVERAGE",
    adEngagementRanking: "AVERAGE",
    adConversionRanking: "AVERAGE",
    ...overrides,
  };
}

describe("pickBestPerVariantGroup", () => {
  it("P1: returns [] for empty input", () => {
    expect(pickBestPerVariantGroup([])).toEqual([]);
  });

  it("P2: picks best CTR per variantGroupId", () => {
    const aggs = [
      mkAgg({ variantGroupId: "g1", variantLabel: "emotional", inlineLinkClickCtr: 0.03 }),
      mkAgg({ variantGroupId: "g1", variantLabel: "numerical", inlineLinkClickCtr: 0.05 }),
      mkAgg({ variantGroupId: "g2", variantLabel: "urgency", inlineLinkClickCtr: 0.04 }),
    ];
    const result = pickBestPerVariantGroup(aggs);
    expect(result).toHaveLength(2);
    const g1 = result.find((a) => a.variantGroupId === "g1")!;
    const g2 = result.find((a) => a.variantGroupId === "g2")!;
    expect(g1.variantLabel).toBe("numerical");
    expect(g2.variantLabel).toBe("urgency");
  });

  it("P3: tie-break — ctr tie resolved by impressions desc", () => {
    const aggs = [
      mkAgg({ variantGroupId: "g1", variantLabel: "emotional", inlineLinkClickCtr: 0.05, impressions: 100 }),
      mkAgg({ variantGroupId: "g1", variantLabel: "numerical", inlineLinkClickCtr: 0.05, impressions: 200 }),
    ];
    const result = pickBestPerVariantGroup(aggs);
    expect(result).toHaveLength(1);
    expect(result[0].variantLabel).toBe("numerical");
  });

  it("P4: tie-break — ctr and impressions tie resolved by variantLabel lex asc", () => {
    const aggs = [
      mkAgg({ variantGroupId: "g1", variantLabel: "numerical", inlineLinkClickCtr: 0.05, impressions: 100 }),
      mkAgg({ variantGroupId: "g1", variantLabel: "emotional", inlineLinkClickCtr: 0.05, impressions: 100 }),
    ];
    const result = pickBestPerVariantGroup(aggs);
    expect(result).toHaveLength(1);
    expect(result[0].variantLabel).toBe("emotional");
  });
});

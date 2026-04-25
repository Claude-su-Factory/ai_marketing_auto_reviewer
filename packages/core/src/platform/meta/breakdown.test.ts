import { describe, it, expect } from "vitest";
import { parseBodyAssetBreakdown } from "./breakdown.js";
import type { Creative } from "../../types.js";

const mockCreative = (label: "emotional" | "numerical", body: string, hashtags: string[] = []): Creative => ({
  id: `c-${label}`,
  productId: "p1",
  variantGroupId: "g1",
  copy: {
    headline: "H", body, cta: "LEARN_MORE", hashtags,
    variantLabel: label,
    assetLabel: `variant-${label}-uuid`,
  },
  imageLocalPath: "", videoLocalPath: "",
  status: "approved", createdAt: "2026-04-20T00:00:00.000Z",
});

const mockMetaRow = (overrides: object) => ({
  body_asset: { id: "asset-1", text: "body-emotional" },
  impressions: "1000", clicks: "42", inline_link_click_ctr: "4.2",
  quality_ranking: "AVERAGE", engagement_rate_ranking: "ABOVE_AVERAGE",
  conversion_rate_ranking: "UNKNOWN",
  ...overrides,
});

describe("parseBodyAssetBreakdown", () => {
  it("maps a row to VariantReport via body text match (exact)", () => {
    const creatives = [mockCreative("emotional", "body-emotional"), mockCreative("numerical", "body-numerical")];
    const reports = parseBodyAssetBreakdown({
      rows: [mockMetaRow({})],
      creatives,
      campaignId: "cam1",
      productId: "p1",
      platform: "meta",
      date: "2026-04-19",
    });

    expect(reports).toHaveLength(1);
    expect(reports[0].variantLabel).toBe("emotional");
    expect(reports[0].assetLabel).toBe("variant-emotional-uuid");
    expect(reports[0].impressions).toBe(1000);
    expect(reports[0].inlineLinkClickCtr).toBe(4.2);
    expect(reports[0].platformMetrics.meta?.qualityRanking).toBe("AVERAGE");
    expect(reports[0].id).toBe("cam1::emotional::2026-04-19");
  });

  it("matches body + hashtags (appended form)", () => {
    const creatives = [mockCreative("emotional", "body-emotional", ["ad", "promo"])];
    const rowWithHashtags = mockMetaRow({
      body_asset: { id: "a-1", text: "body-emotional\n\n#ad #promo" },
    });
    const reports = parseBodyAssetBreakdown({
      rows: [rowWithHashtags],
      creatives,
      campaignId: "cam1",
      productId: "p1",
      platform: "meta",
      date: "2026-04-19",
    });
    expect(reports).toHaveLength(1);
    expect(reports[0].variantLabel).toBe("emotional");
  });

  it("normalizes whitespace and CRLF when comparing", () => {
    const creatives = [mockCreative("emotional", "body-emotional")];
    const rowWithCrlf = mockMetaRow({
      body_asset: { id: "a-1", text: "  body-emotional\r\n" },
    });
    const reports = parseBodyAssetBreakdown({
      rows: [rowWithCrlf],
      creatives,
      campaignId: "cam1",
      productId: "p1",
      platform: "meta",
      date: "2026-04-19",
    });
    expect(reports).toHaveLength(1);
    expect(reports[0].variantLabel).toBe("emotional");
  });

  it("skips rows that match no creative body", () => {
    const creatives = [mockCreative("emotional", "body-emotional")];
    const rogueRow = mockMetaRow({
      body_asset: { id: "asset-x", text: "totally-unrelated-copy" },
    });
    const reports = parseBodyAssetBreakdown({
      rows: [rogueRow],
      creatives,
      campaignId: "cam1",
      productId: "p1",
      platform: "meta",
      date: "2026-04-19",
    });
    expect(reports).toEqual([]);
  });

  it("copies ad-level ranking fields to every row", () => {
    const creatives = [mockCreative("emotional", "body-emotional"), mockCreative("numerical", "body-numerical")];
    const rows = [
      mockMetaRow({ body_asset: { id: "1", text: "body-emotional" } }),
      mockMetaRow({ body_asset: { id: "2", text: "body-numerical" } }),
    ];
    const reports = parseBodyAssetBreakdown({
      rows, creatives, campaignId: "cam1", productId: "p1", platform: "meta", date: "2026-04-19",
    });
    expect(reports).toHaveLength(2);
    expect(reports[0].platformMetrics.meta?.qualityRanking).toBe("AVERAGE");
    expect(reports[1].platformMetrics.meta?.qualityRanking).toBe("AVERAGE");
  });
});

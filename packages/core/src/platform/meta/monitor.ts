import bizSdk from "facebook-nodejs-business-sdk";
import type { Creative } from "../../types.js";
import type { VariantReport } from "../types.js";
import { readJson, listJson, writeJson } from "../../storage.js";
import { parseBodyAssetBreakdown } from "./breakdown.js";
import { requireMeta } from "../../config/helpers.js";

const { Ad } = bizSdk as any;

export type MetaErrorClass = "externally_modified" | "transient";

export function classifyMetaError(err: unknown): MetaErrorClass {
  const anyErr = err as any;
  // SDK FacebookRequestError: status at top-level, already-extracted body at err.response.
  // Axios-style (defensive fallback): response.status / response.data.error.code.
  const status = anyErr?.status ?? anyErr?.response?.status;
  const code = anyErr?.response?.code ?? anyErr?.response?.data?.error?.code;
  if (status === 404 || status === 403) return "externally_modified";
  if (code === 100 || code === 803) return "externally_modified";
  return "transient";
}

async function loadCreativesForGroup(variantGroupId: string): Promise<Creative[]> {
  const paths = await listJson("data/creatives");
  const result: Creative[] = [];
  for (const p of paths) {
    const c = await readJson<Creative>(p);
    if (c && c.variantGroupId === variantGroupId) result.push(c);
  }
  return result;
}

export async function fetchMetaVariantReports(
  campaignId: string,
  date: string,
): Promise<VariantReport[]> {
  (bizSdk as any).FacebookAdsApi.init(requireMeta().access_token);

  const campaign = await readJson<any>(`data/campaigns/${campaignId}.json`);
  if (!campaign) return [];

  const creatives = await loadCreativesForGroup(campaign.variantGroupId);
  const adId = campaign.externalIds?.ad;
  if (!adId) {
    // Campaign without ad ID — either launch_failed (rollback ran) or externally modified
    // with corrupted record. Match pre-refactor 404 path behavior: mark externally_modified.
    if (campaign.status !== "externally_modified") {
      campaign.status = "externally_modified";
      await writeJson(`data/campaigns/${campaignId}.json`, campaign);
      console.warn(`[meta/monitor] campaign ${campaignId} has no externalIds.ad — marked externally_modified`);
    }
    return [];
  }
  const ad = new Ad(adId);

  try {
    const insights = await ad.getInsights(
      [
        "impressions",
        "clicks",
        "inline_link_click_ctr",
        "quality_ranking",
        "engagement_rate_ranking",
        "conversion_rate_ranking",
      ],
      {
        time_range: { since: date, until: date },
        breakdowns: ["body_asset"],
      },
    );

    const rows = Array.isArray(insights) ? insights.map((r: any) => r._data ?? r) : [];
    return parseBodyAssetBreakdown({
      rows,
      creatives,
      campaignId: campaign.id,
      productId: campaign.productId,
      platform: "meta",
      date,
    });
  } catch (err) {
    const cls = classifyMetaError(err);
    if (cls === "externally_modified") {
      campaign.status = "externally_modified";
      await writeJson(`data/campaigns/${campaignId}.json`, campaign);
      console.warn(`[meta/monitor] campaign ${campaignId} marked externally_modified`);
    } else {
      console.error(`[meta/monitor] transient error on ${campaignId}:`, err);
    }
    return [];
  }
}

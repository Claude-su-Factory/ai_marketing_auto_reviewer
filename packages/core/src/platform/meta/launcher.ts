import bizSdk from "facebook-nodejs-business-sdk";
import { readFile } from "fs/promises";
import { randomUUID } from "crypto";
import type { Product } from "../../types.js";
import type { VariantGroup, LaunchResult, LaunchLog } from "../types.js";
import { assembleAssetFeedSpec } from "./assetFeedSpec.js";
import { executeRollback, appendOrphansToDisk, type CreatedResource } from "./rollback.js";
import { readJson, writeJson } from "../../storage.js";
import { getConfig } from "../../config/index.js";
import { requireMeta } from "../../config/helpers.js";

const { AdAccount } = bizSdk as any;

export function buildCampaignName(product: Product): string {
  const date = new Date().toISOString().split("T")[0];
  return `[AD-AI] ${product.name} - ${date}`;
}

export function buildAdSetTargeting() {
  const cfg = getConfig();
  return {
    age_min: cfg.defaults.target_age_min,
    age_max: cfg.defaults.target_age_max,
    geo_locations: { countries: ["KR"] },
    publisher_platforms: ["instagram"],
    instagram_positions: ["stream", "story", "reels"],
  };
}

export function buildAdConfig() {
  const cfg = getConfig();
  return {
    dailyBudgetKRW: cfg.defaults.daily_budget_krw,
    durationDays: cfg.defaults.duration_days,
    objective: "OUTCOME_SALES",
    optimizationGoal: "LINK_CLICKS",
    billingEvent: "IMPRESSIONS",
  };
}

function initMeta() {
  const meta = requireMeta();
  (bizSdk as any).FacebookAdsApi.init(meta.access_token);
  return new AdAccount(meta.ad_account_id);
}

async function uploadImage(account: any, imagePath: string): Promise<string> {
  const imageData = await readFile(imagePath);
  const hash = await account.createAdImage([], {
    bytes: imageData.toString("base64"),
  });
  return hash.hash as string;
}

async function uploadVideo(account: any, videoPath: string): Promise<string> {
  const videoBuffer = await readFile(videoPath);
  const video = await account.createAdVideo([], {
    source: videoBuffer,
    title: "Ad Video",
  });
  return video.id as string;
}

async function deleteMetaResource(
  _type: "campaign" | "adset" | "ad" | "creative",
  id: string,
): Promise<void> {
  // Meta SDK uses uniform DELETE-by-ID syntax; type is kept for caller-side documentation only.
  // Semantics differ: campaign/adset/ad transition to DELETED status; creative is hard-deleted.
  const api = (bizSdk as any).FacebookAdsApi.getDefaultApi();
  await api.call("DELETE", [id]);
}

export async function launchMetaDco(group: VariantGroup, onLog?: (log: LaunchLog) => void): Promise<LaunchResult> {
  const config = buildAdConfig();
  const account = initMeta();
  const created: CreatedResource[] = [];

  try {
    // 1. Campaign
    const campaign = await account.createCampaign([], {
      name: buildCampaignName(group.product),
      objective: config.objective,
      status: "PAUSED",
      special_ad_categories: [],
    });
    created.push({ type: "campaign", id: campaign.id });
    // onLog paths are symbolic (no account_id substitution) — used only for TUI display and the 4-step regex match in LaunchScreen.
    onLog?.({ ts: new Date().toISOString(), method: "POST", path: "/act/campaigns", status: 200, refId: campaign.id });

    // 2. AdSet
    const startTime = new Date().toISOString();
    const endTime = new Date(Date.now() + config.durationDays * 86400000).toISOString();
    const adSet = await account.createAdSet([], {
      name: `${group.product.name} - Ad Set`,
      campaign_id: campaign.id,
      daily_budget: config.dailyBudgetKRW,
      targeting: buildAdSetTargeting(),
      optimization_goal: config.optimizationGoal,
      billing_event: config.billingEvent,
      start_time: startTime,
      end_time: endTime,
      status: "PAUSED",
    });
    created.push({ type: "adset", id: adSet.id });
    onLog?.({ ts: new Date().toISOString(), method: "POST", path: "/act/adsets", status: 200, refId: adSet.id });

    // 3. Upload assets (image + video)
    const imageHash = await uploadImage(account, group.assets.image);
    onLog?.({ ts: new Date().toISOString(), method: "POST", path: "/act/adimages", status: 200, refId: imageHash });
    const videoId = await uploadVideo(account, group.assets.video);
    onLog?.({ ts: new Date().toISOString(), method: "POST", path: "/act/advideos", status: 200, refId: videoId });

    // 4. Assemble asset_feed_spec
    const assetFeedSpec = assembleAssetFeedSpec({
      product: group.product,
      creatives: group.creatives,
      imageHash,
      videoId,
    });

    // 5. Create DCO ad creative
    const meta = requireMeta();
    const adCreative = await account.createAdCreative([], {
      name: `${group.product.name} - DCO Creative`,
      object_story_spec: {
        page_id: meta.page_id,
        instagram_actor_id: meta.instagram_actor_id,
      },
      asset_feed_spec: assetFeedSpec,
    });
    created.push({ type: "creative", id: adCreative.id });
    onLog?.({ ts: new Date().toISOString(), method: "POST", path: "/act/adcreatives", status: 200, refId: adCreative.id });

    // 6. Create DCO ad (1 ad per group)
    const ad = await account.createAd([], {
      name: `${group.product.name} - DCO Ad`,
      adset_id: adSet.id,
      creative: { creative_id: adCreative.id },
      status: "PAUSED",
    });
    created.push({ type: "ad", id: ad.id });
    onLog?.({ ts: new Date().toISOString(), method: "POST", path: "/act/ads", status: 200, refId: ad.id });

    // 7. Persist Campaign record
    const campaignRecord = {
      id: randomUUID(),
      variantGroupId: group.variantGroupId,
      productId: group.product.id,
      platform: "meta" as const,
      metaCampaignId: campaign.id as string,
      metaAdSetId: adSet.id as string,
      metaAdId: ad.id as string,
      metaAdCreativeId: adCreative.id as string,
      launchedAt: new Date().toISOString(),
      status: "paused" as const,
      orphans: [],
    };
    await writeJson(`data/campaigns/${campaignRecord.id}.json`, campaignRecord);

    return {
      campaignId: campaignRecord.id,
      platform: "meta",
      externalIds: {
        campaign: campaign.id,
        adSet: adSet.id,
        ad: ad.id,
      },
    };
  } catch (err) {
    console.error("[meta/launcher] launch failed; rolling back:", err);
    const cleanupResult = await executeRollback({
      created,
      deleter: deleteMetaResource,
    });

    // Persist a launch_failed Campaign record so operators can audit orphans.
    const idOf = (t: CreatedResource["type"]): string =>
      created.find((r) => r.type === t)?.id ?? "";
    const failedRecord = {
      id: randomUUID(),
      variantGroupId: group.variantGroupId,
      productId: group.product.id,
      platform: "meta" as const,
      metaCampaignId: idOf("campaign"),
      metaAdSetId: idOf("adset"),
      metaAdId: idOf("ad"),
      metaAdCreativeId: idOf("creative"),
      launchedAt: new Date().toISOString(),
      status: "launch_failed" as const,
      orphans: cleanupResult.orphans,
    };
    await writeJson(`data/campaigns/${failedRecord.id}.json`, failedRecord);

    await appendOrphansToDisk(cleanupResult.orphans, writeJson, readJson);
    throw err;
  }
}

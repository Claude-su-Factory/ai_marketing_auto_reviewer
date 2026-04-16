import bizSdk from "facebook-nodejs-business-sdk";
import { readFile } from "fs/promises";
import type { Course, Creative, Campaign } from "../types.js";
import { writeJson } from "../storage.js";
import { randomUUID } from "crypto";

const { AdAccount } = bizSdk as any;

export function buildCampaignName(course: Course): string {
  const date = new Date().toISOString().split("T")[0];
  return `[AD-AI] ${course.title} - ${date}`;
}

export function buildAdSetTargeting() {
  return {
    age_min: Number(process.env.AD_TARGET_AGE_MIN ?? 20),
    age_max: Number(process.env.AD_TARGET_AGE_MAX ?? 45),
    geo_locations: { countries: ["KR"] },
    publisher_platforms: ["instagram"],
    instagram_positions: ["stream", "story", "reels"],
  };
}

export function buildAdConfig() {
  return {
    dailyBudgetKRW: Number(process.env.AD_DAILY_BUDGET_KRW ?? 10000),
    durationDays: Number(process.env.AD_DURATION_DAYS ?? 14),
    objective: "OUTCOME_SALES",
    optimizationGoal: "LINK_CLICKS",
    billingEvent: "IMPRESSIONS",
  };
}

function initMeta() {
  (bizSdk as any).FacebookAdsApi.init(process.env.META_ACCESS_TOKEN!);
  return new AdAccount(process.env.META_AD_ACCOUNT_ID!);
}

async function uploadImage(account: any, imagePath: string) {
  const imageData = await readFile(imagePath);
  const hash = await account.createAdImage([], {
    bytes: imageData.toString("base64"),
  });
  return hash.hash as string;
}

async function uploadVideo(account: any, videoPath: string) {
  const videoBuffer = await readFile(videoPath);
  const video = await account.createAdVideo([], {
    source: videoBuffer,
    title: "Ad Video",
  });
  return video.id as string;
}

export async function launchCampaign(
  course: Course,
  creative: Creative
): Promise<Campaign> {
  const config = buildAdConfig();
  const account = initMeta();

  // 1. 캠페인 생성
  const campaign = await account.createCampaign([], {
    name: buildCampaignName(course),
    objective: config.objective,
    status: "PAUSED",
    special_ad_categories: [],
  });

  // 2. 광고 세트 생성
  const startTime = new Date().toISOString();
  const endTime = new Date(
    Date.now() + config.durationDays * 86400000
  ).toISOString();

  const adSet = await account.createAdSet([], {
    name: `${course.title} - Ad Set`,
    campaign_id: campaign.id,
    daily_budget: config.dailyBudgetKRW,
    targeting: buildAdSetTargeting(),
    optimization_goal: config.optimizationGoal,
    billing_event: config.billingEvent,
    start_time: startTime,
    end_time: endTime,
    status: "PAUSED",
  });

  const adIds: string[] = [];

  // 3a. 이미지 광고 생성
  const imageHash = await uploadImage(account, creative.imageLocalPath);
  const imageCreative = await account.createAdCreative([], {
    name: `${course.title} - Image Creative`,
    object_story_spec: {
      page_id: process.env.META_PAGE_ID!,
      instagram_actor_id: process.env.META_INSTAGRAM_ACTOR_ID!,
      link_data: {
        image_hash: imageHash,
        link: course.url,
        message: `${creative.copy.body}\n\n${creative.copy.hashtags.join(" ")}`,
        call_to_action: { type: "LEARN_MORE", value: { link: course.url } },
      },
    },
  });

  const imageAd = await account.createAd([], {
    name: `${course.title} - Image Ad`,
    adset_id: adSet.id,
    creative: { creative_id: imageCreative.id },
    status: "PAUSED",
  });
  adIds.push(imageAd.id as string);

  // 3b. 영상 광고 생성
  const videoId = await uploadVideo(account, creative.videoLocalPath);
  const videoCreative = await account.createAdCreative([], {
    name: `${course.title} - Video Creative`,
    object_story_spec: {
      page_id: process.env.META_PAGE_ID!,
      instagram_actor_id: process.env.META_INSTAGRAM_ACTOR_ID!,
      video_data: {
        video_id: videoId,
        message: `${creative.copy.body}\n\n${creative.copy.hashtags.join(" ")}`,
        call_to_action: { type: "LEARN_MORE", value: { link: course.url } },
        title: creative.copy.headline,
      },
    },
  });

  const videoAd = await account.createAd([], {
    name: `${course.title} - Video Ad`,
    adset_id: adSet.id,
    creative: { creative_id: videoCreative.id },
    status: "PAUSED",
  });
  adIds.push(videoAd.id as string);

  const campaignRecord: Campaign = {
    id: randomUUID(),
    creativeId: creative.id,
    courseId: course.id,
    metaCampaignId: campaign.id as string,
    metaAdSetId: adSet.id as string,
    metaAdIds: adIds,
    launchedAt: new Date().toISOString(),
    status: "paused", // Created as PAUSED in Meta — activate manually in Ads Manager, then update to "active"
  };

  await writeJson(`data/campaigns/${campaignRecord.id}.json`, campaignRecord);
  return campaignRecord;
}

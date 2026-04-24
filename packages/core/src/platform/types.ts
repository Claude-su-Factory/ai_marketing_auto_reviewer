import type { Product, Creative } from "../types.js";

export interface VariantGroup {
  variantGroupId: string;
  product: Product;
  creatives: Creative[];
  assets: { image: string; video: string };
}

export interface LaunchResult {
  campaignId: string;
  platform: string;
  externalIds: {
    campaign: string;
    adSet: string;
    ad: string;
  };
}

export interface CleanupResult {
  deleted: string[];
  orphans: { type: "campaign" | "adset" | "ad" | "creative"; id: string }[];
}

export interface VariantReport {
  id: string;
  campaignId: string;
  variantGroupId: string;
  variantLabel: string;
  metaAssetLabel: string;
  productId: string;
  platform: string;
  date: string;
  impressions: number;
  clicks: number;
  inlineLinkClickCtr: number;
  adQualityRanking: string | null;
  adEngagementRanking: string | null;
  adConversionRanking: string | null;
}

export interface LaunchLog {
  ts: string;
  method: string;
  path: string;
  status: number;
  refId?: string;
}

export interface AdPlatform {
  name: string;
  launch(group: VariantGroup, onLog?: (log: LaunchLog) => void): Promise<LaunchResult>;
  fetchReports(campaignId: string, date: string): Promise<VariantReport[]>;
  cleanup(campaignId: string): Promise<CleanupResult>;
}

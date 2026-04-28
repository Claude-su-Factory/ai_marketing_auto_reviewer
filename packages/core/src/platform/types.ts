import type { Product, Creative } from "../types.js";

export interface VariantGroup {
  variantGroupId: string;
  product: Product;
  creatives: Creative[];
  assets: { image: string };
}

export interface LaunchResult {
  campaignId: string;
  platform: string;
  /**
   * 플랫폼이 정의하는 외부 리소스 ID 맵.
   * 약속된 well-known 키: "campaign", "ad" (모든 플랫폼이 채움).
   * 그 외는 플랫폼별:
   *   Meta: "adSet", "creative"
   *   TikTok: "adGroup"
   *   Google: "adGroup", "asset"
   */
  externalIds: Record<string, string>;
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
  assetLabel: string;
  productId: string;
  platform: string;
  date: string;
  impressions: number;
  clicks: number;
  inlineLinkClickCtr: number;
  /**
   * 플랫폼 고유 지표. 키는 platform 식별자.
   * Meta: { qualityRanking, engagementRanking, conversionRanking } (각 string|null,
   *       e.g., "AVERAGE", "BELOW_AVERAGE_20_30", "ABOVE_AVERAGE", "UNKNOWN")
   * TikTok/Google: 실 통합 시 정의.
   */
  platformMetrics: {
    meta?: {
      qualityRanking: string | null;
      engagementRanking: string | null;
      conversionRanking: string | null;
    };
    tiktok?: Record<string, unknown>;
    google?: Record<string, unknown>;
  };
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

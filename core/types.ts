export interface Product {
  id: string;
  name: string;
  description: string;
  price?: number;
  currency: string;          // KRW, USD 등
  imageUrl?: string;
  targetUrl: string;         // 광고 클릭 시 이동할 URL
  category?: string;         // course | app | ecommerce | service | other
  tags: string[];
  inputMethod: "scraped" | "manual";
  createdAt: string;
}

export interface Creative {
  id: string;
  productId: string;
  variantGroupId: string;                   // Plan A 신규 — 같은 제품의 variant 공유 ID
  copy: {
    headline: string;
    body: string;
    cta: string;
    hashtags: string[];
    variantLabel: "emotional" | "numerical" | "urgency"; // Plan A 신규 (Plan A는 "emotional" 기본값)
    metaAssetLabel: string;                 // Plan A 신규 — e.g. "variant-<uuid>"
  };
  imageLocalPath: string;
  videoLocalPath: string;
  status: "pending" | "approved" | "rejected" | "edited";
  reviewNote?: string;
  createdAt: string;
}

export interface Campaign {
  id: string;
  variantGroupId: string;                   // Plan A 신규 — creativeId 대체
  productId: string;
  platform: string;                         // Plan A 신규 — "meta"
  metaCampaignId: string;
  metaAdSetId: string;
  metaAdId: string;                         // Plan A 신규 — DCO Ad 1개 (기존 metaAdIds[] 폐기)
  metaAdCreativeId?: string;                // Plan A review fix — for cleanup rollback
  launchedAt: string;
  status: "active" | "paused" | "completed" | "launch_failed" | "externally_modified";
  orphans: { type: "campaign" | "adset" | "ad" | "creative"; id: string }[];
}

export interface Report {
  id: string;
  campaignId: string;
  productId: string;
  date: string;
  impressions: number;
  clicks: number;
  ctr: number;
  /** Ad spend in KRW (Korean Won, whole units). Meta returns this as-is for KRW accounts. */
  spend: number;
  /** Cost per click in KRW (Korean Won, whole units). */
  cpc: number;
  reach: number;
  frequency: number;
}

export interface ImprovementChange {
  file: string;
  type: "prompt_update" | "param_update" | "bug_fix";
  before: string;
  after: string;
}

export interface Improvement {
  date: string;
  trigger: string;
  changes: ImprovementChange[];
}

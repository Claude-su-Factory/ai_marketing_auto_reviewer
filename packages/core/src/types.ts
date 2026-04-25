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
    /** 변형 식별자. Meta DCO에서 `asset_feed_spec.bodies/titles[].adlabels.name`으로 사용되어
     *  per-asset insights breakdown 키가 됨. 다른 플랫폼은 실 통합 시 사용처를 매핑한다. */
    assetLabel: string;
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
  /**
   * 플랫폼별 외부 리소스 ID 맵.
   * Meta success: { campaign, adSet, ad, creative } — 모두 채워짐.
   * Meta launch_failed: rollback 시점에 생성된 리소스만 (예: { campaign } 만 있을 수 있음).
   * TikTok / Google: 실 통합 시 정의.
   */
  externalIds: Record<string, string>;
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

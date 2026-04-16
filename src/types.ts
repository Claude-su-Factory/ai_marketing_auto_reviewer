export interface Course {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  url: string;
  platform: "inflearn" | "class101" | "other";
  price: number;
  tags: string[];
  scrapedAt: string;
}

export interface Creative {
  id: string;
  courseId: string;
  copy: {
    headline: string;
    body: string;
    cta: string;
    hashtags: string[];
  };
  imageLocalPath: string;
  videoLocalPath: string;
  status: "pending" | "approved" | "rejected" | "edited";
  reviewNote?: string;
  createdAt: string;
}

export interface Campaign {
  id: string;
  creativeId: string;
  courseId: string;
  metaCampaignId: string;
  metaAdSetId: string;
  metaAdIds: string[];
  launchedAt: string;
  status: "active" | "paused" | "completed";
}

export interface Report {
  id: string;
  campaignId: string;
  courseId: string;
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

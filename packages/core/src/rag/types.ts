import type { VariantReport } from "../platform/types.js";
import type { Product, Creative } from "../types.js";

export interface WinnerCreative {
  id: string;
  creativeId: string;
  productCategory: string | null;
  productTags: string[];
  productDescription: string;
  headline: string;
  body: string;
  cta: string;
  variantLabel: "emotional" | "numerical" | "urgency";
  embeddingProduct: number[];
  embeddingCopy: number[];
  qualifiedAt: string;
  impressions: number;
  inlineLinkClickCtr: number;
}

export interface VariantAggregate {
  campaignId: string;
  variantLabel: string;
  variantGroupId: string;
  productId: string;
  impressions: number;
  clicks: number;
  inlineLinkClickCtr: number;
  /** Meta-specific. 두 번째 어댑터의 quality signal 추가 시 platform-aware 흐름으로 일반화. */
  qualityRanking: string | null;
  engagementRanking: string | null;
  conversionRanking: string | null;
}

export interface QualifyDeps {
  findCreativeByVariant: (
    variantGroupId: string,
    variantLabel: string,
  ) => Promise<Creative | null>;
  loadProduct: (productId: string) => Promise<Product | null>;
  embed: (texts: string[]) => Promise<number[][]>;
  store: {
    hasCreative: (creativeId: string) => boolean;
    loadAll: () => WinnerCreative[];
    insert: (winner: WinnerCreative) => void;
  };
}

export type { VariantReport };

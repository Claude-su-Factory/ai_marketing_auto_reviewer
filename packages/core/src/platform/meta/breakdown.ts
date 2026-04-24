import type { Creative } from "../../types.js";
import type { VariantReport } from "../types.js";

interface MetaBodyAsset {
  id: string;
  text: string;
  adlabels?: { name: string }[]; // Meta는 echo 안 함 (Task 1 확인), forward-compat로 유지
}

interface MetaBreakdownRow {
  body_asset: MetaBodyAsset;
  impressions?: string | number;
  clicks?: string | number;
  inline_link_click_ctr?: string | number;
  quality_ranking?: string;
  engagement_rate_ranking?: string;
  conversion_rate_ranking?: string;
}

export interface ParseBreakdownInput {
  rows: MetaBreakdownRow[];
  creatives: Creative[];
  campaignId: string;
  productId: string;
  platform: string;
  date: string;
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function submittedBodyText(c: Creative): string {
  const hashtags = c.copy.hashtags.map((t) => `#${t}`).join(" ");
  return hashtags ? `${c.copy.body}\n\n${hashtags}` : c.copy.body;
}

export function parseBodyAssetBreakdown(input: ParseBreakdownInput): VariantReport[] {
  const { rows, creatives, campaignId, productId, platform, date } = input;

  return rows.flatMap((row) => {
    const match = findMatchingCreative(row.body_asset, creatives);
    if (!match) return [];

    const report: VariantReport = {
      id: `${campaignId}::${match.copy.variantLabel}::${date}`,
      campaignId,
      variantGroupId: match.variantGroupId,
      variantLabel: match.copy.variantLabel,
      metaAssetLabel: match.copy.metaAssetLabel,
      productId,
      platform,
      date,
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      inlineLinkClickCtr: Number(row.inline_link_click_ctr ?? 0),
      adQualityRanking: row.quality_ranking ?? null,
      adEngagementRanking: row.engagement_rate_ranking ?? null,
      adConversionRanking: row.conversion_rate_ranking ?? null,
    };
    return [report];
  });
}

function findMatchingCreative(
  bodyAsset: MetaBodyAsset,
  creatives: Creative[],
): Creative | null {
  // Strategy B (Task 1): Meta는 body_asset.adlabels를 echo하지 않으므로 text 매칭만 사용.
  // 정규화 규칙: CRLF→LF, trim. 제출 시 조립되는 `body + "\n\n" + hashtags`와 비교.
  const assetText = normalize(bodyAsset.text);

  // 1차: 전체 submitted text (body + hashtags) 완전 일치
  const byFull = creatives.find((c) => normalize(submittedBodyText(c)) === assetText);
  if (byFull) return byFull;

  // 2차: body 단독 일치 (Meta가 hashtags를 rendering 과정에서 stripping한 경우 방어)
  const byBody = creatives.find((c) => assetText === normalize(c.copy.body));
  return byBody ?? null;
}

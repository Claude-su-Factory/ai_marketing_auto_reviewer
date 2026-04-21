import type { VariantReport } from "../platform/types.js";
import type { VariantAggregate, WinnerCreative } from "./types.js";
import { cosineSimilarity, DEDUP_COSINE } from "./retriever.js";

export function aggregateVariantReports(reports: VariantReport[]): VariantAggregate[] {
  const byKey = new Map<string, VariantAggregate>();
  for (const r of reports) {
    const key = `${r.campaignId}::${r.variantLabel}`;
    const cur = byKey.get(key);
    if (cur) {
      cur.impressions += r.impressions;
      cur.clicks += r.clicks;
      cur.inlineLinkClickCtr =
        cur.impressions === 0 ? 0 : cur.clicks / cur.impressions;
    } else {
      byKey.set(key, {
        campaignId: r.campaignId,
        variantLabel: r.variantLabel,
        variantGroupId: r.variantGroupId,
        productId: r.productId,
        impressions: r.impressions,
        clicks: r.clicks,
        inlineLinkClickCtr:
          r.impressions === 0 ? 0 : r.clicks / r.impressions,
        adQualityRanking: r.adQualityRanking,
        adEngagementRanking: r.adEngagementRanking,
        adConversionRanking: r.adConversionRanking,
      });
    }
  }
  return Array.from(byKey.values());
}

const CTR_FALLBACK = 0.015;
const MIN_SAMPLE = 10;

export function getMedianCtr(reports: VariantReport[]): number {
  if (reports.length < MIN_SAMPLE) return CTR_FALLBACK;
  const sorted = reports.map((r) => r.inlineLinkClickCtr).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

const MIN_IMPRESSIONS = 500;

export function passesThreshold(
  agg: VariantAggregate,
  medianCtr: number,
): boolean {
  if (agg.impressions < MIN_IMPRESSIONS) return false;
  if (agg.adQualityRanking?.startsWith("BELOW_AVERAGE")) return false;
  if (agg.adEngagementRanking?.startsWith("BELOW_AVERAGE")) return false;
  if (agg.inlineLinkClickCtr < medianCtr) return false;
  return true;
}

export function shouldSkipInsert(
  candidateEmbed: number[],
  existingWinners: WinnerCreative[],
): boolean {
  return existingWinners.some(
    (w) => cosineSimilarity(candidateEmbed, w.embeddingProduct) > DEDUP_COSINE,
  );
}

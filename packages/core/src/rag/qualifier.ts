import { randomUUID } from "crypto";
import type { VariantReport } from "../platform/types.js";
import type { VariantAggregate, WinnerCreative, QualifyDeps } from "./types.js";
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
      const meta = r.platformMetrics?.meta;
      byKey.set(key, {
        campaignId: r.campaignId,
        variantLabel: r.variantLabel,
        variantGroupId: r.variantGroupId,
        productId: r.productId,
        impressions: r.impressions,
        clicks: r.clicks,
        inlineLinkClickCtr:
          r.impressions === 0 ? 0 : r.clicks / r.impressions,
        qualityRanking: meta?.qualityRanking ?? null,
        engagementRanking: meta?.engagementRanking ?? null,
        conversionRanking: meta?.conversionRanking ?? null,
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
  if (agg.qualityRanking?.startsWith("BELOW_AVERAGE")) return false;
  if (agg.engagementRanking?.startsWith("BELOW_AVERAGE")) return false;
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

export async function qualifyWinners(
  reports: VariantReport[],
  deps: QualifyDeps,
): Promise<{ inserted: number; skipped: number }> {
  const medianCtr = getMedianCtr(reports);
  const aggregates = aggregateVariantReports(reports);

  const passing = aggregates.filter((a) => passesThreshold(a, medianCtr));
  const failed = aggregates.length - passing.length;
  const bests = pickBestPerVariantGroup(passing);
  const droppedSiblings = passing.length - bests.length;

  let inserted = 0;
  let skipped = failed + droppedSiblings;

  for (const agg of bests) {
    const creative = await deps.findCreativeByVariant(agg.variantGroupId, agg.variantLabel);
    if (!creative) { skipped++; continue; }
    if (deps.store.hasCreative(creative.id)) { skipped++; continue; }

    const product = await deps.loadProduct(agg.productId);
    if (!product) { skipped++; continue; }

    const [embedProduct, embedCopy] = await deps.embed([
      product.description,
      `${creative.copy.headline} ${creative.copy.body}`,
    ]);

    const existing = deps.store.loadAll();
    if (shouldSkipInsert(embedProduct, existing)) { skipped++; continue; }

    const winner: WinnerCreative = {
      id: randomUUID(),
      creativeId: creative.id,
      productCategory: product.category ?? null,
      productTags: product.tags,
      productDescription: product.description,
      headline: creative.copy.headline,
      body: creative.copy.body,
      cta: creative.copy.cta,
      variantLabel: creative.copy.variantLabel,
      embeddingProduct: embedProduct,
      embeddingCopy: embedCopy,
      qualifiedAt: new Date().toISOString(),
      impressions: agg.impressions,
      inlineLinkClickCtr: agg.inlineLinkClickCtr,
    };
    deps.store.insert(winner);
    inserted++;
  }

  return { inserted, skipped };
}

export function pickBestPerVariantGroup(aggs: VariantAggregate[]): VariantAggregate[] {
  const byGroup = new Map<string, VariantAggregate[]>();
  for (const a of aggs) {
    const cur = byGroup.get(a.variantGroupId);
    if (cur) cur.push(a);
    else byGroup.set(a.variantGroupId, [a]);
  }
  const picked: VariantAggregate[] = [];
  for (const group of byGroup.values()) {
    const sorted = [...group].sort((a, b) => {
      if (b.inlineLinkClickCtr !== a.inlineLinkClickCtr) {
        return b.inlineLinkClickCtr - a.inlineLinkClickCtr;
      }
      if (b.impressions !== a.impressions) return b.impressions - a.impressions;
      return a.variantLabel.localeCompare(b.variantLabel);
    });
    picked.push(sorted[0]);
  }
  return picked;
}

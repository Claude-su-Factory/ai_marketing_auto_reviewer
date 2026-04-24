import type { VariantReport } from "@ad-ai/core/platform/types.js";

export interface Aggregate { impressions: number; clicks: number; avgCtr: number; variants: number; }

export function aggregateVariantReports(reports: VariantReport[]): Aggregate {
  if (reports.length === 0) return { impressions: 0, clicks: 0, avgCtr: 0, variants: 0 };
  let totalImpr = 0, totalClicks = 0, weighted = 0;
  for (const r of reports) {
    totalImpr += r.impressions;
    totalClicks += r.clicks;
    weighted += r.inlineLinkClickCtr * r.impressions;
  }
  return {
    impressions: totalImpr,
    clicks: totalClicks,
    avgCtr: totalImpr > 0 ? weighted / totalImpr : 0,
    variants: reports.length,
  };
}

export function sortByCtr(reports: VariantReport[]): VariantReport[] {
  return [...reports].sort((a, b) => b.inlineLinkClickCtr - a.inlineLinkClickCtr);
}

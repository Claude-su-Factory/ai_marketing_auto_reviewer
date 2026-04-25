import type { VariantReport } from "../types.js";
import { notImplemented } from "../notImplemented.js";

/**
 * Google Ads 캠페인의 일별 asset/variant 단위 report 회수.
 * 반환 VariantReport[]는 캠페인 안의 각 asset/variant 1행씩.
 * platformMetrics.google 필드에 Google 고유 지표 매핑 (실 통합 시 정의).
 */
export async function fetchGoogleVariantReports(
  _campaignId: string,
  _date: string,
): Promise<VariantReport[]> {
  notImplemented("google", "fetchGoogleVariantReports");
}

import type { VariantReport } from "../types.js";
import { notImplemented } from "../notImplemented.js";

/**
 * TikTok 캠페인의 일별 variant breakdown report 회수.
 * 반환 VariantReport[]는 캠페인 안의 각 variant 1행씩.
 * platformMetrics.tiktok 필드에 TikTok 고유 지표 매핑 (실 통합 시 정의).
 */
export async function fetchTiktokVariantReports(
  _campaignId: string,
  _date: string,
): Promise<VariantReport[]> {
  notImplemented("tiktok", "fetchTiktokVariantReports");
}

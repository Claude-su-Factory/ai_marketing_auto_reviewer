import type { VariantGroup, LaunchResult, LaunchLog } from "../types.js";
import { notImplemented } from "../notImplemented.js";

/**
 * Google Ads 캠페인 런칭. PMax + Video 캠페인 통합 진입점.
 * YouTube ads는 PMax의 video assets 또는 별도 Video campaign type으로 처리.
 * SDK / API 매핑은 README 참조.
 */
export async function launchGoogleAds(
  _group: VariantGroup,
  _onLog?: (log: LaunchLog) => void,
): Promise<LaunchResult> {
  notImplemented("google", "launchGoogleAds");
}

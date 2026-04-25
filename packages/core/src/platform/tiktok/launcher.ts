import type { VariantGroup, LaunchResult, LaunchLog } from "../types.js";
import { notImplemented } from "../notImplemented.js";

/**
 * TikTok ACO (Automated Creative Optimization) 캠페인 런칭.
 * Meta DCO와 유사하게 multi-variant breakdown reporting 지원.
 * SDK / API 매핑은 README 참조.
 */
export async function launchTiktokAco(
  _group: VariantGroup,
  _onLog?: (log: LaunchLog) => void,
): Promise<LaunchResult> {
  notImplemented("tiktok", "launchTiktokAco");
}

import type {
  AdPlatform,
  VariantGroup,
  LaunchResult,
  VariantReport,
  CleanupResult,
  LaunchLog,
} from "../types.js";
import { launchTiktokAco } from "./launcher.js";
import { fetchTiktokVariantReports } from "./monitor.js";
import { notImplemented } from "../notImplemented.js";

export function createTiktokAdapter(): AdPlatform {
  return {
    name: "tiktok",
    async launch(group: VariantGroup, onLog?: (l: LaunchLog) => void): Promise<LaunchResult> {
      return launchTiktokAco(group, onLog);
    },
    async fetchReports(campaignId: string, date: string): Promise<VariantReport[]> {
      return fetchTiktokVariantReports(campaignId, date);
    },
    async cleanup(_campaignId: string): Promise<CleanupResult> {
      notImplemented("tiktok", "cleanup");
    },
  };
}

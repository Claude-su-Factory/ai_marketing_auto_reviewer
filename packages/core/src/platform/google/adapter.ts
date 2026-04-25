import type {
  AdPlatform,
  VariantGroup,
  LaunchResult,
  VariantReport,
  CleanupResult,
  LaunchLog,
} from "../types.js";
import { launchGoogleAds } from "./launcher.js";
import { fetchGoogleVariantReports } from "./monitor.js";
import { notImplemented } from "../notImplemented.js";

export function createGoogleAdapter(): AdPlatform {
  return {
    name: "google",
    async launch(group: VariantGroup, onLog?: (l: LaunchLog) => void): Promise<LaunchResult> {
      return launchGoogleAds(group, onLog);
    },
    async fetchReports(campaignId: string, date: string): Promise<VariantReport[]> {
      return fetchGoogleVariantReports(campaignId, date);
    },
    async cleanup(_campaignId: string): Promise<CleanupResult> {
      notImplemented("google", "cleanup");
    },
  };
}

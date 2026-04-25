import type { AdPlatform, VariantGroup, LaunchResult, VariantReport, CleanupResult, LaunchLog } from "../types.js";
import { launchMetaDco } from "./launcher.js";
import { fetchMetaVariantReports } from "./monitor.js";
import { executeRollback, appendOrphansToDisk } from "./rollback.js";
import { readJson, writeJson } from "../../storage.js";
import bizSdk from "facebook-nodejs-business-sdk";
import { requireMeta } from "../../config/helpers.js";

async function deleteMetaResource(_type: "campaign" | "adset" | "ad" | "creative", id: string): Promise<void> {
  // Meta SDK uses uniform DELETE-by-ID syntax; type is kept for caller-side documentation only.
  // Semantics differ: campaign/adset/ad transition to DELETED status; creative is hard-deleted.
  const api = (bizSdk as any).FacebookAdsApi.getDefaultApi();
  await api.call("DELETE", [id]);
}

export function createMetaAdapter(): AdPlatform {
  return {
    name: "meta",
    async launch(group: VariantGroup, onLog?: (l: LaunchLog) => void): Promise<LaunchResult> {
      return launchMetaDco(group, onLog);
    },
    async fetchReports(campaignId: string, date: string): Promise<VariantReport[]> {
      return fetchMetaVariantReports(campaignId, date);
    },
    async cleanup(campaignId: string): Promise<CleanupResult> {
      (bizSdk as any).FacebookAdsApi.init(requireMeta().access_token);
      const campaign = await readJson<any>(`data/campaigns/${campaignId}.json`);
      if (!campaign) return { deleted: [], orphans: [] };

      const ext: Record<string, string> = campaign.externalIds ?? {};
      const created: { type: "campaign" | "adset" | "ad" | "creative"; id: string }[] = [];
      if (ext.campaign) created.push({ type: "campaign", id: ext.campaign });
      if (ext.adSet) created.push({ type: "adset", id: ext.adSet });
      if (ext.creative) created.push({ type: "creative", id: ext.creative });
      if (ext.ad) created.push({ type: "ad", id: ext.ad });

      const result = await executeRollback({ created, deleter: deleteMetaResource });
      await appendOrphansToDisk(result.orphans, writeJson, readJson);
      return result;
    },
  };
}

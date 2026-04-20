import type { AdPlatform, VariantGroup, LaunchResult, VariantReport, CleanupResult } from "../types.js";
import { launchMetaDco } from "./launcher.js";
import { fetchMetaVariantReports } from "./monitor.js";
import { executeRollback, appendOrphansToDisk } from "./rollback.js";
import { readJson, writeJson } from "../../storage.js";
import bizSdk from "facebook-nodejs-business-sdk";

async function deleteMetaResource(type: "campaign" | "adset" | "ad", id: string): Promise<void> {
  const api = (bizSdk as any).FacebookAdsApi.getDefaultApi();
  await api.call("DELETE", [id]);
}

export function createMetaAdapter(): AdPlatform {
  return {
    name: "meta",
    async launch(group: VariantGroup): Promise<LaunchResult> {
      return launchMetaDco(group);
    },
    async fetchReports(campaignId: string, date: string): Promise<VariantReport[]> {
      return fetchMetaVariantReports(campaignId, date);
    },
    async cleanup(campaignId: string): Promise<CleanupResult> {
      (bizSdk as any).FacebookAdsApi.init(process.env.META_ACCESS_TOKEN!);
      const campaign = await readJson<any>(`data/campaigns/${campaignId}.json`);
      if (!campaign) return { deleted: [], orphans: [] };

      const created = [
        { type: "campaign" as const, id: campaign.metaCampaignId },
        { type: "adset" as const, id: campaign.metaAdSetId },
        { type: "ad" as const, id: campaign.metaAdId },
      ];
      const result = await executeRollback({ created, deleter: deleteMetaResource });
      await appendOrphansToDisk(result.orphans, writeJson, readJson);
      return result;
    },
  };
}

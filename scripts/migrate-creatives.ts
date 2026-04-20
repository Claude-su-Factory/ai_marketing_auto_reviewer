import "dotenv/config";
import { readdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

const CREATIVES_DIR = "data/creatives";
const CAMPAIGNS_DIR = "data/campaigns";

interface OldCreative {
  id: string; productId: string;
  copy: { headline: string; body: string; cta: string; hashtags: string[] };
  imageLocalPath: string; videoLocalPath: string;
  status: string; reviewNote?: string; createdAt: string;
}

interface OldCampaign {
  id: string;
  creativeId?: string;
  productId: string;
  metaCampaignId: string;
  metaAdSetId: string;
  metaAdIds?: string[];
  launchedAt: string;
  status: string;
}

async function migrateCreatives(): Promise<Map<string, string>> {
  const groupMap = new Map<string, string>();
  if (!existsSync(CREATIVES_DIR)) {
    console.log(`${CREATIVES_DIR} 없음 — creative 마이그레이션 건너뜀`);
    return groupMap;
  }
  const files = (await readdir(CREATIVES_DIR)).filter((f) => f.endsWith(".json"));
  console.log(`Creative 마이그레이션 대상: ${files.length}개`);

  for (const file of files) {
    const p = path.join(CREATIVES_DIR, file);
    const old = JSON.parse(await readFile(p, "utf-8")) as OldCreative;
    if ("variantGroupId" in old) {
      console.log(`✓ ${file} (이미 마이그레이션됨)`);
      groupMap.set(old.id, (old as any).variantGroupId);
      continue;
    }
    const variantGroupId = randomUUID();
    groupMap.set(old.id, variantGroupId);
    const updated = {
      ...old,
      variantGroupId,
      copy: {
        ...old.copy,
        variantLabel: "emotional" as const,
        metaAssetLabel: `variant-${variantGroupId}`,
      },
    };
    await writeFile(p, JSON.stringify(updated, null, 2), "utf-8");
    console.log(`✓ ${file} (variantGroupId=${variantGroupId})`);
  }
  return groupMap;
}

async function migrateCampaigns(creativeToGroup: Map<string, string>): Promise<void> {
  if (!existsSync(CAMPAIGNS_DIR)) {
    console.log(`${CAMPAIGNS_DIR} 없음 — campaign 마이그레이션 건너뜀`);
    return;
  }
  const files = (await readdir(CAMPAIGNS_DIR)).filter((f) => f.endsWith(".json"));
  console.log(`Campaign 마이그레이션 대상: ${files.length}개`);

  for (const file of files) {
    const p = path.join(CAMPAIGNS_DIR, file);
    const old = JSON.parse(await readFile(p, "utf-8")) as OldCampaign;
    if ("variantGroupId" in old && "platform" in old && "metaAdId" in old) {
      console.log(`✓ ${file} (이미 마이그레이션됨)`);
      continue;
    }
    const variantGroupId =
      (old.creativeId && creativeToGroup.get(old.creativeId)) || randomUUID();
    const metaAdId = old.metaAdIds?.[0] ?? "";
    const updated = {
      id: old.id,
      variantGroupId,
      productId: old.productId,
      platform: "meta",
      metaCampaignId: old.metaCampaignId,
      metaAdSetId: old.metaAdSetId,
      metaAdId,
      launchedAt: old.launchedAt,
      status: old.status,
      orphans: [],
    };
    await writeFile(p, JSON.stringify(updated, null, 2), "utf-8");
    console.log(`✓ ${file} (platform=meta, metaAdId=${metaAdId})`);
  }
}

async function main() {
  const groupMap = await migrateCreatives();
  await migrateCampaigns(groupMap);
  console.log("\n완료.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

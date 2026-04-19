import "dotenv/config";
import { launchCampaign } from "../launcher/index.js";
import { readJson, listJson } from "../../core/storage.js";
import type { Creative, Product } from "../../core/types.js";

const creativePaths = await listJson("data/creatives");
for (const p of creativePaths) {
  const creative = await readJson<Creative>(p);
  if (!creative || (creative.status !== "approved" && creative.status !== "edited")) continue;
  const product = await readJson<Product>(`data/products/${creative.productId}.json`);
  if (!product) continue;
  console.log(`게재 중: ${product.name}`);
  const campaign = await launchCampaign(product, creative);
  console.log(`완료: ${campaign.metaCampaignId}`);
}

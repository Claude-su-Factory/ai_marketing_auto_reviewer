import "dotenv/config";
import { readJson, listJson } from "../../core/storage.js";
import type { Creative, Product } from "../../core/types.js";
import { activePlatforms } from "../../core/platform/registry.js";
import type { VariantGroup } from "../../core/platform/types.js";

const platforms = await activePlatforms();
if (platforms.length === 0) {
  console.error("활성화된 플랫폼이 없습니다. .env의 AD_PLATFORMS 또는 credential을 확인하세요.");
  process.exit(1);
}
console.log(`활성 플랫폼: ${platforms.map((p) => p.name).join(", ")}`);

const creativePaths = await listJson("data/creatives");
for (const p of creativePaths) {
  const creative = await readJson<Creative>(p);
  if (!creative) continue;
  if (creative.status !== "approved" && creative.status !== "edited") continue;

  const product = await readJson<Product>(`data/products/${creative.productId}.json`);
  if (!product) continue;

  const group: VariantGroup = {
    variantGroupId: creative.variantGroupId,
    product,
    creatives: [creative],
    assets: { image: creative.imageLocalPath, video: creative.videoLocalPath },
  };

  for (const platform of platforms) {
    try {
      console.log(`${platform.name} 런칭: ${product.name}`);
      const result = await platform.launch(group);
      console.log(`  ✓ ${platform.name} campaign=${result.externalIds.campaign} ad=${result.externalIds.ad}`);
    } catch (err) {
      console.error(`  ✗ ${platform.name} 실패:`, err);
    }
  }
}

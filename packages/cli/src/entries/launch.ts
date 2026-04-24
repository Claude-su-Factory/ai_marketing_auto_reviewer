import "dotenv/config";
import { readJson, listJson } from "@ad-ai/core/storage.js";
import type { Creative, Product } from "@ad-ai/core/types.js";
import { activePlatforms } from "@ad-ai/core/platform/registry.js";
import type { VariantGroup } from "@ad-ai/core/platform/types.js";
import {
  groupCreativesByVariantGroup,
  groupApprovalCheck,
} from "@ad-ai/core/launch/groupApproval.js";

const platforms = await activePlatforms();
if (platforms.length === 0) {
  console.error("활성화된 플랫폼이 없습니다. .env의 AD_PLATFORMS 또는 credential을 확인하세요.");
  process.exit(1);
}
console.log(`활성 플랫폼: ${platforms.map((p) => p.name).join(", ")}`);

const creativePaths = await listJson("data/creatives");
const allCreatives: Creative[] = [];
for (const p of creativePaths) {
  const c = await readJson<Creative>(p);
  if (c) allCreatives.push(c);
}

const groups = groupCreativesByVariantGroup(allCreatives);

for (const [groupId, members] of groups.entries()) {
  const { launch, approved } = groupApprovalCheck(members);
  if (!launch) {
    console.log(`skip group ${groupId.slice(0, 8)}… (approved ${approved.length}/3, 필요 ≥ 2)`);
    continue;
  }

  const product = await readJson<Product>(`data/products/${approved[0].productId}.json`);
  if (!product) {
    console.log(`skip group ${groupId.slice(0, 8)}… (product 없음)`);
    continue;
  }

  const group: VariantGroup = {
    variantGroupId: groupId,
    product,
    creatives: approved,
    assets: {
      image: approved[0].imageLocalPath,
      video: approved[0].videoLocalPath,
    },
  };

  for (const platform of platforms) {
    try {
      console.log(`${platform.name} 런칭: ${product.name} (${approved.length} variants)`);
      const result = await platform.launch(group);
      console.log(`  ✓ ${platform.name} campaign=${result.externalIds.campaign} ad=${result.externalIds.ad}`);
    } catch (err) {
      console.error(`  ✗ ${platform.name} 실패:`, err);
    }
  }
}

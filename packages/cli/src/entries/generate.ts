import { generateCopy, createAnthropicClient } from "@ad-ai/core/creative/copy.js";
import { generateImage } from "@ad-ai/core/creative/image.js";
import { generateVideo } from "@ad-ai/core/creative/video.js";
import { readJson, writeJson } from "@ad-ai/core/storage.js";
import type { Product, Creative } from "@ad-ai/core/types.js";
import { randomUUID } from "crypto";
import { VARIANT_LABELS } from "@ad-ai/core/creative/prompt.js";

const productId = process.argv[2];
if (!productId) { console.error("Usage: npm run generate <productId>"); process.exit(1); }

const product = await readJson<Product>(`data/products/${productId}.json`);
if (!product) { console.error("제품을 찾을 수 없습니다:", productId); process.exit(1); }

const client = createAnthropicClient();
console.log("이미지 생성 중...");
const imageLocalPath = await generateImage(product);
console.log("영상 생성 중... (최대 10분 소요)");
const videoLocalPath = await generateVideo(product, console.log);

const variantGroupId = randomUUID();
for (const label of VARIANT_LABELS) {
  console.log(`카피 생성 중 (${label})...`);
  const copy = await generateCopy(client, product, [], label);

  const creative: Creative = {
    id: randomUUID(),
    productId: product.id,
    variantGroupId,
    copy: {
      ...copy,
      variantLabel: label,
      metaAssetLabel: `${variantGroupId}::${label}`,
    },
    imageLocalPath,
    videoLocalPath,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  await writeJson(`data/creatives/${creative.id}.json`, creative);
  console.log("완료:", creative.id);
}
console.log(`완료: 3 variants (group=${variantGroupId})`);

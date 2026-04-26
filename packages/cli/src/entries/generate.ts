import { generateCopy, createAnthropicClient } from "@ad-ai/core/creative/copy.js";
import { generateImage } from "@ad-ai/core/creative/image.js";
import { generateVideo } from "@ad-ai/core/creative/video.js";
import { readJson, writeJson } from "@ad-ai/core/storage.js";
import type { Product, Creative } from "@ad-ai/core/types.js";
import { randomUUID } from "crypto";
import { VARIANT_LABELS, type FewShotExample } from "@ad-ai/core/creative/prompt.js";
import { retrieveFewShotForProduct } from "@ad-ai/core/rag/retriever.js";
import { createVoyageClient } from "@ad-ai/core/rag/voyage.js";
import { createCreativesDb } from "@ad-ai/core/rag/db.js";
import { WinnerStore } from "@ad-ai/core/rag/store.js";

const productId = process.argv[2];
if (!productId) { console.error("Usage: npm run generate <productId>"); process.exit(1); }

const product = await readJson<Product>(`data/products/${productId}.json`);
if (!product) { console.error("제품을 찾을 수 없습니다:", productId); process.exit(1); }

let creativesDb: ReturnType<typeof createCreativesDb> | null = null;
try {
  const client = createAnthropicClient();
  const voyage = createVoyageClient();
  creativesDb = createCreativesDb();
  const winnerStore = new WinnerStore(creativesDb);

  console.log("이미지 생성 중...");
  const imageLocalPath = await generateImage(product);
  console.log("영상 생성 중... (최대 10분 소요)");
  const videoLocalPath = await generateVideo(product, console.log);

  const fewShot: FewShotExample[] = await retrieveFewShotForProduct(product, {
    embed: (texts) => voyage.embed(texts),
    loadAllWinners: () => winnerStore.loadAll(),
  });

  const variantGroupId = randomUUID();
  for (const label of VARIANT_LABELS) {
    console.log(`카피 생성 중 (${label})...`);
    const copy = await generateCopy(client, product, fewShot, label);

    const creative: Creative = {
      id: randomUUID(),
      productId: product.id,
      variantGroupId,
      copy: {
        ...copy,
        variantLabel: label,
        assetLabel: `${variantGroupId}::${label}`,
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
} catch (e) {
  console.error("Generate 실패:", e);
  process.exit(1);
} finally {
  creativesDb?.close();
}

import "dotenv/config";
import { generateCopy, createAnthropicClient } from "../../core/creative/copy.js";
import { generateImage } from "../../core/creative/image.js";
import { generateVideo } from "../../core/creative/video.js";
import { readJson, writeJson } from "../../core/storage.js";
import type { Product, Creative } from "../../core/types.js";
import { randomUUID } from "crypto";

const productId = process.argv[2];
if (!productId) { console.error("Usage: npm run generate <productId>"); process.exit(1); }

const product = await readJson<Product>(`data/products/${productId}.json`);
if (!product) { console.error("제품을 찾을 수 없습니다:", productId); process.exit(1); }

const client = createAnthropicClient();
console.log("카피 생성 중...");
const copy = await generateCopy(client, product);
console.log("이미지 생성 중...");
const imageLocalPath = await generateImage(product);
console.log("영상 생성 중... (최대 10분 소요)");
const videoLocalPath = await generateVideo(product, console.log);

const creative: Creative = {
  id: randomUUID(), productId: product.id, copy,
  imageLocalPath, videoLocalPath, status: "pending",
  createdAt: new Date().toISOString(),
};
await writeJson(`data/creatives/${creative.id}.json`, creative);
console.log("완료:", creative.id);

import { GoogleGenAI } from "@google/genai";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { Product } from "../types.js";
import { requireGoogleAiKey } from "../config/helpers.js";

export function buildVideoPrompt(product: Product): string {
  return `Short Instagram Reels advertisement (15 seconds), vertical 9:16 format.
Product/service promotion for "${product.name}".
Topics: ${product.tags.slice(0, 3).join(", ")}.
Visual style: Dynamic, modern. Show someone benefiting from the product/service.
No voiceover needed. Cinematic quality. Ends with clear call-to-action moment.`;
}

async function saveVideoBytes(data: Uint8Array | string, productId: string): Promise<string> {
  const dir = "data/creatives";
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${productId}-video.mp4`);
  const buffer = typeof data === "string" ? Buffer.from(data, "base64") : Buffer.from(data);
  await writeFile(filePath, buffer);
  return filePath;
}

export async function generateVideo(product: Product, onProgress?: (msg: string) => void): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: requireGoogleAiKey() });
  const prompt = buildVideoPrompt(product);
  onProgress?.("Veo 3.1: 영상 생성 요청 중...");
  let operation = await ai.models.generateVideos({
    model: "veo-3.1-generate-preview",
    prompt,
    config: { aspectRatio: "9:16", durationSeconds: 15 },
  });
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    if (operation.done) break;
    onProgress?.(`Veo 3.1: 영상 생성 중... (${i + 1}/${maxAttempts})`);
    await new Promise((r) => setTimeout(r, 10000));
    operation = await ai.operations.get({ operation });
  }
  if (!operation.done) throw new Error("Veo 3.1: 영상 생성 타임아웃");
  const videoData = operation.result?.generatedVideos?.[0]?.video?.videoBytes;
  if (!videoData) throw new Error("Veo 3.1: 영상 데이터 없음");
  return saveVideoBytes(videoData, product.id);
}

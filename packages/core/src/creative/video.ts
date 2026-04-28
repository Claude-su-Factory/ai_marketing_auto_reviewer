import { GoogleGenAI } from "@google/genai";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { Product } from "../types.js";
import { requireGoogleAiKey } from "../config/helpers.js";
import { callGoogleModel, withGeminiRetry } from "./geminiRetry.js";
import { discoverVideoModel } from "./modelDiscovery.js";

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

/** Resolves Veo response → raw bytes. Newer Veo (3.x) returns `uri` (cloud-stored),
 *  older returns inline `videoBytes` (base64). Handle both. */
export async function fetchVeoVideoData(
  video: { uri?: string; videoBytes?: string },
  apiKey: string,
): Promise<Uint8Array | string> {
  if (video.videoBytes) return video.videoBytes;
  if (video.uri) {
    const sep = video.uri.includes("?") ? "&" : "?";
    const res = await fetch(`${video.uri}${sep}key=${apiKey}`);
    if (!res.ok) {
      throw new Error(`Veo URI 다운로드 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }
  throw new Error("Veo 응답에 videoBytes/uri 모두 없음");
}

export async function generateVideo(product: Product, onProgress?: (msg: string) => void): Promise<string> {
  const apiKey = requireGoogleAiKey();
  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildVideoPrompt(product);
  const model = await discoverVideoModel();
  onProgress?.(`Google video (${model}): 영상 생성 요청 중...`);
  let operation = await callGoogleModel(
    () => ai.models.generateVideos({
      model,
      prompt,
      // durationSeconds: Veo 2.0/3.0/3.1 모두 4-8 초만 허용 (Google API enforced)
      config: { aspectRatio: "9:16", durationSeconds: 8 },
    }),
    model,
    "video",
  );
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    if (operation.done) break;
    onProgress?.(`Google video (${model}): 영상 생성 중... (${i + 1}/${maxAttempts})`);
    await new Promise((r) => setTimeout(r, 10000));
    operation = await withGeminiRetry(() => ai.operations.get({ operation }));
  }
  if (!operation.done) throw new Error(`Google video (${model}): 영상 생성 타임아웃`);
  const video = operation.result?.generatedVideos?.[0]?.video;
  if (!video) throw new Error(`Google video (${model}): 영상 응답 없음`);
  const data = await fetchVeoVideoData(video, apiKey);
  return saveVideoBytes(data, product.id);
}

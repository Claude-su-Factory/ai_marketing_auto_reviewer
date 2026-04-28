import { GoogleGenAI } from "@google/genai";
import { writeFile, mkdir, readdir, unlink, stat } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { buildVideoPrompt, fetchVeoVideoData } from "@ad-ai/core/creative/video.js";
import { callGoogleModel, withGeminiRetry } from "@ad-ai/core/creative/geminiRetry.js";
import { discoverVideoModel } from "@ad-ai/core/creative/modelDiscovery.js";
import { requireGoogleAiKey } from "@ad-ai/core/config/helpers.js";
import type { Product } from "@ad-ai/core/types.js";
import type { BillingService } from "../billing.js";
import { PRICING } from "@ad-ai/core/billing/pricing.js";
import { createStripeClient, triggerAutoRecharge } from "../stripe.js";

export interface VideoJob {
  id: string;
  licenseId: string;
  status: "pending" | "done" | "failed";
  progress?: string;
  filePath?: string;
  downloadUrl?: string;
  error?: string;
  createdAt: number;
}

const jobs = new Map<string, VideoJob>();
const TMP_DIR = "server/tmp";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function getJob(jobId: string): VideoJob | undefined {
  return jobs.get(jobId);
}

export async function startVideoJob(
  product: Product,
  licenseId: string,
  serverBaseUrl: string,
  billing: BillingService,
  eventId: string
): Promise<string> {
  const jobId = `veo-${randomUUID().slice(0, 8)}`;
  const job: VideoJob = {
    id: jobId,
    licenseId,
    status: "pending",
    createdAt: Date.now(),
  };
  jobs.set(jobId, job);

  runVeoGeneration(job, product, serverBaseUrl, billing, eventId).catch((e) => {
    job.status = "failed";
    job.error = String(e);
    billing.refund(eventId, licenseId, PRICING.video_gen.charged);
  });

  return jobId;
}

async function runVeoGeneration(
  job: VideoJob,
  product: Product,
  serverBaseUrl: string,
  billing: BillingService,
  eventId: string
) {
  const ai = new GoogleGenAI({ apiKey: requireGoogleAiKey() });
  const prompt = buildVideoPrompt(product);
  const model = await discoverVideoModel();

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
    job.progress = `${i + 1}/${maxAttempts}`;
    await new Promise((r) => setTimeout(r, 10000));
    operation = await withGeminiRetry(() => ai.operations.get({ operation }));
  }

  if (!operation.done) {
    job.status = "failed";
    job.error = "Veo 3.1: 영상 생성 타임아웃";
    billing.refund(eventId, job.licenseId, PRICING.video_gen.charged);
    return;
  }

  const video = operation.result?.generatedVideos?.[0]?.video;
  if (!video) {
    job.status = "failed";
    job.error = `Google video (${model}): 영상 응답 없음`;
    billing.refund(eventId, job.licenseId, PRICING.video_gen.charged);
    return;
  }
  let videoData: Uint8Array | string;
  try {
    videoData = await fetchVeoVideoData(video, requireGoogleAiKey());
  } catch (e) {
    job.status = "failed";
    job.error = `Google video (${model}): ${e instanceof Error ? e.message : String(e)}`;
    billing.refund(eventId, job.licenseId, PRICING.video_gen.charged);
    return;
  }

  if (!existsSync(TMP_DIR)) await mkdir(TMP_DIR, { recursive: true });
  const filePath = path.join(TMP_DIR, `${job.id}.mp4`);
  const buffer = typeof videoData === "string"
    ? Buffer.from(videoData, "base64")
    : Buffer.from(videoData);
  await writeFile(filePath, buffer);

  job.filePath = filePath;
  job.downloadUrl = `${serverBaseUrl}/files/${job.id}.mp4`;
  job.status = "done";

  billing.confirmUsage(eventId);

  if (billing.needsRecharge(job.licenseId)) {
    const license = billing.getLicense(job.licenseId);
    if (license?.stripe_customer_id && license?.stripe_payment_method_id) {
      const stripe = createStripeClient();
      triggerAutoRecharge(stripe, license.stripe_customer_id, license.stripe_payment_method_id, license.recharge_amount, job.licenseId).catch(() => {});
    }
  }
}

export async function cleanupOldFiles() {
  if (!existsSync(TMP_DIR)) return;
  const files = await readdir(TMP_DIR);
  const now = Date.now();
  for (const file of files) {
    const filePath = path.join(TMP_DIR, file);
    const stats = await stat(filePath);
    if (now - stats.mtimeMs > MAX_AGE_MS) {
      await unlink(filePath);
    }
  }
}

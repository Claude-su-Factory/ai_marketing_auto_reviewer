import type { ModeConfig } from "../mode.js";
import type { Product, Creative, Report } from "../../core/types.js";
import { generateCopy, createAnthropicClient } from "../../core/creative/copy.js";
import { generateImage } from "../../core/creative/image.js";
import { generateVideo } from "../../core/creative/video.js";
import { parseProductWithGemini } from "../../core/product/parser.js";
import { computeStats, buildAnalysisPrompt } from "../../core/campaign/monitor.js";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { serverFetch, serverGet } from "./usageServer.js";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

export type UsageType = "copy_gen" | "image_gen" | "video_gen" | "parse" | "analyze" | "campaign_launch";

export interface AiProxy {
  generateCopy(product: Product): Promise<Creative["copy"]>;
  generateImage(product: Product): Promise<string>;
  generateVideo(product: Product, onProgress?: (msg: string) => void): Promise<string>;
  parseProduct(url: string, html: string): Promise<Product>;
  analyzePerformance(reports: Report[]): Promise<string>;
  reportUsage(type: UsageType, metadata?: object): Promise<void>;
}

function createOwnerProxy(): AiProxy {
  const anthropic = createAnthropicClient();

  return {
    generateCopy: (product) => generateCopy(anthropic, product),
    generateImage: (product) => generateImage(product),
    generateVideo: (product, onProgress) => generateVideo(product, onProgress),
    parseProduct: async (url, html) => {
      const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
      return parseProductWithGemini(ai, url, html);
    },
    analyzePerformance: async (reports) => {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
      const stats = computeStats(reports);
      const prompt = buildAnalysisPrompt(reports, stats);
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      return response.content[0].type === "text" ? response.content[0].text : "";
    },
    reportUsage: async () => {},
  };
}

function createCustomerProxy(config: ModeConfig): AiProxy {
  async function ensureTempDir(): Promise<string> {
    if (!existsSync(config.tempDir)) await mkdir(config.tempDir, { recursive: true });
    return config.tempDir;
  }

  return {
    generateCopy: async (product) => {
      const res = await serverFetch(config, "/ai/copy", { product });
      if (!res.ok) throw new Error(`AI copy failed: ${res.status}`);
      return res.json() as Promise<Creative["copy"]>;
    },

    generateImage: async (product) => {
      const res = await serverFetch(config, "/ai/image", { product });
      if (!res.ok) throw new Error(`AI image failed: ${res.status}`);
      const { imageBase64 } = await res.json() as { imageBase64: string };
      const dir = await ensureTempDir();
      const filePath = path.join(dir, `${product.id}-image.jpg`);
      await writeFile(filePath, Buffer.from(imageBase64, "base64"));
      return filePath;
    },

    generateVideo: async (product, onProgress) => {
      const res = await serverFetch(config, "/ai/video", { product });
      if (!res.ok) throw new Error(`AI video failed: ${res.status}`);
      const { jobId } = await res.json() as { jobId: string };

      for (let i = 0; i < 60; i++) {
        const statusRes = await serverGet(config, `/ai/video/status/${jobId}`);
        const statusData = await statusRes.json() as { status: string; progress?: string; downloadUrl?: string; error?: string };

        if (statusData.status === "done" && statusData.downloadUrl) {
          onProgress?.("영상 다운로드 중...");
          const videoRes = await fetch(statusData.downloadUrl);
          const buffer = Buffer.from(await videoRes.arrayBuffer());
          const dir = await ensureTempDir();
          const filePath = path.join(dir, `${product.id}-video.mp4`);
          await writeFile(filePath, buffer);
          return filePath;
        }

        if (statusData.status === "failed") {
          throw new Error(statusData.error ?? "Video generation failed");
        }

        onProgress?.(`Veo 3.1: 영상 생성 중... (${statusData.progress ?? `${i + 1}/60`})`);
        await new Promise((r) => setTimeout(r, 10000));
      }

      throw new Error("Veo 3.1: 영상 생성 타임아웃");
    },

    parseProduct: async (url, html) => {
      const res = await serverFetch(config, "/ai/parse", { url, html });
      if (!res.ok) throw new Error(`AI parse failed: ${res.status}`);
      return res.json() as Promise<Product>;
    },

    analyzePerformance: async (reports) => {
      const res = await serverFetch(config, "/ai/analyze", { reports });
      if (!res.ok) throw new Error(`AI analyze failed: ${res.status}`);
      const { analysis } = await res.json() as { analysis: string };
      return analysis;
    },

    reportUsage: async (type, metadata) => {
      await serverFetch(config, "/usage/report", { type, metadata });
    },
  };
}

export function createAiProxy(config: ModeConfig): AiProxy {
  if (config.mode === "owner") return createOwnerProxy();
  return createCustomerProxy(config);
}

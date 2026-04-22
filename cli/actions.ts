import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { activePlatforms } from "../core/platform/registry.js";
import type { VariantGroup, VariantReport } from "../core/platform/types.js";
import {
  groupCreativesByVariantGroup,
  groupApprovalCheck,
} from "../core/launch/groupApproval.js";
import {
  collectDailyReports,
  variantReportsToReports,
  computeStats,
  buildAnalysisPrompt,
} from "../core/campaign/monitor.js";
import { runImprovementCycle } from "../core/improver/runner.js";
import { shouldTriggerImprovement } from "../core/improver/index.js";
import { readJson, writeJson, listJson } from "../core/storage.js";
import type { Product, Creative } from "../core/types.js";
import type { DoneResult, ProgressCallback, TaskProgress } from "./tui/AppTypes.js";
import { randomUUID } from "crypto";
import { VARIANT_LABELS } from "../core/creative/prompt.js";
import { generateCopy, createAnthropicClient } from "../core/creative/copy.js";
import { generateImage } from "../core/creative/image.js";
import { generateVideo } from "../core/creative/video.js";
import { parseProductWithGemini } from "../core/product/parser.js";

export function buildOverallProgress(p: TaskProgress): number {
  return Math.round((p.copy + p.image + p.video) / 3);
}

export function validateMonitorMode(input: string): "daily" | "weekly" | null {
  if (input === "d") return "daily";
  if (input === "w") return "weekly";
  return null;
}

export async function runScrape(url: string, onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    onProgress({ message: `스크래핑 중... ${url.slice(0, 40)}` });
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      const html = await page.content();
      const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
      const product = await parseProductWithGemini(ai, url, html);
      await writeJson(`data/products/${product.id}.json`, product);
      return { success: true, message: "Scrape 완료", logs: [`${product.name} 저장됨`] };
    } finally {
      await browser.close();
    }
  } catch (e) {
    return { success: false, message: "Scrape 실패", logs: [String(e)] };
  }
}

export async function runGenerate(onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    const productPaths = await listJson("data/products");
    if (productPaths.length === 0) {
      return { success: false, message: "Generate 실패", logs: ["data/products/에 제품이 없습니다. Scrape을 먼저 실행하세요."] };
    }
    const anthropic = createAnthropicClient();
    const logs: string[] = [];
    const startedAt = Date.now();

    for (let i = 0; i < productPaths.length; i++) {
      const product = await readJson<Product>(productPaths[i]);
      if (!product) continue;
      const queue: ("done" | "running" | "pending")[] =
        productPaths.map((_, idx) => idx < i ? "done" : idx === i ? "running" : "pending");
      const variantGroupId = randomUUID();

      type Track = { status: "pending" | "running" | "done"; pct: number; label: string };
      const tracks: { copy: Track; image: Track; video: Track } = {
        copy:  { status: "running", pct: 0, label: "대기" },
        image: { status: "running", pct: 0, label: "시작" },
        video: { status: "running", pct: 0, label: "시작" },
      };
      const emit = (msg: string) => onProgress({
        message: msg,
        generate: {
          queue,
          currentProduct: { id: product.id, name: product.name },
          tracks: { ...tracks },
          elapsedMs: Date.now() - startedAt,
        },
      });
      emit(`${product.name} 생성 중...`);

      const imageTask = (async () => {
        const p = await generateImage(product);
        tracks.image = { status: "done", pct: 100, label: "done" };
        emit(`${product.name} 이미지 완료`);
        return p;
      })();

      const videoTask = (async () => {
        const p = await generateVideo(product, (msg) => {
          const match = msg.match(/\((\d+)\/(\d+)\)/);
          if (match) tracks.video = { status: "running", pct: Math.round((Number(match[1]) / Number(match[2])) * 95), label: msg };
          emit(msg);
        });
        tracks.video = { status: "done", pct: 100, label: "done" };
        emit(`${product.name} 영상 완료`);
        return p;
      })();

      const copiesTask = (async () => {
        const copies: { label: typeof VARIANT_LABELS[number]; data: Awaited<ReturnType<typeof generateCopy>> }[] = [];
        for (let v = 0; v < VARIANT_LABELS.length; v++) {
          const label = VARIANT_LABELS[v];
          tracks.copy = { status: "running", pct: Math.round((v / VARIANT_LABELS.length) * 100), label: `variant ${v + 1}/3` };
          emit(`카피 ${v + 1}/3 (${label})`);
          const c = await generateCopy(anthropic, product, [], label);
          copies.push({ label, data: c });
        }
        tracks.copy = { status: "done", pct: 100, label: "3 variants" };
        emit(`${product.name} 카피 완료`);
        return copies;
      })();

      const [imageLocalPath, videoLocalPath, copies] = await Promise.all([imageTask, videoTask, copiesTask]);

      for (const { label, data } of copies) {
        const creative: Creative = {
          id: randomUUID(),
          productId: product.id,
          variantGroupId,
          copy: { ...data, variantLabel: label, metaAssetLabel: `${variantGroupId}::${label}` },
          imageLocalPath, videoLocalPath, status: "pending",
          createdAt: new Date().toISOString(),
        };
        await writeJson(`data/creatives/${creative.id}.json`, creative);
      }
      logs.push(`${product.name} ✓ (3 variants)`);
    }
    return { success: true, message: `Generate 완료 — ${logs.length}개 제품`, logs };
  } catch (e) {
    return { success: false, message: "Generate 실패", logs: [String(e)] };
  }
}

export async function runLaunch(onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    const platforms = await activePlatforms();
    if (platforms.length === 0) {
      return { success: false, message: "Launch 실패", logs: ["활성화된 플랫폼이 없습니다. .env의 AD_PLATFORMS 또는 credential을 확인하세요."] };
    }
    const creativePaths = await listJson("data/creatives");
    const allCreatives: Creative[] = [];
    for (const p of creativePaths) {
      const c = await readJson<Creative>(p);
      if (c) allCreatives.push(c);
    }
    const groups = groupCreativesByVariantGroup(allCreatives);
    const logs: string[] = [];
    for (const [groupId, members] of groups.entries()) {
      const { launch, approved } = groupApprovalCheck(members);
      if (!launch) {
        logs.push(`skip group ${groupId.slice(0, 8)}… (approved ${approved.length}/3, 필요 ≥ 2)`);
        continue;
      }
      const product = await readJson<Product>(`data/products/${approved[0].productId}.json`);
      if (!product) {
        logs.push(`skip group ${groupId.slice(0, 8)}… (product 없음)`);
        continue;
      }
      const group: VariantGroup = { variantGroupId: groupId, product, creatives: approved, assets: { image: approved[0].imageLocalPath, video: approved[0].videoLocalPath } };
      onProgress({ message: `게재 중: ${product.name} (${approved.length} variants)` });
      for (const platform of platforms) {
        const result = await platform.launch(group);
        logs.push(`${product.name} → ${result.externalIds.campaign} (${platform.name}, ${approved.length} variants)`);
      }
    }
    if (logs.every((l) => l.startsWith("skip"))) {
      return { success: false, message: "Launch 실패", logs: logs.length > 0 ? logs : ["승인된 variantGroup이 없습니다. Review를 먼저 실행하세요."] };
    }
    return { success: true, message: `Launch 완료 — ${logs.filter((l) => !l.startsWith("skip")).length}개 게재`, logs };
  } catch (e) {
    return { success: false, message: "Launch 실패", logs: [String(e)] };
  }
}

export async function runMonitor(mode: "daily" | "weekly", onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    if (mode === "daily") {
      onProgress({ message: "일간 성과 수집 중..." });
      const reports = await collectDailyReports();
      return { success: true, message: "Monitor (daily) 완료", logs: [`${reports.length}개 리포트 수집됨`] };
    }
    onProgress({ message: "주간 분석 중... (Claude 분석 포함)" });
    const reportPaths = (await listJson("data/reports")).filter((f) => !f.includes("weekly-analysis"));
    const allVariants: VariantReport[] = [];
    for (const p of reportPaths.slice(-7)) {
      const daily = await readJson<VariantReport[]>(p);
      if (daily) allVariants.push(...daily);
    }
    if (allVariants.length === 0) {
      return { success: true, message: "Monitor (weekly) 완료", logs: ["성과 데이터 없음"] };
    }
    const aggregated = variantReportsToReports(allVariants);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const stats = computeStats(aggregated);
    const prompt = buildAnalysisPrompt(aggregated, stats);
    const response = await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: 1024, messages: [{ role: "user", content: prompt }] });
    const analysis = response.content[0].type === "text" ? response.content[0].text : "";
    await writeJson(`data/reports/weekly-analysis-${new Date().toISOString().split("T")[0]}.json`, JSON.parse(analysis.match(/\{[\s\S]*\}/)?.[0] ?? "{}"));
    return { success: true, message: "Monitor (weekly) 완료", logs: [analysis.slice(0, 200)] };
  } catch (e) {
    return { success: false, message: "Monitor 실패", logs: [String(e)] };
  }
}

export async function runImprove(onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    const reportPaths = await listJson("data/reports");
    const allVariants: VariantReport[] = [];
    for (const p of reportPaths.filter((f) => !f.includes("weekly-analysis")).slice(-3)) {
      const daily = await readJson<VariantReport[]>(p);
      if (daily) allVariants.push(...daily);
    }
    const weeklyPaths = reportPaths.filter((p) => p.includes("weekly-analysis"));
    const weeklyPath = weeklyPaths[weeklyPaths.length - 1];
    if (!weeklyPath) {
      return { success: false, message: "Improve 실패", logs: ["주간 분석 없음. Monitor weekly를 먼저 실행하세요."] };
    }
    const analysis = await readJson<object>(weeklyPath);
    const aggregated = variantReportsToReports(allVariants);
    const weakReports = aggregated.filter(shouldTriggerImprovement);
    onProgress({ message: `개선 대상 ${weakReports.length}개 캠페인 분석 중...` });
    await runImprovementCycle(weakReports, JSON.stringify(analysis));
    return { success: true, message: "Improve 완료", logs: [`${weakReports.length}개 캠페인 기반 개선 적용`] };
  } catch (e) {
    return { success: false, message: "Improve 실패", logs: [String(e)] };
  }
}

export async function runPipelineAction(urls: string[], onProgress: ProgressCallback): Promise<DoneResult> {
  const logs: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    onProgress({ message: `스크래핑 중... (${i + 1}/${urls.length})`, courseIndex: i + 1, totalCourses: urls.length });
    const scrapeResult = await runScrape(urls[i], onProgress);
    if (!scrapeResult.success) return scrapeResult;
    logs.push(...scrapeResult.logs);
  }
  const generateResult = await runGenerate(onProgress);
  logs.push(...generateResult.logs);
  return {
    success: generateResult.success,
    message: generateResult.success
      ? `Pipeline 완료 — ${urls.length}개 URL 처리`
      : "Pipeline 실패",
    logs,
  };
}

import "dotenv/config";
import type { AiProxy } from "../client/aiProxy.js";
import { launchCampaign } from "../launcher/index.js";
import { collectDailyReports } from "../monitor/index.js";
import { runImprovementCycle, shouldTriggerImprovement } from "../improver/index.js";
import { readJson, writeJson, listJson } from "../storage.js";
import type { Product, Creative, Report } from "../types.js";
import type { DoneResult, ProgressCallback, TaskProgress } from "./AppTypes.js";
import { randomUUID } from "crypto";

export function buildOverallProgress(p: TaskProgress): number {
  return Math.round((p.copy + p.image + p.video) / 3);
}

export function validateMonitorMode(input: string): "daily" | "weekly" | null {
  if (input === "d") return "daily";
  if (input === "w") return "weekly";
  return null;
}

export async function runScrape(
  proxy: AiProxy,
  url: string,
  onProgress: ProgressCallback
): Promise<DoneResult> {
  try {
    onProgress({ message: `스크래핑 중... ${url.slice(0, 40)}` });
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      const html = await page.content();
      const product = await proxy.parseProduct(url, html);
      await writeJson(`data/products/${product.id}.json`, product);
      return {
        success: true,
        message: "Scrape 완료",
        logs: [`${product.name} 저장됨`],
      };
    } finally {
      await browser.close();
    }
  } catch (e) {
    return { success: false, message: "Scrape 실패", logs: [String(e)] };
  }
}

export async function runGenerate(proxy: AiProxy, onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    const productPaths = await listJson("data/products");
    if (productPaths.length === 0) {
      return {
        success: false,
        message: "Generate 실패",
        logs: ["data/products/에 제품이 없습니다. Scrape을 먼저 실행하세요."],
      };
    }

    const logs: string[] = [];

    for (let i = 0; i < productPaths.length; i++) {
      const product = await readJson<Product>(productPaths[i]);
      if (!product) continue;

      const taskProgress: TaskProgress = { copy: 0, image: 0, video: 0 };

      onProgress({
        message: "카피 생성 중...",
        currentCourse: product.name,
        courseIndex: i + 1,
        totalCourses: productPaths.length,
        taskProgress: { ...taskProgress },
      });
      const copy = await proxy.generateCopy(product);
      taskProgress.copy = 100;

      onProgress({
        message: "이미지 생성 중...",
        currentCourse: product.name,
        courseIndex: i + 1,
        totalCourses: productPaths.length,
        taskProgress: { ...taskProgress },
      });
      const imageLocalPath = await proxy.generateImage(product);
      taskProgress.image = 100;

      onProgress({
        message: "영상 생성 중...",
        currentCourse: product.name,
        courseIndex: i + 1,
        totalCourses: productPaths.length,
        taskProgress: { ...taskProgress },
      });
      const videoLocalPath = await proxy.generateVideo(product, (msg) => {
        const match = msg.match(/\((\d+)\/(\d+)\)/);
        if (match) {
          taskProgress.video = Math.round((Number(match[1]) / Number(match[2])) * 90);
        }
        onProgress({
          message: msg,
          currentCourse: product.name,
          courseIndex: i + 1,
          totalCourses: productPaths.length,
          taskProgress: { ...taskProgress },
        });
      });
      taskProgress.video = 100;

      onProgress({
        message: "저장 중...",
        currentCourse: product.name,
        courseIndex: i + 1,
        totalCourses: productPaths.length,
        taskProgress: { ...taskProgress },
      });

      const creative: Creative = {
        id: randomUUID(),
        productId: product.id,
        copy,
        imageLocalPath,
        videoLocalPath,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      await writeJson(`data/creatives/${creative.id}.json`, creative);
      logs.push(`${product.name} ✓`);
    }

    return {
      success: true,
      message: `Generate 완료 — ${logs.length}개 제품`,
      logs,
    };
  } catch (e) {
    return { success: false, message: "Generate 실패", logs: [String(e)] };
  }
}

export async function runLaunch(proxy: AiProxy, onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    const creativePaths = await listJson("data/creatives");
    const logs: string[] = [];

    for (const p of creativePaths) {
      const creative = await readJson<Creative>(p);
      if (!creative || (creative.status !== "approved" && creative.status !== "edited")) continue;
      const product = await readJson<Product>(`data/products/${creative.productId}.json`);
      if (!product) continue;

      onProgress({ message: `게재 중: ${product.name}` });
      const campaign = await launchCampaign(product, creative);
      await proxy.reportUsage("campaign_launch", { campaignId: campaign.id });
      logs.push(`${product.name} → ${campaign.metaCampaignId}`);
    }

    if (logs.length === 0) {
      return {
        success: false,
        message: "Launch 실패",
        logs: ["승인된 소재가 없습니다. Review를 먼저 실행하세요."],
      };
    }
    return { success: true, message: `Launch 완료 — ${logs.length}개 게재`, logs };
  } catch (e) {
    return { success: false, message: "Launch 실패", logs: [String(e)] };
  }
}

export async function runMonitor(
  proxy: AiProxy,
  mode: "daily" | "weekly",
  onProgress: ProgressCallback
): Promise<DoneResult> {
  try {
    if (mode === "daily") {
      onProgress({ message: "일간 성과 수집 중..." });
      const reports = await collectDailyReports();
      return {
        success: true,
        message: "Monitor (daily) 완료",
        logs: [`${reports.length}개 리포트 수집됨`],
      };
    } else {
      onProgress({ message: "주간 분석 중... (Claude 분석 포함)" });
      const reportPaths = (await listJson("data/reports")).filter(f => !f.includes("weekly-analysis"));
      const allReports: Report[] = [];
      for (const p of reportPaths.slice(-7)) {
        const daily = await readJson<Report[]>(p);
        if (daily) allReports.push(...daily);
      }
      if (allReports.length === 0) {
        return { success: true, message: "Monitor (weekly) 완료", logs: ["성과 데이터 없음"] };
      }
      const analysis = await proxy.analyzePerformance(allReports);
      await writeJson(
        `data/reports/weekly-analysis-${new Date().toISOString().split("T")[0]}.json`,
        JSON.parse(analysis.match(/\{[\s\S]*\}/)?.[0] ?? "{}")
      );
      return {
        success: true,
        message: "Monitor (weekly) 완료",
        logs: [analysis.slice(0, 200)],
      };
    }
  } catch (e) {
    return { success: false, message: "Monitor 실패", logs: [String(e)] };
  }
}

export async function runImprove(proxy: AiProxy, onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    const reportPaths = await listJson("data/reports");
    const allReports: Report[] = [];

    for (const p of reportPaths.filter((f) => !f.includes("weekly-analysis")).slice(-3)) {
      const daily = await readJson<Report[]>(p);
      if (daily) allReports.push(...daily);
    }

    const weeklyPaths = reportPaths.filter((p) => p.includes("weekly-analysis"));
    const weeklyPath = weeklyPaths[weeklyPaths.length - 1];

    if (!weeklyPath) {
      return {
        success: false,
        message: "Improve 실패",
        logs: ["주간 분석 없음. Monitor weekly를 먼저 실행하세요."],
      };
    }

    const analysis = await readJson<object>(weeklyPath);
    const weakReports = allReports.filter(shouldTriggerImprovement);

    onProgress({ message: `개선 대상 ${weakReports.length}개 캠페인 분석 중...` });
    await runImprovementCycle(weakReports, JSON.stringify(analysis));

    return {
      success: true,
      message: "Improve 완료",
      logs: [`${weakReports.length}개 캠페인 기반 개선 적용`],
    };
  } catch (e) {
    return { success: false, message: "Improve 실패", logs: [String(e)] };
  }
}

export async function runPipelineAction(
  proxy: AiProxy,
  urls: string[],
  onProgress: ProgressCallback
): Promise<DoneResult> {
  const logs: string[] = [];

  for (let i = 0; i < urls.length; i++) {
    onProgress({
      message: `스크래핑 중... (${i + 1}/${urls.length})`,
      courseIndex: i + 1,
      totalCourses: urls.length,
    });
    const scrapeResult = await runScrape(proxy, urls[i], onProgress);
    if (!scrapeResult.success) return scrapeResult;
    logs.push(...scrapeResult.logs);
  }

  const generateResult = await runGenerate(proxy, onProgress);
  logs.push(...generateResult.logs);

  return {
    success: generateResult.success,
    message: generateResult.success
      ? `Pipeline 완료 — ${urls.length}개 URL 처리`
      : "Pipeline 실패",
    logs,
  };
}

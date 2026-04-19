import Anthropic from "@anthropic-ai/sdk";
import bizSdk from "facebook-nodejs-business-sdk";
import cron from "node-cron";
import type { Report, Campaign } from "../../core/types.js";
import { readJson, writeJson, appendJson, listJson } from "../../core/storage.js";
import { randomUUID } from "crypto";

const { AdAccount } = bizSdk as any;

export interface PerformanceStats {
  top: Report[];
  bottom: Report[];
  totalSpend: number;
  avgCtr: number;
}

export function computeStats(reports: Report[]): PerformanceStats {
  if (reports.length === 0) {
    return { top: [], bottom: [], totalSpend: 0, avgCtr: 0 };
  }
  const sorted = [...reports].sort((a, b) => b.ctr - a.ctr);
  const topCount = Math.min(3, Math.ceil(sorted.length / 2));
  const bottomCount = Math.min(3, sorted.length - topCount);
  return {
    top: sorted.slice(0, topCount),
    bottom: sorted.slice(sorted.length - bottomCount).reverse(),
    totalSpend: reports.reduce((sum, r) => sum + r.spend, 0),
    avgCtr: reports.reduce((sum, r) => sum + r.ctr, 0) / reports.length,
  };
}

export function buildAnalysisPrompt(reports: Report[], stats: PerformanceStats): string {
  return `다음 인스타그램 광고 성과 데이터를 분석하고 개선 제안을 JSON으로 반환해주세요.

## 성과 데이터
${reports.map((r) => `캠페인 ${r.campaignId}: CTR ${r.ctr}%, CPC ₩${r.cpc}, 지출 ₩${r.spend}`).join("\n")}

## 요약
- 상위 CTR: ${stats.top.map((r) => r.ctr).join("%, ")}%
- 하위 CTR: ${stats.bottom.map((r) => r.ctr).join("%, ")}%
- 총 지출: ₩${stats.totalSpend.toLocaleString()}
- 평균 CTR: ${stats.avgCtr.toFixed(2)}%

개선이 필요한 캠페인과 구체적인 제안을 아래 형식으로 반환:
{
  "summary": "전체 요약",
  "improvements": [
    {
      "campaignId": "",
      "issue": "문제점",
      "suggestion": "개선 제안",
      "targetFile": "수정할 파일 경로 (예: src/generator/copy.ts)",
      "changeType": "prompt_update | param_update | bug_fix"
    }
  ]
}`;
}

async function fetchInsights(campaignId: string, date: string): Promise<Report | null> {
  try {
    (bizSdk as any).FacebookAdsApi.init(process.env.META_ACCESS_TOKEN!);
    const account = new AdAccount(process.env.META_AD_ACCOUNT_ID!);
    const insights = await account.getInsights(
      ["impressions", "clicks", "ctr", "spend", "cpc", "reach", "frequency"],
      {
        time_range: { since: date, until: date },
        filtering: [{ field: "campaign.id", operator: "EQUAL", value: campaignId }],
      }
    );
    if (!insights[0]) return null;
    const d = insights[0];
    return {
      id: randomUUID(),
      campaignId,
      productId: "",
      date,
      impressions: Number(d.impressions ?? 0),
      clicks: Number(d.clicks ?? 0),
      ctr: Number(d.ctr ?? 0),
      spend: Number(d.spend ?? 0),
      cpc: Number(d.cpc ?? 0),
      reach: Number(d.reach ?? 0),
      frequency: Number(d.frequency ?? 0),
    };
  } catch {
    return null;
  }
}

export async function collectDailyReports(): Promise<Report[]> {
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const campaignPaths = await listJson("data/campaigns");
  const reports: Report[] = [];

  for (const p of campaignPaths) {
    const campaign = await readJson<Campaign>(p);
    if (!campaign || campaign.status === "completed") continue;
    const report = await fetchInsights(campaign.metaCampaignId, yesterday);
    if (report) {
      report.productId = campaign.productId;
      await appendJson(`data/reports/${yesterday}.json`, report);
      reports.push(report);
    }
  }

  return reports;
}

export async function generateWeeklyAnalysis(): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const reportPaths = (await listJson("data/reports"))
    .filter((p) => !p.includes("weekly-analysis"));
  const allReports: Report[] = [];

  for (const p of reportPaths.slice(-7)) {
    const daily = await readJson<Report[]>(p);
    if (daily) allReports.push(...daily);
  }

  if (allReports.length === 0) return "성과 데이터 없음";

  const stats = computeStats(allReports);
  const prompt = buildAnalysisPrompt(allReports, stats);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
  await writeJson(
    `data/reports/weekly-analysis-${new Date().toISOString().split("T")[0]}.json`,
    JSON.parse(jsonMatch)
  );
  return text;
}

export function startCronScheduler(): void {
  // 매일 오전 9시
  cron.schedule("0 9 * * *", async () => {
    console.log("[Monitor] 일간 성과 수집 시작...");
    await collectDailyReports();
    console.log("[Monitor] 일간 수집 완료");
  });

  // 매주 월요일 오전 9시
  cron.schedule("0 9 * * 1", async () => {
    console.log("[Monitor] 주간 분석 시작...");
    const analysis = await generateWeeklyAnalysis();
    console.log("[Monitor] 주간 분석:\n", analysis);
  });

  console.log("[Monitor] 스케줄러 시작됨 (매일 09:00, 매주 월 09:00)");
}

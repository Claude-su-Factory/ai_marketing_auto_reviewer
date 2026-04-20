import Anthropic from "@anthropic-ai/sdk";
import type { Report, Campaign } from "../types.js";
import type { VariantReport } from "../platform/types.js";
import { readJson, writeJson, appendJson, listJson } from "../storage.js";
import { activePlatforms } from "../platform/registry.js";
import { randomUUID } from "crypto";

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
      "targetFile": "수정할 파일 경로 (예: core/creative/copy.ts)",
      "changeType": "prompt_update | param_update | bug_fix"
    }
  ]
}`;
}

export async function collectDailyReports(): Promise<VariantReport[]> {
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const platforms = await activePlatforms();
  const campaignPaths = await listJson("data/campaigns");
  const all: VariantReport[] = [];

  for (const p of campaignPaths) {
    const campaign = await readJson<Campaign>(p);
    if (!campaign) continue;
    if (
      campaign.status === "completed" ||
      campaign.status === "externally_modified" ||
      campaign.status === "launch_failed"
    ) {
      continue;
    }
    const platform = platforms.find((pl) => pl.name === campaign.platform);
    if (!platform) continue;

    const reports = await platform.fetchReports(campaign.id, yesterday);
    for (const r of reports) {
      await appendJson(`data/reports/${yesterday}.json`, r);
      all.push(r);
    }
  }

  return all;
}

function variantReportsToReports(vrs: VariantReport[]): Report[] {
  const byCampaign = new Map<string, { imp: number; cl: number; date: string; productId: string }>();
  for (const v of vrs) {
    const cur = byCampaign.get(v.campaignId) ?? { imp: 0, cl: 0, date: v.date, productId: v.productId };
    cur.imp += v.impressions;
    cur.cl += v.clicks;
    byCampaign.set(v.campaignId, cur);
  }
  const reports: Report[] = [];
  for (const [campaignId, agg] of byCampaign) {
    reports.push({
      id: randomUUID(),
      campaignId,
      productId: agg.productId,
      date: agg.date,
      impressions: agg.imp,
      clicks: agg.cl,
      ctr: agg.imp === 0 ? 0 : (agg.cl / agg.imp) * 100,
      spend: 0,
      cpc: 0,
      reach: 0,
      frequency: 0,
    });
  }
  return reports;
}

export async function generateWeeklyAnalysis(): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const reportPaths = (await listJson("data/reports"))
    .filter((p) => !p.includes("weekly-analysis"));
  const allVariants: VariantReport[] = [];

  for (const p of reportPaths.slice(-7)) {
    const daily = await readJson<VariantReport[]>(p);
    if (daily) allVariants.push(...daily);
  }
  if (allVariants.length === 0) return "성과 데이터 없음";

  const reports = variantReportsToReports(allVariants);
  const stats = computeStats(reports);
  const prompt = buildAnalysisPrompt(reports, stats);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
  await writeJson(
    `data/reports/weekly-analysis-${new Date().toISOString().split("T")[0]}.json`,
    JSON.parse(jsonMatch),
  );
  return text;
}

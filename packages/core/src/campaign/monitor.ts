import Anthropic from "@anthropic-ai/sdk";
import type { Report, Campaign } from "../types.js";
import { requireAnthropicKey } from "../config/helpers.js";
import type { VariantReport } from "../platform/types.js";
import { readJson, writeJson, appendJson, listJson } from "../storage.js";
import { activePlatforms } from "../platform/registry.js";
import { randomUUID } from "crypto";
import type { Prompts } from "../learning/prompts.js";
import { loadPrompts } from "../learning/prompts.js";
import { MODEL_ANALYSIS } from "../config/claudeModels.js";

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

export function buildAnalysisPrompt(
  reports: Report[],
  stats: PerformanceStats,
  currentPrompts: Prompts,
): string {
  return `다음 인스타그램 광고 성과 데이터를 분석하고 개선 제안을 JSON으로 반환해주세요.

## 성과 데이터
${reports.map((r) => `캠페인 ${r.campaignId}: CTR ${r.ctr}%, CPC ₩${r.cpc}, 지출 ₩${r.spend}`).join("\n")}

## 요약
- 상위 CTR: ${stats.top.map((r) => r.ctr).join("%, ")}%
- 하위 CTR: ${stats.bottom.map((r) => r.ctr).join("%, ")}%
- 총 지출: ₩${stats.totalSpend.toLocaleString()}
- 평균 CTR: ${stats.avgCtr.toFixed(2)}%

## 현재 학습된 프롬프트 (개선 대상)
${JSON.stringify(currentPrompts, null, 2)}

위 데이터를 보고, 카피 생성 프롬프트의 어느 부분(promptKey)을 어떻게 바꿔야 성과가 좋아질지 제안해주세요.
허용된 promptKey 만 사용 (그 외 값은 무시됨):
- "copy.systemPrompt" — 시스템 프롬프트 전체
- "copy.userTemplate" — 사용자 프롬프트 템플릿 (반드시 {{name}}/{{description}}/{{angleHint}} 포함)
- "copy.angleHints.emotional" — 감정 호소 variant 톤
- "copy.angleHints.numerical" — 수치 강조 variant 톤
- "copy.angleHints.urgency" — 긴급성 variant 톤

주의: 다음 항목은 절대 변경 제안에 포함하지 말 것. 광고 정책 위반 위험.
- 개인화 표현 ("당신만을 위한", "회원님께", "~님" 등): broad 비개인화 노출 정책 위반.
- 과장/superlative ("100%", "1위", "최고" 등 검증 안 된 표현): 한국 표시광고법 + Meta 광고 정책 위반.

반드시 아래 JSON 형식으로만 응답:
{
  "summary": "전체 요약",
  "improvements": [
    {
      "campaignId": "성과 부진 캠페인 ID (선택)",
      "issue": "문제점",
      "suggestion": "개선 방향",
      "promptKey": "위 enum 중 하나"
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

export function variantReportsToReports(vrs: VariantReport[]): Report[] {
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
  const client = new Anthropic({ apiKey: requireAnthropicKey() });
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
  const currentPrompts = await loadPrompts();
  const prompt = buildAnalysisPrompt(reports, stats, currentPrompts);

  const response = await client.messages.create({
    model: MODEL_ANALYSIS,
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

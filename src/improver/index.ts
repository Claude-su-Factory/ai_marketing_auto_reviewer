import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "fs/promises";
import { execSync } from "child_process";
import type { Report, Improvement, ImprovementChange } from "../types.js";
import { appendJson } from "../storage.js";

const CTR_THRESHOLD = Number(process.env.CTR_IMPROVEMENT_THRESHOLD ?? 1.5);

export function shouldTriggerImprovement(report: Report): boolean {
  return report.ctr < CTR_THRESHOLD;
}

export function buildImprovementPrompt(
  filePath: string,
  currentCode: string,
  performanceContext: string,
  issue: string
): string {
  return `당신은 광고 자동화 파이프라인 코드를 개선하는 엔지니어입니다.

## 성과 문제
${performanceContext}

## 식별된 문제
${issue}

## 현재 코드 (${filePath})
\`\`\`typescript
${currentCode}
\`\`\`

위 코드에서 광고 성과를 개선할 수 있는 최소한의 변경을 제안해주세요.
강의 플랫폼(인프런, 클래스101) 외부 페이지는 절대 수정하지 마세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "file": "${filePath}",
  "oldCode": "변경 전 코드 (exact match)",
  "newCode": "변경 후 코드",
  "reason": "변경 이유"
}`;
}

export function parseImprovements(claudeResponse: string): {
  file: string;
  oldCode: string;
  newCode: string;
  reason: string;
} {
  const jsonMatch = claudeResponse.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch?.[0] ?? "{}");
}

async function applyCodeChange(
  filePath: string,
  oldCode: string,
  newCode: string
): Promise<boolean> {
  try {
    const content = await readFile(filePath, "utf-8");
    if (!content.includes(oldCode)) return false;
    const updated = content.replace(oldCode, newCode);
    await writeFile(filePath, updated, "utf-8");
    return true;
  } catch {
    return false;
  }
}

export async function runImprovementCycle(
  weakReports: Report[],
  analysisJson: string
): Promise<void> {
  if (weakReports.length === 0) return;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const analysis = JSON.parse(analysisJson.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
  const improvements: ImprovementChange[] = [];

  for (const item of analysis.improvements ?? []) {
    if (!item.targetFile) continue;

    let currentCode: string;
    try {
      currentCode = await readFile(item.targetFile, "utf-8");
    } catch {
      continue;
    }

    const prompt = buildImprovementPrompt(
      item.targetFile,
      currentCode,
      `CTR ${weakReports[0].ctr}% — 임계값 ${CTR_THRESHOLD}% 미달`,
      item.issue
    );

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    const change = parseImprovements(text);

    if (!change.file || !change.oldCode || !change.newCode) continue;

    const applied = await applyCodeChange(change.file, change.oldCode, change.newCode);
    if (!applied) continue;

    improvements.push({
      file: change.file,
      type: item.changeType ?? "prompt_update",
      before: change.oldCode,
      after: change.newCode,
    });
  }

  if (improvements.length === 0) return;

  const improvement: Improvement = {
    date: new Date().toISOString().split("T")[0],
    trigger: `${weakReports.length}개 캠페인 CTR 임계값 미달`,
    changes: improvements,
  };

  const dateKey = improvement.date;
  await appendJson(`data/improvements/${dateKey}.json`, improvement);

  // 변경 사항 git 커밋
  try {
    const changedFiles = improvements.map((c) => c.file).join(" ");
    execSync(`git add ${changedFiles} data/improvements/${dateKey}.json`);
    execSync(`git commit -m "improve: auto-optimize pipeline (${improvements.length} changes) [${dateKey}]"`);
    console.log(`[Improver] ${improvements.length}개 개선 적용 및 커밋 완료`);
  } catch (e) {
    console.warn("[Improver] git 커밋 실패:", e);
  }
}

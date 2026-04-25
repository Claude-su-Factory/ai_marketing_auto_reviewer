import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "fs/promises";
import { execFileSync } from "child_process";
import type { Report, Improvement, ImprovementChange } from "../types.js";
import { appendJson } from "../storage.js";
import {
  CTR_THRESHOLD,
  buildImprovementPrompt,
  parseImprovements,
} from "./index.js";
import { requireAnthropicKey } from "../config/helpers.js";

export function filterSafeImprovementFiles(files: string[]): string[] {
  return files.filter((f) => /^(core|cli|server)\/[\w./-]+\.ts$/.test(f));
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

  const client = new Anthropic({ apiKey: requireAnthropicKey() });
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
    const changedFiles = improvements.map((c) => c.file);
    const safeFiles = filterSafeImprovementFiles(changedFiles);
    if (safeFiles.length === 0) return;

    const dataFile = `data/improvements/${dateKey}.json`;
    execFileSync("git", ["add", ...safeFiles, dataFile]);
    execFileSync("git", [
      "commit",
      "-m",
      `improve: auto-optimize pipeline (${safeFiles.length} changes) [${dateKey}]`,
    ]);
    console.log(`[Improver] ${safeFiles.length}개 개선 적용 및 커밋 완료`);
  } catch (e) {
    console.warn("[Improver] git 커밋 실패:", e);
  }
}

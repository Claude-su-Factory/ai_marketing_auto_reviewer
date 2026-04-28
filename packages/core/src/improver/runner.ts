import Anthropic from "@anthropic-ai/sdk";
import { writeJson, appendJson } from "../storage.js";
import { requireAnthropicKey } from "../config/helpers.js";
import {
  loadPrompts,
  invalidatePromptsCache,
  PromptsSchema,
  validateUserTemplate,
  type Prompts,
} from "../learning/prompts.js";
import {
  buildImprovementPrompt,
  isAllowedPromptKey,
  parsePromptUpdate,
  getCtrThreshold,
  type AnalysisResult,
  type PromptKey,
} from "./index.js";
import type { Report, Improvement, ImprovementChange } from "../types.js";
import { MODEL_IMPROVER } from "../config/claudeModels.js";

const DEFAULT_PROMPTS_PATH = "data/learned/prompts.json";
const DEFAULT_IMPROVEMENTS_DIR = "data/improvements";
const MAX_PROPOSALS_PER_CYCLE = 5;
const ANALYSIS_CALL_USD = 0.005;
const PROPOSAL_CALL_USD = 0.01;

interface RunImprovementCycleConfig {
  promptsPath?: string;
  improvementsDir?: string;
}

function getPromptValue(prompts: Prompts, key: PromptKey): string {
  const parts = key.split(".");
  let cur: unknown = prompts;
  for (const p of parts) cur = (cur as Record<string, unknown>)[p];
  return cur as string;
}

function setPromptValue(prompts: Prompts, key: PromptKey, value: string): Prompts {
  // 깊은 복제. PromptsSchema 가 string-only 인 동안에만 안전.
  // 미래에 Date/Map/Set 등 non-JSON 타입을 추가하면 structuredClone 또는 명시적 deep clone 으로 교체.
  const cloned: Prompts = JSON.parse(JSON.stringify(prompts));
  const parts = key.split(".");
  const last = parts.pop()!;
  let cur: Record<string, unknown> = cloned as unknown as Record<string, unknown>;
  for (const p of parts) cur = cur[p] as Record<string, unknown>;
  cur[last] = value;
  return cloned;
}

interface ValidationFail { ok: false; reason: string; }
interface ValidationPass { ok: true; prompts: Prompts; }

// Gate 4: banned-pattern check (personalization + unverified hyperbole)
// 정책 근거: CLAUDE.md "broad non-personalized exposure" + 한국 표시광고법 + Meta 광고 정책.
// improver 가 학습으로 prompts.json 에 이런 표현을 도입하면 모든 미래 카피 생성이 오염되므로 fail-safe 로 차단.
const BANNED_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /당신만을 위한|회원[님사]|[가-힣A-Za-z]+님(?:께|에게|을(?!\s*뜻하|\s*의미)|이\s|만(?:\s|$|의))/u, label: "personalization" },
  { pattern: /100%\s*효과|1위(?!,)|최고의?\s|유일한\s/u, label: "unverified-hyperbole" },
  { pattern: /100%\s*마스터|완벽\s*정복|(효과|결과|성공|합격)\s*보장(합니다|하는|된|)/u, label: "result-guarantee" },
  { pattern: /역대\s*최저|최대\s*할인|유례\s*없는/u, label: "discount-superlative" },
];

function validateUpdate(updated: Prompts, key: PromptKey, newValue: string): ValidationFail | ValidationPass {
  const parsed = PromptsSchema.safeParse(updated);
  if (!parsed.success) return { ok: false, reason: `schema validation: ${parsed.error.message}` };
  if (key === "copy.userTemplate") {
    const missing = validateUserTemplate(newValue);
    if (missing.length > 0) return { ok: false, reason: `missing required placeholders: ${missing.join(", ")}` };
  }
  for (const { pattern, label } of BANNED_PATTERNS) {
    if (pattern.test(newValue)) {
      return { ok: false, reason: `banned pattern (${label}): ${pattern.source}` };
    }
  }
  return { ok: true, prompts: parsed.data };
}

export async function runImprovementCycle(
  weakReports: Report[],
  analysis: AnalysisResult,
  config: RunImprovementCycleConfig = {},
): Promise<void> {
  if (weakReports.length === 0) return;
  const proposals = (analysis.improvements ?? [])
    .filter((it) => isAllowedPromptKey(it.promptKey))
    .slice(0, MAX_PROPOSALS_PER_CYCLE);
  if (proposals.length === 0) return;

  const promptsPath = config.promptsPath ?? DEFAULT_PROMPTS_PATH;
  const improvementsDir = config.improvementsDir ?? DEFAULT_IMPROVEMENTS_DIR;

  const client = new Anthropic({ apiKey: requireAnthropicKey() });
  let currentPrompts = await loadPrompts();
  const accepted: ImprovementChange[] = [];
  const rejected: { promptKey: string; issue: string; reason: string }[] = [];
  const dateKey = new Date().toISOString().split("T")[0];

  const ctxFirst = weakReports[0];
  const performanceContext =
    `${weakReports.length}개 캠페인 CTR 임계값(${getCtrThreshold().toFixed(2)}%) 미달. ` +
    `대표 캠페인 CTR=${ctxFirst.ctr.toFixed(2)}%, impressions=${ctxFirst.impressions}.`;

  for (const it of proposals) {
    const before = getPromptValue(currentPrompts, it.promptKey);
    const userPrompt = buildImprovementPrompt(it.promptKey, before, it.issue, it.suggestion, performanceContext);

    const response = await client.messages.create({
      model: MODEL_IMPROVER,
      max_tokens: 2048,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    const parsed = parsePromptUpdate(text);

    if (!parsed.newValue || parsed.promptKey !== it.promptKey) {
      rejected.push({
        promptKey: it.promptKey,
        issue: it.issue,
        reason: `parse fail: missing newValue or key mismatch (got ${parsed.promptKey})`,
      });
      continue;
    }

    const updated = setPromptValue(currentPrompts, it.promptKey, parsed.newValue);
    const v = validateUpdate(updated, it.promptKey, parsed.newValue);
    if (!v.ok) {
      rejected.push({ promptKey: it.promptKey, issue: it.issue, reason: v.reason });
      continue;
    }

    currentPrompts = v.prompts;
    accepted.push({
      promptKey: it.promptKey,
      before,
      after: parsed.newValue,
      reason: parsed.reason ?? "",
    });
  }

  if (accepted.length > 0) {
    await writeJson(promptsPath, currentPrompts);
    invalidatePromptsCache();
    const improvement: Improvement = {
      date: dateKey,
      trigger: `${weakReports.length}개 캠페인 CTR 임계값 미달`,
      changes: accepted,
    };
    await appendJson(`${improvementsDir}/${dateKey}.json`, improvement);
    console.log(`[improver] ${accepted.length}개 prompt 업데이트 적용 — ${promptsPath}`);
  }
  if (rejected.length > 0) {
    await appendJson(`${improvementsDir}/${dateKey}-rejected.json`, { date: dateKey, rejected });
    console.warn(`[improver] ${rejected.length}개 제안 거부 (검증 실패)`);
  }

  const estCost = ANALYSIS_CALL_USD + (accepted.length + rejected.length) * PROPOSAL_CALL_USD;
  console.log(
    `[improver] cycle complete — accepted=${accepted.length} rejected=${rejected.length} ` +
    `est_cost=$${estCost.toFixed(3)}`,
  );
}

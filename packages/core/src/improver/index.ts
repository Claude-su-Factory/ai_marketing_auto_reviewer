import type { Report } from "../types.js";
import { getConfig } from "@ad-ai/core/config/index.js";

export const ALLOWED_PROMPT_KEYS = [
  "copy.systemPrompt",
  "copy.userTemplate",
  "copy.angleHints.emotional",
  "copy.angleHints.numerical",
  "copy.angleHints.urgency",
] as const;
export type PromptKey = (typeof ALLOWED_PROMPT_KEYS)[number];

export interface AnalysisImprovement {
  campaignId?: string;
  issue: string;
  suggestion: string;
  promptKey: PromptKey;
}

export interface AnalysisResult {
  summary?: string;
  improvements?: AnalysisImprovement[];
}

export interface PromptUpdateProposal {
  promptKey: PromptKey;
  newValue: string;
  reason: string;
}

export function getCtrThreshold(): number {
  return getConfig().defaults.ctr_improvement_threshold;
}

export function shouldTriggerImprovement(report: Report): boolean {
  return report.ctr < getCtrThreshold();
}

export function isAllowedPromptKey(key: string): key is PromptKey {
  return (ALLOWED_PROMPT_KEYS as readonly string[]).includes(key);
}

export function buildImprovementPrompt(
  promptKey: PromptKey,
  currentValue: string,
  issue: string,
  suggestion: string,
  performanceContext: string,
): string {
  return `당신은 광고 카피 생성 프롬프트를 개선하는 엔지니어입니다.

## 성과 문제
${performanceContext}

## 식별된 이슈
${issue}

## 개선 방향 (분석 단계에서 제안됨)
${suggestion}

## 변경 대상 프롬프트 키
${promptKey}

## 현재 값
"""
${currentValue}
"""

위 prompt 값을 issue/suggestion 에 맞게 다시 작성하세요. 의미를 보존하되 카피 성과가 개선되도록 표현을 조정합니다.

규칙:
- userTemplate 을 수정하는 경우 반드시 {{name}}, {{description}}, {{angleHint}} placeholder 가 포함되어야 합니다.
- systemPrompt 는 최소 50자 이상.
- 다른 placeholder ({{priceText}}, {{category}}, {{tags}}, {{targetUrl}}, {{fewShotBlock}}) 는 빼도 OK.

반드시 아래 JSON 형식으로만 응답:
{
  "promptKey": "${promptKey}",
  "newValue": "새 값 (전체 텍스트)",
  "reason": "변경 이유 (한 문장)"
}`;
}

export function parsePromptUpdate(claudeResponse: string): Partial<PromptUpdateProposal> {
  const jsonMatch = claudeResponse.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch?.[0] ?? "{}");
}

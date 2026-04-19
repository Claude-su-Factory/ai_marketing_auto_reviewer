import type { Report } from "../types.js";

export const CTR_THRESHOLD = Number(process.env.CTR_IMPROVEMENT_THRESHOLD ?? 1.5);

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

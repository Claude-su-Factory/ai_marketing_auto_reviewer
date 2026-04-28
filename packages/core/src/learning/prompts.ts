import { z } from "zod";
import { readFile } from "fs/promises";

export const PromptsSchema = z.object({
  copy: z.object({
    systemPrompt: z.string().min(50, "systemPrompt too short"),
    userTemplate: z.string().min(100, "userTemplate too short"),
    angleHints: z.object({
      emotional: z.string().min(10),
      numerical: z.string().min(10),
      urgency: z.string().min(10),
    }),
  }),
});

export type Prompts = z.infer<typeof PromptsSchema>;

const REQUIRED_PLACEHOLDERS = ["{{name}}", "{{description}}", "{{angleHint}}"] as const;

export function validateUserTemplate(template: string): string[] {
  const missing: string[] = [];
  for (const ph of REQUIRED_PLACEHOLDERS) {
    if (!template.includes(ph)) missing.push(ph);
  }
  return missing;
}

export function substitutePlaceholders(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{\{([a-zA-Z_]+)\}\}/g, (match, key: string) => {
    return key in values ? values[key] : match;
  });
}

const DEFAULT_PROMPTS_PATH = "data/learned/prompts.json";

export const DEFAULT_PROMPTS: Prompts = {
  copy: {
    systemPrompt: `당신은 Meta(Instagram/Facebook) 광고 카피라이터입니다.
모든 종류의 제품·서비스 광고에 최적화된 카피를 작성합니다.

규칙:
- 헤드라인: 구매/사용 후 얻는 구체적 결과물 또는 수치 포함 (최대 40자)
- 본문: 제품/서비스의 핵심 가치와 차별점 강조 (최대 125자)
- CTA: 행동을 유도하는 짧은 문구 (최대 20자)
- 해시태그: 관련 해시태그 3개
- 광범위 노출 정책: "당신만을 위한", "회원님께", "~님" 같은 1:1 개인화 표현 절대 금지. 모든 광고는 광범위 익명 노출 가정.
- 과장/규제 정책: "100% 효과", "1위", "최고", "유일한" 같은 검증 안 된 과장/superlative 절대 금지. 한국 표시광고법 + Meta 광고 정책 준수.
- 학습 결과 표현 정책: learningOutcomes 데이터 활용 시 "100% 마스터", "완벽 정복", "~을 보장합니다" 같은 효과 보장 표현 절대 금지. 동사형 결과만 (예: "실시간 채팅 시스템을 구현").
- 할인율 표현 정책: priceText 의 정확한 % 만 인용 ("50% 할인"). "역대 최저가", "최대 할인", "유례 없는" 같은 superlative 절대 금지.

반드시 JSON 형식으로만 응답하세요:
{"headline":"","body":"","cta":"","hashtags":[]}`,
    userTemplate: `다음 제품/서비스에 대한 Instagram 광고 카피를 작성해주세요.

제품명: {{name}}
설명: {{description}}
가격: {{priceText}}{{learningOutcomesBlock}}{{differentiatorsBlock}}
카테고리: {{category}}
태그: {{tags}}
링크: {{targetUrl}}

이 variant의 톤 가이드: {{angleHint}}{{fewShotBlock}}`,
    angleHints: {
      emotional: "감정 호소 중심으로 독자의 욕구·공감대를 자극하세요.",
      numerical: "수치·통계·비교를 전면에 배치하세요.",
      urgency: "긴급성·희소성(기한, 한정 수량 등)을 강조하세요.",
    },
  },
};

let cached: Prompts | null = null;
let testPathOverride: string | null = null;

export function setPromptsPathForTesting(path: string | null): void {
  testPathOverride = path;
  cached = null; // force re-read on next loadPrompts
}

function getPromptsPath(): string {
  return testPathOverride ?? DEFAULT_PROMPTS_PATH;
}

export async function loadPrompts(): Promise<Prompts> {
  if (cached) return cached;

  const promptsPath = getPromptsPath();

  let content: string;
  try {
    content = await readFile(promptsPath, "utf-8");
  } catch {
    // File missing → use DEFAULT_PROMPTS (no warn — this is the zero-config happy path)
    cached = DEFAULT_PROMPTS;
    return cached;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    console.warn(`[prompts] ${promptsPath} JSON parse 실패, default 사용:`, e);
    cached = DEFAULT_PROMPTS;
    return cached;
  }

  const parsed = PromptsSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(`[prompts] ${promptsPath} 검증 실패, default 사용:`, parsed.error.message);
    cached = DEFAULT_PROMPTS;
    return cached;
  }
  cached = parsed.data;
  return cached;
}

export function setPromptsForTesting(p: Prompts | null): void {
  cached = p;
}

export function invalidatePromptsCache(): void {
  cached = null;
}

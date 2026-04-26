# 자기학습 루프 — Prompt-as-Data 모델 전환

**작성일:** 2026-04-26
**스펙 종류:** 설계 (design) + 리팩터
**관련 ROADMAP 항목:** Tier 3 — *"자율 개선 루프 강화"*

---

## 1. 배경 (Why)

### 1.1 현재 자기학습 루프의 구조적 결함

현재 `packages/core/src/improver/runner.ts` 는 Claude 가 제안한 코드 패치를 *임의의 TS 파일* 에 직접 적용한다. 보안/안전 가드는 `filterSafeImprovementFiles` regex 1개 (`^(core|cli|server)\/...\.ts$`) 로 제한되어 있으나:

1. **regex 가 멀티모듈 리팩터(2026-04-24) 에서 깨졌다** — 실제 경로는 `packages/core/src/...` 형태인데 regex 는 `core/...` 로 시작하는 패턴을 기대. 결과: improver 가 코드를 수정해도 git commit 단계에서 모든 파일이 필터링되어 0 commits. 자기학습 결과가 git 에 박히지 않음.
2. **보안 체크 위치가 잘못됨** — `applyCodeChange` 가 Claude 가 반환한 임의 path 에 `writeFile` 시도. `filterSafeImprovementFiles` 는 git commit 직전에야 path 를 검사 — 이미 파일은 수정됨.
3. **regex 자체가 fragile** — 디렉토리 이름이 보안 경계가 되는 건 본질적으로 잘못된 추상화. 다음 리팩터에서 또 깨질 가능성.
4. **Improver 의 책임 범위가 모호** — *"어떤 코드든 개선하는 자율 엔지니어"* 컨셉이지만 실제 분석 결과의 99% 는 `creative/prompt.ts` 의 한국어 문구 재작성. 즉 *general code patcher* 모자를 쓴 *prompt tweaker*.

### 1.2 CLI vs Server 의 deployment 차이

- **CLI** = 단일 사용자(소유자) 가 로컬 launchd worker 로 실행. 파일 기반 데이터 (`data/`). DB 사용 안 함.
- **Server** (미래) = 다수 사용자의 캠페인 데이터를 DB 에 적재 + 시스템-wide 학습. server 활성화 시점은 ROADMAP Tier 2.

두 환경 모두 같은 자기학습 메커니즘을 공유하되, **저장소 layer 만 다름** (file vs DB). 현재 코드 패치 모델은 이 분리에 적합하지 않다 (server 가 자기 자신의 코드를 수정하는 건 위험).

### 1.3 본 spec 의 목표

자기학습의 *대상* 을 *코드* 에서 *데이터* 로 옮긴다. Claude 는 더 이상 임의 TS 파일을 수정하지 않고, `data/learned/prompts.json` 한 파일만 read/write. 코드는 이 파일을 lazy 로드하여 사용. CLI/Server 양쪽에서 동일한 인터페이스(`loadPrompts()`)를 공유하되, CLI 는 file, Server 는 (미래) DB 로 구현.

---

## 2. 범위

### 2.1 범위 안

1. **Prompt 추출 + Loader** — `creative/copy.ts:COPY_SYSTEM_PROMPT`, `creative/prompt.ts:ANGLE_HINTS` + `buildCopyPrompt` 템플릿 본문을 `data/learned/prompts.json` 으로 분리. 신규 `packages/core/src/learning/prompts.ts` 가 `getConfig()` 패턴으로 lazy 로드 (파일 부재 시 default = 현재 하드코딩 값).
2. **Server-호환 인터페이스** — `loadPrompts()` 가 같은 shape 반환하면 CLI 는 file, Server 는 DB 로 다르게 구현 가능. 본 작업은 file 구현체만, DB 는 server 활성화 시점에 추가.
3. **Improver 재작성** — Claude 에게 "분석 결과 + 현재 prompts.json" 주고 "업데이트된 prompt 값" 받아서 Zod 검증 후 저장. `data/improvements/{date}.json` 에 before/after 기록.
4. **`buildAnalysisPrompt` / `buildImprovementPrompt` 시그니처 변경** — 분석 결과가 `targetFile` (코드 경로) 대신 `promptKey` (데이터 키) 반환하도록 *한 번* 수정. 이후 이 두 prompt 자체는 improver 대상 아님 (부트스트랩 루프 회피).
5. **regex / `applyCodeChange` / `filterSafeImprovementFiles` 삭제** — 코드 패치 흐름 전체 제거.
6. **TUI / CLI Generate 경로의 fewShot 주입** — 현재 `actions.ts:runGenerate` 와 `entries/generate.ts` 는 `[]` 빈 fewShot 을 넘김. winner DB 활용 못 하는 문제 동시 해결 (Section 3.6 참조).
7. **비용 가드** — `MIN_CAMPAIGNS_FOR_LEARNING = 3`, `MAX_PROPOSALS_PER_CYCLE = 5`, cost 추정 로그 (Section 5.6 참조).

### 2.2 범위 밖 (의도적 deferred)

| 안 하는 것 | 이유 |
|---|---|
| Server DB 통합 | Server 자체가 미실행. 인터페이스만 맞춰두고 실 구현은 server 활성화 시 |
| Analysis prompt + Improver meta prompt 자기학습 | 학습 결과를 평가하는 prompt 자체가 학습되면 부트스트랩 루프 |
| Prompt 버전 관리 / A-B 테스트 | 현재 단일 사용자 환경, 학습 결과 1개만 유지 |
| Multi-tenant prompt 분기 | Server 활성화 + multi-user 시점에 |
| `creative/image.ts`, `creative/video.ts` 의 prompt | Image/Video 생성 prompt 는 별도 SDK shape — 본 범위는 카피만 |
| Daily/monthly cost ceiling | Server 활성화 시 결정 |
| `writeJson` atomicity 개선 | storage.ts 별 cleanup 주제. 본 spec 의 schema fallback 으로 partial-write 영향 완화됨 (loader 가 깨진 파일 → default 반환) |
| `weakReports[0]` 한 캠페인만 prompt context 에 사용 | 기존 동작 유지. 다음 cleanup 사이클에서 multi-campaign 컨텍스트 검토 |

---

## 3. 핵심 결정 사항

### 3.1 Server 모델은 시스템-wide (Option A)

Server 활성화 시 `learned_prompts` DB 테이블에 *1 행만* (시스템 전역). Improver cron 이 모든 사용자의 캠페인 성과를 집계 → 그 1행 업데이트. 모든 사용자가 동일한 진화하는 prompts 공유.

**이유**:
1. 빠른 학습 수렴 — 데이터 풍부 (수백 사용자 × 캠페인 수)
2. 저비용 — 사용자 수 무관, 사이클당 고정 비용 (Section 5.2 참조)
3. 단순 아키텍처 — `loadPrompts()` 인터페이스가 stateless, 현재 설계 그대로
4. Cold-start 없음 — 신규 사용자도 즉시 학습된 프롬프트 혜택

**Per-user fine-tuning** 은 Premium tier 옵션으로 *미래* 추가. `loadPrompts(userId?)` 형태로 optional 인자만 미리 보장.

### 3.2 비용 회수 — 기존 deduct-first markup 으로 분산

Improver cron 은 플랫폼 운영 비용. 사용자별 직접 차감 안 함. 사용자가 `generateCopy`/`generateImage`/`generateVideo` 호출할 때 기존 markup 으로 운영비 충당.

**이유**:
- Cron 이 사용자 모르게 fire → "잠든 사이 크레딧 차감" UX 나쁨
- 사용자가 실제 가치 받는 시점 = AI 호출 시점. 그 시점 markup 이 자연스러움
- 신규 결제 플로우 추가 필요 없음

실제 markup 정책은 server 활성화 시 다음을 기반으로 별도 결정: (a) 측정된 Anthropic 실제 토큰 비용, (b) 사용자 분포 (long-tail 이면 power user 가 분담), (c) Stripe 결제 수수료. 본 spec 의 추정치는 cost-of-magnitude 예시.

### 3.3 자기학습 대상 범위 — copy.* 만

`prompts.json` 의 자기학습 대상 = `copy.systemPrompt`, `copy.userTemplate`, `copy.angleHints.{emotional,numerical,urgency}` — 총 5개 키. 의도적으로 좁힘.

**제외**:
- `buildAnalysisPrompt`, `buildImprovementPrompt` — 메타 프롬프트, 부트스트랩 루프 회피
- priceText fallback (`"가격 미정"`), fewShotBlock 헤더 (`"참고 예시:"`) — micro 포맷, schema 복잡도/검증 surface 줄임
- image / video prompt — 별도 SDK shape, 본 범위 밖

학습이 누적된 후 micro 포맷도 학습 대상에 추가할지 검토.

### 3.4 Schema regex 일부러 약화

`copy.systemPrompt` 는 `min(50)`, `userTemplate` 은 `min(100)`, `angleHints.*` 는 `min(10)` — 길이 가드만. 내용 검증 (특정 표현 포함 여부 등) 안 함. 실 운영 데이터 누적 후 강화.

핵심 placeholder (`{{name}}`, `{{description}}`, `{{angleHint}}`) 만 필수 포함 검증. 선택적 placeholder (`{{priceText}}`, `{{category}}`, `{{tags}}`, `{{targetUrl}}`, `{{fewShotBlock}}`) 는 improver 가 빼도 OK.

### 3.5 `Improvement.changes[].type` 필드 제거

기존 `ImprovementChange` 는 `type: "prompt_update" | "param_update" | "bug_fix"` 를 갖고 있었으나 이제 prompt update 만 존재. 필드 자체를 제거하여 type 시스템에서 의미 없는 union 제거.

기존 `data/improvements/*.json` 파일이 있다면 mixed shape 으로 누적되지만 (audit 용 read-only) runtime 영향 zero. 사용자 환경에서는 0개 파일이라 영향 zero.

---

## 4. Schema + Loader

### 4.1 `data/learned/prompts.json` 스키마

```jsonc
{
  "copy": {
    "systemPrompt": "당신은 Meta(Instagram/Facebook) 광고 카피라이터입니다...",
    "userTemplate": "다음 제품/서비스에 대한 Instagram 광고 카피를 작성해주세요.\n\n제품명: {{name}}\n설명: {{description}}\n가격: {{priceText}}\n카테고리: {{category}}\n태그: {{tags}}\n링크: {{targetUrl}}\n\n이 variant의 톤 가이드: {{angleHint}}{{fewShotBlock}}",
    "angleHints": {
      "emotional": "감정 호소 중심으로 독자의 욕구·공감대를 자극하세요.",
      "numerical": "수치·통계·비교를 전면에 배치하세요.",
      "urgency": "긴급성·희소성(기한, 한정 수량 등)을 강조하세요."
    }
  }
}
```

### 4.2 Zod 스키마 + 검증 helper

```ts
// packages/core/src/learning/prompts.ts (신규)
import { z } from "zod";

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
```

### 4.3 Loader (lazy singleton)

```ts
// packages/core/src/learning/prompts.ts (계속)
import { readJson } from "../storage.js";

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

반드시 JSON 형식으로만 응답하세요:
{"headline":"","body":"","cta":"","hashtags":[]}`,
    userTemplate: `다음 제품/서비스에 대한 Instagram 광고 카피를 작성해주세요.

제품명: {{name}}
설명: {{description}}
가격: {{priceText}}
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

export async function loadPrompts(): Promise<Prompts> {
  if (cached) return cached;
  const raw = await readJson<unknown>(DEFAULT_PROMPTS_PATH);
  if (!raw) {
    cached = DEFAULT_PROMPTS;
    return cached;
  }
  const parsed = PromptsSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(`[prompts] ${DEFAULT_PROMPTS_PATH} 검증 실패, default 사용:`, parsed.error.message);
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
```

핵심 동작:
- 파일 부재 → DEFAULT_PROMPTS (zero-config)
- 파일 schema 깨짐 → `console.warn` + DEFAULT_PROMPTS. 자기학습 데이터 손상이 collect/generate/launch 핵심 흐름을 깨뜨리지 않도록 improver 영향 범위만 격리. 사용자는 다음 improver 사이클에서 자동 복구 (analysis 가 default 기준으로 다시 제안)
- 정상 → 캐시
- Improver 가 새 prompts 쓰면 `invalidatePromptsCache()` 호출 → 다음 `loadPrompts()` 가 디스크 재read

### 4.4 Placeholder 치환 helper

```ts
export function substitutePlaceholders(
  template: string,
  values: Record<string, string>,
): string {
  let result = template;
  for (const [key, val] of Object.entries(values)) {
    result = result.replaceAll(`{{${key}}}`, val);
  }
  return result;
}
```

`replaceAll` 로 같은 placeholder 가 여러 번 등장해도 모두 치환. 미정의 placeholder 는 그대로 (`{{unknown}}` 가 prompt 안에 시각적으로 남아 디버깅 용이).

### 4.5 파일 위치 + git 정책

`data/learned/prompts.json` — `.gitignore` 의 `data/` 규칙으로 자동 git 제외. 사용자별 로컬 학습 데이터. 새 머신에서 `git clone` → 즉시 default 로 동작 → 시간 지나며 학습 누적. 학습 결과 백업은 사용자가 수동 (`data/` 동기화).

이 정책은 `data/improvements/{date}.json` 도 동일 — 사용자 로컬 audit.

### 4.6 호출처 변경

```ts
// creative/copy.ts (변경 후)
import { loadPrompts } from "../learning/prompts.js";

export async function generateCopy(
  client: Anthropic,
  product: Product,
  fewShot: FewShotExample[] = [],
  variantLabel: VariantLabel = "emotional",
): Promise<Creative["copy"]> {
  const prompts = await loadPrompts();
  const userPrompt = await buildCopyPrompt(product, fewShot, variantLabel);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: [{ type: "text", text: prompts.copy.systemPrompt, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userPrompt }],
  });
  // ... rest unchanged
}
```

```ts
// creative/prompt.ts (변경 후 — async + loader 사용)
import { loadPrompts, substitutePlaceholders } from "../learning/prompts.js";

export async function buildCopyPrompt(
  product: Product,
  fewShot: FewShotExample[],
  variantLabel: VariantLabel,
): Promise<string> {
  const prompts = await loadPrompts();
  const priceText = product.price
    ? `${product.currency} ${product.price.toLocaleString()}`
    : "가격 미정";
  const fewShotBlock =
    fewShot.length > 0
      ? `\n\n참고 예시:\n${fewShot
          .map((ex, i) => `[${i + 1}] 헤드라인: ${ex.headline} / 본문: ${ex.body} / CTA: ${ex.cta}`)
          .join("\n")}\n`
      : "";
  return substitutePlaceholders(prompts.copy.userTemplate, {
    name: product.name,
    description: product.description,
    priceText,
    category: product.category ?? "기타",
    tags: product.tags.join(", "),
    targetUrl: product.targetUrl,
    angleHint: prompts.copy.angleHints[variantLabel],
    fewShotBlock,
  });
}
```

`buildCopyPrompt` 가 async 가 됨. 호출처 (`pipeline.ts:78`, `actions.ts:120` 의 generateCopy 인자 빌드, `entries/generate.ts:24` 의 generateCopy 인자 빌드, 즉 generateCopy 안에서 호출) 가 이미 async 함수 안이라 `await` 추가만으로 OK.

기존 export 정리:
- `creative/copy.ts:COPY_SYSTEM_PROMPT` 제거 — 사용처는 `creative/copy.test.ts` 4개 assertion 만. 마이그레이션 시 `import { DEFAULT_PROMPTS } from "../learning/prompts.js"` 로 변경하고 `DEFAULT_PROMPTS.copy.systemPrompt` 검증으로 교체
- `creative/prompt.ts:ANGLE_HINTS` 제거 — 외부 export 없음 (`grep` 결과 internal use only)

---

## 5. Improver 흐름 변경

### 5.1 새 데이터 흐름

```
Weekly Analysis (Claude #1)
  Input:  weak Reports + stats + current prompts.json (JSON-stringified)
  Output: { summary, improvements: [{ campaignId, issue, suggestion, promptKey }] }
                                                         ↑
                                            enum: copy.systemPrompt / copy.userTemplate /
                                                  copy.angleHints.{emotional,numerical,urgency}
                  ↓
For each improvement (max MAX_PROPOSALS_PER_CYCLE=5):

Improvement Generator (Claude #2)
  Input:  promptKey + current value at that key + issue + suggestion + perfContext
  Output: { promptKey, newValue, reason }
                  ↓
4-Gate Validation:
  Gate 1: parsePromptUpdate (newValue/promptKey 존재)
  Gate 2: setPromptValue → 전체 PromptsSchema.safeParse (string min 길이)
  Gate 3: validateUserTemplate (REQUIRED_PLACEHOLDERS, userTemplate 만)
  Gate 4: BANNED_PATTERNS 검사 (personalization + unverified-hyperbole)
                  ↓
통과: writeJson(prompts.json) + invalidatePromptsCache() + audit append
실패: data/improvements/{date}-rejected.json 에 사유 기록 + skip
                  ↓
Cost log: accepted/rejected 수 + 추정 비용 emit
```

각 gate 실패 시 *해당 proposal 만 skip*, 다른 proposal 계속 진행. 사이클 전체가 멈추지 않음.

### 5.2 `buildAnalysisPrompt` 변경

```ts
// packages/core/src/campaign/monitor.ts (변경 후)
export function buildAnalysisPrompt(
  reports: Report[],
  stats: PerformanceStats,
  currentPrompts: Prompts,  // ← 신규 인자
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
```

`generateWeeklyAnalysis` 도 `loadPrompts()` 호출 추가 후 `buildAnalysisPrompt(reports, stats, prompts)` 형태로 호출.

### 5.3 `improver/index.ts` 새 시그니처

```ts
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
```

### 5.4 `improver/runner.ts` 전면 재작성

`filterSafeImprovementFiles`, `applyCodeChange`, `execFileSync git ...` 모두 삭제. 새 본체:

```ts
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
  ALLOWED_PROMPT_KEYS,
  buildImprovementPrompt,
  isAllowedPromptKey,
  parsePromptUpdate,
  getCtrThreshold,
  type AnalysisResult,
  type PromptKey,
} from "./index.js";
import type { Report, Improvement, ImprovementChange } from "../types.js";

const PROMPTS_PATH = "data/learned/prompts.json";
const MAX_PROPOSALS_PER_CYCLE = 5;
const ANALYSIS_CALL_USD = 0.005;
const PROPOSAL_CALL_USD = 0.01;

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
): Promise<void> {
  if (weakReports.length === 0) return;
  const proposals = (analysis.improvements ?? [])
    .filter((it) => isAllowedPromptKey(it.promptKey))
    .slice(0, MAX_PROPOSALS_PER_CYCLE);
  if (proposals.length === 0) return;

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
      model: "claude-sonnet-4-6",
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
    await writeJson(PROMPTS_PATH, currentPrompts);
    invalidatePromptsCache();
    const improvement: Improvement = {
      date: dateKey,
      trigger: `${weakReports.length}개 캠페인 CTR 임계값 미달`,
      changes: accepted,
    };
    await appendJson(`data/improvements/${dateKey}.json`, improvement);
    console.log(`[improver] ${accepted.length}개 prompt 업데이트 적용 — ${PROMPTS_PATH}`);
  }
  if (rejected.length > 0) {
    await appendJson(`data/improvements/${dateKey}-rejected.json`, { date: dateKey, rejected });
    console.warn(`[improver] ${rejected.length}개 제안 거부 (검증 실패)`);
  }

  const estCost = ANALYSIS_CALL_USD + (accepted.length + rejected.length) * PROPOSAL_CALL_USD;
  console.log(
    `[improver] cycle complete — accepted=${accepted.length} rejected=${rejected.length} ` +
    `est_cost=$${estCost.toFixed(3)}`,
  );
}
```

### 5.5 `core/types.ts` Improvement 변경

```ts
export interface ImprovementChange {
  promptKey: string;
  before: string;
  after: string;
  reason?: string;
}

export interface Improvement {
  date: string;
  trigger: string;
  changes: ImprovementChange[];
}
```

`type` 필드 제거. 사용처 전부 grep 확인 — `runner.ts:4,41` 만 import/사용 (grep 검증 완료).

### 5.6 `scheduler/improvementCycle.ts` — `MIN_CAMPAIGNS_FOR_LEARNING` 가드

```ts
const MIN_CAMPAIGNS_FOR_LEARNING = 3;

export async function defaultRunCycleAdapter(
  analysis: object | null,
  reports: VariantReport[],
): Promise<void> {
  if (!analysis) return;
  const aggregated = variantReportsToReports(reports);
  if (aggregated.length < MIN_CAMPAIGNS_FOR_LEARNING) {
    console.log(
      `[improvementCycle] insufficient data (${aggregated.length}/${MIN_CAMPAIGNS_FOR_LEARNING}), skipping cycle`,
    );
    return;
  }
  const weak = aggregated.filter(shouldTriggerImprovement);
  if (weak.length === 0) return;
  await defaultRunCycle(weak, analysis as AnalysisResult);
}
```

이전 `JSON.stringify(analysis)` round-trip 제거. `analysis` object 직접 전달.

### 5.7 TUI/CLI Generate fewShot 주입

본 작업 범위에 포함. winner DB 학습 결과를 카피 생성에 실제 활용하기 위한 필수 wiring.

**Lifecycle**: voyage 클라이언트와 creativesDb 핸들은 `runGenerate` 의 try 블록 안에서 1회 생성, products loop 가 모두 끝난 후 `finally` 에서 optional chain 으로 close. constructors 가 try 밖에 있으면 `createCreativesDb` 자체가 throw 할 때 (예: 디스크 권한 문제) catch/finally 가 우회되어 caller 에 raw exception 이 전파된다. fewShot 회수만 product 별로 호출. winner DB 핸들이 매 product 마다 open/close 되면 SQLite 오버헤드 누적.

```ts
// packages/cli/src/actions.ts: runGenerate (변경 후 — 골격)
import { retrieveFewShotForProduct } from "@ad-ai/core/rag/retriever.js";
import { createVoyageClient } from "@ad-ai/core/rag/voyage.js";
import { createCreativesDb } from "@ad-ai/core/rag/db.js";
import { WinnerStore } from "@ad-ai/core/rag/store.js";

export async function runGenerate(...): Promise<DoneResult> {
  let creativesDb: ReturnType<typeof createCreativesDb> | null = null;
  try {
    const voyage = createVoyageClient();
    creativesDb = createCreativesDb();
    const winnerStore = new WinnerStore(creativesDb);
    // ... 기존 product loop ...
    for (const product of products) {
      // (existing image/video 3-track 시작 전 또는 copiesTask 안에서 1회 회수)
      const fewShot = await retrieveFewShotForProduct(product, {
        embed: (texts) => voyage.embed(texts),
        loadAllWinners: () => winnerStore.loadAll(),
      });
      // copiesTask 안의 generateCopy 호출:
      const c = await generateCopy(anthropic, product, fewShot, label);
      // ...
    }
  } catch (e) {
    return { success: false, message: "Generate 실패", logs: [String(e)] };
  } finally {
    creativesDb?.close();
  }
}
```

`entries/generate.ts` 도 동일 패턴 (단일 product 라 loop 없이 한 번 회수). 두 경로 모두 `pipeline.ts` 의 기존 winner DB lifecycle 패턴 차용 (`pipeline.ts` 도 outer scope 에서 db open, finally close).

**fewShot 회수 위치**: `runGenerate` 의 3-track 병렬 (image/video/copy) 구조에서 fewShot 회수는 voyage embedding 1회 호출 (~1초) — copy track 시작 전 sequential 또는 copy track 첫 단계로 배치. image/video 와 병렬화는 불필요 (fewShot 은 copy 만 사용).

`runGenerate` 의 3-track 병렬 (image/video/copy) 구조에서 `copiesTask` 안에 fewShot 회수가 포함됨. fewShot 은 product 별 1회 회수 후 3 variant 모두에서 동일하게 사용.

---

## 6. 테스트 전략

### 6.1 안전 메커니즘 4중 가드

```
Claude 응답
   ↓
Gate 1: parsePromptUpdate (JSON parse, newValue/promptKey 존재)
   ↓ 실패 → reject log, skip
Gate 2: setPromptValue → 전체 PromptsSchema.safeParse
   ↓ 실패 → reject log, skip
Gate 3: validateUserTemplate (REQUIRED_PLACEHOLDERS, userTemplate 만)
   ↓ 실패 → reject log, skip
Gate 4: BANNED_PATTERNS 검사 (personalization + unverified-hyperbole)
   ↓ 실패 → reject log, skip
   ↓
WriteJson + invalidatePromptsCache + audit
```

추가 안전:
- `loadPrompts()` 파일 손상 시 default fallback (§4.3)
- `MIN_CAMPAIGNS_FOR_LEARNING = 3` 미달 skip (§5.6)
- `MAX_PROPOSALS_PER_CYCLE = 5` 상한 (§5.4)
- `DEFAULT_PROMPTS` 코드 박힘 → 파일시스템 망가져도 default 동작

### 6.2 테스트 격리 셋업 변경

```ts
// vitest.setup.ts (변경 후)
import { beforeEach, afterEach } from "vitest";
import { setConfigForTesting, resetConfigForTesting } from "./packages/core/src/config/index.js";
import { makeTestConfig } from "./packages/core/src/config/testing.js";
import { setPromptsForTesting } from "./packages/core/src/learning/prompts.js";

beforeEach(() => {
  setConfigForTesting(makeTestConfig());
  setPromptsForTesting(null);
});

afterEach(() => {
  resetConfigForTesting();
});
```

### 6.3 신규 테스트 파일

#### `learning/prompts.test.ts` (신규, 12 케이스)

| 케이스 | 내용 |
|---|---|
| 1 | `loadPrompts()` 파일 없으면 DEFAULT_PROMPTS |
| 2 | `loadPrompts()` 유효 JSON → 파싱된 값 |
| 3 | `loadPrompts()` schema 깨짐 → console.warn + DEFAULT_PROMPTS |
| 4 | `loadPrompts()` 캐시 동작 (두 번째 호출 시 디스크 read 안 함) |
| 5 | `setPromptsForTesting(custom)` 주입 |
| 6 | `setPromptsForTesting(null)` 캐시 클리어 |
| 7 | `invalidatePromptsCache()` 후 재load → 디스크 read |
| 8 | `validateUserTemplate(...)` REQUIRED 모두 있으면 [] |
| 9 | `validateUserTemplate(...)` 일부 누락 → 누락 키 배열 |
| 10 | `substitutePlaceholders` 단일 치환 |
| 11 | `substitutePlaceholders` 다중 occurrence + 다중 키 |
| 12 | `substitutePlaceholders` 미정의 key 그대로 |

#### `improver/runner.test.ts` (전면 재작성, 10 케이스)

기존 케이스 (code patching, applyCodeChange, filterSafeImprovementFiles) 전부 폐기.

| 케이스 | 내용 |
|---|---|
| 1 | weakReports.length === 0 → 즉시 return, Claude 호출 없음 |
| 2 | analysis.improvements 모두 disallowed promptKey → skip |
| 3 | MAX_PROPOSALS_PER_CYCLE 상한 (6개 제안 → 5개만 처리) |
| 4 | 정상 흐름 — Claude valid → prompts.json 쓰기 + invalidatePromptsCache + audit |
| 5 | parsePromptUpdate 실패 → rejected |
| 6 | promptKey 불일치 → rejected |
| 7 | Schema 검증 실패 (newValue too short) → rejected |
| 8 | userTemplate 변경 시 placeholder 누락 → rejected |
| 9 | 정상 + 일부 reject 혼합 |
| 10 | Cost 로그 emit (accepted/rejected 합산) |

Claude SDK stub: `vi.mock("@anthropic-ai/sdk", () => ({...}))` 패턴.

### 6.4 기존 테스트 변경

| 파일 | 변경 |
|---|---|
| `improver/index.test.ts` | `buildImprovementPrompt` 신규 시그니처 / `isAllowedPromptKey` / `parsePromptUpdate` 케이스 추가. 기존 file-path 케이스 폐기 |
| `scheduler/improvementCycle.test.ts` | `defaultRunCycleAdapter` 가 object 받음 + MIN_CAMPAIGNS skip 케이스 신규 |
| `campaign/monitor.test.ts` | `buildAnalysisPrompt(reports, stats, currentPrompts)` 시그니처. `generateWeeklyAnalysis` 내부 `loadPrompts()` 호출 위해 setPromptsForTesting 주입 |
| `creative/copy.test.ts` | `import { COPY_SYSTEM_PROMPT }` → `import { DEFAULT_PROMPTS } from "../learning/prompts.js"` 변경. 4개 assertion (`onContain("40")` 등) 은 `DEFAULT_PROMPTS.copy.systemPrompt` 검증으로 교체. `generateCopy` 케이스는 `setPromptsForTesting(DEFAULT_PROMPTS)` 명시적 주입 |
| `creative/prompt.test.ts` | `buildCopyPrompt` 이제 async — `await` 추가. 결과 문자열에 default userTemplate placeholder 가 모두 치환됐는지 verify |
| `cli/src/actions.test.ts` | runGenerate 가 retrieveFewShotForProduct 호출 — voyage/creatives.db stub 추가. fewShot 비어있을 때 / winner 있을 때 두 분기 검증 |

### 6.5 실패 모드 매트릭스

| 시나리오 | 동작 |
|---|---|
| `data/learned/prompts.json` 없음 | DEFAULT_PROMPTS, 시스템 정상 |
| 파일 JSON parse 실패 | console.warn + DEFAULT_PROMPTS |
| 파일 schema 어긋남 | console.warn + DEFAULT_PROMPTS |
| 디스크 쓰기 실패 (improver write) | runner 내부 try/catch 없음 → 상위 cycle catch 에서 console.error 후 다음 tick 재시도 |
| Claude timeout/rate-limit | proposal 단위 try (현재 구현은 cycle 전체 try 없음 — runImprovementCycle 호출자가 try/catch) |
| Claude 빈 응답 | parsePromptUpdate → `{}` → newValue 누락 → rejected |
| Claude 깨진 텍스트 | JSON 파싱 실패 → rejected |
| improver 도중 process kill | `writeJson` 이 non-atomic — partial file 가능. loader 가 schema fail → default fallback 으로 자동 복구 |

`writeJson` atomicity 는 본 spec 범위 밖이지만 loader 의 schema fallback 으로 partial-write 영향이 자동 복구됨. atomic write 도입은 별도 cleanup 주제.

### 6.6 캐시 Invalidation 통합 검증

`improver/runner.test.ts` 케이스 4 (정상 흐름) 안에 어서션:

```ts
await runImprovementCycle(weakReports, analysis);
// invalidate 후 새 disk read 가 일어나는지
const reloaded = await loadPrompts();
expect(reloaded.copy.angleHints.emotional).toBe("새로 학습된 값");
```

worker 장기 실행 환경에서 improver 가 prompts.json 업데이트 후 다음 generateCopy 가 새 값 사용하는 흐름 확인.

### 6.7 테스트 수 delta

| 영역 | 신규 | 수정 | 삭제 |
|---|---|---|---|
| `learning/prompts.test.ts` | 12 | 0 | 0 |
| `improver/runner.test.ts` | 10 | 0 | 기존 모두 (~5 추정) |
| `improver/index.test.ts` | 3 | 2 (kept) | 1 (old) |
| `scheduler/improvementCycle.test.ts` | 1 | 2-3 | 0 |
| `campaign/monitor.test.ts` | 0 | 1 | 0 |
| `creative/copy.test.ts` | 0 | 5-6 (assertion 교체) | 0 |
| `creative/prompt.test.ts` | 0 | 2-3 | 0 |
| `cli/src/actions.test.ts` | 2 | 0 | 0 |

대략 +28 신규 / -5 삭제 → net **+23**. 358 → ~381. 정확 수치는 implementation 시 확정.

---

## 7. 비용 가드

### 7.1 CLI 실측 비용 (단일 사용자, Sonnet 4.6 기준 추정)

| 항목 | 1회 비용 |
|---|---|
| Weekly analysis call (input ~2k, output ~1k) | ~$0.005 |
| Improvement proposal call × N | ~$0.01 × N |
| 1 사이클 (1 analysis + 평균 3 proposals) | ~$0.035 |
| Owner cadence (2일 주기) → 월 ~15 사이클 | **~$0.50/month** |

CLI 단일 사용자 환경에서는 무시 가능.

### 7.2 Server 비용 모델 (활성화 시)

`learned_prompts` DB 테이블 1행 — 시스템 전역. cron 1회 = 1 사이클 (사용자 수 무관). 비용 회수는 기존 deduct-first markup 으로 분산.

| 사용자 수 | 시스템-wide (선택) | 사용자별 (배제) |
|---|---|---|
| 100 | ~$0.50/월 | ~$50/월 |
| 1,000 | ~$0.50/월 | ~$500/월 |
| 10,000 | ~$0.50/월 | ~$5,000/월 |

### 7.3 본 spec 의 비용 가드

1. `MIN_CAMPAIGNS_FOR_LEARNING = 3` — 데이터 부족 시 사이클 skip
2. `MAX_PROPOSALS_PER_CYCLE = 5` — Claude 가 10개 제안해도 상위 5개만
3. Cadence 자체 (Owner 2일, Server 7일) — cron 으로 자연 throttle
4. Cost 로그 — 사이클 종료 시 1줄 emit, 누적 grep 가능

### 7.4 Server 미래 옵션 (본 spec 범위 밖)

- Per-user fine-tuning premium tier (`loadPrompts(userId?)` optional 인자)
- Daily/monthly cost ceiling
- 프롬프트 카테고리별 분기 (course/ecommerce 등)

`loadPrompts` 시그니처에 optional userId 인자 미리 보장 — 미래 확장이 인터페이스 깨지지 않도록.

---

## 8. 작업 순서 (5 commits)

각 commit 은 그린 빌드 + 그린 테스트 유지하도록 atomic.

### Commit 1 — Loader + Schema + DEFAULT_PROMPTS

**Files (new):**
- `packages/core/src/learning/prompts.ts`
- `packages/core/src/learning/prompts.test.ts` — 12 케이스

**Files (modify):**
- `vitest.setup.ts` — `setPromptsForTesting(null)` reset

**범위**: 순수 추가, 기존 동작 변화 없음. loader 가 어디서도 import 안 됨.

**Subagent**: `superpowers:code-reviewer`

### Commit 2 — `creative/*` 마이그레이션

**Files (modify):**
- `packages/core/src/creative/copy.ts` — `COPY_SYSTEM_PROMPT` export 제거, `loadPrompts()` 사용
- `packages/core/src/creative/prompt.ts` — `ANGLE_HINTS` 제거, `buildCopyPrompt` async 변환
- `packages/cli/src/pipeline.ts` — `await buildCopyPrompt(...)`
- `packages/cli/src/actions.ts` — 동일
- `packages/cli/src/entries/generate.ts` — 동일
- `packages/core/src/creative/copy.test.ts` — `COPY_SYSTEM_PROMPT` import → `DEFAULT_PROMPTS.copy.systemPrompt` 로 교체. 4개 assertion 동일하게 검증
- `packages/core/src/creative/prompt.test.ts` — async fixture + placeholder 치환 검증

**범위**: 동작 보존. DEFAULT_PROMPTS 가 byte-단위로 기존 하드코딩 값과 동일.

**Subagent**: `marketing-copy-reviewer` (creative/prompt.ts 수정 — Copy 생성 로직 변경 트리거) + `superpowers:code-reviewer`

마케팅 reviewer 검증 포인트:
- DEFAULT_PROMPTS 의 각 필드가 byte-단위로 기존 값과 동일 (회귀 zero)
- `substitutePlaceholders` 결과 문자열이 기존 `buildCopyPrompt` 결과와 동일 (whitespace/줄바꿈 포함)

### Commit 3 — Improver 재작성

**Files (modify):**
- `packages/core/src/types.ts` — `Improvement.ImprovementChange` 새 shape
- `packages/core/src/types.test.ts` — Improvement fixture
- `packages/core/src/campaign/monitor.ts` — `buildAnalysisPrompt(reports, stats, currentPrompts)` + `generateWeeklyAnalysis` 내부 loadPrompts
- `packages/core/src/campaign/monitor.test.ts` — fixture
- `packages/core/src/improver/index.ts` — 새 시그니처 + 새 타입
- `packages/core/src/improver/index.test.ts` — 신규/수정/삭제
- `packages/core/src/improver/runner.ts` — 전면 재작성. `filterSafeImprovementFiles`, `applyCodeChange`, `execFileSync git ...` 삭제
- `packages/core/src/improver/runner.test.ts` — 전면 재작성, 10 케이스
- `packages/core/src/scheduler/improvementCycle.ts` — `defaultRunCycleAdapter` 단순화 + MIN_CAMPAIGNS 가드
- `packages/core/src/scheduler/improvementCycle.test.ts` — 시그니처 + 신규 케이스

**Subagent**: `marketing-copy-reviewer` (runImprove 산출물 변경) + `superpowers:code-reviewer`

마케팅 reviewer 검증 포인트:
- `buildAnalysisPrompt` / `buildImprovementPrompt` 가 Claude 에게 명확한 promptKey enum + placeholder 가드 제시
- Reject log 가 다음 사이클이 학습할 수 있는 진단 정보 포함

### Commit 4 — TUI/CLI Generate fewShot 주입

**Files (modify):**
- `packages/cli/src/actions.ts` — `runGenerate` 에 `retrieveFewShotForProduct` 패턴 복제 + voyage/creatives.db 라이프사이클
- `packages/cli/src/entries/generate.ts` — 동일 패턴
- `packages/cli/src/actions.test.ts` — voyage/creatives.db stub + 2 신규 케이스 (winner 있음/없음)

**Subagent**: `marketing-copy-reviewer` (runGenerate 산출물 변경) + `superpowers:code-reviewer`

### Commit 5 — 문서

**Files (modify):**
- `docs/ARCHITECTURE.md` — 새 섹션 §X "프롬프트-as-Data 학습 패턴". Why / How / Trade-off. CLI/Server 데이터 layer 차이 (file vs DB) 명시
- `docs/STATUS.md` — 마지막 업데이트 `2026-04-26`. 최근 변경 이력 맨 위 1줄
- `docs/ROADMAP.md` — 마지막 업데이트 갱신. Tier 3 "자율 개선 루프 강화" 항목 갱신

**Subagent**: 없음

### 8.1 Subagent 호출 매트릭스

| Commit | meta-platform-expert | marketing-copy-reviewer | code-reviewer |
|---|---|---|---|
| 1 (loader) | ❌ | ❌ | ✅ |
| 2 (creative migration) | ❌ | ✅ | ✅ |
| 3 (improver rewrite) | ❌ | ✅ | ✅ |
| 4 (fewShot 주입) | ❌ | ✅ | ✅ |
| 5 (docs) | ❌ | ❌ | ❌ |

`meta-platform-expert` 트리거 없음 (`platform/meta/*` 수정 없음).

### 8.2 작업 시간 견적

| 단계 | 시간 |
|---|---|
| Commit 1 (loader + schema + 12 테스트) | 1.5h |
| Commit 2 (creative 마이그레이션 + 호출처 await) | 1h |
| Commit 3 (improver 재작성 + types + scheduler + 13 테스트) | 3h |
| Commit 4 (TUI/CLI fewShot 주입) | 1h |
| Commit 5 (문서) | 0.5h |
| Subagent reviews × 7 + 수정 라운드 | 2h |
| 전체 테스트 그린 안정화 | 0.5h |
| **합계** | **~9.5시간 (1.5일)** |

---

## 9. 영속 데이터 마이그레이션

**필요 없음**. `data/improvements/` 는 0개 파일 (Plan C 검증 미시작 상태). `data/learned/prompts.json` 은 새로 생성될 파일. 기존 `Improvement.changes[].type` 필드 제거는 향후 audit 파일 read 코드 없으므로 호환성 문제 없음.

---

## 10. 리스크 + 롤백

### 10.1 Critical 위험

**Commit 2 의 byte-단위 default 일치 보장 실패**: 기존 카피 생성과 다른 결과 → 광고 회귀.

완화:
- Commit 2 의 marketing-copy-reviewer 가 byte-단위 일치 검증
- `creative/copy.test.ts` 의 `expect(...).toBe(LITERAL)` assertion 으로 자동 회귀 감지 가능 — 가능하면 자동 케이스 추가

### 10.2 일반 롤백

각 commit `git revert <sha>` 단순 복구. `data/learned/prompts.json` 이 생성된 상태에서 revert 하면 코드는 옛날로 돌아가지만 파일은 남음 — 다음 generateCopy 가 hardcoded const 사용하므로 prompts.json 의미 없어짐 → 안전.

### 10.3 중간 상태 안전성

- Commit 1 만 land — 시스템 정상 (loader 가 어디서도 import 안 됨)
- Commit 1+2 만 land — 시스템 정상 (improver 는 옛날 코드 패치 흐름이지만 regex 깨진 채. 즉 *현재 master 보다 더 망가지지는 않음*, Critical #1 미해결 상태)
- Commit 1+2+3 land — 자기학습 진짜 동작 확보. **반드시 여기까지는 한 번에 land**
- Commit 4 분리 OK — fewShot 주입은 학습 루프 위에서 따로 활성화
- Commit 5 분리 OK — 순수 문서

### 10.4 Definition of Done

- [ ] 5 commits 모두 그린 빌드 + 그린 테스트
- [ ] `npm test` ~378-385
- [ ] `data/learned/prompts.json` 부재 시 시스템 정상 (default fallback)
- [ ] `applyCodeChange` / `filterSafeImprovementFiles` / `execFileSync.*git` grep 결과 0건
- [ ] `metaAssetLabel|adQualityRanking` 같은 옛 필드 회귀 0건
- [ ] marketing-copy-reviewer 통과 (Commit 2/3/4)
- [ ] code-reviewer 통과 (Commit 1/2/3/4)
- [ ] STATUS 마지막 업데이트 = 2026-04-26
- [ ] ROADMAP Tier 3 "자율 개선 루프 강화" 갱신
- [ ] ARCHITECTURE 에 prompt-as-data 섹션 신규

---

## 11. Open Questions / 후속 작업

1. **`writeJson` atomicity** — `data/learned/prompts.json` 쓰기 도중 process kill 시 partial file 가능. loader 의 schema fallback 으로 자동 복구되지만, atomic write (temp + rename) 도입 검토. 별 spec 또는 다음 cleanup 사이클.
2. **`weakReports[0]` 한 캠페인만 prompt context** — 여러 weak campaign 있어도 첫 번째만 사용. multi-campaign aggregate context 검토.
3. **micro 포맷 자기학습** — `"가격 미정"`, `"참고 예시:"` 등 TS 코드 안 정적 문자열도 학습 대상으로 확장할지. 데이터 누적 후 검토.
4. **Server 활성화 시점의 DB 스키마** — `learned_prompts` 테이블 구조. 본 spec 의 file-based shape (`Prompts` interface) 그대로 column 매핑. server activation spec 에서 확정.
5. **Prompt 버전 관리** — 학습 결과 1개만 유지 vs N개 history 유지. A/B 테스트 인프라와 연동될 수 있음. server activation 후 검토.
6. **Premium tier per-user fine-tuning** — `loadPrompts(userId?)` optional 인자 미리 보장. 실 구현은 별 spec.

---

## 12. 검토 이력

### 2026-04-26 — 초안 작성 + 섹션 단위 자체 검토

본 스펙은 brainstorming 단계에서 6개 섹션 (범위 / Schema+Loader / Improver 흐름 / 비용+Server / 안전+테스트 / 작업순서) 으로 나누어 각각 자체 검토를 거쳐 작성됐다. 섹션별 발견 이슈:

**Section 1 (범위)** — Critical/Important/Minor: 0건 

**Section 2 (Schema+Loader) — Important 1건**
- schema 검증 실패 시 default fallback 정당화가 일반론 ("운영 안전") → "자기학습 데이터 손상이 collect/generate/launch 핵심 흐름까지 깨뜨리지 않도록 improver 영향 범위만 격리" 로 강화. §4.3 본문 반영.

**Section 3 (Improver 흐름) — Important 1건 + Minor 1건**
- `setPromptValue` 깊은 복제가 `JSON.parse(JSON.stringify(...))` 패턴 — 미래 non-JSON 타입 추가 시 silent breakage. 주석 강화로 future trap 방지. §5.4 본문 반영.
- Minor: N+1 Claude 호출 비용 — Section 4 throttle 가드로 대응.

**Section 4 (비용+Server) — Important 1건**
- 비용 추정치 ($0.005/$0.01) + markup 가정 (0.001원) 검증 안 됨 — server 활성화 시 실제 측정 + Stripe 수수료 + 사용자 분포 기반 결정 명시. §3.2 + §7.1 본문 반영.

**Section 5 (안전+테스트) — Important 1건 + Minor 1건**
- `creative/copy.test.ts` / `creative/prompt.test.ts` / `campaign/monitor.test.ts` 존재 여부 미확인 → spec 작성 시 grep 으로 직접 확인 (모두 존재 확인됨, §6.4 반영). `COPY_SYSTEM_PROMPT` 가 4 assertion 으로 import-test 됨 → §4.6 + §6.4 에 마이그레이션 경로 명시.
- Minor: test count delta 추정 — 정확 수치는 implementation 단계 확정.

**Section 6 (작업순서) — Minor 1건**
- Commit 2 byte-단위 default 일치 검증을 자동화 가능 여부 — `creative/copy.test.ts` 의 기존 assertion 패턴 그대로 활용 가능 (§10.1 자동 회귀 감지 가능 명시).

### 2026-04-26 — 스펙 작성 후 자체 검토 (5점 점검 추가 적용)

**Important #5**: §5.7 fewShot 주입 코드 스니펫의 voyage/creativesDb lifecycle 모호 — 주석 *"각 product 처리 시"* + try/finally 가 product loop 안인지 밖인지 불명확. SQLite 핸들이 매 product 마다 open/close 되면 오버헤드. 인라인 수정: §5.7 본문 교체 — outer scope 에서 1회 생성 + 전체 finally close + product loop 안에서 fewShot 회수만 호출. pipeline.ts 의 기존 패턴과 일치 명시.

**Minor #4**: §6.4 `actions.test.ts` 신규 2 케이스의 voyage/better-sqlite3 stub 패턴 미명시. implementation 단계에서 결정 — 기존 cli/src/actions.test.ts 의 vi.mock 패턴 차용 가능.

### 종합

- Critical: 0건
- Important: 5건 (섹션별 brainstorming 4건 + 스펙 자체 검토 1건). **모두 인라인 수정 완료**
- Minor: 4건 (Section 3/5/6 + 스펙 자체 검토 1건). 인라인 처리 또는 implementation 단계 deferral

다음 단계: 사용자 검토 → 승인 시 `superpowers:writing-plans` 스킬로 implementation plan 작성.

### 2026-04-26 — Implementation 완료 + 추가 review findings

implementation 사이클 (5 commits + fix-ups, baseline 358 → 392 tests) 에서 spec 외 추가 발견된 review findings:

**Commit 3 marketing-copy-reviewer Critical 2건** (`ba41d67` / `96cf3cd` / `1f3f18b` 으로 fix):
- 개인화 가드 부재 — `DEFAULT_PROMPTS.systemPrompt` + `buildAnalysisPrompt` + `buildImprovementPrompt` + `validateUpdate` Gate 4 의 4-layer 추가
- Hyperbole 가드 부재 — 동일 4-layer 적용
- Korean word-boundary regex bug — `\b최고의?\s` 가 한국어에서 dead code, `\b` 제거
- Personalization regex literal `~` 요구 — `[가-힣A-Za-z]+님(?:...)` 으로 generic noun + 님 패턴 매칭

**Commit 4 code-reviewer Important 1건** (`7f047b4` 으로 fix):
- voyage/creativesDb lifecycle 이 try 블록 밖에 있어 `createCreativesDb` throw 시 catch/finally 우회 — `actions.ts` / `entries/generate.ts` / `pipeline.ts` 3 파일에 lifecycle restructure (`let creativesDb | null` + try 안으로 이동 + finally `creativesDb?.close()`)

본 spec 의 §5.1 / §5.4 / §6.1 Gate 추가 (3 → 4) 및 §5.7 lifecycle 예시 코드 inline 갱신됨.

### 종합 (재집계)

- Critical: 0건 (모든 implementation 사이클 발견 항목 fix 완료)
- Important: 11건 — Section 1-4 brainstorming 4건 + spec 자체 검토 1건 + Commit 3 marketing reviewer 2건 + Commit 3 code reviewer 2건 + Commit 4 code reviewer 1건 + 외 spec drift (3-gate → 4-gate 표기) 1건. Critical/Important 모두 인라인 수정 완료.
- Minor: STATUS.md 의 "Prompt-as-Data refactor review-deferred items" 통합 entry 에 R-A1~R-A3, R-B1~R-B10, R-C1~R-C5 등 18개 항목 deferred 기록.

다음 cleanup 사이클에 일괄 처리.

# Parser Gemini → Claude + Image/Video Retry Wrapper + Scrape Progress UI 복구

**작성일:** 2026-04-27
**스펙 종류:** 설계 + 마이그레이션 + 안정성 개선
**관련:** `packages/core/src/product/parser.ts`, `packages/core/src/creative/{image,video}.ts`, `packages/cli/src/actions.ts:runScrape`, `packages/cli/src/tui/screens/ScrapeScreen.tsx`

---

## 1. 배경 (Why)

### 1.1 사용자가 만난 두 가지 issue

1. **Gemini 503 Service Unavailable** — `parseProductWithGemini` 호출 시 transient error. inflearn HTML 8000자 + 분석 스크립트 부담으로 첫 호출에서 자주 만남. 현재 코드는 retry 없음 → 한 번에 throw.

2. **Scrape TUI 진행 단계 무표시** — TUI 의 ScrapeScreen 이 4 단계 (Playwright / 페이지 로드 / Gemini 파싱 / 제품 저장) 를 정의하는데, `runScrape` 가 단계별 onProgress emit 안 해서 UI 가 매칭할 게 없음 → "갑자기 완료".

### 1.2 추가 동기

- **AI provider 일관성**: 자기학습 루프, 광고 카피, 주간 분석, improver 가 모두 Anthropic Claude. Parser 만 Gemini 라 inconsistent. 1-provider stack 으로 정리하면 운영 단순화 + Anthropic prompt cache 등 일관 활용.
- **Image/Video 도 503 가능**: parser 만 fix 하면 image/video 호출 시 같은 문제 만남. retry wrapper 도입이 운영 안정성 증진.

### 1.3 본 spec 의 목표

3 묶음 동시 처리:
- **(a) Parser Gemini → Claude** — text task 만 Anthropic 으로 이전. 503 자주 만나는 곳 + provider 일관성 동시 해결.
- **(c) Image/Video Gemini retry wrapper** — Imagen 3 / Veo 3.1 호출에 503/UNAVAILABLE/429 자동 흡수 helper.
- **(d) runScrape 단계별 onProgress emit + ScrapeScreen 정규식 robust 화** — TUI 진행 표시 살리기.

(b) Image/Video 의 다른 provider 이전 (DALL-E, Runway 등) 은 별 spec — provider abstraction 필요한 큰 refactor. 본 범위 밖.

---

## 2. 범위

### 2.1 범위 안

#### (a) Parser Claude 마이그레이션

1. `packages/core/src/product/parser.ts` 전면 재작성:
   - `parseProductWithGemini(ai: GoogleGenAI, ...)` → `parseProductWithClaude(client: Anthropic, ...)`
   - System prompt 분리 + `cache_control: ephemeral` (반복 호출 시 비용 절감)
   - `claude-sonnet-4-6` 모델 (다른 Claude 호출과 일관)
2. `packages/cli/src/actions.ts:runScrape` — `GoogleGenAI`/`requireGoogleAiKey` import 제거, `createAnthropicClient` 사용.
3. `packages/server/src/routes/aiParse.ts` — server route 같은 마이그레이션.
4. `packages/core/src/product/parser.test.ts` — 신규 (또는 갱신, 존재 여부 확인) Anthropic SDK mock 패턴.

#### (c) Image/Video Gemini retry wrapper

5. 신규 `packages/core/src/creative/geminiRetry.ts`:
   - `withGeminiRetry<T>(fn, options?): Promise<T>` 제네릭 helper
   - maxRetries=3, baseDelayMs=2000 (exponential: 2s/4s/6s)
   - `defaultIsRetryable` — `503|UNAVAILABLE|429|RESOURCE_EXHAUSTED` 매칭
   - `onAttempt` 콜백 — 기본 console.warn
6. 호출처 wrap (4곳):
   - `packages/core/src/creative/image.ts` — `generateImages` 호출
   - `packages/core/src/creative/video.ts` — `generateVideos` + polling 호출
   - `packages/server/src/jobs/videoJob.ts` — Veo polling
   - `packages/server/src/routes/aiImage.ts` — server route (server 미실행)
7. 신규 `packages/core/src/creative/geminiRetry.test.ts` — 11 케이스 (isRetryable 6 + withRetry 5).

#### (d) runScrape 4-단계 onProgress emit + ScrapeScreen 보강

8. `packages/cli/src/actions.ts:runScrape` — 4 위치에서 onProgress emit (단계별).
9. `packages/cli/src/tui/screens/ScrapeScreen.tsx:17-20`:
   - `parse` label `"Gemini 파싱"` → `"Claude 파싱"`
   - `parse` 정규식 `/Gemini|파싱/i` → `/Gemini|Claude|파싱/i`
   - `save` 정규식 `/저장됨|Scrape 완료/i` → `/저장됨|저장 중|Scrape 완료/i`
10. `packages/cli/src/tui/screens/ScrapeScreen.test.tsx` — 2개 fixture 갱신:
    - "Gemini 파싱" 직접 assert → "Claude 파싱" 또는 "파싱" 부분 매칭
11. `packages/cli/src/actions.test.ts` — runScrape onProgress 4-step verify 1 신규 케이스 추가.

#### 공통

12. `docs/STATUS.md` — 마지막 업데이트 + 최근 변경 이력.
13. `docs/ARCHITECTURE.md` — AI provider 정리 (parser 가 Anthropic 으로 이전됨, ai.google 은 image/video 만 사용).

### 2.2 범위 밖 (의도적 deferred)

| 안 하는 것 | 이유 |
|---|---|
| (b) Image/Video 다른 provider (DALL-E, Runway 등) | 큰 refactor (provider abstraction). 별 spec, ROI 측정 후 |
| (e) Product 데이터 풍부화 (learningOutcomes, targetAudience, originalPrice 등) | 별 spec — Product 타입 확장 + parser prompt 확장 + buildCopyPrompt 통합 + 모든 호출처 type-fix + RAG/qualifier 영향 검토. ~1일 단위 |
| Parser prompt 자기학습 (prompts.json 추가) | 메타 prompt 부트스트랩 루프 회피 (prompt-as-data spec §3.3 와 일관) |
| `videoJob.ts` cancellation 로직 | 별 cleanup |
| Provider abstraction (multi-AI 추상화) | future, ROI 측정 후 |

---

## 3. 핵심 결정

### 3.1 Parser 모델 — `claude-sonnet-4-6`

- 다른 Claude 호출 (creative/copy.ts:generateCopy, campaign/monitor.ts:generateWeeklyAnalysis, improver/runner.ts:runImprovementCycle) 와 일관.
- HTML→JSON 추출은 sonnet 으로 충분 — opus overkill, haiku 가능하지만 일관성 우선.
- 사용자 명시: "토큰 사용량 신경쓰지 않고" → 모델 cost 우선 고려 안 함.

### 3.2 System prompt + `cache_control: ephemeral`

PARSER_SYSTEM_PROMPT 분리하여 system 블록에. Anthropic prompt cache 활용 — 반복 호출 (같은 system, 다른 HTML) 시 입력 토큰 비용 절감.

### 3.3 Retry wrapper 위치 — `creative/geminiRetry.ts`

- `lib/util` 같은 generic 위치 아닌 `creative/` colocate (사용처 image.ts, video.ts 와 같은 디렉토리).
- 미래에 다른 provider retry 가 필요하면 generic `util/retry.ts` 로 ascend 가능.
- 시그니처는 generic (`<T>`) 라 Gemini 외에도 사용 가능 — 단 `defaultIsRetryable` 의 패턴이 Gemini error message 형식 가정.

### 3.4 Retry 정책

- maxRetries = 3 (총 시도 3회. 첫 + 재시도 2회)
- baseDelayMs = 2000, delay = baseDelayMs × attempt (1번째 fail 후 2s, 2번째 fail 후 4s, 3번째 fail 후 6s — 단 3번째는 throw)
- Retryable: `String(e)` 가 `"503"|"UNAVAILABLE"|"429"|"RESOURCE_EXHAUSTED"` 포함
- Non-retryable (404, 401, 400 등) 즉시 throw
- `onAttempt` 콜백 default: `console.warn` 으로 attempt/maxRetries/error message slice

### 3.5 ScrapeScreen 정규식 robust 화

`parse` 정규식에 `Gemini|Claude` 둘 다 OR 처리. 미래에 또 provider 변경되어도 정규식이 깨지지 않게.

`save` 정규식은 `"저장 중"` 도 추가 — runScrape 가 emit 시 매칭됨.

### 3.6 commit 분할

**Commit 1 = (a) + (d)**:
- runScrape 본체가 동시 수정됨 (parser 호출 변경 + onProgress 추가) — atomic
- ScrapeScreen 정규식 + 라벨 변경 ("Claude 파싱") 도 (a) 와 sync 필요
- marketing-copy-reviewer 트리거 (parser prompt 추가)

**Commit 2 = (c)**:
- geminiRetry 신규 모듈 + 4 호출처 wrap
- code-reviewer 만 (Claude prompt 변경 없음)

이 분할로:
- Commit 1 의 결과: TUI 단계 표시 살아남 + parser 안정성↑
- Commit 2 의 결과: Image/Video 도 안정성↑
- Review 부담 분산

---

## 4. 코드 상세

### 4.1 `packages/core/src/product/parser.ts` (전면 재작성)

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { Product } from "../types.js";
import { randomUUID } from "crypto";

export function detectCategory(url: string): string {
  if (url.includes("inflearn.com")) return "course";
  if (url.includes("class101.net")) return "course";
  return "other";
}

const PARSER_SYSTEM_PROMPT = `당신은 제품/서비스 페이지 HTML 에서 정보를 추출하는 파서입니다.

규칙:
- 반드시 JSON 형식으로만 응답. 다른 텍스트 절대 포함 금지.
- 불확실한 필드는 빈 문자열, 0, 또는 빈 배열 반환.
- price 는 숫자만 (KRW 가정, 통화 기호/콤마 제거).
- tags 는 핵심 키워드 3-5개.

응답 형식:
{"name":"","description":"","price":0,"tags":[],"imageUrl":""}`;

export async function parseProductWithClaude(
  client: Anthropic,
  url: string,
  html: string,
): Promise<Product> {
  const userPrompt = `URL: ${url}

다음 HTML 에서 제품 정보를 추출하세요.

HTML:
${html.slice(0, 8000)}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: [{ type: "text", text: PARSER_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userPrompt }],
  });

  const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? "{}");

  return {
    id: randomUUID(),
    name: parsed.name ?? "",
    description: parsed.description ?? "",
    imageUrl: parsed.imageUrl ?? "",
    targetUrl: url,
    category: detectCategory(url),
    price: parsed.price ?? 0,
    currency: "KRW",
    tags: parsed.tags ?? [],
    inputMethod: "scraped",
    createdAt: new Date().toISOString(),
  };
}
```

### 4.2 `packages/cli/src/actions.ts:runScrape` 변경

imports:
```ts
- import { GoogleGenAI } from "@google/genai";
- import { requireGoogleAiKey } from "@ad-ai/core/config/helpers.js";
- import { parseProductWithGemini } from "@ad-ai/core/product/parser.js";
+ import { createAnthropicClient } from "@ad-ai/core/creative/copy.js";
+ import { parseProductWithClaude } from "@ad-ai/core/product/parser.js";
```

(다른 imports — `requireAnthropicKey` 가 `actions.ts:4` 에 이미 import 됐는지 확인. 없으면 추가 안 함 — `createAnthropicClient` 가 helper.)

runScrape body:
```ts
export async function runScrape(url: string, onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    onProgress({ message: "Playwright 브라우저 실행 중..." });
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      onProgress({ message: `페이지 로드 중: ${url.slice(0, 40)}` });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      const html = await page.content();

      onProgress({ message: "Claude 파싱 중..." });
      const client = createAnthropicClient();
      const product = await parseProductWithClaude(client, url, html);

      onProgress({ message: `제품 저장 중: ${product.name.slice(0, 30)}` });
      await writeJson(`data/products/${product.id}.json`, product);
      return { success: true, message: "Scrape 완료", logs: [`${product.name} 저장됨`] };
    } finally {
      await browser.close();
    }
  } catch (e) {
    return { success: false, message: "Scrape 실패", logs: [String(e)] };
  }
}
```

### 4.3 `packages/server/src/routes/aiParse.ts` 변경

```ts
- import { GoogleGenAI } from "@google/genai";
- import { requireGoogleAiKey } from "@ad-ai/core/config/helpers.js";
- import { parseProductWithGemini } from "@ad-ai/core/product/parser.js";
+ import Anthropic from "@anthropic-ai/sdk";
+ import { requireAnthropicKey } from "@ad-ai/core/config/helpers.js";
+ import { parseProductWithClaude } from "@ad-ai/core/product/parser.js";

// in handler
- const ai = new GoogleGenAI({ apiKey: requireGoogleAiKey() });
- const product = await parseProductWithGemini(ai, url, html);
+ const client = new Anthropic({ apiKey: requireAnthropicKey() });
+ const product = await parseProductWithClaude(client, url, html);
```

### 4.4 신규 `packages/core/src/creative/geminiRetry.ts`

```ts
export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  isRetryable?: (e: unknown) => boolean;
  onAttempt?: (attempt: number, maxRetries: number, error: unknown) => void;
}

const DEFAULT_RETRYABLE_PATTERNS = [
  "503",
  "UNAVAILABLE",
  "429",
  "RESOURCE_EXHAUSTED",
];

export function defaultIsRetryable(e: unknown): boolean {
  const msg = String(e);
  return DEFAULT_RETRYABLE_PATTERNS.some((p) => msg.includes(p));
}

function defaultOnAttempt(attempt: number, maxRetries: number, error: unknown): void {
  console.warn(
    `[gemini-retry] attempt ${attempt}/${maxRetries} failed (transient), retrying:`,
    String(error).slice(0, 120),
  );
}

export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 2000;
  const isRetryable = options.isRetryable ?? defaultIsRetryable;
  const onAttempt = options.onAttempt ?? defaultOnAttempt;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt === maxRetries || !isRetryable(e)) throw e;
      onAttempt(attempt, maxRetries, e);
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
  throw lastError;
}
```

### 4.5 호출처 wrap (4곳)

각 위치의 Gemini API 호출을 `withGeminiRetry(() => ...)` 로 wrap. 패턴:

```ts
// before
const response = await ai.models.generateImages({ ... });

// after
import { withGeminiRetry } from "./geminiRetry.js";
const response = await withGeminiRetry(() => ai.models.generateImages({ ... }));
```

영향 호출처:
- `creative/image.ts` — `ai.models.generateImages`
- `creative/video.ts` — `ai.models.generateVideos` + polling 호출
- `server/jobs/videoJob.ts` — Veo polling
- `server/routes/aiImage.ts` — image gen

### 4.6 `ScrapeScreen.tsx` 정규식 + 라벨 갱신

```ts
// before
{ key: "playwright", label: "Playwright 실행", match: /Playwright|브라우저/i },
{ key: "pageload",   label: "페이지 로드",     match: /networkidle|페이지/i },
{ key: "parse",      label: "Gemini 파싱",     match: /Gemini|파싱/i },
{ key: "save",       label: "제품 저장",       match: /저장됨|Scrape 완료/i },

// after
{ key: "playwright", label: "Playwright 실행", match: /Playwright|브라우저/i },
{ key: "pageload",   label: "페이지 로드",     match: /networkidle|페이지/i },
{ key: "parse",      label: "Claude 파싱",     match: /Gemini|Claude|파싱/i },
{ key: "save",       label: "제품 저장",       match: /저장됨|저장 중|Scrape 완료/i },
```

### 4.7 `ScrapeScreen.test.tsx` fixture 갱신

```ts
// before (line 14)
expect(f).toContain("Gemini 파싱");

// after — provider 변경에 robust 한 매칭
expect(f).toContain("Claude 파싱");
```

(또는 `expect(f).toContain("파싱")` 으로 부분 매칭. 명시성을 위해 "Claude 파싱" 권장.)

두 번째 테스트 (`renders 4-stage progress checklist during scrape`) 도 동일 변경.

---

## 5. 테스트 전략

### 5.1 신규 테스트 파일

#### `packages/core/src/product/parser.test.ts` (신규)

기존에 없으면 신규 작성. 6 케이스:

```ts
import { describe, it, expect, vi } from "vitest";
import { parseProductWithClaude, detectCategory } from "./parser.js";

function mockClient(responseText: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: responseText }],
      }),
    },
  };
}

describe("parseProductWithClaude", () => {
  it("parses JSON response into Product shape", async () => { /* ... */ });
  it("falls back to safe defaults when Claude returns malformed JSON", async () => { /* ... */ });
  it("uses claude-sonnet-4-6 model with system prompt + ephemeral cache", async () => { /* ... */ });
});

describe("detectCategory", () => {
  it("detects course for inflearn", () => { /* ... */ });
  it("detects course for class101", () => { /* ... */ });
  it("returns other for unknown", () => { /* ... */ });
});
```

#### `packages/core/src/creative/geminiRetry.test.ts` (신규)

11 케이스: 6 isRetryable + 5 withRetry.

```ts
describe("defaultIsRetryable", () => {
  // retries: 503, UNAVAILABLE, 429, RESOURCE_EXHAUSTED (4)
  // does NOT retry: 404, generic (2)
});

describe("withGeminiRetry", () => {
  // 1. returns immediately on first success
  // 2. retries on retryable error and succeeds
  // 3. throws non-retryable error immediately
  // 4. throws after max retries on persistent retryable error
  // 5. uses exponential backoff (delay = baseDelayMs * attempt)
});
```

`vi.useFakeTimers()` 사용으로 retry delay 빠르게 forward.

### 5.2 기존 테스트 갱신

#### `packages/cli/src/actions.test.ts` — runScrape onProgress 4-step

기존에 runScrape 의 *signature length* 만 검증 (`runScrape.length === 2`). 신규 케이스 1개:

```ts
it("emits onProgress at 4 stages: playwright, pageload, parse, save", async () => {
  // mock chromium, parseProductWithClaude, storage
  // run runScrape, capture all onProgress messages
  // assert 4 expected message patterns appear in order
});
```

vi.mock 패턴 (기존 runGenerate 테스트 참조).

#### `packages/cli/src/tui/screens/ScrapeScreen.test.tsx` — fixture 갱신

```ts
// 첫 번째 테스트: URL prompt
expect(f).toContain("Claude 파싱");  // was "Gemini 파싱"

// 두 번째 테스트: 4-stage progress
expect(f).toContain("Claude 파싱");  // was "Gemini 파싱"
```

### 5.3 테스트 수 delta

| 파일 | 신규/수정 |
|---|---|
| `parser.test.ts` (신규) | 6 |
| `geminiRetry.test.ts` (신규) | 11 |
| `actions.test.ts` (신규 1 + 갱신 0) | +1 |
| `ScrapeScreen.test.tsx` (갱신 2) | 0 net |

대략 **+18 신규 케이스**. 기존 396 → ~414.

### 5.4 통합 검증

(a)+(d) commit 후 수동 검증:
1. inflearn URL Scrape → 4 단계 progress UI 표시 확인
2. Claude 파싱 라벨 표시
3. data/products/{uuid}.json 정상 저장

(c) commit 후 수동 검증 (선택):
1. Image 생성 시 503 simulate 어려움 — production 운영 중 자연 발생 시 retry log 확인

### 5.5 회귀 위험

#### Critical

**없음** — parser.ts 가 BASE_CONFIG 와 BASE_CONFIG.platforms.meta 변경 안 함. Product 타입 unchanged. 파일 저장 위치 unchanged.

#### Important

**Parser 출력 quality** — Gemini → Claude 전환으로 같은 HTML 입력에 대해 *byte-identical 출력 보장 안 됨*. 다만:
- 두 모델 모두 동일한 JSON schema 따라야 (system prompt 가 강제)
- name/description/price/tags 추출 정확도는 모델별 미세 차이 가능
- marketing-copy-reviewer 가 검증 가능 (테스트 케이스로 동일 HTML 입력 비교)

#### 회귀 mitigation

- 기존 1개 product (data/products/11333548-86ea-464a-a414-d788b9164b4d.json) 는 Gemini 가 추출한 결과. (a) 적용 후 *같은 URL* 재 scrape 하면 Claude 가 추출 — 결과 비교 가능 (수동).
- 단 회귀 시 사용자가 즉시 알 수 있음 (다음 Scrape 결과가 이상하면) → revert 단순.

---

## 6. 영속 데이터 마이그레이션

**필요 없음.**
- Product 타입 unchanged
- data/products/*.json 기존 파일 영향 zero
- 기존 1 product 파일 그대로 유지 (Claude 가 추출한 것 아니지만 schema 동일)

---

## 7. 리스크 + 롤백

### 7.1 회귀 위험

위 §5.5 참조. Critical 없음, Important 1건 (parser 출력 quality 모델별 미세 차이 가능성).

### 7.2 일반 롤백

`git revert <sha>` 단순 복구. Commit 1, 2 각각 독립 revert 가능 (Commit 2 가 Commit 1 에 의존 안 함 — image/video 호출처는 (a) 와 무관).

### 7.3 중간 상태 안전성

Commit 1 만 land 하고 Commit 2 안 land 해도 시스템 정상:
- Parser 가 Claude 사용 → 503 빈도 감소
- Image/Video 는 retry 없음 — 503 만나면 fail (현재와 동일)

따라서 Commit 1 → Commit 2 순서대로 가되 분리 land 안전.

---

## 8. 작업 순서 (2 commits)

### Commit 1 — (a) + (d)

**Files:**
- `packages/core/src/product/parser.ts` (재작성)
- `packages/core/src/product/parser.test.ts` (신규)
- `packages/cli/src/actions.ts` (runScrape — parser 호출 변경 + 4 단계 onProgress)
- `packages/cli/src/actions.test.ts` (runScrape onProgress 신규 케이스)
- `packages/server/src/routes/aiParse.ts` (Claude 마이그레이션)
- `packages/cli/src/tui/screens/ScrapeScreen.tsx` (정규식 + 라벨)
- `packages/cli/src/tui/screens/ScrapeScreen.test.tsx` (fixture)

**Subagent:**
- `marketing-copy-reviewer` (creative/prompt.ts 수정은 아니지만 *parser prompt 신규* + runImprove 산출물 영향 가능 — CLAUDE.md "Copy 생성 로직" 트리거 검토. parser prompt 가 광고 카피 직접 영향 안 주므로 마케팅 reviewer 트리거 약함. **결론**: spec 작성 시 명시 — parser 는 카피 직접 영향 없으므로 marketing-copy-reviewer 트리거 *약함*. code-reviewer 만 호출.)
- `superpowers:code-reviewer` (모든 commit)

### Commit 2 — (c)

**Files:**
- `packages/core/src/creative/geminiRetry.ts` (신규)
- `packages/core/src/creative/geminiRetry.test.ts` (신규)
- `packages/core/src/creative/image.ts` (wrap)
- `packages/core/src/creative/video.ts` (wrap)
- `packages/server/src/jobs/videoJob.ts` (wrap)
- `packages/server/src/routes/aiImage.ts` (wrap)

**Subagent:**
- `superpowers:code-reviewer`

### 공통 (Commit 1 에 통합)

- `docs/STATUS.md` (마지막 업데이트 + 최근 변경 이력 — Commit 1 commit 시 같이)
- `docs/ARCHITECTURE.md` — AI provider 정리 (다음 cleanup 사이클에 또는 (e) 작업 시 업데이트)

---

## 9. 작업 시간 견적

| 단계 | 시간 |
|---|---|
| Spec 작성 + 자체 검토 | 0.7h |
| Plan 작성 | 0.4h |
| Commit 1 — (a) parser + (d) onProgress | 1.5h |
| Commit 2 — (c) retry wrapper + 4 wrap | 1.0h |
| 테스트 작성 (parser + geminiRetry + actions) | 1.0h |
| 문서 (STATUS, ARCHITECTURE) | 0.3h |
| Subagent reviews × 2 commits + 수정 | 1.5h |
| 안정화 | 0.3h |
| **합계** | **~6.7h (1일)** |

---

## 10. Definition of Done

- [ ] 2 commits — Commit 1 (a)+(d), Commit 2 (c)
- [ ] `npm test` ~414 (396 + 18 신규)
- [ ] grep 검증:
  - `grep -rn "GoogleGenAI\|@google/genai" packages/ --include="*.ts" | grep -v "image\|video\|videoJob\|aiImage"` → 0 hits (parser/aiParse/actions 에서 제거됨)
  - `grep -rn "withGeminiRetry" packages/ --include="*.ts"` → image/video/videoJob/aiImage 4 곳 + geminiRetry 정의
- [ ] inflearn URL Scrape → 4-단계 TUI progress 표시 확인 (수동)
- [ ] data/products/*.json 정상 저장
- [ ] code-reviewer 검토 통과 (Commit 1, 2 각각)
- [ ] STATUS 마지막 업데이트 = 2026-04-27

---

## 11. Open Questions / 후속 작업

### 11.1 (e) Product 데이터 풍부화 — 별 spec

본 spec scope-out. 별 spec 으로 진행 권장. 추가 후보 필드 (광고 효과 큰 순):

| 필드 | 효과 |
|---|---|
| `learningOutcomes: string[]` | "이 강의 마치면 ~ 할 수 있다" — 결과 어필, numerical/emotional 양쪽 모두 |
| `targetAudience: string` | Meta ad set targeting 구체화 + 카피의 "당신은 ~" 훅 |
| `differentiators: string[]` | USP — "실무 중심", "현직 시니어" — emotional variant 강력 |
| `socialProof: { rating?, studentCount?, reviewSnippet? }` | 사회적 증거 — urgency/numerical 양쪽 |
| `originalPrice?: number` | 할인율 표시 ("50% 할인") — urgency 핵심 |

영향 범위 (별 spec 시):
- `Product` 타입 확장 (`packages/core/src/types.ts`)
- `parser.ts` parsing prompt 확장
- `creative/prompt.ts:buildCopyPrompt` 새 필드 통합
- `learning/prompts.ts:DEFAULT_PROMPTS.copy.userTemplate` 갱신 (필드 placeholder 추가)
- 모든 Product 생성 호출처 (manual entry 등) type fix
- RAG/qualifier 영향 (winner 의 productDescription 외 새 필드 추가 검토)

### 11.2 Image/Video 다른 provider 이전 — 별 spec

본 spec scope-out. (b) 작업. provider abstraction 도입 + DALL-E/Runway/Luma 등 검토.

### 11.3 Scrape 단계 통합

`scraper.ts:scrapeProduct` 와 `actions.ts:runScrape` 가 chromium launch + page.goto 코드 중복. `runScrape` 가 `scrapeProduct` 를 import 하면 자연스러움. 별 cleanup. (이전 commit b75e9f1 에 메모됨.)

### 11.4 Provider abstraction

여러 AI provider 를 추상화 (multi-platform 어댑터처럼 — `AIProvider` interface). 본 spec 의 Anthropic/Google 분리는 그 중간 단계. ROI 측정 후 결정.

---

## 12. 검토 이력

### 2026-04-27 — 초안 작성 + 섹션 단위 자체 검토

본 spec 은 brainstorming 단계에서 2개 섹션 (범위/결정 + 코드 상세/테스트) 으로 작성. 3 묶음 묶었지만 commit 분할로 review 부담 분산.

**Section 1 — Minor 1건**
- "parser 가 503 자주 만나는 곳" 표현 약함 → §1.1 에서 "사용자가 첫 503 만난 호출이 parser 단계 — provider 일관성 + 안정성 동시 해결" 로 정확화. 본문 반영.

**Section 2 — Minor 1건**
- `actions.test.ts:runScrape` 기존 unit test 존재 여부 미확인 → spec 작성 시 grep 으로 직접 확인 (signature length 만 검증, onProgress emit 검증 없음 → 신규 케이스 추가 필요). §5.2 에 명시.

### 2026-04-27 — 스펙 작성 후 자체 검토 (5점 점검)

스펙 작성 직후 추가 자체 검토:

**Important #1**: Commit 1 의 `marketing-copy-reviewer` 트리거 여부 — 처음에는 "parser prompt 신규 추가" 라 트리거 가능성 검토했으나 §3.6 의 결론: parser prompt 는 광고 카피 *직접 영향 없음* (parser 는 HTML→JSON 추출용, copy 생성 prompt 와 분리). CLAUDE.md "Copy 생성 로직 변경" 의 정확 정의는 광고 카피 *생성* 흐름 변경 — parser 는 *입력 데이터 추출* 단계라 분리. 따라서 marketing-copy-reviewer 트리거 **약함** — code-reviewer 만 호출. 이는 일관성을 위해 spec 본문 §8 에서 명시.

**Minor #1**: §11.1 의 (e) Product 데이터 풍부화 — 본 spec 끝에 "Open Questions" 섹션으로 메모. 사용자가 분리 진행 결정한 항목.

### 종합

- Critical: 0건
- Important: 1건 (marketing-copy-reviewer 트리거 약함 → code-reviewer 만). 본문 §8 에 명시
- Minor: 2건 (parser 503 표현 강화, actions.test.ts grep 확인). 본문 반영

다음 단계: 사용자 검토 → 승인 시 `superpowers:writing-plans` 스킬로 plan 작성.

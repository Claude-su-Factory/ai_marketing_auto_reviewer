# Parser Gemini → Claude + Retry Wrapper + Scrape UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (a) Parser Gemini→Claude 마이그레이션 + (c) Image/Video Gemini retry wrapper + (d) runScrape 4-단계 onProgress emit + ScrapeScreen 정규식 robust 화. 503 안정성 + AI provider 일관성 + TUI UX 동시 개선.

**Architecture:** 2 atomic commits. Commit 1 = (a)+(d) — runScrape 본체 동시 수정 + ScrapeScreen 정규식. Commit 2 = (c) — geminiRetry helper + 4 호출처 wrap. 각 commit 내부는 TypeScript compile-time consistency 가 안전망.

**Tech Stack:** TypeScript, vitest, @anthropic-ai/sdk, @google/genai, ink (TUI). tsx 런타임.

**Spec:** `docs/superpowers/specs/2026-04-27-gemini-to-claude-parser-design.md` (커밋 `ee81fe7`)

**브랜치:** master 직접 commit (CLAUDE.md 정책).

**견적:** ~6.7h (1일).

**Subagent 호출:** code-reviewer × 2 commits (각 commit 후). marketing-copy-reviewer 는 spec §8 결정대로 *약함* — parser 는 광고 카피 직접 영향 없음, 호출 안 함.

---

## Task 0: Pre-flight

### Task 0.1: 환경 확인

- [ ] **Step 1: 작업 트리 깨끗**
```bash
git status --short
```
Expected: 빈 출력 또는 `.claude/scheduled_tasks.lock` 만.

- [ ] **Step 2: HEAD = spec commit**
```bash
git log --oneline -3
```
Expected 최상단: `ee81fe7 docs(specs): add Gemini→Claude parser + retry wrapper + Scrape progress UI design spec`

- [ ] **Step 3: Test baseline**
```bash
npm test 2>&1 | tail -5
```
Expected: **396 tests passing** (이전 작업 chain 후 기준). 1 pre-existing flake (useReports) 알려진 결함 — 동일.

- [ ] **Step 4: TypeScript clean**
```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
npx tsc --noEmit -p packages/cli/tsconfig.json 2>&1 | head
```
Expected: 0 errors after filter.

---

## Commit 1: (a) Parser Claude 마이그레이션 + (d) onProgress + ScrapeScreen

### Task 1.1: `parser.ts` 전면 재작성

**Files:**
- Modify: `packages/core/src/product/parser.ts` (전체)

- [ ] **Step 1: 본체 교체**

`packages/core/src/product/parser.ts` 전체 교체:

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

기존 `parseProductWithGemini` export 완전히 사라짐. `detectCategory` 시그니처 그대로.

### Task 1.2: `parser.test.ts` 신규

**Files:**
- Create: `packages/core/src/product/parser.test.ts`

- [ ] **Step 1: 6 케이스 테스트 작성**

`packages/core/src/product/parser.test.ts` 신규:

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
  it("parses JSON response into Product shape", async () => {
    const client = mockClient(JSON.stringify({
      name: "Redis 강의",
      description: "트래픽 처리 노하우",
      price: 99000,
      tags: ["Redis", "백엔드"],
      imageUrl: "https://example.com/cover.jpg",
    }));
    const product = await parseProductWithClaude(
      client as any,
      "https://www.inflearn.com/course/redis",
      "<html>...</html>",
    );
    expect(product.name).toBe("Redis 강의");
    expect(product.description).toBe("트래픽 처리 노하우");
    expect(product.price).toBe(99000);
    expect(product.tags).toEqual(["Redis", "백엔드"]);
    expect(product.imageUrl).toBe("https://example.com/cover.jpg");
    expect(product.targetUrl).toBe("https://www.inflearn.com/course/redis");
    expect(product.category).toBe("course");
    expect(product.currency).toBe("KRW");
    expect(product.inputMethod).toBe("scraped");
    expect(product.id).toBeTruthy();
    expect(product.createdAt).toBeTruthy();
  });

  it("falls back to safe defaults when Claude returns malformed JSON", async () => {
    const client = mockClient("not JSON at all");
    const product = await parseProductWithClaude(
      client as any,
      "https://example.com",
      "<html>...</html>",
    );
    expect(product.name).toBe("");
    expect(product.description).toBe("");
    expect(product.price).toBe(0);
    expect(product.tags).toEqual([]);
    expect(product.imageUrl).toBe("");
  });

  it("uses claude-sonnet-4-6 model with system prompt + ephemeral cache", async () => {
    const client = mockClient(JSON.stringify({ name: "x", description: "y", price: 0, tags: [] }));
    await parseProductWithClaude(client as any, "https://example.com", "<html>");
    const callArgs = (client.messages.create as any).mock.calls[0][0];
    expect(callArgs.model).toBe("claude-sonnet-4-6");
    expect(callArgs.system[0].text).toContain("JSON");
    expect(callArgs.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(callArgs.messages[0].role).toBe("user");
    expect(callArgs.messages[0].content).toContain("HTML:");
  });
});

describe("detectCategory", () => {
  it("detects course for inflearn", () => {
    expect(detectCategory("https://www.inflearn.com/course/x")).toBe("course");
  });
  it("detects course for class101", () => {
    expect(detectCategory("https://class101.net/x")).toBe("course");
  });
  it("returns other for unknown", () => {
    expect(detectCategory("https://example.com")).toBe("other");
  });
});
```

- [ ] **Step 2: 테스트 실행**

```bash
npx vitest run packages/core/src/product/parser.test.ts 2>&1 | tail -10
```

Expected: 6 cases passing.

### Task 1.3: `actions.ts:runScrape` 변경 — Claude 마이그레이션 + 4-단계 onProgress

**Files:**
- Modify: `packages/cli/src/actions.ts` (imports + runScrape body)

- [ ] **Step 1: imports 변경**

`packages/cli/src/actions.ts` 상단의 imports 영역:

```ts
// Before (line 2)
import { GoogleGenAI } from "@google/genai";

// After: 제거
```

```ts
// Before (line 4)
import { requireAnthropicKey, requireGoogleAiKey } from "@ad-ai/core/config/helpers.js";

// After
import { requireAnthropicKey } from "@ad-ai/core/config/helpers.js";
```

(line numbers approximate — implementer 가 정확한 line 확인. `requireGoogleAiKey` 가 다른 곳에서도 import 되는지 grep 필요. runScrape 외 사용처 없으면 제거. 아래 grep 으로 검증.)

```ts
// Before (parser import)
import { parseProductWithGemini } from "@ad-ai/core/product/parser.js";

// After
import { parseProductWithClaude } from "@ad-ai/core/product/parser.js";
```

`createAnthropicClient` import 추가 (다른 import 그룹과 인접):

```ts
import { createAnthropicClient } from "@ad-ai/core/creative/copy.js";
```

- [ ] **Step 2: runScrape body 교체**

`packages/cli/src/actions.ts` 의 `runScrape` 함수 (현재 ~line 44-65):

```ts
// Before
export async function runScrape(url: string, onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    onProgress({ message: `스크래핑 중... ${url.slice(0, 40)}` });
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      const html = await page.content();
      const ai = new GoogleGenAI({ apiKey: requireGoogleAiKey() });
      const product = await parseProductWithGemini(ai, url, html);
      await writeJson(`data/products/${product.id}.json`, product);
      return { success: true, message: "Scrape 완료", logs: [`${product.name} 저장됨`] };
    } finally {
      await browser.close();
    }
  } catch (e) {
    return { success: false, message: "Scrape 실패", logs: [String(e)] };
  }
}

// After
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

- [ ] **Step 3: requireGoogleAiKey 사용처 검증**

```bash
grep -n "requireGoogleAiKey" packages/cli/src/actions.ts
```

Expected: 0 hits (위 step 1 에서 제거됨). 만약 다른 곳 (예: runGenerate) 에서 사용 시 import 유지하고 runScrape 만 제거.

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit -p packages/cli/tsconfig.json 2>&1 | head -10
```

Expected: 0 errors.

### Task 1.4: `actions.test.ts` runScrape onProgress 4-step verify 신규

**Files:**
- Modify: `packages/cli/src/actions.test.ts`

- [ ] **Step 1: 신규 describe block 추가**

`packages/cli/src/actions.test.ts` 끝부분에 추가 (기존 describe 들 다음):

```ts
describe("runScrape emits 4-stage onProgress", () => {
  it("emits progress at playwright/pageload/parse/save stages", async () => {
    const messages: string[] = [];
    vi.doMock("playwright", () => ({
      chromium: {
        launch: async () => ({
          newPage: async () => ({
            goto: async () => {},
            content: async () => "<html>mock</html>",
          }),
          close: async () => {},
        }),
      },
    }));
    vi.doMock("@ad-ai/core/creative/copy.js", () => ({
      createAnthropicClient: () => ({}),
    }));
    vi.doMock("@ad-ai/core/product/parser.js", () => ({
      parseProductWithClaude: async () => ({
        id: "test-id",
        name: "Mock Product",
        description: "d",
        imageUrl: "",
        targetUrl: "https://example.com",
        category: "course",
        price: 0,
        currency: "KRW",
        tags: [],
        inputMethod: "scraped",
        createdAt: "2026-04-27T00:00:00.000Z",
      }),
    }));
    vi.doMock("@ad-ai/core/storage.js", () => ({
      writeJson: async () => {},
    }));

    vi.resetModules();
    const { runScrape: fresh } = await import("./actions.js");
    await fresh("https://example.com", (p: any) => messages.push(p.message));

    expect(messages.some((m) => /Playwright|브라우저/i.test(m))).toBe(true);
    expect(messages.some((m) => /페이지 로드/i.test(m))).toBe(true);
    expect(messages.some((m) => /Claude 파싱/i.test(m))).toBe(true);
    expect(messages.some((m) => /제품 저장 중/i.test(m))).toBe(true);

    vi.doUnmock("playwright");
    vi.doUnmock("@ad-ai/core/creative/copy.js");
    vi.doUnmock("@ad-ai/core/product/parser.js");
    vi.doUnmock("@ad-ai/core/storage.js");
  });
});
```

- [ ] **Step 2: 테스트 실행**

```bash
npx vitest run packages/cli/src/actions.test.ts 2>&1 | tail -10
```

Expected: 기존 테스트 + 1 신규 = 모두 passing.

### Task 1.5: `aiParse.ts` 마이그레이션 (server)

**Files:**
- Modify: `packages/server/src/routes/aiParse.ts`

- [ ] **Step 1: imports 변경**

```ts
// Before (line 2-4)
import { GoogleGenAI } from "@google/genai";
import { parseProductWithGemini } from "@ad-ai/core/product/parser.js";
import { requireGoogleAiKey } from "@ad-ai/core/config/helpers.js";

// After
import Anthropic from "@anthropic-ai/sdk";
import { parseProductWithClaude } from "@ad-ai/core/product/parser.js";
import { requireAnthropicKey } from "@ad-ai/core/config/helpers.js";
```

- [ ] **Step 2: handler body 변경**

`packages/server/src/routes/aiParse.ts` 의 router.post 핸들러 안:

```ts
// Before
const ai = new GoogleGenAI({ apiKey: requireGoogleAiKey() });
const product = await parseProductWithGemini(ai, url, html);

// After
const client = new Anthropic({ apiKey: requireAnthropicKey() });
const product = await parseProductWithClaude(client, url, html);
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit -p packages/server/tsconfig.json 2>&1 | head -10
```

Expected: 0 errors. (서버 미실행이지만 TS 통과 필수.)

### Task 1.6: `ScrapeScreen.tsx` 정규식 + 라벨 갱신

**Files:**
- Modify: `packages/cli/src/tui/screens/ScrapeScreen.tsx:17-20`

- [ ] **Step 1: 4 줄 변경**

`packages/cli/src/tui/screens/ScrapeScreen.tsx` 의 stages 배열 (라인 17-20):

```ts
// Before
{ key: "playwright", label: "Playwright 실행", match: /Playwright|브라우저/i },
{ key: "pageload",   label: "페이지 로드",     match: /networkidle|페이지/i },
{ key: "parse",      label: "Gemini 파싱",     match: /Gemini|파싱/i },
{ key: "save",       label: "제품 저장",       match: /저장됨|Scrape 완료/i },

// After
{ key: "playwright", label: "Playwright 실행", match: /Playwright|브라우저/i },
{ key: "pageload",   label: "페이지 로드",     match: /networkidle|페이지/i },
{ key: "parse",      label: "Claude 파싱",     match: /Gemini|Claude|파싱/i },
{ key: "save",       label: "제품 저장",       match: /저장됨|저장 중|Scrape 완료/i },
```

3가지 변경:
- `parse` label `"Gemini 파싱"` → `"Claude 파싱"`
- `parse` 정규식에 `Claude` 추가
- `save` 정규식에 `저장 중` 추가

### Task 1.7: `ScrapeScreen.test.tsx` fixture 갱신

**Files:**
- Modify: `packages/cli/src/tui/screens/ScrapeScreen.test.tsx`

- [ ] **Step 1: 2개 assertion 갱신**

기존 두 it() 안의 `expect(f).toContain("Gemini 파싱")` 두 곳을:

```ts
// Before (두 곳)
expect(f).toContain("Gemini 파싱");

// After (두 곳)
expect(f).toContain("Claude 파싱");
```

- [ ] **Step 2: 테스트 실행**

```bash
npx vitest run packages/cli/src/tui/screens/ScrapeScreen.test.tsx 2>&1 | tail -5
```

Expected: 2 passing.

### Task 1.8: 전체 테스트 실행

- [ ] **Step 1: `npm test`**

```bash
npm test 2>&1 | tail -10
```

Expected: 396 + 신규 (parser 6 + actions runScrape 1) = **403 tests passing** + 1 pre-existing useReports flake. ScrapeScreen 2개는 fixture 변경으로 동수 유지.

만약 다른 테스트 회귀 발생:
- `ScrapeScreen.test.tsx` 의 첫 번째 테스트가 "URL prompt 가 'Gemini 파싱' 힌트 포함" — Step 1.7 변경으로 자동 fix
- 다른 회귀는 grep 으로 추적 (예: `parseProductWithGemini` 잔존 import)

### Task 1.9: 문서 + Commit 1

**Files:**
- Modify: `docs/STATUS.md`

- [ ] **Step 1: STATUS.md 갱신**

라인 3 마지막 업데이트:
```markdown
마지막 업데이트: 2026-04-27
```

`## 최근 변경 이력` 다음 (현재 맨 위 entry 다음에) 새 entry 추가:

```markdown
- 2026-04-27 refactor(parser): Gemini → Claude 마이그레이션 + runScrape 4-단계 onProgress emit + ScrapeScreen 정규식 robust 화. (a) `packages/core/src/product/parser.ts` 의 `parseProductWithGemini` → `parseProductWithClaude` (claude-sonnet-4-6 + system prompt + ephemeral cache). `cli/actions.ts:runScrape` 와 `server/routes/aiParse.ts` 호출처 마이그레이션. (d) runScrape 가 4 단계 (Playwright/페이지 로드/Claude 파싱/제품 저장) 에서 onProgress emit 추가, ScrapeScreen 의 parse 정규식을 `/Gemini|Claude|파싱/i` 로 확장 (provider 변경 robust). 503 안정성 + provider 일관성 + TUI UX 동시 개선. AI provider 정리: Anthropic = parser/copy/analysis/improver, Google = image/video.
```

- [ ] **Step 2: grep verification**

```bash
grep -rn "GoogleGenAI\|@google/genai\|parseProductWithGemini\|requireGoogleAiKey" packages/ --include="*.ts" 2>&1 | grep -v "image\|video\|videoJob\|aiImage" | head
```

Expected: 0 hits in (parser/aiParse/actions:runScrape) 영역. image/video 관련 호출처에는 여전히 남아있음 (Commit 2 에서 처리).

`requireGoogleAiKey` 가 image.ts/video.ts 등에서 여전히 사용 중인지 확인:
```bash
grep -rn "requireGoogleAiKey" packages/ --include="*.ts" | head
```
Expected: image.ts, video.ts, videoJob.ts, aiImage.ts (Commit 2 영역) 만.

- [ ] **Step 3: 명시적 add (-A 사용 금지)**

```bash
git add packages/core/src/product/parser.ts \
  packages/core/src/product/parser.test.ts \
  packages/cli/src/actions.ts \
  packages/cli/src/actions.test.ts \
  packages/server/src/routes/aiParse.ts \
  packages/cli/src/tui/screens/ScrapeScreen.tsx \
  packages/cli/src/tui/screens/ScrapeScreen.test.tsx \
  docs/STATUS.md
```

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(parser): migrate Gemini → Claude + add runScrape 4-stage onProgress emit

(a) Parser Gemini → Claude (text task — provider 일관성 + 503 안정성):
- packages/core/src/product/parser.ts: parseProductWithGemini → parseProductWithClaude (claude-sonnet-4-6, system prompt + ephemeral cache)
- packages/cli/src/actions.ts:runScrape: GoogleGenAI 호출 제거, createAnthropicClient + parseProductWithClaude 사용
- packages/server/src/routes/aiParse.ts: 동일 마이그레이션 (server 미실행이지만 코드 sync)

(d) runScrape 4-단계 onProgress emit + ScrapeScreen 정규식 robust 화:
- packages/cli/src/actions.ts:runScrape: Playwright/페이지 로드/Claude 파싱/제품 저장 4 단계마다 onProgress
- packages/cli/src/tui/screens/ScrapeScreen.tsx: parse label "Gemini 파싱" → "Claude 파싱", parse 정규식 /Gemini|Claude|파싱/i (provider 변경 robust), save 정규식에 "저장 중" 추가

테스트:
- parser.test.ts 신규 (6 케이스 — JSON parse / fallback / 모델+system prompt 검증 + detectCategory 3)
- actions.test.ts 에 runScrape 4-단계 onProgress emit 검증 신규 (1 케이스)
- ScrapeScreen.test.tsx fixture 2 케이스 갱신 ("Gemini 파싱" → "Claude 파싱")

AI provider 정리: Anthropic = parser/copy/analysis/improver, Google = image/video. Image/Video 의 retry wrapper 는 Commit 2 에서 별 처리.

Spec: docs/superpowers/specs/2026-04-27-gemini-to-claude-parser-design.md §4-§5
EOF
)"
```

- [ ] **Step 5: Final verification**

```bash
git log --oneline -5
npm test 2>&1 | tail -5
```

Expected: HEAD = 새 commit, ~403 tests passing + 1 useReports flake.

### Task 1.10: code-reviewer for Commit 1

- [ ] **Step 1: code-reviewer 호출**

`Agent` 도구로 `superpowers:code-reviewer` 호출. WHAT_WAS_IMPLEMENTED: spec §4 + §5.4 변경 (Commit 1 = a+d). PLAN_OR_REQUIREMENTS: 본 plan Tasks 1.1-1.9. BASE_SHA: `ee81fe7`. HEAD_SHA: 위 commit.

검증 포인트:
- parser.ts 의 system prompt + cache_control 정확
- actions.ts:runScrape 의 GoogleGenAI 잔존 없음 + 4-단계 onProgress 순서 정확
- aiParse.ts 마이그레이션 완전
- ScrapeScreen 정규식 변경이 기존 4-stage progress 에 회귀 없음
- TypeScript clean (cli + core + server)

- [ ] **Step 2: 발견 이슈 처리**

Critical/Important: 즉시 수정 후 재검토. Minor: STATUS 알려진 결함 추가 또는 수용.

---

## Commit 2: (c) Image/Video Retry Wrapper

### Task 2.1: `geminiRetry.ts` 신규 helper

**Files:**
- Create: `packages/core/src/creative/geminiRetry.ts`

- [ ] **Step 1: 본체 작성**

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

### Task 2.2: `geminiRetry.test.ts` 신규

**Files:**
- Create: `packages/core/src/creative/geminiRetry.test.ts`

- [ ] **Step 1: 11 케이스 테스트 작성**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withGeminiRetry, defaultIsRetryable } from "./geminiRetry.js";

describe("defaultIsRetryable", () => {
  it("retries 503", () => {
    expect(defaultIsRetryable(new Error("ServerError: 503 Service Unavailable"))).toBe(true);
  });
  it("retries UNAVAILABLE", () => {
    expect(defaultIsRetryable(new Error("UNAVAILABLE: model busy"))).toBe(true);
  });
  it("retries 429", () => {
    expect(defaultIsRetryable(new Error("429 rate limit"))).toBe(true);
  });
  it("retries RESOURCE_EXHAUSTED", () => {
    expect(defaultIsRetryable(new Error("RESOURCE_EXHAUSTED quota"))).toBe(true);
  });
  it("does NOT retry 404", () => {
    expect(defaultIsRetryable(new Error("404 NOT_FOUND"))).toBe(false);
  });
  it("does NOT retry generic", () => {
    expect(defaultIsRetryable(new Error("oops random"))).toBe(false);
  });
});

describe("withGeminiRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns immediately on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withGeminiRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable error and succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("503 UNAVAILABLE"))
      .mockResolvedValueOnce("ok");
    const promise = withGeminiRetry(fn, { onAttempt: () => {} });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws non-retryable error immediately", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("404 NOT_FOUND"));
    await expect(withGeminiRetry(fn)).rejects.toThrow("404");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws after max retries on persistent retryable error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("503 always failing"));
    const promise = withGeminiRetry(fn, { maxRetries: 3, onAttempt: () => {} });
    promise.catch(() => {}); // suppress unhandled rejection
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow("503");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("uses exponential backoff (delay = baseDelayMs * attempt)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("503"));
    const promise = withGeminiRetry(fn, { maxRetries: 3, baseDelayMs: 1000, onAttempt: () => {} });
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);  // delay 1: 1000ms
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);  // delay 2: 2000ms (cumulative 3000)
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: 테스트 실행**

```bash
npx vitest run packages/core/src/creative/geminiRetry.test.ts 2>&1 | tail -10
```

Expected: 11 cases passing.

### Task 2.3: `image.ts` retry wrap

**Files:**
- Modify: `packages/core/src/creative/image.ts`

- [ ] **Step 1: import + wrap**

`packages/core/src/creative/image.ts` 상단에 import 추가:
```ts
import { withGeminiRetry } from "./geminiRetry.js";
```

`generateImage` 함수 안의 `ai.models.generateImages` 호출 wrap:

```ts
// Before
const response = await ai.models.generateImages({
  model: "imagen-3.0-generate-002",
  prompt,
  config: { numberOfImages: 1, aspectRatio: "1:1", outputMimeType: "image/jpeg" },
});

// After
const response = await withGeminiRetry(() =>
  ai.models.generateImages({
    model: "imagen-3.0-generate-002",
    prompt,
    config: { numberOfImages: 1, aspectRatio: "1:1", outputMimeType: "image/jpeg" },
  })
);
```

### Task 2.4: `video.ts` retry wrap (2 호출)

**Files:**
- Modify: `packages/core/src/creative/video.ts`

- [ ] **Step 1: import 추가**

```ts
import { withGeminiRetry } from "./geminiRetry.js";
```

- [ ] **Step 2: 초기 generateVideos wrap**

```ts
// Before
let operation = await ai.models.generateVideos({
  model: "veo-3.1-generate-preview",
  prompt,
  config: { aspectRatio: "9:16", durationSeconds: 15 },
});

// After
let operation = await withGeminiRetry(() =>
  ai.models.generateVideos({
    model: "veo-3.1-generate-preview",
    prompt,
    config: { aspectRatio: "9:16", durationSeconds: 15 },
  })
);
```

- [ ] **Step 3: polling `operations.get` wrap**

```ts
// Before (polling loop 안)
operation = await ai.operations.get({ operation });

// After
operation = await withGeminiRetry(() => ai.operations.get({ operation }));
```

`onProgress` callback 이 polling 단계에서 호출되는데, retry 가 발생하면 polling 진행 상황 표시가 약간 어색할 수 있음 — 하지만 retry 자체가 console.warn 으로 가시화되므로 OK.

### Task 2.5: `videoJob.ts` retry wrap (2 호출)

**Files:**
- Modify: `packages/server/src/jobs/videoJob.ts`

- [ ] **Step 1: import 추가**

```ts
import { withGeminiRetry } from "@ad-ai/core/creative/geminiRetry.js";
```

- [ ] **Step 2: 초기 generateVideos wrap (line ~67)**

```ts
// Before
let operation = await ai.models.generateVideos({
  model: "veo-3.1-generate-preview",
  prompt,
  config: { aspectRatio: "9:16", durationSeconds: 15 },
});

// After
let operation = await withGeminiRetry(() =>
  ai.models.generateVideos({
    model: "veo-3.1-generate-preview",
    prompt,
    config: { aspectRatio: "9:16", durationSeconds: 15 },
  })
);
```

- [ ] **Step 3: polling `operations.get` wrap (line ~80)**

```ts
// Before
operation = await ai.operations.get({ operation });

// After
operation = await withGeminiRetry(() => ai.operations.get({ operation }));
```

### Task 2.6: `aiImage.ts` retry wrap

**Files:**
- Modify: `packages/server/src/routes/aiImage.ts`

- [ ] **Step 1: import + wrap**

상단 import:
```ts
import { withGeminiRetry } from "@ad-ai/core/creative/geminiRetry.js";
```

`router.post` 핸들러 안의 `ai.models.generateImages` 호출 wrap:

```ts
// Before
const response = await ai.models.generateImages({
  model: "imagen-3.0-generate-002",
  prompt,
  config: { numberOfImages: 1, aspectRatio: "1:1", outputMimeType: "image/jpeg" },
});

// After
const response = await withGeminiRetry(() =>
  ai.models.generateImages({
    model: "imagen-3.0-generate-002",
    prompt,
    config: { numberOfImages: 1, aspectRatio: "1:1", outputMimeType: "image/jpeg" },
  })
);
```

### Task 2.7: 전체 테스트 + grep verification

- [ ] **Step 1: `npm test`**

```bash
npm test 2>&1 | tail -5
```

Expected: ~403 (Commit 1 후) + 11 (geminiRetry) = **414 tests passing** + 1 useReports flake.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
npx tsc --noEmit -p packages/server/tsconfig.json 2>&1 | head
```

Expected: 0 errors.

- [ ] **Step 3: grep verification**

```bash
grep -rn "withGeminiRetry" packages/ --include="*.ts" | grep -v "\.test\.ts"
```

Expected: 5 hits — geminiRetry.ts (정의), image.ts, video.ts (2회), videoJob.ts (2회), aiImage.ts. 총 6+ hits 허용 (video.ts/videoJob.ts 가 2 호출씩).

### Task 2.8: Commit 2

- [ ] **Step 1: 명시적 add**

```bash
git add packages/core/src/creative/geminiRetry.ts \
  packages/core/src/creative/geminiRetry.test.ts \
  packages/core/src/creative/image.ts \
  packages/core/src/creative/video.ts \
  packages/server/src/jobs/videoJob.ts \
  packages/server/src/routes/aiImage.ts
```

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(creative): add Gemini retry wrapper for Image/Video API calls

503/UNAVAILABLE/429/RESOURCE_EXHAUSTED transient error 자동 흡수. Image (Imagen 3) + Video (Veo 3.1) 호출 안정성 개선. parser 는 이미 Commit 1 에서 Claude 로 옮겨 retry 불필요.

신규 packages/core/src/creative/geminiRetry.ts:
- withGeminiRetry<T>(fn, options?): generic helper
- maxRetries=3, baseDelayMs=2000, exponential backoff (delay = baseDelayMs * attempt → 2s/4s/6s)
- defaultIsRetryable: 503|UNAVAILABLE|429|RESOURCE_EXHAUSTED 매칭
- onAttempt callback (default: console.warn)

Wrap 호출처 (4 파일, 6 호출):
- core/creative/image.ts: ai.models.generateImages
- core/creative/video.ts: ai.models.generateVideos + ai.operations.get (polling)
- server/jobs/videoJob.ts: 동일 2 호출
- server/routes/aiImage.ts: generateImages

테스트: geminiRetry.test.ts 신규 11 케이스 (isRetryable 6 + withRetry 5).

503 이 자주 발생하는 Image/Video 생성 단계의 안정성 개선. parser 는 Commit 1 에서 Claude 로 이전됨 — retry 불필요.

Spec: docs/superpowers/specs/2026-04-27-gemini-to-claude-parser-design.md §4.4-§4.5
EOF
)"
```

- [ ] **Step 3: Final verification**

```bash
git log --oneline -7
npm test 2>&1 | tail -5
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
```

Expected: HEAD = 새 commit, ~414 tests passing.

### Task 2.9: code-reviewer for Commit 2

- [ ] **Step 1: code-reviewer 호출**

`Agent` 도구로 `superpowers:code-reviewer`. WHAT_WAS_IMPLEMENTED: spec §4.4-§4.5 (Commit 2 = c). PLAN_OR_REQUIREMENTS: Tasks 2.1-2.8. BASE_SHA: Commit 1 SHA. HEAD_SHA: Commit 2 SHA.

검증 포인트:
- geminiRetry helper signature + maxRetries/baseDelayMs default
- defaultIsRetryable 패턴 4개 정확 (503|UNAVAILABLE|429|RESOURCE_EXHAUSTED)
- 호출처 4 파일 wrap 일관성 (모두 `withGeminiRetry(() => ...)`)
- video.ts/videoJob.ts 의 polling 안 retry 가 의도된 동작인지 (각 polling 시도가 transient 503 만나면 그 한 번의 polling 시도 retry — OK)
- 테스트 11 케이스 모두 의미 있는 assertion

- [ ] **Step 2: 발견 이슈 처리**

---

## 완료 조건 (Definition of Done)

- [ ] 2 commits — Commit 1 (a)+(d), Commit 2 (c)
- [ ] `npm test` ~414 (396 + 18 신규)
- [ ] grep 검증:
  ```bash
  grep -rn "GoogleGenAI\|@google/genai\|parseProductWithGemini\|requireGoogleAiKey" packages/ --include="*.ts" 2>&1 | grep -v "image\|video\|videoJob\|aiImage"
  ```
  Expected: 0 hits in (parser/aiParse/actions:runScrape) 영역.
  ```bash
  grep -rn "withGeminiRetry" packages/ --include="*.ts"
  ```
  Expected: image/video/videoJob/aiImage 호출 + geminiRetry 정의/테스트.
- [ ] inflearn URL Scrape → 4-단계 TUI progress 표시 확인 (수동)
- [ ] data/products/*.json 정상 저장
- [ ] code-reviewer 검토 통과 (Commit 1, 2 각각)
- [ ] STATUS 마지막 업데이트 = 2026-04-27

---

## 작업 시간 견적 (재집계)

| 단계 | 시간 |
|---|---|
| Task 0 (pre-flight) | 0.1h |
| Tasks 1.1-1.9 (Commit 1 코드 + 테스트 + commit) | 2.5h |
| Task 1.10 (code-reviewer Commit 1) | 0.6h |
| Tasks 2.1-2.8 (Commit 2 코드 + 테스트 + commit) | 1.5h |
| Task 2.9 (code-reviewer Commit 2) | 0.4h |
| 안정화 + 수동 verification | 0.3h |
| **합계** | **~5.4h** |

(Spec §9 견적 6.7h 보다 약간 짧음 — spec/plan 작성 시간 빠짐.)

---

## Self-Review

### Spec coverage 매핑

| Spec section | Plan task | 검증 |
|---|---|---|
| §1 배경 | Plan header | ✅ |
| §2.1 (a) Parser | Task 1.1, 1.2, 1.3, 1.5 | ✅ |
| §2.1 (c) Image/Video retry | Task 2.1-2.6 | ✅ |
| §2.1 (d) onProgress + 정규식 | Task 1.3, 1.6, 1.7 | ✅ |
| §2.2 범위 밖 | Plan 본문에 안 둠 (의도) | ✅ |
| §3.1 Claude 모델 | Task 1.1 코드 | ✅ |
| §3.2 cache_control | Task 1.1 코드 | ✅ |
| §3.3 retry 위치 (creative/) | Task 2.1 | ✅ |
| §3.4 retry 정책 | Task 2.1 코드 | ✅ |
| §3.5 정규식 robust | Task 1.6 | ✅ |
| §3.6 commit 분할 | Plan Commit 1, 2 구조 | ✅ |
| §4 코드 상세 | Tasks 1.x, 2.x | ✅ |
| §5 테스트 전략 | Task 1.2, 1.4, 1.7, 2.2 | ✅ |
| §6 마이그레이션 (zero) | Task 0.1 | ✅ |
| §7 리스크 | Plan 본문에 안 둠 (spec 에 위임) | ✅ |
| §8 작업 순서 | Plan Tasks 1-2 | ✅ |
| §9 시간 견적 | Plan 본문 | ✅ |
| §10 DoD | Plan DoD 섹션 | ✅ |
| §11 Open Questions | Plan 본문 없음 (spec 에 위임) | ✅ |

### Placeholder scan

- "TBD", "TODO", "implement later": 0건 ✅
- "Add appropriate error handling": 0건 ✅
- "Similar to Task N": 0건 ✅
- 모든 step 코드 본체 명시 ✅

### Type consistency

- `parseProductWithClaude(client: Anthropic, url: string, html: string): Promise<Product>` 시그니처 — Task 1.1 정의 + Task 1.3 (actions.ts) + Task 1.5 (aiParse.ts) 사용 모두 일치 ✅
- `withGeminiRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>` — Task 2.1 정의 + Task 2.3-2.6 호출 모두 일치 ✅
- `Anthropic` SDK 의 `client.messages.create({system: [...], messages: [{role, content}]})` — Task 1.1 코드 + Task 1.2 mock 모두 일치 ✅

이슈 없음.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-27-gemini-to-claude-parser.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Commit 1 (a+d), Commit 2 (c) 각각 implementer subagent dispatch + code-reviewer.

**2. Inline Execution** — CLAUDE.md 가 Inline 사용 금지 — *해당 없음*.

CLAUDE.md 정책상 **Subagent-Driven 만 허용**. 진행 시 `superpowers:subagent-driven-development` 스킬 호출.

# SP4 레이어드 아키텍처 리팩터 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src/` 아래에 뒤섞인 CLI 조작과 비지니스 로직을, 프레임워크 무관 `core/`와 presentation layer `cli/`·`server/`로 재조직한다. 순수 파일 이동 리팩터이며 동작 변경은 없다.

**Architecture:** leaf부터 stage 순서로 이동한다. Stage 1: `core/` 생성 (아무도 의존하지 않는 순수 로직) → Stage 2: `server/` cleanup → Stage 3: `cli/` 생성 (`core/`에만 의존) → Stage 4: 빌드 설정 업데이트 → Stage 5: `src/` 전체 삭제. 각 task 마지막에 `tsc --noEmit` + `vitest run`으로 회귀 검증하고 커밋한다.

**Tech Stack:** TypeScript (ESM, `.js` 확장자 import), vitest, Node built-ins, 외부 라이브러리 (Ink, Playwright, Express, better-sqlite3, Stripe, node-cron, Anthropic/Google SDK). 설계 문서: [`docs/superpowers/specs/2026-04-17-layered-architecture-refactor-design.md`](../specs/2026-04-17-layered-architecture-refactor-design.md).

---

## 배경

SP3까지 `src/`는 Owner CLI (TUI) + 공통 비지니스 로직이 혼재된 디렉토리였고, `server/`는 `src/` 내부로 reach-in import 했다 (`../../src/generator/copy.js`). 이 구조는 책임 경계가 흐리고, CLI 전용 의존성(Ink, Playwright)과 서버 전용 의존성이 같은 파일에 섞여 있어 새 presentation layer(예: 웹 대시보드)를 붙이기 어렵다.

설계 문서는 다음 3개 레이어로 재조직한다.

| 계층 | 책임 | 허용되는 의존성 |
|------|------|------|
| `core/` | 프레임워크 무관 비지니스 로직 | Node built-ins, 외부 API SDK (Google/Anthropic/Meta), Stripe 상수, JSON 파일 I/O |
| `cli/` | Owner TUI + Customer CLI 진입점 | `core/*`, Ink/React, Playwright, node-cron, `fs`, `child_process` (git exec) |
| `server/` | Express + SQLite + Stripe SDK | `core/*`, Express, better-sqlite3, Stripe SDK |

제약 (설계 문서 §제약 사항):
- 동작 변경 금지 (API 시그니처·반환값·부수 효과 동일)
- 테스트 코드 수정 금지 (import 경로만 업데이트)
- 주석/포맷/변수명 "개선" 금지
- 기존 테스트 수 동일 유지

---

## 파일 구조

리팩터 후 디렉토리 맵 (전체 명단은 설계 문서 §목표 구조 참조).

```
core/                          ← 순수 비지니스 로직
├── types.ts, storage.ts
├── types/facebook-nodejs-business-sdk.d.ts
├── billing/{pricing,tiers}.ts
├── product/parser.ts          (split: scraper/index.ts의 pure 함수)
├── creative/{copy,image,video}.ts
├── campaign/{launcher,monitor}.ts  (monitor는 split: startCronScheduler 제외)
├── improver/index.ts          (split: shouldTriggerImprovement, buildImprovementPrompt, parseImprovements)
└── reviewer/decisions.ts      (split: applyReviewDecision)

cli/
├── mode.ts, pipeline.ts, actions.ts, scraper.ts
├── tui/*.tsx
├── client/{aiProxy,usageServer}.ts
├── reviewer/session.ts        (split: runReviewSession)
├── improver/runner.ts         (split: runImprovementCycle, applyCodeChange)
├── monitor/scheduler.ts       (split: startCronScheduler)
└── entries/*.ts               (모든 진입점, 기존 src/cli/*)

server/                        ← 기존 구조 유지
├── stripe.ts                  (tiers 제거됨)
├── routes/*.ts                (src/ 대신 core/ import)
└── ...
```

**분할 파일 처리 원칙:** 한 task 안에서 원자적으로 처리한다. (1) `core/` 또는 `cli/`에 새 파일 생성 (pure 또는 non-pure 부분만 copy-paste) → (2) `src/` 원본 수정 (남은 부분만 유지, 이동한 부분은 import해서 사용) 또는 통째로 `git mv` → (3) 테스트 파일은 `git mv` 후 import 경로 수정. 이렇게 하면 동일 코드가 두 곳에 존재하는 일이 없고 테스트 수도 변하지 않는다.

---

## Stage 1 — core/ 생성 (Tasks 1-6)

### Task 1: core/ 기반 파일 이동 (types, storage, facebook 타입 선언)

**Files:**
- Move: `src/types.ts` → `core/types.ts`
- Move: `src/types.test.ts` → `core/types.test.ts`
- Move: `src/storage.ts` → `core/storage.ts`
- Move: `src/storage.test.ts` → `core/storage.test.ts`
- Move: `src/types/facebook-nodejs-business-sdk.d.ts` → `core/types/facebook-nodejs-business-sdk.d.ts`
- Modify: 모든 `../types.js` / `./types.js` import를 새 경로로 업데이트
- Modify: 모든 `../storage.js` / `./storage.js` import를 새 경로로 업데이트

- [ ] **Step 1: 디렉토리 생성 및 파일 이동**

```bash
mkdir -p core/types
git mv src/types.ts core/types.ts
git mv src/types.test.ts core/types.test.ts
git mv src/storage.ts core/storage.ts
git mv src/storage.test.ts core/storage.test.ts
git mv src/types/facebook-nodejs-business-sdk.d.ts core/types/facebook-nodejs-business-sdk.d.ts
rmdir src/types
```

- [ ] **Step 2: 이동한 파일이 서로 참조하는지 확인 후 내부 import 업데이트**

`core/types.test.ts`의 import 경로 확인: `./types.js` 그대로 유지 (같은 디렉토리).
`core/storage.test.ts`의 import 경로 확인: `./storage.js` 그대로 유지.
`core/storage.ts`가 `./types.js`를 참조하면 그대로 유지.

- [ ] **Step 3: src/ 쪽 consumer 업데이트**

`src/` 아래 모든 `.ts`/`.tsx` 파일에서 `../types.js`, `../../types.js` 등의 참조를 `../core/types.js`, `../../core/types.js`로 변경. `../storage.js`도 동일.

변경 대상 파일 (grep으로 확인):

```bash
grep -rln "from \"\(\.\./\)\+types\(/index\)\?\.js\"" src/
grep -rln "from \"\(\.\./\)\+storage\.js\"" src/
```

각 파일에서 상대 경로 깊이에 맞게 `core/` 경유 경로로 수정. 예:
- `src/tui/actions.ts`의 `from "../types.js"` → `from "../../core/types.js"`
- `src/generator/copy.ts`의 `from "../types.js"` → `from "../../core/types.js"`
- `src/scraper/index.ts`의 `from "../storage.js"` → `from "../../core/storage.js"`

- [ ] **Step 4: server/ 쪽 consumer 업데이트**

```bash
grep -rln "from \"\.\./\.\./src/types\.js\"" server/
```

변경 대상:
- `server/routes/aiCopy.ts:4`, `aiImage.ts:4`, `aiVideo.ts:3`, `aiAnalyze.ts:4`, `jobs/videoJob.ts:7`

`from "../../src/types.js"` → `from "../../core/types.js"`

- [ ] **Step 5: 타입 검사 및 테스트**

```bash
npx tsc --noEmit
npx vitest run
```

모두 PASS. 테스트 수는 이전 대비 동일 (이동만 했으므로).

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "refactor: move types and storage to core/"
```

---

### Task 2: core/billing 생성 (pricing, tiers)

**Files:**
- Move: `server/pricing.ts` → `core/billing/pricing.ts`
- Move: `server/pricing.test.ts` → `core/billing/pricing.test.ts`
- Create: `core/billing/tiers.ts` (server/stripe.ts에서 `RECHARGE_TIERS`, `getTierAmount`만 추출)
- Create: `core/billing/tiers.test.ts` (server/stripe.test.ts에서 해당 describe 2개 추출)
- Modify: `server/stripe.ts` — `RECHARGE_TIERS`, `getTierAmount` 제거 + `core/billing/tiers.js`에서 re-export (임시 호환)
- Modify: `server/stripe.test.ts` — 해당 두 describe 블록 삭제
- Modify: `server/billing.ts`, `server/admin.ts` — pricing/tiers import 경로 업데이트

- [ ] **Step 1: 디렉토리 생성 및 pricing 이동**

```bash
mkdir -p core/billing
git mv server/pricing.ts core/billing/pricing.ts
git mv server/pricing.test.ts core/billing/pricing.test.ts
```

- [ ] **Step 2: core/billing/tiers.ts 생성**

`core/billing/tiers.ts`를 생성하고 아래 내용 작성:

```typescript
export const RECHARGE_TIERS: Record<string, number> = {
  basic: 10,
  standard: 20,
  pro: 50,
};

export function getTierAmount(tier: string): number {
  return RECHARGE_TIERS[tier] ?? 20;
}
```

- [ ] **Step 3: core/billing/tiers.test.ts 생성**

`server/stripe.test.ts`에서 `describe("RECHARGE_TIERS")`, `describe("getTierAmount")` 두 블록을 `core/billing/tiers.test.ts`로 옮기고 import 경로를 `./tiers.js`로 수정:

```typescript
import { describe, expect, it } from "vitest";
import { getTierAmount, RECHARGE_TIERS } from "./tiers.js";

describe("RECHARGE_TIERS", () => {
  it("has basic/standard/pro tiers", () => {
    expect(RECHARGE_TIERS.basic).toBe(10);
    expect(RECHARGE_TIERS.standard).toBe(20);
    expect(RECHARGE_TIERS.pro).toBe(50);
  });
});

describe("getTierAmount", () => {
  it("returns amount for known tier", () => {
    expect(getTierAmount("standard")).toBe(20);
  });
  it("returns default 20 for unknown tier", () => {
    expect(getTierAmount("unknown")).toBe(20);
  });
});
```

주: 기존 `server/stripe.test.ts`의 describe 블록 본문을 그대로 복사 (동작·assertion 변경 없음). 실제 파일 내용을 읽어 일치시킬 것.

- [ ] **Step 4: server/stripe.ts 슬림화**

`server/stripe.ts`에서 `RECHARGE_TIERS`, `getTierAmount` 선언 삭제. 다른 Stripe 함수(`createStripeClient`, `createStripeCustomer`, `createCheckoutSession`, `triggerAutoRecharge`)는 유지.

- [ ] **Step 5: server/stripe.test.ts 슬림화**

`describe("RECHARGE_TIERS")`, `describe("getTierAmount")` 두 블록 삭제. 파일이 비게 되면 `git rm server/stripe.test.ts`.

- [ ] **Step 6: server consumer import 업데이트**

```bash
grep -rln "from \"\./pricing\.js\"\|from \"\.\./pricing\.js\"" server/
grep -rln "getTierAmount\|RECHARGE_TIERS" server/
```

- `server/billing.ts`: `from "./pricing.js"` → `from "../core/billing/pricing.js"`
- `server/admin.ts:4`: `getTierAmount` import 분리
  - `from "./stripe.js"` (createStripeClient 등)
  - `from "../core/billing/tiers.js"` (getTierAmount)
- `server/routes/*.ts` 중 pricing import 있으면 `from "../../core/billing/pricing.js"`

- [ ] **Step 7: 타입 검사 및 테스트**

```bash
npx tsc --noEmit
npx vitest run
```

모두 PASS. 테스트 수 동일.

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "refactor: extract billing (pricing, tiers) to core/"
```

---

### Task 3: core/product/parser.ts 생성 (scraper split)

**Files:**
- Create: `core/product/parser.ts` (`detectCategory`, `parseProductWithGemini` — src/scraper/index.ts에서 추출)
- Move: `src/scraper/index.test.ts` → `core/product/parser.test.ts`
- Modify: `src/scraper/index.ts` — pure 함수 삭제, `scrapeProduct`만 유지하고 `core/product/parser.js`에서 import
- Modify: `server/routes/aiParse.ts` — import 경로 업데이트

- [ ] **Step 1: 디렉토리 생성**

```bash
mkdir -p core/product
```

- [ ] **Step 2: core/product/parser.ts 생성**

`src/scraper/index.ts`의 `detectCategory`, `parseProductWithGemini` 두 함수를 그대로 옮기고, 필요한 import만 가져온다:

```typescript
import { GoogleGenAI } from "@google/genai";
import type { Product } from "../types.js";
import { randomUUID } from "crypto";

export function detectCategory(url: string): string {
  if (url.includes("inflearn.com")) return "course";
  if (url.includes("class101.net")) return "course";
  return "other";
}

export async function parseProductWithGemini(
  ai: GoogleGenAI,
  url: string,
  html: string
): Promise<Product> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-05-20",
    contents: `다음 HTML에서 제품/서비스 정보를 추출해 JSON으로 반환해주세요.
반드시 아래 형식만 반환하고 다른 텍스트는 포함하지 마세요:
{"name":"","description":"","price":0,"tags":[],"imageUrl":""}

HTML:
${html.slice(0, 8000)}`,
  });

  const raw = response.text ?? "{}";
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

주의: 문자열·함수 시그니처·필드 순서를 `src/scraper/index.ts`와 동일하게 유지. 손대지 말 것.

- [ ] **Step 3: 테스트 파일 이동**

```bash
git mv src/scraper/index.test.ts core/product/parser.test.ts
```

`core/product/parser.test.ts`의 import 경로를 `./index.js` → `./parser.js`로 수정.

- [ ] **Step 4: src/scraper/index.ts 슬림화**

Pure 함수 선언을 삭제하고, `scrapeProduct` 구현 내부에서 `core/product/parser.js`에서 import해서 사용:

```typescript
import { chromium } from "playwright";
import { GoogleGenAI } from "@google/genai";
import type { Product } from "../../core/types.js";
import { writeJson } from "../../core/storage.js";
import { parseProductWithGemini } from "../../core/product/parser.js";

export async function scrapeProduct(url: string): Promise<Product> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    const html = await page.content();
    const product = await parseProductWithGemini(ai, url, html);
    await writeJson(`data/products/${product.id}.json`, product);
    return product;
  } finally {
    await browser.close();
  }
}
```

`detectCategory`, `parseProductWithGemini` 선언과 `randomUUID` import 삭제. `writeJson`, `Product`은 Task 1에서 이미 `core/` 기준으로 업데이트되었으므로 그 경로 사용.

- [ ] **Step 5: server consumer 업데이트**

`server/routes/aiParse.ts:3`:
- `from "../../src/scraper/index.js"` → `from "../../core/product/parser.js"`

- [ ] **Step 6: 타입 검사 및 테스트**

```bash
npx tsc --noEmit
npx vitest run
```

모두 PASS. 테스트 수 동일.

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "refactor: split scraper pure functions to core/product/parser"
```

---

### Task 4: core/creative 생성 (copy, image, video 통째 이동)

**Files:**
- Move: `src/generator/copy.ts` → `core/creative/copy.ts`
- Move: `src/generator/copy.test.ts` → `core/creative/copy.test.ts`
- Move: `src/generator/image.ts` → `core/creative/image.ts`
- Move: `src/generator/image.test.ts` → `core/creative/image.test.ts`
- Move: `src/generator/video.ts` → `core/creative/video.ts`
- Move: `src/generator/video.test.ts` → `core/creative/video.test.ts`
- Modify: 이동한 파일 내부의 상대 import 경로 업데이트
- Modify: 모든 consumer import 경로 업데이트 (src/, server/)

- [ ] **Step 1: 디렉토리 생성 및 이동**

```bash
mkdir -p core/creative
git mv src/generator/copy.ts core/creative/copy.ts
git mv src/generator/copy.test.ts core/creative/copy.test.ts
git mv src/generator/image.ts core/creative/image.ts
git mv src/generator/image.test.ts core/creative/image.test.ts
git mv src/generator/video.ts core/creative/video.ts
git mv src/generator/video.test.ts core/creative/video.test.ts
rmdir src/generator
```

- [ ] **Step 2: 이동한 파일의 내부 import 경로 수정**

`core/creative/copy.ts`, `image.ts`, `video.ts`에서 `../types.js`, `../storage.js` 같은 참조가 있으면 `../types.js`, `../storage.js`로 유지 (core/ 기준 상대 경로). `core/` 기반이므로 한 단계 위가 `core/types.ts`다.

`core/creative/copy.test.ts` 등은 `./copy.js` 등의 같은 디렉토리 참조는 그대로, `../types.js`는 `../types.js`로 유지.

실제 각 파일을 읽고 import 경로가 유효한지 `npx tsc --noEmit`로 검증.

- [ ] **Step 3: src/ 쪽 consumer 업데이트**

```bash
grep -rln "from \"\.\./generator/" src/
```

대상 예상:
- `src/tui/actions.ts`
- `src/pipeline.ts`
- `src/cli/generate.ts`
- `src/cli/pipeline.ts`

각 파일에서:
- `from "../generator/copy.js"` → `from "../../core/creative/copy.js"`
- `from "../generator/image.js"` → `from "../../core/creative/image.js"`
- `from "../generator/video.js"` → `from "../../core/creative/video.js"`

상대 경로 깊이는 실제 파일 위치에 맞게 조정 (예: `src/tui/actions.ts`는 `../../core/`, `src/cli/pipeline.ts`도 `../../core/`).

- [ ] **Step 4: server/ 쪽 consumer 업데이트**

```bash
grep -rln "from \"\.\./\.\./src/generator/" server/
```

대상:
- `server/routes/aiCopy.ts:3`
- `server/routes/aiImage.ts:3`
- `server/jobs/videoJob.ts:6`

변경:
- `from "../../src/generator/copy.js"` → `from "../../core/creative/copy.js"`
- `from "../../src/generator/image.js"` → `from "../../core/creative/image.js"`
- `from "../../src/generator/video.js"` → `from "../../core/creative/video.js"`

- [ ] **Step 5: 타입 검사 및 테스트**

```bash
npx tsc --noEmit
npx vitest run
```

모두 PASS. 테스트 수 동일.

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "refactor: move creative generators to core/creative"
```

---

### Task 5: core/campaign 생성 (launcher 통째 + monitor split)

**Files:**
- Move: `src/launcher/index.ts` → `core/campaign/launcher.ts`
- Move: `src/launcher/index.test.ts` → `core/campaign/launcher.test.ts`
- Create: `core/campaign/monitor.ts` — `src/monitor/index.ts`에서 `startCronScheduler` 제외 전부 이동
- Move: `src/monitor/index.test.ts` → `core/campaign/monitor.test.ts`
- Modify: `src/monitor/index.ts` — `startCronScheduler`만 유지하고 pure 함수들은 `core/campaign/monitor.js`에서 import
- Modify: 모든 consumer import 경로

- [ ] **Step 1: 디렉토리 생성 및 launcher 이동**

```bash
mkdir -p core/campaign
git mv src/launcher/index.ts core/campaign/launcher.ts
git mv src/launcher/index.test.ts core/campaign/launcher.test.ts
rmdir src/launcher
```

`core/campaign/launcher.ts`의 내부 import에서 `../types.js`, `../storage.js` 등이 유효한지 확인 (core/ 기준 한 단계 위).

- [ ] **Step 2: core/campaign/monitor.ts 생성**

`src/monitor/index.ts`의 내용 중 `startCronScheduler`를 제외한 나머지를 전부 옮긴다. `cron` import도 제거. 나머지 import(Anthropic, bizSdk, types, storage)는 그대로:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import bizSdk from "facebook-nodejs-business-sdk";
import type { Report, Campaign } from "../types.js";
import { readJson, writeJson, appendJson, listJson } from "../storage.js";
import { randomUUID } from "crypto";

const { AdAccount } = bizSdk as any;

export interface PerformanceStats {
  top: Report[];
  bottom: Report[];
  totalSpend: number;
  avgCtr: number;
}

export function computeStats(reports: Report[]): PerformanceStats {
  // ... src/monitor/index.ts:17-30 그대로
}

export function buildAnalysisPrompt(reports: Report[], stats: PerformanceStats): string {
  // ... src/monitor/index.ts:32-57 그대로
}

async function fetchInsights(campaignId: string, date: string): Promise<Report | null> {
  // ... src/monitor/index.ts:59-88 그대로
}

export async function collectDailyReports(): Promise<Report[]> {
  // ... src/monitor/index.ts:90-107 그대로
}

export async function generateWeeklyAnalysis(): Promise<string> {
  // ... src/monitor/index.ts:109-138 그대로
}
```

주의: 주석·공백·문자열 동일하게 유지. 실제 원본 코드를 그대로 복사하고 cron 관련 부분(`startCronScheduler`와 `import cron from "node-cron"`)만 제외.

- [ ] **Step 3: 테스트 파일 이동**

```bash
git mv src/monitor/index.test.ts core/campaign/monitor.test.ts
```

`core/campaign/monitor.test.ts`의 import 경로를 `./index.js` → `./monitor.js`로 수정. `../types.js` 같은 외부 참조는 core/ 구조에 맞게 그대로 (`../types.js`).

- [ ] **Step 4: src/monitor/index.ts 슬림화**

```typescript
import cron from "node-cron";
import { collectDailyReports, generateWeeklyAnalysis } from "../../core/campaign/monitor.js";

export { collectDailyReports, generateWeeklyAnalysis, computeStats, buildAnalysisPrompt, type PerformanceStats } from "../../core/campaign/monitor.js";

export function startCronScheduler(): void {
  // 매일 오전 9시
  cron.schedule("0 9 * * *", async () => {
    console.log("[Monitor] 일간 성과 수집 시작...");
    await collectDailyReports();
    console.log("[Monitor] 일간 수집 완료");
  });

  // 매주 월요일 오전 9시
  cron.schedule("0 9 * * 1", async () => {
    console.log("[Monitor] 주간 분석 시작...");
    const analysis = await generateWeeklyAnalysis();
    console.log("[Monitor] 주간 분석:\n", analysis);
  });

  console.log("[Monitor] 스케줄러 시작됨 (매일 09:00, 매주 월 09:00)");
}
```

주석·공백 원본과 동일하게 유지. re-export은 기존 consumer (server/routes/aiAnalyze.ts 등이 Task 5 완료 전 import 경로를 바꾸기 전까지) 호환을 위한 임시 조치.

- [ ] **Step 5: src/ 쪽 consumer 업데이트**

```bash
grep -rln "from \"\.\./launcher/\|from \"\.\./monitor/" src/
```

대상 예상: `src/tui/actions.ts`, `src/pipeline.ts`, `src/cli/launch.ts`, `src/cli/monitor.ts`, `src/cli/pipeline.ts`.

- `from "../launcher/index.js"` → `from "../../core/campaign/launcher.js"` (src/tui, src/cli 기준)
- `from "../monitor/index.js"` pure 함수 참조 → `from "../../core/campaign/monitor.js"`
- `from "../monitor/index.js"` `startCronScheduler` 참조 → `from "../monitor/index.js"` 유지 (아직 cli/로 안 옮김)

실제로는 `src/cli/monitor.ts`만 `startCronScheduler`를 쓸 것이고, 나머지 consumer는 pure 함수만 쓸 가능성이 높다. grep 결과에 따라 각 파일에서 pure 함수 import만 새 경로로 분리.

- [ ] **Step 6: server/ 쪽 consumer 업데이트**

`server/routes/aiAnalyze.ts:3`:
- `from "../../src/monitor/index.js"` → `from "../../core/campaign/monitor.js"`

- [ ] **Step 7: 타입 검사 및 테스트**

```bash
npx tsc --noEmit
npx vitest run
```

모두 PASS. 테스트 수 동일. (monitor.test.ts가 이동했지만 같은 테스트 개수로 core/ 아래에서 실행됨.)

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "refactor: move launcher and split monitor to core/campaign"
```

---

### Task 6: core/reviewer/decisions + core/improver/index 생성 (pure split)

**Files:**
- Create: `core/reviewer/decisions.ts` (`applyReviewDecision`, `ReviewAction` type)
- Create: `core/reviewer/decisions.test.ts` (`src/reviewer/index.test.ts` 중 `applyReviewDecision` 테스트만 추출)
- Create: `core/improver/index.ts` (`shouldTriggerImprovement`, `buildImprovementPrompt`, `parseImprovements`)
- Move: `src/improver/index.test.ts` → `core/improver/index.test.ts`
- Modify: `src/reviewer/index.ts` — `applyReviewDecision`, `ReviewAction` 제거, `core/reviewer/decisions.js`에서 import해서 `runReviewSession` 내부에서 사용
- Modify: `src/reviewer/index.test.ts` — `applyReviewDecision` 관련 테스트만 삭제 (runReviewSession 테스트가 남으면 유지, 없으면 파일 삭제)
- Modify: `src/improver/index.ts` — pure 함수 제거, `core/improver/index.js`에서 import해서 `runImprovementCycle` 내부에서 사용

- [ ] **Step 1: 디렉토리 생성**

```bash
mkdir -p core/reviewer core/improver
```

- [ ] **Step 2: core/reviewer/decisions.ts 생성**

`src/reviewer/index.ts:7-28`의 `ReviewAction` 타입과 `applyReviewDecision` 함수를 그대로 옮긴다:

```typescript
import type { Creative } from "../types.js";

export type ReviewAction =
  | { action: "approve" }
  | { action: "reject"; note: string }
  | { action: "edit"; field: keyof Creative["copy"]; value: string };

export function applyReviewDecision(
  creative: Creative,
  decision: ReviewAction
): Creative {
  switch (decision.action) {
    case "approve":
      return { ...creative, status: "approved" };
    case "reject":
      return { ...creative, status: "rejected", reviewNote: decision.note };
    case "edit":
      return {
        ...creative,
        status: "edited",
        copy: { ...creative.copy, [decision.field]: decision.value },
      };
  }
}
```

- [ ] **Step 3: core/reviewer/decisions.test.ts 생성**

`src/reviewer/index.test.ts`에서 `applyReviewDecision` 관련 describe 블록(들)을 그대로 복사해서 `core/reviewer/decisions.test.ts`를 만들고, import 경로를 `./decisions.js`로 수정.

원본 테스트 파일 내용을 먼저 읽어 정확히 어떤 테스트가 있는지 확인 후 이동.

- [ ] **Step 4: core/improver/index.ts 생성**

`src/improver/index.ts`에서 `shouldTriggerImprovement`, `buildImprovementPrompt`, `parseImprovements` 및 `CTR_THRESHOLD` 상수를 옮긴다. `runImprovementCycle`, `applyCodeChange`는 제외:

```typescript
import type { Report } from "../types.js";

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
```

문자열·공백·타입 시그니처 원본과 동일.

- [ ] **Step 5: improver 테스트 이동**

`src/improver/index.test.ts`가 세 pure 함수만 테스트한다면 (확인 필요):

```bash
git mv src/improver/index.test.ts core/improver/index.test.ts
```

그리고 core/improver/index.test.ts의 import 경로를 `./index.js` 그대로 유지 (이동 후에도 같은 디렉토리).

만약 테스트 파일이 `runImprovementCycle`이나 `applyCodeChange`도 테스트한다면 해당 블록만 남기고 나머지는 삭제해서 src/에 임시 유지 — 이후 cli/ stage에서 이동.

- [ ] **Step 6: src/reviewer/index.ts 슬림화**

`ReviewAction`, `applyReviewDecision` 선언 제거 후 `runReviewSession` 내부에서 `core/reviewer/decisions.js`의 것을 import해서 사용:

```typescript
import React from "react";
import { render } from "ink";
import type { Creative, Product } from "../../core/types.js";
import { ReviewScreen } from "../tui/ReviewScreen.js";
import { readJson, writeJson, listJson } from "../../core/storage.js";
import { applyReviewDecision } from "../../core/reviewer/decisions.js";

export { applyReviewDecision } from "../../core/reviewer/decisions.js";
export type { ReviewAction } from "../../core/reviewer/decisions.js";

export async function runReviewSession(): Promise<void> {
  // ... src/reviewer/index.ts:30-82 그대로
}
```

re-export은 server/CLI consumer 호환 임시 유지용 (Stage 3에서 consumer들이 직접 core/ import로 옮기면 제거 가능).

- [ ] **Step 7: src/reviewer/index.test.ts 정리**

원본 파일을 읽어 `applyReviewDecision` 외의 테스트(예: `runReviewSession`)가 있는지 확인. 있다면 그 블록만 남기고 `applyReviewDecision` 블록 삭제. 없다면 전체 삭제:

```bash
git rm src/reviewer/index.test.ts
```

- [ ] **Step 8: src/improver/index.ts 슬림화**

Pure 함수 선언 제거 후 `core/improver/index.js`에서 import:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "fs/promises";
import { execFileSync } from "child_process";
import type { Report, Improvement, ImprovementChange } from "../../core/types.js";
import { appendJson } from "../../core/storage.js";
import { buildImprovementPrompt, parseImprovements } from "../../core/improver/index.js";

export { shouldTriggerImprovement, buildImprovementPrompt, parseImprovements } from "../../core/improver/index.js";

const CTR_THRESHOLD = Number(process.env.CTR_IMPROVEMENT_THRESHOLD ?? 1.5);

async function applyCodeChange(
  // ... src/improver/index.ts:54-68 그대로
): Promise<boolean> {
  // 기존 그대로
}

export async function runImprovementCycle(
  // ... src/improver/index.ts:70-151 그대로
): Promise<void> {
  // 기존 그대로. buildImprovementPrompt/parseImprovements는 이제 core/에서 import됨
}
```

`CTR_THRESHOLD`는 `runImprovementCycle` 내부에서만 쓰는 용도로 여기 중복 유지 (core/도 같은 env var 읽음 — 동일 값).

- [ ] **Step 9: src/ 쪽 consumer 업데이트**

```bash
grep -rln "from \"\.\./reviewer/\|from \"\.\./improver/" src/
```

대상 예상: `src/pipeline.ts`, `src/tui/actions.ts`, `src/cli/review.ts`, `src/cli/improve.ts`.

- pure 함수(`applyReviewDecision`, `shouldTriggerImprovement`, `buildImprovementPrompt`, `parseImprovements`) 참조 → `core/` 경로로 변경
- 비순수 함수(`runReviewSession`, `runImprovementCycle`) 참조 → `src/reviewer/index.js`, `src/improver/index.js` 그대로 유지 (아직 cli/로 안 옮김)

- [ ] **Step 10: 타입 검사 및 테스트**

```bash
npx tsc --noEmit
npx vitest run
```

모두 PASS. 테스트 수 동일.

- [ ] **Step 11: 커밋**

```bash
git add -A
git commit -m "refactor: split reviewer and improver pure functions to core/"
```

---

## Stage 2 — server/ cleanup (Task 7)

### Task 7: server/ 잔여 src/ reach-in 제거 및 stripe.ts 최종 슬림화

Task 1-6에서 server/ routes의 src/ 참조를 대부분 업데이트했다. 이 task는 (a) 혹시 남아있는 `../../src/` 참조를 전부 찾아 정리하고, (b) Task 2에서 re-export 임시 호환으로 남겨둔 server/stripe.ts의 tier 관련 re-export이 있다면 제거한다.

**Files:**
- Modify: `server/stripe.ts` — 혹시 남은 re-export 제거
- Modify: `server/**/*.ts` — 남아 있는 `../../src/` 참조를 전부 `core/` 경로로 변경

- [ ] **Step 1: 잔여 src/ 참조 스캔**

```bash
grep -rn "from \"\.\./\.\./src/\|from \"\.\./src/" server/
```

결과가 비어 있으면 Step 2로. 남아 있으면 각 파일의 import 경로를 대응되는 `core/` 경로로 변경.

Task 1-6 이후 예상 잔여: 없음 (모든 src/ reach-in은 이미 core/로 옮겼음).

- [ ] **Step 2: server/stripe.ts 확인**

`server/stripe.ts`가 Task 2 이후 Stripe SDK 함수 4개만 export하는지 확인:
- `createStripeClient`
- `createStripeCustomer`
- `createCheckoutSession`
- `triggerAutoRecharge`

`RECHARGE_TIERS`, `getTierAmount` re-export이 남아 있다면 제거.

- [ ] **Step 3: 타입 검사 및 테스트**

```bash
npx tsc --noEmit
npx vitest run
```

모두 PASS. 테스트 수 동일.

- [ ] **Step 4: 커밋 (변경사항 있으면)**

```bash
git add -A
git commit -m "refactor: clean up server/ residual src/ imports"
```

변경사항 없으면 skip하고 Task 8로.

---

## Stage 3 — cli/ 생성 (Tasks 8-11)

### Task 8: cli/ infrastructure (mode, pipeline, scraper, client/)

**Files:**
- Move: `src/mode.ts` → `cli/mode.ts`
- Move: `src/mode.test.ts` → `cli/mode.test.ts`
- Move: `src/pipeline.ts` → `cli/pipeline.ts`
- Move: `src/scraper/index.ts` (`scrapeProduct`만 남아 있음) → `cli/scraper.ts`
- Move: `src/client/aiProxy.ts` → `cli/client/aiProxy.ts`
- Move: `src/client/aiProxy.test.ts` → `cli/client/aiProxy.test.ts`
- Move: `src/client/usageServer.ts` → `cli/client/usageServer.ts`
- Move: `src/client/usageServer.test.ts` → `cli/client/usageServer.test.ts`
- Modify: 이동한 파일의 상대 import 경로 업데이트

- [ ] **Step 1: 디렉토리 생성 및 이동**

```bash
mkdir -p cli/client
git mv src/mode.ts cli/mode.ts
git mv src/mode.test.ts cli/mode.test.ts
git mv src/pipeline.ts cli/pipeline.ts
git mv src/scraper/index.ts cli/scraper.ts
rmdir src/scraper
git mv src/client/aiProxy.ts cli/client/aiProxy.ts
git mv src/client/aiProxy.test.ts cli/client/aiProxy.test.ts
git mv src/client/usageServer.ts cli/client/usageServer.ts
git mv src/client/usageServer.test.ts cli/client/usageServer.test.ts
rmdir src/client
```

- [ ] **Step 2: 이동한 파일의 내부 import 경로 수정**

각 파일에서 상대 경로가 달라진 참조를 수정. 주요 변환 패턴:
- `cli/mode.ts`, `cli/pipeline.ts` (이전 `src/` 직속): `../core/...`와 `./` 참조 확인
- `cli/scraper.ts`: `../../core/...` → `../core/...` (깊이 1단계 줄어듦)
- `cli/client/*.ts`: `../../core/...` 유지 (깊이 동일)

실제 파일을 읽고 각 import를 적절히 조정. `npx tsc --noEmit`이 통과하도록 맞출 것.

- [ ] **Step 3: src/ 쪽 consumer 업데이트**

```bash
grep -rln "from \"\.\./mode\.js\|from \"\.\./pipeline\.js\|from \"\.\./scraper/\|from \"\.\./client/" src/
grep -rln "from \"\./mode\.js\|from \"\./pipeline\.js" src/
```

대상 예상:
- `src/tui/App.tsx`, `src/tui/actions.ts`
- `src/cli/*.ts` (아직 cli/entries로 안 옮김)
- `src/reviewer/index.ts`, `src/improver/index.ts`, `src/monitor/index.ts` (잔류 wrappers)

각 파일에서 `../mode.js`, `../pipeline.js`, `../scraper/index.js`, `../client/*.js` 참조를 새 `cli/` 경로로 업데이트. 상대 경로 깊이 주의.

- [ ] **Step 4: 타입 검사 및 테스트**

```bash
npx tsc --noEmit
npx vitest run
```

모두 PASS. 테스트 수 동일.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "refactor: move cli infra (mode, pipeline, scraper, client) to cli/"
```

---

### Task 9: cli/tui + cli/actions

**Files:**
- Move: `src/tui/App.tsx` → `cli/tui/App.tsx` (+ `App.test.tsx`)
- Move: `src/tui/AppTypes.ts` → `cli/tui/AppTypes.ts` (+ `AppTypes.test.ts`)
- Move: `src/tui/MenuScreen.tsx` → `cli/tui/MenuScreen.tsx` (+ `MenuScreen.test.tsx`)
- Move: `src/tui/ReviewScreen.tsx` → `cli/tui/ReviewScreen.tsx`
- Move: `src/tui/PipelineProgress.tsx` → `cli/tui/PipelineProgress.tsx` (+ `PipelineProgress.test.tsx`)
- Move: `src/tui/DoneScreen.tsx` → `cli/tui/DoneScreen.tsx` (+ `DoneScreen.test.tsx`)
- Move: `src/tui/actions.ts` → `cli/actions.ts` (+ `actions.test.ts`)
- Modify: 모든 consumer import 경로 업데이트

- [ ] **Step 1: 디렉토리 생성 및 이동**

```bash
mkdir -p cli/tui
git mv src/tui/App.tsx cli/tui/App.tsx
git mv src/tui/App.test.tsx cli/tui/App.test.tsx
git mv src/tui/AppTypes.ts cli/tui/AppTypes.ts
git mv src/tui/AppTypes.test.ts cli/tui/AppTypes.test.ts
git mv src/tui/MenuScreen.tsx cli/tui/MenuScreen.tsx
git mv src/tui/MenuScreen.test.tsx cli/tui/MenuScreen.test.tsx
git mv src/tui/ReviewScreen.tsx cli/tui/ReviewScreen.tsx
git mv src/tui/PipelineProgress.tsx cli/tui/PipelineProgress.tsx
git mv src/tui/PipelineProgress.test.tsx cli/tui/PipelineProgress.test.tsx
git mv src/tui/DoneScreen.tsx cli/tui/DoneScreen.tsx
git mv src/tui/DoneScreen.test.tsx cli/tui/DoneScreen.test.tsx
git mv src/tui/actions.ts cli/actions.ts
git mv src/tui/actions.test.ts cli/actions.test.ts
rmdir src/tui
```

- [ ] **Step 2: 이동한 파일의 내부 import 수정**

`cli/tui/*.tsx`와 `cli/actions.ts` 내부에서:
- 같은 tui 폴더끼리의 참조는 `./` 그대로
- `cli/tui/*.tsx`에서 `cli/` 상위 참조: `../mode.js`, `../pipeline.js`, `../actions.js` 등으로 조정
- `cli/actions.ts`에서: `./tui/*` 또는 `./mode.js` 등으로 조정
- `core/` 참조: 깊이에 맞게 `../core/...` 또는 `../../core/...`

실제 파일을 읽고 tsc가 통과하도록 수정.

- [ ] **Step 3: src/ 쪽 consumer 업데이트**

```bash
grep -rln "from \"\.\./tui/\|from \"\.\./\.\./tui/" src/
```

대상 예상:
- `src/reviewer/index.ts`: `../tui/ReviewScreen.js` → `../../cli/tui/ReviewScreen.js`
- `src/cli/app.ts`: `../tui/App.js` → `../../cli/tui/App.js`

- [ ] **Step 4: 타입 검사 및 테스트**

```bash
npx tsc --noEmit
npx vitest run
```

모두 PASS. 테스트 수 동일.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "refactor: move tui components and actions to cli/"
```

---

### Task 10: cli/reviewer/session + cli/improver/runner + cli/monitor/scheduler

**Files:**
- Create: `cli/reviewer/session.ts` — `src/reviewer/index.ts`에서 `runReviewSession`만 추출
- Create: `cli/improver/runner.ts` — `src/improver/index.ts`에서 `runImprovementCycle`, `applyCodeChange`만 추출
- Create: `cli/monitor/scheduler.ts` — `src/monitor/index.ts`에서 `startCronScheduler`만 추출
- Delete (after content extracted): `src/reviewer/index.ts`, `src/improver/index.ts`, `src/monitor/index.ts`
- Modify: consumer import 경로 (`src/cli/review.ts`, `improve.ts`, `monitor.ts`)
- Move: `src/improver/index.test.ts` 중 `runImprovementCycle` 테스트가 남아있다면 `cli/improver/runner.test.ts`로 이동

- [ ] **Step 1: 디렉토리 생성**

```bash
mkdir -p cli/reviewer cli/improver cli/monitor
```

- [ ] **Step 2: cli/reviewer/session.ts 생성**

`src/reviewer/index.ts`의 `runReviewSession` 함수와 필요한 import만 가져와서 작성:

```typescript
import React from "react";
import { render } from "ink";
import type { Creative, Product } from "../../core/types.js";
import { ReviewScreen } from "../tui/ReviewScreen.js";
import { readJson, writeJson, listJson } from "../../core/storage.js";
import { applyReviewDecision } from "../../core/reviewer/decisions.js";

export async function runReviewSession(): Promise<void> {
  // ... src/reviewer/index.ts:30-82 그대로 복사
}
```

함수 본문은 원본 그대로. 공백·주석 유지.

- [ ] **Step 3: cli/improver/runner.ts 생성**

`src/improver/index.ts`의 `applyCodeChange` (private) + `runImprovementCycle`을 가져온다. 복사 후 pure 함수는 `core/improver/index.js`에서 import:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "fs/promises";
import { execFileSync } from "child_process";
import type { Report, Improvement, ImprovementChange } from "../../core/types.js";
import { appendJson } from "../../core/storage.js";
import { buildImprovementPrompt, parseImprovements } from "../../core/improver/index.js";

const CTR_THRESHOLD = Number(process.env.CTR_IMPROVEMENT_THRESHOLD ?? 1.5);

async function applyCodeChange(
  // ... src/improver/index.ts:54-68 그대로
): Promise<boolean> {
  // ...
}

export async function runImprovementCycle(
  // ... src/improver/index.ts:70-151 그대로
): Promise<void> {
  // ...
}
```

- [ ] **Step 4: cli/monitor/scheduler.ts 생성**

```typescript
import cron from "node-cron";
import { collectDailyReports, generateWeeklyAnalysis } from "../../core/campaign/monitor.js";

export function startCronScheduler(): void {
  // 매일 오전 9시
  cron.schedule("0 9 * * *", async () => {
    console.log("[Monitor] 일간 성과 수집 시작...");
    await collectDailyReports();
    console.log("[Monitor] 일간 수집 완료");
  });

  // 매주 월요일 오전 9시
  cron.schedule("0 9 * * 1", async () => {
    console.log("[Monitor] 주간 분석 시작...");
    const analysis = await generateWeeklyAnalysis();
    console.log("[Monitor] 주간 분석:\n", analysis);
  });

  console.log("[Monitor] 스케줄러 시작됨 (매일 09:00, 매주 월 09:00)");
}
```

- [ ] **Step 5: improver 잔여 테스트 처리**

`src/improver/index.test.ts`가 Task 6에서 core/로 move되지 않고 남아 있다면 (예: `applyCodeChange`나 `runImprovementCycle` 테스트가 있는 경우) `cli/improver/runner.test.ts`로 이동:

```bash
[ -f src/improver/index.test.ts ] && git mv src/improver/index.test.ts cli/improver/runner.test.ts
```

이동 후 import 경로를 `./runner.js`로 수정. 원본 파일이 이미 Task 6에서 옮겨졌으면 이 step skip.

- [ ] **Step 6: src/ 잔여 파일 삭제**

```bash
git rm src/reviewer/index.ts
[ -f src/reviewer/index.test.ts ] && git rm src/reviewer/index.test.ts
rmdir src/reviewer
git rm src/improver/index.ts
rmdir src/improver 2>/dev/null || true
git rm src/monitor/index.ts
rmdir src/monitor
```

- [ ] **Step 7: src/cli/ 쪽 consumer 업데이트**

```bash
grep -rln "from \"\.\./reviewer/\|from \"\.\./improver/\|from \"\.\./monitor/" src/cli/
```

- `src/cli/review.ts`: `runReviewSession` import → `../../cli/reviewer/session.js`
- `src/cli/improve.ts`: `runImprovementCycle` import → `../../cli/improver/runner.js`. Pure 함수 `shouldTriggerImprovement` 같은 것도 있으면 `../../core/improver/index.js`로.
- `src/cli/monitor.ts`: `startCronScheduler` → `../../cli/monitor/scheduler.js`. `collectDailyReports`, `generateWeeklyAnalysis` 도 쓰면 `../../core/campaign/monitor.js`.
- `src/cli/pipeline.ts`: 위 중 사용하는 것들 경로 업데이트.

- [ ] **Step 8: 타입 검사 및 테스트**

```bash
npx tsc --noEmit
npx vitest run
```

모두 PASS. 테스트 수 동일 (pure 함수 테스트는 Task 6에서 core/로 갔고, 비순수 테스트는 cli/에서 그대로 실행).

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "refactor: move non-pure reviewer/improver/monitor to cli/"
```

---

### Task 11: cli/entries 생성 (src/cli/* 전체 이동)

**Files:**
- Move: `src/cli/app.ts` → `cli/entries/app.ts`
- Move: `src/cli/scrape.ts` → `cli/entries/scrape.ts`
- Move: `src/cli/generate.ts` → `cli/entries/generate.ts`
- Move: `src/cli/review.ts` → `cli/entries/review.ts`
- Move: `src/cli/launch.ts` → `cli/entries/launch.ts`
- Move: `src/cli/monitor.ts` → `cli/entries/monitor.ts`
- Move: `src/cli/improve.ts` → `cli/entries/improve.ts`
- Move: `src/cli/pipeline.ts` → `cli/entries/pipeline.ts`
- Modify: 이동한 파일의 상대 import 경로 조정

- [ ] **Step 1: 디렉토리 생성 및 이동**

```bash
mkdir -p cli/entries
git mv src/cli/app.ts cli/entries/app.ts
git mv src/cli/scrape.ts cli/entries/scrape.ts
git mv src/cli/generate.ts cli/entries/generate.ts
git mv src/cli/review.ts cli/entries/review.ts
git mv src/cli/launch.ts cli/entries/launch.ts
git mv src/cli/monitor.ts cli/entries/monitor.ts
git mv src/cli/improve.ts cli/entries/improve.ts
git mv src/cli/pipeline.ts cli/entries/pipeline.ts
rmdir src/cli
```

- [ ] **Step 2: import 경로 조정**

원래 `src/cli/*.ts`가 사용하던 경로들:
- `../tui/App.js` → 새 위치 `cli/entries/app.ts` 기준 `../tui/App.js` (동일)
- `../mode.js` → `../mode.js` (동일)
- `../pipeline.js` → `../pipeline.js` (동일)
- `../../core/...` → `../../core/...` (동일; 깊이 2단계 유지)
- `../../cli/reviewer/session.js` → `../reviewer/session.js`
- `../../cli/improver/runner.js` → `../improver/runner.js`
- `../../cli/monitor/scheduler.js` → `../monitor/scheduler.js`
- `../../core/improver/index.js` → `../../core/improver/index.js` (동일)

각 파일을 읽고 실제 사용 경로를 tsc가 받아들일 형태로 수정.

- [ ] **Step 3: 타입 검사 및 테스트**

```bash
npx tsc --noEmit
npx vitest run
```

모두 PASS. 테스트 수 동일.

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "refactor: move cli entry points to cli/entries"
```

---

## Stage 4 — 빌드 설정 (Task 12)

### Task 12: package.json scripts + tsconfig.json

**Files:**
- Modify: `package.json` — scripts의 `tsx src/cli/*.ts` → `tsx cli/entries/*.ts`
- Modify: `tsconfig.json` — `include`를 `["core/**/*", "cli/**/*", "server/**/*"]`로, `rootDir: "src"` 제거

- [ ] **Step 1: package.json 수정**

기존:
```json
"app": "tsx src/cli/app.ts",
"scrape": "tsx src/cli/scrape.ts",
"generate": "tsx src/cli/generate.ts",
"review": "tsx src/cli/review.ts",
"launch": "tsx src/cli/launch.ts",
"monitor": "tsx src/cli/monitor.ts",
"pipeline": "tsx src/cli/pipeline.ts",
"improve": "tsx src/cli/improve.ts",
```

변경 후:
```json
"app": "tsx cli/entries/app.ts",
"scrape": "tsx cli/entries/scrape.ts",
"generate": "tsx cli/entries/generate.ts",
"review": "tsx cli/entries/review.ts",
"launch": "tsx cli/entries/launch.ts",
"monitor": "tsx cli/entries/monitor.ts",
"pipeline": "tsx cli/entries/pipeline.ts",
"improve": "tsx cli/entries/improve.ts",
```

`server`, `admin`, `migrate`, `test` 스크립트는 그대로.

- [ ] **Step 2: tsconfig.json 수정**

기존:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

변경 후:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["core/**/*", "cli/**/*", "server/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

`rootDir: "src"` 제거. `include`는 세 경로.

- [ ] **Step 3: 실행 확인**

```bash
npx tsc --noEmit
npx vitest run
```

타입 검사 및 테스트 모두 PASS.

로컬에서 CLI 진입점이 동작하는지 빠르게 확인 (Ink 렌더링이 시작되는지):

```bash
timeout 3 npm run app || true
```

출력에서 Ink TUI가 로드되고 대기 상태에 들어가면 OK. 에러 없이 `timeout`만으로 종료되면 정상.

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "refactor: update build config for new layered structure"
```

---

## Stage 5 — src/ 삭제 (Task 13)

### Task 13: src/ 잔여 파일 삭제 + 최종 회귀 검증

**Files:**
- Delete: `src/` 전체

- [ ] **Step 1: src/ 잔여 파일 확인**

```bash
find src -type f 2>/dev/null
```

Task 1-11에서 모든 파일이 이동했다면 결과가 비어 있거나 `.DS_Store` 같은 자동 생성 파일만 남아 있어야 한다.

남아있는 `.ts`/`.tsx` 파일이 있으면 해당 task로 돌아가 원인을 파악하고 수정. 이 단계는 단순 정리여야 한다.

- [ ] **Step 2: src/ 삭제**

```bash
rm -rf src/
```

`git rm -rf`가 아닌 `rm -rf`를 쓰는 이유: Task 1-11이 `git mv`를 썼으므로 추적된 파일은 이미 새 위치로 옮겨졌고, src/에 남은 건 추적되지 않는 `.DS_Store` 정도. `git status`로 tracked delete이 있는지 확인.

```bash
git status
```

`deleted:` 항목이 있으면 `git add -A`로 스테이징.

- [ ] **Step 3: 최종 회귀 검증**

```bash
npx tsc --noEmit
npx vitest run
```

두 명령 모두 PASS. 테스트 수가 리팩터 전과 동일한지 확인.

리팩터 전 테스트 수를 이전 커밋 로그에서 확인:

```bash
git log --oneline | head -5
# 리팩터 전 커밋 SHA를 찾아 해당 시점 테스트 수 조회
```

실제 실행 시 리팩터 전 테스트 수는 설계 문서에 명시된 118개 (혹은 SP3 dedup으로 추가된 분을 포함한 현재 수). 현재 main에서 `npx vitest run`을 돌려 기준 수를 확정한 뒤 Task 13 종료 시점과 비교.

- [ ] **Step 4: 모든 진입점 smoke 실행**

```bash
timeout 3 npm run app || true
timeout 3 npm run scrape -- https://example.com 2>&1 | head -5 || true
timeout 3 npm run server &
sleep 2
curl -s http://localhost:3000/health 2>/dev/null || curl -s http://localhost:3000/ 2>/dev/null
kill %1 2>/dev/null || true
```

목적: 각 진입점이 import 에러 없이 부팅되는지 확인. Playwright·외부 API 호출은 실패해도 무방 (동작 변경이 아니라 import 레이어 검증).

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "refactor: delete src/ after layered restructure"
```

---

## 자체 검토 (Self-Review)

### 1. Spec 커버리지

설계 문서의 각 섹션 대조:

| 설계 항목 | 담당 Task |
|----------|-----------|
| core/types, types.d.ts, storage | Task 1 |
| core/billing/pricing, tiers | Task 2 |
| core/product/parser (scraper split) | Task 3 |
| core/creative/{copy,image,video} | Task 4 |
| core/campaign/launcher (whole) | Task 5 |
| core/campaign/monitor (split, startCronScheduler 제외) | Task 5 |
| core/reviewer/decisions (applyReviewDecision) | Task 6 |
| core/improver/index (pure 3개) | Task 6 |
| server/ import 업데이트, stripe.ts tiers 제거 | Task 2, 7 |
| cli/mode, pipeline, actions, scraper | Task 8, 9 |
| cli/tui/* | Task 9 |
| cli/client/{aiProxy,usageServer} | Task 8 |
| cli/reviewer/session (runReviewSession) | Task 10 |
| cli/improver/runner (runImprovementCycle, applyCodeChange) | Task 10 |
| cli/monitor/scheduler (startCronScheduler) | Task 10 |
| cli/entries/* (src/cli/* 전체) | Task 11 |
| package.json, tsconfig.json | Task 12 |
| src/ 삭제 | Task 13 |

모든 설계 항목이 task에 매핑됨.

### 2. Placeholder 스캔

- "TBD", "TODO", "implement later" 없음
- 분할이 필요한 파일(scraper, monitor, reviewer, improver)은 Task 3, 5, 6, 10에서 원자적으로 처리됨 (pure 부분은 core/로, 비순수 부분은 cli/로; 중간 상태에서 re-export 임시 호환 명시)
- 각 task의 "Step N" 블록마다 구체적인 명령·코드 스니펫·예상 결과 제시
- "Step 2: 이동한 파일의 내부 import 경로 수정" 같은 광범위 지침에는 grep 명령으로 대상 파일을 찾아 조정하도록 지시 (실제 파일 내용을 읽고 tsc 통과하도록 맞출 것)

### 3. 타입/API 일관성

- `ReviewAction` 타입은 Task 6에서 `core/reviewer/decisions.ts`로 이동 후 `src/reviewer/index.ts`에서 re-export (Task 10에서 src/ 파일 삭제 시 re-export도 사라지지만 그때는 이미 모든 consumer가 직접 core/에서 import함)
- `PerformanceStats` interface는 Task 5에서 `core/campaign/monitor.ts`로 이동
- `CTR_THRESHOLD` 상수는 Task 6에서 core/improver/index.ts와 Task 10의 cli/improver/runner.ts에 모두 선언됨. 같은 env var(`CTR_IMPROVEMENT_THRESHOLD`)를 읽으므로 런타임 값 동일. 중복이긴 하나 YAGNI·"동작 변경 금지" 원칙 하에 허용 (원본 `src/improver/index.ts`도 이 상수를 파일 상단에 하나 두고 있었음 → 분할 후 양쪽에 남는 건 자연스러운 결과)
- `applyReviewDecision`, `computeStats`, `buildAnalysisPrompt`, `shouldTriggerImprovement`, `buildImprovementPrompt`, `parseImprovements` 함수 시그니처는 Task 3·5·6에서 모두 원본 그대로 유지

### 4. 회귀 안전장치

- 모든 task의 마지막 step은 `npx tsc --noEmit` + `npx vitest run` + commit
- Stage 중간 실패 시 해당 task의 커밋만 revert하면 됨 (각 task = 1 commit 원칙)
- Task 13 Step 3에서 리팩터 전 테스트 수를 기준값으로 확인

### 5. 스코프 경계

- `docs/`, `data/`, `scripts/`, `node_modules/` 건드리지 않음 (설계 문서 §제약)
- 주석/포맷/변수명 변경 없음 (각 분할 task에서 "원본 그대로 복사" 명시)
- 새 기능·에러 핸들링 추가 없음

---

## 실행 완료 시 기대 상태

- `src/` 디렉토리 삭제됨
- `core/`, `cli/`, `server/` 3개 최상위 디렉토리만 소스 코드 포함
- `npm test` 통과, 테스트 수 리팩터 전과 동일
- `npm run app`, `npm run server`, `npm run admin` 등 모든 진입점 동작
- `docs/ARCHITECTURE.md`, `docs/STATUS.md`, `docs/ROADMAP.md` 업데이트는 Task 13 이후 별도 커밋 (리팩터 자체와 분리) — CLAUDE.md의 "문서 업데이트 규칙"에 따라 SP4 완료로 표시하고 ARCHITECTURE.md의 "핵심 설계 결정"에 레이어드 구조 항목 추가

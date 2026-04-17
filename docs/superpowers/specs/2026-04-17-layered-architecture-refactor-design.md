# 레이어드 아키텍처 리팩터 설계

**날짜:** 2026-04-17
**프로젝트:** ad_ai
**상태:** 승인됨

---

## 개요

현재 `src/` 아래에 CLI 조작(TUI)과 비지니스 로직이 섞여 있고, `server/`가 `src/` 깊숙이 reach-in하는 어색한 구조를 정리한다. 비지니스 로직을 `core/`로 추출하고, CLI와 Server를 동등한 presentation layer로 배치한다.

**순수 파일 이동 리팩터.** 동작 변경 없음. API 시그니처 유지.

---

## 핵심 원칙

| 기준 | 위치 |
|------|------|
| 프레임워크 무관 순수 로직 (CLI + Server 둘 다 사용) | `core/` |
| Ink TUI, Playwright 로컬 실행, cron, git exec | `cli/` |
| Express, SQLite, Stripe SDK, HTTP routes | `server/` |

- YAGNI: 함수 시그니처, 주석, 포맷 손대지 않는다
- 이동만, 기능 추가 없음
- 일부 파일은 쪼갠다 (순수/비순수 섞여 있는 경우)

---

## 현재 구조 (Before)

```
src/                   ← CLI + 비지니스 로직 혼재
├── types.ts
├── storage.ts
├── scraper/index.ts
├── generator/{copy, image, video}.ts
├── launcher/index.ts
├── monitor/index.ts
├── improver/index.ts
├── reviewer/index.ts
├── tui/*.tsx
├── client/{aiProxy, usageServer}.ts
├── mode.ts
├── pipeline.ts
└── cli/*.ts

server/                ← src/ 깊숙이 reach-in
├── routes/aiCopy.ts   → import from "../../src/generator/copy.js"
├── pricing.ts
├── stripe.ts          (tiers 포함)
└── ...
```

## 목표 구조 (After)

```
core/                          ← 순수 비지니스 로직 (프레임워크 무관)
├── types.ts                   ← src/types.ts
├── types/facebook-nodejs-business-sdk.d.ts  ← src/types/
├── storage.ts                 ← src/storage.ts
├── product/
│   └── parser.ts              ← parseProductWithGemini, detectCategory (scrapeProduct 제외)
├── creative/
│   ├── copy.ts                ← src/generator/copy.ts 전체
│   ├── image.ts               ← src/generator/image.ts 전체
│   └── video.ts               ← src/generator/video.ts 전체
├── campaign/
│   ├── launcher.ts            ← src/launcher/index.ts 전체
│   └── monitor.ts             ← src/monitor/index.ts 중 startCronScheduler 제외 전부
├── improver/
│   └── index.ts               ← src/improver/index.ts 중 pure 함수 (shouldTriggerImprovement, buildImprovementPrompt, parseImprovements)
├── reviewer/
│   └── decisions.ts           ← src/reviewer/index.ts 중 applyReviewDecision
└── billing/
    ├── pricing.ts             ← server/pricing.ts
    └── tiers.ts               ← server/stripe.ts 중 RECHARGE_TIERS, getTierAmount

cli/                           ← Owner TUI + Customer CLI
├── mode.ts                    ← src/mode.ts
├── pipeline.ts                ← src/pipeline.ts
├── actions.ts                 ← src/tui/actions.ts
├── scraper.ts                 ← src/scraper/index.ts 중 scrapeProduct (Playwright 포함)
├── tui/
│   ├── App.tsx                ← src/tui/App.tsx
│   ├── AppTypes.ts            ← src/tui/AppTypes.ts
│   ├── MenuScreen.tsx         ← src/tui/MenuScreen.tsx
│   ├── ReviewScreen.tsx       ← src/tui/ReviewScreen.tsx
│   ├── PipelineProgress.tsx   ← src/tui/PipelineProgress.tsx
│   └── DoneScreen.tsx         ← src/tui/DoneScreen.tsx
├── client/
│   ├── aiProxy.ts             ← src/client/aiProxy.ts
│   └── usageServer.ts         ← src/client/usageServer.ts
├── reviewer/
│   └── session.ts             ← src/reviewer/index.ts 중 runReviewSession (Ink render)
├── improver/
│   └── runner.ts              ← src/improver/index.ts 중 runImprovementCycle, applyCodeChange (git exec)
├── monitor/
│   └── scheduler.ts           ← src/monitor/index.ts 중 startCronScheduler
└── entries/                   ← src/cli/* 전체 (진입점)
    ├── app.ts
    ├── scrape.ts
    ├── generate.ts
    ├── review.ts
    ├── launch.ts
    ├── monitor.ts
    ├── improve.ts
    └── pipeline.ts

server/                        ← 기존 구조 유지 (일부 import 경로만 변경)
├── index.ts
├── db.ts, auth.ts, rateLimit.ts
├── billing.ts                 ← core/billing/pricing.ts import로 변경
├── stripe.ts                  ← tiers 제거 (core/billing/tiers.ts로 이동)
├── admin.ts, adminUtils.ts
├── routes/                    ← core/ import 경로 업데이트
│   ├── license.ts
│   ├── aiCopy.ts, aiImage.ts, aiVideo.ts, aiParse.ts, aiAnalyze.ts
│   ├── usage.ts
│   └── stripeWebhook.ts
└── jobs/
    └── videoJob.ts
```

---

## 분할이 필요한 파일

### src/reviewer/index.ts → 2개로 분할

| 함수 | 특성 | 이동 위치 |
|------|------|----------|
| `applyReviewDecision(creative, decision)` | 순수 함수 | `core/reviewer/decisions.ts` |
| `runReviewSession()` | Ink render + file I/O | `cli/reviewer/session.ts` |

### src/improver/index.ts → 2개로 분할

| 함수 | 특성 | 이동 위치 |
|------|------|----------|
| `shouldTriggerImprovement(report)` | 순수 | `core/improver/index.ts` |
| `buildImprovementPrompt(...)` | 순수 | `core/improver/index.ts` |
| `parseImprovements(text)` | 순수 | `core/improver/index.ts` |
| `runImprovementCycle(...)` | Anthropic SDK + 파일 수정 + git exec | `cli/improver/runner.ts` |
| `applyCodeChange(...)` | 파일 I/O | `cli/improver/runner.ts` |

### src/scraper/index.ts → 2개로 분할

| 함수 | 특성 | 이동 위치 |
|------|------|----------|
| `parseProductWithGemini(ai, url, html)` | Gemini 호출, 순수 (HTML 인자로 받음) | `core/product/parser.ts` |
| `detectCategory(url)` | 순수 | `core/product/parser.ts` |
| `scrapeProduct(url)` | Playwright 로컬 실행 | `cli/scraper.ts` |

### src/monitor/index.ts → 2개로 분할

| 함수 | 특성 | 이동 위치 |
|------|------|----------|
| `computeStats(reports)` | 순수 | `core/campaign/monitor.ts` |
| `buildAnalysisPrompt(reports, stats)` | 순수 | `core/campaign/monitor.ts` |
| `fetchInsights(campaignId, date)` | Meta API | `core/campaign/monitor.ts` |
| `collectDailyReports()` | Meta API + file I/O | `core/campaign/monitor.ts` |
| `generateWeeklyAnalysis()` | Claude + file I/O | `core/campaign/monitor.ts` |
| `startCronScheduler()` | node-cron 실행 | `cli/monitor/scheduler.ts` |

### server/stripe.ts → 2개로 분할

| 함수 | 특성 | 이동 위치 |
|------|------|----------|
| `RECHARGE_TIERS`, `getTierAmount` | 순수 상수/함수 | `core/billing/tiers.ts` |
| `createStripeClient`, `createStripeCustomer`, `createCheckoutSession`, `triggerAutoRecharge` | Stripe SDK | `server/stripe.ts` (유지) |

---

## 설정 변경

### package.json scripts

기존 `tsx src/cli/*.ts` → `tsx cli/entries/*.ts`:

```json
{
  "scripts": {
    "app": "tsx cli/entries/app.ts",
    "scrape": "tsx cli/entries/scrape.ts",
    "generate": "tsx cli/entries/generate.ts",
    "review": "tsx cli/entries/review.ts",
    "launch": "tsx cli/entries/launch.ts",
    "monitor": "tsx cli/entries/monitor.ts",
    "pipeline": "tsx cli/entries/pipeline.ts",
    "improve": "tsx cli/entries/improve.ts",
    "server": "tsx server/index.ts",
    "admin": "tsx server/admin.ts",
    "migrate": "tsx scripts/migrate.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": { ... 기존 그대로 },
  "include": ["core/**/*", "cli/**/*", "server/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

`rootDir: "src"` 는 제거.

### Import 경로 변경 패턴

```typescript
// 기존 (src/tui/actions.ts 관점)
import type { Product } from "../types.js";
import { generateCopy } from "../generator/copy.js";

// 변경 후 (cli/actions.ts 관점)
import type { Product } from "../core/types.js";
import { generateCopy } from "../core/creative/copy.js";

// 변경 후 (server/routes/aiCopy.ts 관점, 기존)
import { generateCopy } from "../../src/generator/copy.js";
// 변경 후 (새 경로)
import { generateCopy } from "../../core/creative/copy.js";
```

---

## 실행 전략

파일이 40개 이상 이동되므로 의존성 leaf부터 순서대로 진행한다.

### 단계별 실행

```
1단계: core/ 생성 (아무도 의존하지 않음)
    ├── types.ts, storage.ts, types/facebook...d.ts
    ├── billing/pricing.ts, billing/tiers.ts
    ├── product/parser.ts
    ├── creative/{copy, image, video}.ts
    ├── campaign/{launcher, monitor}.ts
    ├── reviewer/decisions.ts
    └── improver/index.ts (pure 함수만)
    ✓ tsc --noEmit + npm test 통과 확인
    ✓ commit

2단계: server/ import 경로 업데이트 + pricing/tiers 정리
    → server 테스트 통과 확인
    ✓ commit

3단계: cli/ 생성 (core와만 의존)
    ├── mode.ts, scraper.ts (Playwright)
    ├── client/ (aiProxy, usageServer)
    ├── tui/ (모든 React 컴포넌트)
    ├── reviewer/session.ts
    ├── improver/runner.ts
    ├── monitor/scheduler.ts
    ├── actions.ts, pipeline.ts
    └── entries/ (모든 진입점)
    ✓ tsc --noEmit + npm test 통과 확인
    ✓ commit

4단계: package.json + tsconfig.json 업데이트
    ✓ npm run app 실행 확인 (실패하지 않음)
    ✓ commit

5단계: src/ 전체 삭제
    ✓ tsc --noEmit + npm test 최종 통과
    ✓ commit
```

각 단계 후 커밋. 실패 시 해당 단계만 revert.

---

## 제약 사항

- 동작 변경 금지 (API 시그니처, 반환값, 부수 효과 동일)
- 테스트 코드 내용 수정 금지 (import 경로만 업데이트)
- 새 기능 추가 금지
- 기존 파일 "개선" 금지 (주석, 포맷, 변수명 등)
- `docs/`, `data/`, `scripts/`, `node_modules/` 건드리지 않음
- 기존 테스트 수(118개) 동일하게 유지

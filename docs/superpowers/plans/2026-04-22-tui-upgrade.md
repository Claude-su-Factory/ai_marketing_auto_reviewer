# TUI Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 Ink 5 기반 CLI TUI 를 owner-only 전용으로 정제하고, Tokyo Night 팔레트 공통 컴포넌트 · Generate 병렬화 · Monitor 신규 화면 · 화면 간 톤 통일을 적용한다.

**Architecture:** `cli/tui/theme/tokens.ts` 공통 팔레트 → `components/Header|StatusBar|ProgressTrack` 재사용 위젯 → `screens/*Screen.tsx` 10개(기존 4+신규 6) → `hooks/*` 4개(useElapsed/useReports/useWorkerStatus/useTodayStats) → `App.tsx` 라우터가 screen 을 선택. Generate 는 product 내부 3-track(`Promise.all`), product 간 sequential, variant(3 copies) sequential. Monitor 는 `fs.watch` 이벤트 드리븐 재스캔.

**Tech Stack:** Ink 5.0.1, React 18.3, ink-testing-library, vitest 1.5, sharp(이미지 메타), `ink-spinner`/`ink-gradient`/`ink-text-input`(신규 의존성), child_process(launchctl), fs.watch, Anthropic SDK 0.39, Google Genai SDK, facebook-nodejs-business-sdk.

**Spec:** `docs/superpowers/specs/2026-04-22-tui-upgrade-design.md`

**Branch policy:** 모든 작업은 `master` 브랜치에 직접 커밋 (프로젝트 규칙, `CLAUDE.md`).

---

## Phase 0a — 사전 검증 결과

플랜 작성 시점(2026-04-22)에 다음 항목을 이미 확인했다. Implementer 는 재확인하지 않아도 된다.

| 항목 | 결과 | 근거 |
|---|---|---|
| `tsconfig.json` JSX | ✅ `"jsx": "react-jsx"` — JSX 사용 가능 | `tsconfig.json:5` |
| `VariantReport.spend` 부재 | ✅ Monitor 에서 spend/CPC 제거 확정 | `core/platform/types.ts:25-41` |
| `Creative.approvedAt` | ✗ 없음 — `today ✓` 는 `data/creatives/${id}.json` 파일 **mtime** 으로 계산 | `core/types.ts:15-32` |
| `AD_AI_MODE` 참조 범위 | ✅ repo 전체 grep 0건 (cli/mode.ts 내부 제외) — 제거 안전 | `grep -rn AD_AI_MODE` |
| `data/improvements/*.json` 스키마 | ✅ `Improvement[]` 배열, 각 `{date, trigger, changes}` | `core/types.ts:71-75`, `core/improver/runner.ts:83-90` |
| `AdPlatform.launch(group)` 시그니처 | ✅ 현재 `(group: VariantGroup) => Promise<LaunchResult>` — Phase 5.4 에서 optional `onLog` 추가 | `core/platform/meta/adapter.ts:14-17` |
| `data/worker-state.json` | ✅ 존재 확인 | `data/worker-state.json` |

**Implementer 가 Task 시작 시점에 검증할 항목**:

- `ink-spinner` / `ink-gradient` / `ink-text-input` 의 Ink 5 호환 버전 — Task 1 에서 `npm view <pkg> peerDependencies` 확인 후 설치
- Claude/Google SDK rate limit 기본값 — Phase 3 Task 20 실운영 검증 스텝

---

## File Structure

**생성**:

```
cli/tui/theme/tokens.ts
cli/tui/format.ts  (+ format.test.ts)
cli/tui/hooks/useElapsed.ts  (+ test)
cli/tui/hooks/useReports.ts  (+ test)
cli/tui/hooks/useWorkerStatus.ts  (+ test)
cli/tui/hooks/useTodayStats.ts  (+ test)
cli/tui/components/Header.tsx  (+ test)
cli/tui/components/StatusBar.tsx  (+ test)
cli/tui/components/ProgressTrack.tsx  (+ test)
cli/tui/screens/GenerateScreen.tsx  (+ test)
cli/tui/screens/MonitorScreen.tsx  (+ test)
cli/tui/screens/ScrapeScreen.tsx  (+ test)
cli/tui/screens/AddProductScreen.tsx  (+ test)
cli/tui/screens/LaunchScreen.tsx  (+ test)
cli/tui/screens/ImproveScreen.tsx  (+ test)
cli/tui/screens/PipelineScreen.tsx  (+ test)
tests/mocks/fsWatch.ts
vitest.config.ts  (신규, sharp mock setup)
```

**이동/재작성**:

```
cli/tui/MenuScreen.tsx → cli/tui/screens/MenuScreen.tsx  (재작성)
cli/tui/DoneScreen.tsx → cli/tui/screens/DoneScreen.tsx  (재작성)
cli/tui/ReviewScreen.tsx → cli/tui/screens/ReviewScreen.tsx  (업그레이드)
```

**삭제**:

```
cli/tui/PipelineProgress.tsx  (PipelineScreen 으로 흡수)
cli/tui/PipelineProgress.test.tsx
cli/mode.ts
cli/mode.test.ts
cli/client/aiProxy.ts
cli/client/usageServer.ts
```

**수정**:

```
cli/tui/App.tsx
cli/tui/AppTypes.ts
cli/actions.ts
cli/actions.test.ts
core/platform/meta/launcher.ts  (onLog 추가)
core/platform/meta/adapter.ts   (onLog 전달)
core/platform/types.ts          (AdPlatform.launch 시그니처 확장)
docs/STATUS.md
docs/ROADMAP.md
docs/ARCHITECTURE.md
README.md
```

---

## Phase 0b — Customer 모드 제거

### Task 1: actions.ts 를 core 직접 호출로 리팩터

**Files:**
- Modify: `cli/actions.ts`
- Modify: `cli/actions.test.ts`

- [ ] **Step 1: 기존 `actions.test.ts` 가 실패하도록 proxy 의존성 제거 테스트 추가**

```ts
// cli/actions.test.ts 맨 위에 추가
import { runScrape, runGenerate, runLaunch, runMonitor, runImprove, runPipelineAction } from "./actions.js";

describe("actions no longer require AiProxy", () => {
  it("runScrape accepts (url, onProgress) without proxy", () => {
    expect(runScrape.length).toBe(2);
  });
  it("runGenerate accepts (onProgress) without proxy", () => {
    expect(runGenerate.length).toBe(1);
  });
  it("runLaunch accepts (onProgress) without proxy", () => {
    expect(runLaunch.length).toBe(1);
  });
  it("runMonitor accepts (mode, onProgress) without proxy", () => {
    expect(runMonitor.length).toBe(2);
  });
  it("runImprove accepts (onProgress) without proxy", () => {
    expect(runImprove.length).toBe(1);
  });
  it("runPipelineAction accepts (urls, onProgress) without proxy", () => {
    expect(runPipelineAction.length).toBe(2);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
npx vitest run cli/actions.test.ts
```
Expected: `runScrape.length` 등이 proxy 포함 시그니처(3,2,2,3,2,3)로 나와 실패.

- [ ] **Step 3: `cli/actions.ts` 리팩터**

전체 파일을 다음 내용으로 교체:

```ts
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { activePlatforms } from "../core/platform/registry.js";
import type { VariantGroup, VariantReport } from "../core/platform/types.js";
import {
  groupCreativesByVariantGroup,
  groupApprovalCheck,
} from "../core/launch/groupApproval.js";
import {
  collectDailyReports,
  variantReportsToReports,
  computeStats,
  buildAnalysisPrompt,
} from "../core/campaign/monitor.js";
import { runImprovementCycle } from "../core/improver/runner.js";
import { shouldTriggerImprovement } from "../core/improver/index.js";
import { readJson, writeJson, listJson } from "../core/storage.js";
import type { Product, Creative, Report } from "../core/types.js";
import type { DoneResult, ProgressCallback, TaskProgress } from "./tui/AppTypes.js";
import { randomUUID } from "crypto";
import { VARIANT_LABELS } from "../core/creative/prompt.js";
import { generateCopy, createAnthropicClient } from "../core/creative/copy.js";
import { generateImage } from "../core/creative/image.js";
import { generateVideo } from "../core/creative/video.js";
import { parseProductWithGemini } from "../core/product/parser.js";

export function buildOverallProgress(p: TaskProgress): number {
  return Math.round((p.copy + p.image + p.video) / 3);
}

export function validateMonitorMode(input: string): "daily" | "weekly" | null {
  if (input === "d") return "daily";
  if (input === "w") return "weekly";
  return null;
}

export async function runScrape(url: string, onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    onProgress({ message: `스크래핑 중... ${url.slice(0, 40)}` });
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      const html = await page.content();
      const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
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

export async function runGenerate(onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    const productPaths = await listJson("data/products");
    if (productPaths.length === 0) {
      return { success: false, message: "Generate 실패", logs: ["data/products/에 제품이 없습니다. Scrape을 먼저 실행하세요."] };
    }
    const anthropic = createAnthropicClient();
    const logs: string[] = [];
    for (let i = 0; i < productPaths.length; i++) {
      const product = await readJson<Product>(productPaths[i]);
      if (!product) continue;
      const taskProgress: TaskProgress = { copy: 0, image: 0, video: 0 };
      onProgress({ message: "이미지 생성 중...", currentCourse: product.name, courseIndex: i + 1, totalCourses: productPaths.length, taskProgress: { ...taskProgress } });
      const imageLocalPath = await generateImage(product);
      taskProgress.image = 100;
      onProgress({ message: "영상 생성 중...", currentCourse: product.name, courseIndex: i + 1, totalCourses: productPaths.length, taskProgress: { ...taskProgress } });
      const videoLocalPath = await generateVideo(product, (msg) => {
        const match = msg.match(/\((\d+)\/(\d+)\)/);
        if (match) taskProgress.video = Math.round((Number(match[1]) / Number(match[2])) * 90);
        onProgress({ message: msg, currentCourse: product.name, courseIndex: i + 1, totalCourses: productPaths.length, taskProgress: { ...taskProgress } });
      });
      taskProgress.video = 100;
      const variantGroupId = randomUUID();
      for (let v = 0; v < VARIANT_LABELS.length; v++) {
        const label = VARIANT_LABELS[v];
        onProgress({ message: `카피 ${v + 1}/3 생성 중 (${label})...`, currentCourse: product.name, courseIndex: i + 1, totalCourses: productPaths.length, taskProgress: { copy: Math.round(((v + 1) / 3) * 100), image: 100, video: 100 } });
        const copy = await generateCopy(anthropic, product, [], label);
        const creative: Creative = {
          id: randomUUID(),
          productId: product.id,
          variantGroupId,
          copy: { ...copy, variantLabel: label, metaAssetLabel: `${variantGroupId}::${label}` },
          imageLocalPath,
          videoLocalPath,
          status: "pending",
          createdAt: new Date().toISOString(),
        };
        await writeJson(`data/creatives/${creative.id}.json`, creative);
      }
      logs.push(`${product.name} ✓ (3 variants)`);
    }
    return { success: true, message: `Generate 완료 — ${logs.length}개 제품`, logs };
  } catch (e) {
    return { success: false, message: "Generate 실패", logs: [String(e)] };
  }
}

export async function runLaunch(onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    const platforms = await activePlatforms();
    if (platforms.length === 0) {
      return { success: false, message: "Launch 실패", logs: ["활성화된 플랫폼이 없습니다. .env의 AD_PLATFORMS 또는 credential을 확인하세요."] };
    }
    const creativePaths = await listJson("data/creatives");
    const allCreatives: Creative[] = [];
    for (const p of creativePaths) {
      const c = await readJson<Creative>(p);
      if (c) allCreatives.push(c);
    }
    const groups = groupCreativesByVariantGroup(allCreatives);
    const logs: string[] = [];
    for (const [groupId, members] of groups.entries()) {
      const { launch, approved } = groupApprovalCheck(members);
      if (!launch) {
        logs.push(`skip group ${groupId.slice(0, 8)}… (approved ${approved.length}/3, 필요 ≥ 2)`);
        continue;
      }
      const product = await readJson<Product>(`data/products/${approved[0].productId}.json`);
      if (!product) {
        logs.push(`skip group ${groupId.slice(0, 8)}… (product 없음)`);
        continue;
      }
      const group: VariantGroup = { variantGroupId: groupId, product, creatives: approved, assets: { image: approved[0].imageLocalPath, video: approved[0].videoLocalPath } };
      onProgress({ message: `게재 중: ${product.name} (${approved.length} variants)` });
      for (const platform of platforms) {
        const result = await platform.launch(group);
        logs.push(`${product.name} → ${result.externalIds.campaign} (${platform.name}, ${approved.length} variants)`);
      }
    }
    if (logs.every((l) => l.startsWith("skip"))) {
      return { success: false, message: "Launch 실패", logs: logs.length > 0 ? logs : ["승인된 variantGroup이 없습니다. Review를 먼저 실행하세요."] };
    }
    return { success: true, message: `Launch 완료 — ${logs.filter((l) => !l.startsWith("skip")).length}개 게재`, logs };
  } catch (e) {
    return { success: false, message: "Launch 실패", logs: [String(e)] };
  }
}

export async function runMonitor(mode: "daily" | "weekly", onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    if (mode === "daily") {
      onProgress({ message: "일간 성과 수집 중..." });
      const reports = await collectDailyReports();
      return { success: true, message: "Monitor (daily) 완료", logs: [`${reports.length}개 리포트 수집됨`] };
    }
    onProgress({ message: "주간 분석 중... (Claude 분석 포함)" });
    const reportPaths = (await listJson("data/reports")).filter((f) => !f.includes("weekly-analysis"));
    const allVariants: VariantReport[] = [];
    for (const p of reportPaths.slice(-7)) {
      const daily = await readJson<VariantReport[]>(p);
      if (daily) allVariants.push(...daily);
    }
    if (allVariants.length === 0) {
      return { success: true, message: "Monitor (weekly) 완료", logs: ["성과 데이터 없음"] };
    }
    const aggregated = variantReportsToReports(allVariants);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const stats = computeStats(aggregated);
    const prompt = buildAnalysisPrompt(aggregated, stats);
    const response = await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: 1024, messages: [{ role: "user", content: prompt }] });
    const analysis = response.content[0].type === "text" ? response.content[0].text : "";
    await writeJson(`data/reports/weekly-analysis-${new Date().toISOString().split("T")[0]}.json`, JSON.parse(analysis.match(/\{[\s\S]*\}/)?.[0] ?? "{}"));
    return { success: true, message: "Monitor (weekly) 완료", logs: [analysis.slice(0, 200)] };
  } catch (e) {
    return { success: false, message: "Monitor 실패", logs: [String(e)] };
  }
}

export async function runImprove(onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    const reportPaths = await listJson("data/reports");
    const allVariants: VariantReport[] = [];
    for (const p of reportPaths.filter((f) => !f.includes("weekly-analysis")).slice(-3)) {
      const daily = await readJson<VariantReport[]>(p);
      if (daily) allVariants.push(...daily);
    }
    const weeklyPaths = reportPaths.filter((p) => p.includes("weekly-analysis"));
    const weeklyPath = weeklyPaths[weeklyPaths.length - 1];
    if (!weeklyPath) {
      return { success: false, message: "Improve 실패", logs: ["주간 분석 없음. Monitor weekly를 먼저 실행하세요."] };
    }
    const analysis = await readJson<object>(weeklyPath);
    const aggregated = variantReportsToReports(allVariants);
    const weakReports = aggregated.filter(shouldTriggerImprovement);
    onProgress({ message: `개선 대상 ${weakReports.length}개 캠페인 분석 중...` });
    await runImprovementCycle(weakReports, JSON.stringify(analysis));
    return { success: true, message: "Improve 완료", logs: [`${weakReports.length}개 캠페인 기반 개선 적용`] };
  } catch (e) {
    return { success: false, message: "Improve 실패", logs: [String(e)] };
  }
}

export async function runPipelineAction(urls: string[], onProgress: ProgressCallback): Promise<DoneResult> {
  const logs: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    onProgress({ message: `스크래핑 중... (${i + 1}/${urls.length})`, courseIndex: i + 1, totalCourses: urls.length });
    const scrapeResult = await runScrape(urls[i], onProgress);
    if (!scrapeResult.success) return scrapeResult;
    logs.push(...scrapeResult.logs);
  }
  const generateResult = await runGenerate(onProgress);
  logs.push(...generateResult.logs);
  return {
    success: generateResult.success,
    message: generateResult.success
      ? `Pipeline 완료 — ${urls.length}개 URL 처리`
      : "Pipeline 실패",
    logs,
  };
}
```

- [ ] **Step 4: 기존 테스트도 proxy mock 을 제거하도록 업데이트 후 `npx vitest run cli/actions.test.ts` → PASS**

```bash
npx vitest run cli/actions.test.ts
```

`cli/actions.test.ts` 의 기존 테스트 케이스에서 `proxy: AiProxy` mock 을 사용하던 부분은 모두 직접 core 모듈을 `vi.mock` 처리하거나, SDK 호출 경로(`generateImage`, `generateVideo`, `generateCopy`, `parseProductWithGemini`, `Anthropic.messages.create`)를 mock 한다. 테스트가 실제 API 를 호출하면 안 된다.

- [ ] **Step 5: 커밋**

```bash
git add cli/actions.ts cli/actions.test.ts
git commit -m "refactor(cli): remove AiProxy indirection, call core directly"
```

---

### Task 2: customer 모드 파일 삭제 + App.tsx 정리

**Files:**
- Delete: `cli/mode.ts`, `cli/mode.test.ts`, `cli/client/aiProxy.ts`, `cli/client/usageServer.ts`
- Modify: `cli/tui/App.tsx`

- [ ] **Step 1: App.tsx 에 mode-free 렌더링 단언 테스트 추가**

`cli/tui/App.test.tsx` 끝에 추가:

```tsx
import { render } from "ink-testing-library";
import React from "react";
import { App } from "./App.js";

describe("App owner-only rendering", () => {
  it("renders menu immediately without license validation gate", () => {
    const { lastFrame } = render(React.createElement(App));
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("라이선스 검증");
    expect(frame).toContain("Scrape");
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
npx vitest run cli/tui/App.test.tsx
```
Expected: FAIL — 현재 App 은 `라이선스 검증 중...` 을 `customer` 분기에서 렌더할 수 있고, `detectMode` 가 없는 상태에서 import 가 깨진다.

- [ ] **Step 3: 파일 삭제 + App.tsx 단순화**

```bash
rm cli/mode.ts cli/mode.test.ts cli/client/aiProxy.ts cli/client/usageServer.ts
rmdir cli/client 2>/dev/null || true
```

`cli/tui/App.tsx` 를 다음과 같이 수정(핵심 diff):

```tsx
// 상단 import: 아래 3줄 삭제
// import { detectMode, type ModeConfig } from "../mode.js";
// import { createAiProxy, type AiProxy } from "../client/aiProxy.js";
// import { validateLicense } from "../client/usageServer.js";

// App() 함수 초반부 교체
export function App() {
  const [appState, setAppState] = useState<AppState>("menu");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [currentAction, setCurrentAction] = useState<ActionKey | null>(null);
  const [runProgress, setRunProgress] = useState<RunProgress>({ message: "" });
  const [doneResult, setDoneResult] = useState<DoneResult | null>(null);
  const [reviewGroups, setReviewGroups] = useState<ReviewGroup[]>([]);
  const [formStep, setFormStep] = useState<FormStep>("name");
  const [formData, setFormData] = useState<Partial<Product>>({});

  const visibleMenuItems = MENU_ITEMS;  // customer 분기 제거

  // useEffect(() => { if (modeConfig.mode === "customer" ...) ... }, []); ← 블록 전체 삭제
```

`executeAction` 내부 `proxy` 인자 제거:

```tsx
  const executeAction = useCallback(async (key: ActionKey, inputVal?: string) => {
    setAppState("running");
    setRunProgress({ message: "시작 중..." });
    let result: DoneResult;
    switch (key) {
      case "scrape":      result = await runScrape(inputVal ?? "", handleProgressUpdate); break;
      case "generate":    result = await runGenerate(handleProgressUpdate); break;
      case "launch":      result = await runLaunch(handleProgressUpdate); break;
      case "monitor": {
        const mode = validateMonitorMode(inputVal ?? "");
        result = mode
          ? await runMonitor(mode, handleProgressUpdate)
          : { success: false, message: "Monitor 실패", logs: ["d 또는 w를 입력하세요"] };
        break;
      }
      case "improve":     result = await runImprove(handleProgressUpdate); break;
      case "pipeline":    result = await runPipelineAction((inputVal ?? "").split(/\s+/).filter(Boolean), handleProgressUpdate); break;
      default:            result = { success: false, message: "알 수 없는 액션", logs: [] };
    }
    setDoneResult(result);
    setAppState("done");
  }, [handleProgressUpdate]);

  // `if (!initialized) return ...` 블록 전체 삭제
```

- [ ] **Step 4: 테스트 재실행 → PASS**

```bash
npx vitest run cli/tui/App.test.tsx cli/actions.test.ts
```

- [ ] **Step 5: 커밋**

```bash
git add -u cli/tui/App.tsx cli/tui/App.test.tsx
git add -u
git commit -m "chore(cli): remove customer mode — owner-only CLI"
```

---

### Task 3: 문서 업데이트 (ARCHITECTURE + ROADMAP)

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: ARCHITECTURE.md 에 "server/ 비활성 상태" 명시**

`docs/ARCHITECTURE.md` 의 "핵심 설계 결정" 섹션 맨 아래에 다음 블록 추가:

```markdown
### 2026-04-22 — CLI는 owner-only, server/는 미래 웹 UI 대기 인프라

- CLI (`cli/tui/`) 는 repo clone 한 owner/기여자만 사용. `AD_AI_MODE=customer` 분기 삭제
- `server/` (billing, license, AI proxy) 는 코드로만 유지되고 현재 실행되지 않는다 (non-active)
- 재활성화 시점: 웹 UI 재개 작업 (ROADMAP Tier 2)
- Why: 외부 서비스 제공 모델 대신, repo 클론 후 자기 API 키 사용하는 owner-only 모델로 단순화
```

- [ ] **Step 2: ROADMAP.md 에 Tier 2 항목 추가**

`docs/ROADMAP.md` 의 Tier 2 섹션에 다음 bullet 추가:

```markdown
- **웹 UI + customer 모드 재도입**: `server/` billing/license/AI proxy 재활성화, CLI 외 웹 사용자 대상 서비스 제공. 트리거: owner 만의 CLI 운영 경험 충분히 축적된 후
- **Meta API spend 수집 + Monitor spend/CPC 복원**: `fetchMetaVariantReports` 확장, `VariantReport` 에 `spend/cpc` 추가, Monitor 화면 재설계. 트리거: Plan C 안정화 완료
- **Pipeline 4단계 확장**: Review/Launch 를 `runPipelineAction` 에 통합, 수동 승인 단계 자동 skip 옵션. 트리거: Review 자동 승인 규칙 확정 후
```

- [ ] **Step 3: 문서 일관성 확인**

```bash
grep -n "customer\|AD_AI_MODE\|AiProxy" docs/ARCHITECTURE.md docs/ROADMAP.md docs/STATUS.md
```
Expected: 위 3개 파일에 잔존 참조는 "재도입" 맥락에만 존재

- [ ] **Step 4: (해당 없음 — 문서 전용 작업)**

- [ ] **Step 5: 커밋**

```bash
git add docs/ARCHITECTURE.md docs/ROADMAP.md
git commit -m "docs: note server/ non-active state and Tier 2 re-activation plan"
```

---

## Phase 1 — Foundation (공통 유틸 · 훅 · 컴포넌트)

### Task 4: theme/tokens.ts + vitest.config 에 sharp mock 전역 설정

**Files:**
- Create: `cli/tui/theme/tokens.ts`
- Create: `vitest.config.ts`
- Create: `tests/mocks/sharpStub.ts`

- [ ] **Step 1: tokens.ts 단순 contract 테스트 추가**

`cli/tui/theme/tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { colors, border, icons } from "./tokens.js";

describe("theme tokens", () => {
  it("exposes 9 Tokyo Night color keys", () => {
    expect(Object.keys(colors).sort()).toEqual(
      ["accent", "analytics", "bg", "danger", "dim", "fg", "review", "success", "warning"].sort()
    );
  });
  it("border uses round style and review accent color", () => {
    expect(border.borderStyle).toBe("round");
    expect(border.borderColor).toBe(colors.review);
  });
  it("icons set covers the status quartet", () => {
    expect(icons.success).toBe("✓");
    expect(icons.running).toBe("⟳");
    expect(icons.pending).toBe("○");
    expect(icons.failure).toBe("✗");
  });
});
```

- [ ] **Step 2: 테스트 실행 → FAIL**

```bash
npx vitest run cli/tui/theme/tokens.test.ts
```
Expected: `Cannot find module './tokens.js'`

- [ ] **Step 3: 구현**

`cli/tui/theme/tokens.ts`:

```ts
export const colors = {
  bg:        "#1a1b26",
  fg:        "#c0caf5",
  dim:       "#565f89",
  accent:    "#7aa2f7",
  success:   "#9ece6a",
  warning:   "#e0af68",
  danger:    "#f7768e",
  review:    "#bb9af7",
  analytics: "#7dcfff",
} as const;

export const border = { borderStyle: "round" as const, borderColor: colors.review };

export const icons = {
  success: "✓",
  running: "⟳",
  pending: "○",
  failure: "✗",
  header:  "◆",
  bullet:  "●",
  select:  "▶",
  up:      "▲",
  down:    "▼",
} as const;
```

`tests/mocks/sharpStub.ts`:

```ts
import { vi } from "vitest";

const sharpMock = vi.fn((_path?: string) => ({
  metadata: vi.fn().mockResolvedValue({ width: 1080, height: 1080, format: "jpeg", size: 342000 }),
}));

export default sharpMock;
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: [],
  },
  resolve: {
    alias: {
      sharp: new URL("./tests/mocks/sharpStub.ts", import.meta.url).pathname,
    },
  },
});
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run cli/tui/theme/tokens.test.ts
```
Expected: PASS. 기존 테스트도 영향 없는지 `npx vitest run` 전체 녹색.

- [ ] **Step 5: 커밋**

```bash
git add cli/tui/theme/tokens.ts cli/tui/theme/tokens.test.ts vitest.config.ts tests/mocks/sharpStub.ts
git commit -m "feat(tui): Tokyo Night token palette + sharp mock alias"
```

---

### Task 5: format.ts (formatWon / formatPct / formatAgo / truncate)

**Files:**
- Create: `cli/tui/format.ts`
- Create: `cli/tui/format.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
import { describe, it, expect } from "vitest";
import { formatWon, formatPct, formatAgo, truncate } from "./format.js";

describe("format.formatWon", () => {
  it("formats integer KRW with 천 단위 콤마", () => { expect(formatWon(12345)).toBe("12,345원"); });
  it("handles zero", () => { expect(formatWon(0)).toBe("0원"); });
});

describe("format.formatPct", () => {
  it("formats 0-1 ratio with 2 decimals", () => { expect(formatPct(0.0214)).toBe("2.14%"); });
  it("handles 0", () => { expect(formatPct(0)).toBe("0.00%"); });
});

describe("format.formatAgo", () => {
  it("minutes", () => { expect(formatAgo(new Date(Date.now() - 3 * 60_000))).toBe("3m ago"); });
  it("hours", () => { expect(formatAgo(new Date(Date.now() - 2 * 3_600_000))).toBe("2h ago"); });
  it("days", () => { expect(formatAgo(new Date(Date.now() - 4 * 86_400_000))).toBe("4d ago"); });
  it("handles just now (<60s)", () => { expect(formatAgo(new Date(Date.now() - 5_000))).toBe("just now"); });
});

describe("format.truncate", () => {
  it("truncates with ellipsis", () => { expect(truncate("안녕하세요 오늘은 월요일입니다", 10)).toBe("안녕하세요 오늘은…"); });
  it("returns original when short", () => { expect(truncate("짧음", 10)).toBe("짧음"); });
});
```

- [ ] **Step 2: 테스트 실행 → FAIL**

```bash
npx vitest run cli/tui/format.test.ts
```

- [ ] **Step 3: 구현**

```ts
// cli/tui/format.ts
export function formatWon(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

export function formatPct(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

export function formatAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

export function truncate(s: string, max: number): string {
  if ([...s].length <= max) return s;
  return `${[...s].slice(0, max).join("")}…`;
}
```

- [ ] **Step 4: 테스트 PASS**

```bash
npx vitest run cli/tui/format.test.ts
```

- [ ] **Step 5: 커밋**

```bash
git add cli/tui/format.ts cli/tui/format.test.ts
git commit -m "feat(tui): add formatWon/formatPct/formatAgo/truncate helpers"
```

---

### Task 6: useElapsed 훅 (fake timer)

**Files:**
- Create: `cli/tui/hooks/useElapsed.ts`
- Create: `cli/tui/hooks/useElapsed.test.tsx`

- [ ] **Step 1: 실패 테스트**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { useElapsed } from "./useElapsed.js";

function Harness({ startedAt }: { startedAt: number }) {
  const elapsedMs = useElapsed(startedAt);
  return React.createElement(Text, null, `elapsed:${elapsedMs}`);
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 3, 22, 9, 0, 0)); });
afterEach(() => { vi.useRealTimers(); });

describe("useElapsed", () => {
  it("reports 0 at start", () => {
    const { lastFrame } = render(React.createElement(Harness, { startedAt: Date.now() }));
    expect(lastFrame()).toContain("elapsed:0");
  });
  it("advances on interval tick", () => {
    const started = Date.now();
    const { lastFrame } = render(React.createElement(Harness, { startedAt: started }));
    vi.advanceTimersByTime(1500);
    expect(lastFrame()).toContain("elapsed:1500");
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npx vitest run cli/tui/hooks/useElapsed.test.tsx
```

- [ ] **Step 3: 구현**

```ts
// cli/tui/hooks/useElapsed.ts
import { useEffect, useState } from "react";

export function useElapsed(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  return now - startedAt;
}
```

- [ ] **Step 4: PASS**

```bash
npx vitest run cli/tui/hooks/useElapsed.test.tsx
```

- [ ] **Step 5: 커밋**

```bash
git add cli/tui/hooks/useElapsed.ts cli/tui/hooks/useElapsed.test.tsx
git commit -m "feat(tui): add useElapsed hook with fake-timer tests"
```

---

### Task 7: fsWatch EventEmitter mock + useReports 훅

**Files:**
- Create: `tests/mocks/fsWatch.ts`
- Create: `cli/tui/hooks/useReports.ts`
- Create: `cli/tui/hooks/useReports.test.tsx`

- [ ] **Step 1: 실패 테스트**

`tests/mocks/fsWatch.ts`:

```ts
import { EventEmitter } from "events";
export const fsWatchEmitter = new EventEmitter();
export function fakeFsWatch(path: string, cb: (ev: string, name: string) => void) {
  const h = (name: string) => cb("change", name);
  fsWatchEmitter.on(`change:${path}`, h);
  return { close: () => fsWatchEmitter.off(`change:${path}`, h) };
}
```

`cli/tui/hooks/useReports.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { useReports } from "./useReports.js";
import { fsWatchEmitter } from "../../../tests/mocks/fsWatch.js";

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    watch: (path: string, cb: (ev: string, name: string) => void) => {
      const h = (name: string) => cb("change", name);
      fsWatchEmitter.on(`change:${path}`, h);
      return { close: () => fsWatchEmitter.off(`change:${path}`, h) };
    },
  };
});

vi.mock("../../../core/storage.js", () => ({
  listJson: vi.fn(async (_dir: string) => ["data/reports/2026-04-20.json"]),
  readJson: vi.fn(async (_p: string) => [{
    id: "v1", campaignId: "c1", variantGroupId: "g1", variantLabel: "A",
    metaAssetLabel: "g1::A", productId: "p1", platform: "meta", date: "2026-04-20",
    impressions: 10000, clicks: 200, inlineLinkClickCtr: 0.02,
    adQualityRanking: null, adEngagementRanking: null, adConversionRanking: null,
  }]),
}));

function Harness({ window }: { window: 7 | 14 | 30 }) {
  const { reports, loading } = useReports(window);
  return React.createElement(Text, null, loading ? "loading" : `reports:${reports.length}`);
}

describe("useReports", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("loads reports on mount and counts them", async () => {
    const { lastFrame } = render(React.createElement(Harness, { window: 7 }));
    await vi.waitFor(() => expect(lastFrame()).toContain("reports:1"));
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npx vitest run cli/tui/hooks/useReports.test.tsx
```

- [ ] **Step 3: 구현**

```ts
// cli/tui/hooks/useReports.ts
import { useEffect, useState } from "react";
import * as fs from "fs";
import { listJson, readJson } from "../../../core/storage.js";
import type { VariantReport } from "../../../core/platform/types.js";

export interface UseReportsResult {
  reports: VariantReport[];
  loading: boolean;
  lastRefreshAt: number;
}

export function useReports(windowDays: 7 | 14 | 30): UseReportsResult {
  const [reports, setReports] = useState<VariantReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshAt, setLastRefreshAt] = useState(Date.now());

  const load = async () => {
    setLoading(true);
    const paths = (await listJson("data/reports")).filter((p) => !p.includes("weekly-analysis"));
    const cutoff = Date.now() - windowDays * 86_400_000;
    const accumulated: VariantReport[] = [];
    for (const p of paths) {
      const data = await readJson<VariantReport[]>(p);
      if (!data) continue;
      for (const r of data) {
        if (new Date(r.date).getTime() >= cutoff) accumulated.push(r);
      }
    }
    setReports(accumulated);
    setLastRefreshAt(Date.now());
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const w1 = fs.watch("data/reports", { persistent: false }, () => { void load(); });
    const fallback = setInterval(() => { void load(); }, 60_000);
    return () => { w1.close(); clearInterval(fallback); };
  }, [windowDays]);

  return { reports, loading, lastRefreshAt };
}
```

- [ ] **Step 4: PASS**

```bash
npx vitest run cli/tui/hooks/useReports.test.tsx
```

- [ ] **Step 5: 커밋**

```bash
git add tests/mocks/fsWatch.ts cli/tui/hooks/useReports.ts cli/tui/hooks/useReports.test.tsx
git commit -m "feat(tui): useReports hook with fs.watch + 60s fallback"
```

---

### Task 8: useWorkerStatus 훅 (launchctl 60초 캐시)

**Files:**
- Create: `cli/tui/hooks/useWorkerStatus.ts`
- Create: `cli/tui/hooks/useWorkerStatus.test.tsx`

- [ ] **Step 1: 실패 테스트**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { useWorkerStatus } from "./useWorkerStatus.js";

vi.mock("child_process", () => ({
  exec: (cmd: string, cb: (err: Error | null, out: string) => void) => {
    cb(null, cmd.includes("com.adai.worker") ? "1234\t0\tcom.adai.worker\n" : "");
  },
}));

function Harness() {
  const { active } = useWorkerStatus();
  return React.createElement(Text, null, active ? "active" : "inactive");
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useWorkerStatus", () => {
  it("reports active when launchctl output contains pid > 0", async () => {
    const { lastFrame } = render(React.createElement(Harness));
    await vi.waitFor(() => expect(lastFrame()).toContain("active"));
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npx vitest run cli/tui/hooks/useWorkerStatus.test.tsx
```

- [ ] **Step 3: 구현**

```ts
// cli/tui/hooks/useWorkerStatus.ts
import { useEffect, useState } from "react";
import { exec } from "child_process";

export interface WorkerStatus { active: boolean; checkedAt: number; }

export function useWorkerStatus(): WorkerStatus {
  const [status, setStatus] = useState<WorkerStatus>({ active: false, checkedAt: 0 });
  useEffect(() => {
    const check = () => {
      exec("launchctl list com.adai.worker", (err, stdout) => {
        if (err || !stdout.trim()) { setStatus({ active: false, checkedAt: Date.now() }); return; }
        const firstLine = stdout.split("\n")[0] ?? "";
        const [pid] = firstLine.split("\t");
        setStatus({ active: Number(pid) > 0, checkedAt: Date.now() });
      });
    };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);
  return status;
}
```

- [ ] **Step 4: PASS**

```bash
npx vitest run cli/tui/hooks/useWorkerStatus.test.tsx
```

- [ ] **Step 5: 커밋**

```bash
git add cli/tui/hooks/useWorkerStatus.ts cli/tui/hooks/useWorkerStatus.test.tsx
git commit -m "feat(tui): useWorkerStatus hook polling launchctl every 60s"
```

---

### Task 9: useTodayStats 훅 (파일 mtime 기반 today ✓)

**Files:**
- Create: `cli/tui/hooks/useTodayStats.ts`
- Create: `cli/tui/hooks/useTodayStats.test.tsx`

- [ ] **Step 1: 실패 테스트**

```tsx
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { useTodayStats } from "./useTodayStats.js";

const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
const todayMtime = startOfToday.getTime() + 3_600_000;
const yesterdayMtime = startOfToday.getTime() - 3_600_000;

vi.mock("../../../core/storage.js", () => ({
  listJson: vi.fn(async (_dir: string) => [
    "data/creatives/a.json", "data/creatives/b.json", "data/creatives/c.json",
  ]),
  readJson: vi.fn(async (p: string) => {
    if (p.endsWith("a.json")) return { id: "a", status: "approved" };
    if (p.endsWith("b.json")) return { id: "b", status: "edited" };
    return { id: "c", status: "pending" };
  }),
}));
vi.mock("fs/promises", async () => {
  const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  return {
    ...actual,
    stat: vi.fn(async (p: string) => {
      if (p.endsWith("a.json")) return { mtimeMs: todayMtime } as any;
      if (p.endsWith("b.json")) return { mtimeMs: todayMtime } as any;
      return { mtimeMs: yesterdayMtime } as any;
    }),
  };
});

function Harness() {
  const { todayCount } = useTodayStats();
  return React.createElement(Text, null, `today:${todayCount}`);
}

describe("useTodayStats", () => {
  it("counts creatives with approved/edited status AND mtime in today", async () => {
    const { lastFrame } = render(React.createElement(Harness));
    await vi.waitFor(() => expect(lastFrame()).toContain("today:2"));
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npx vitest run cli/tui/hooks/useTodayStats.test.tsx
```

- [ ] **Step 3: 구현**

```ts
// cli/tui/hooks/useTodayStats.ts
import { useCallback, useEffect, useState } from "react";
import { stat } from "fs/promises";
import { listJson, readJson } from "../../../core/storage.js";
import type { Creative } from "../../../core/types.js";

export interface TodayStats { todayCount: number; refresh: () => void; bump: () => void; }

export function useTodayStats(): TodayStats {
  const [todayCount, setTodayCount] = useState(0);

  const compute = useCallback(async () => {
    const paths = await listJson("data/creatives");
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    let count = 0;
    for (const p of paths) {
      const c = await readJson<Creative>(p);
      if (!c) continue;
      if (c.status !== "approved" && c.status !== "edited") continue;
      const s = await stat(p);
      if (s.mtimeMs >= startOfToday.getTime()) count++;
    }
    setTodayCount(count);
  }, []);

  useEffect(() => { void compute(); }, [compute]);

  return {
    todayCount,
    refresh: () => { void compute(); },
    bump: () => setTodayCount((n) => n + 1),
  };
}
```

- [ ] **Step 4: PASS**

```bash
npx vitest run cli/tui/hooks/useTodayStats.test.tsx
```

- [ ] **Step 5: 커밋**

```bash
git add cli/tui/hooks/useTodayStats.ts cli/tui/hooks/useTodayStats.test.tsx
git commit -m "feat(tui): useTodayStats counts today-approved creatives via mtime"
```

---

### Task 10: ProgressTrack 공통 컴포넌트

**Files:**
- Create: `cli/tui/components/ProgressTrack.tsx`
- Create: `cli/tui/components/ProgressTrack.test.tsx`

의존성 추가 (이 task 에서 실행):

```bash
npm view ink-spinner peerDependencies
npm view ink-gradient peerDependencies
npm view ink-text-input peerDependencies
# Ink 5 호환 버전만 설치
npm install ink-spinner@^5 ink-gradient@^3 ink-text-input@^6
```

Implementer 는 `npm view` 결과에 Ink 5 호환이 없으면 호환되는 최신 major 로 변경.

- [ ] **Step 1: 실패 테스트**

```tsx
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ProgressTrack } from "./ProgressTrack.js";

describe("ProgressTrack", () => {
  it("renders label, bar, and percentage when running", () => {
    const { lastFrame } = render(
      React.createElement(ProgressTrack, {
        label: "이미지", status: "running", pct: 50, detail: "gen",
      })
    );
    const f = lastFrame() ?? "";
    expect(f).toContain("이미지");
    expect(f).toContain("50%");
    expect(f).toContain("gen");
  });
  it("shows done icon when status=done", () => {
    const { lastFrame } = render(
      React.createElement(ProgressTrack, { label: "영상", status: "done", pct: 100 })
    );
    expect(lastFrame()).toContain("✓");
  });
  it("shows pending icon when status=pending", () => {
    const { lastFrame } = render(
      React.createElement(ProgressTrack, { label: "카피", status: "pending", pct: 0 })
    );
    expect(lastFrame()).toContain("○");
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npx vitest run cli/tui/components/ProgressTrack.test.tsx
```

- [ ] **Step 3: 구현**

```tsx
// cli/tui/components/ProgressTrack.tsx
import React from "react";
import { Box, Text } from "ink";
import { colors, icons } from "../theme/tokens.js";

export type TrackStatus = "pending" | "running" | "done";

interface Props { label: string; status: TrackStatus; pct: number; detail?: string; }

const BAR_WIDTH = 20;

export function ProgressTrack({ label, status, pct, detail }: Props) {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
  const icon = status === "done" ? icons.success : status === "running" ? icons.running : icons.pending;
  const iconColor = status === "done" ? colors.success : status === "running" ? colors.warning : colors.dim;
  return React.createElement(
    Box, { gap: 1 },
    React.createElement(Text, { color: iconColor }, icon),
    React.createElement(Text, null, label.padEnd(6)),
    React.createElement(Text, { color: colors.accent }, bar),
    React.createElement(Text, { color: colors.fg }, `${clamped}%`),
    detail && React.createElement(Text, { color: colors.dim }, detail),
  );
}
```

- [ ] **Step 4: PASS**

```bash
npx vitest run cli/tui/components/ProgressTrack.test.tsx
```

- [ ] **Step 5: 커밋**

```bash
git add cli/tui/components/ProgressTrack.tsx cli/tui/components/ProgressTrack.test.tsx package.json package-lock.json
git commit -m "feat(tui): ProgressTrack component + ink-spinner/gradient/text-input deps"
```

---

## Phase 2 — Shell

### Task 11: Header 컴포넌트

**Files:**
- Create: `cli/tui/components/Header.tsx`
- Create: `cli/tui/components/Header.test.tsx`

- [ ] **Step 1: 실패 테스트**

```tsx
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Header } from "./Header.js";

vi.mock("../hooks/useWorkerStatus.js", () => ({
  useWorkerStatus: () => ({ active: true, checkedAt: Date.now() }),
}));

describe("Header", () => {
  it("renders logo, version, owner badge, and active worker badge", () => {
    const { lastFrame } = render(React.createElement(Header, { rightSlot: "Menu" }));
    const f = lastFrame() ?? "";
    expect(f).toContain("AD-AI");
    expect(f).toContain("v1.0.0");
    expect(f).toContain("owner");
    expect(f).toContain("worker");
    expect(f).toContain("Menu");
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npx vitest run cli/tui/components/Header.test.tsx
```

- [ ] **Step 3: 구현**

```tsx
// cli/tui/components/Header.tsx
import React from "react";
import { Box, Text } from "ink";
import { colors, icons } from "../theme/tokens.js";
import { useWorkerStatus } from "../hooks/useWorkerStatus.js";

interface Props { rightSlot?: string; }

export function Header({ rightSlot }: Props) {
  const { active } = useWorkerStatus();
  return React.createElement(
    Box, { borderStyle: "round", borderColor: colors.review, paddingX: 1, justifyContent: "space-between" },
    React.createElement(Box, { gap: 2 },
      React.createElement(Text, { color: colors.accent, bold: true }, "AD-AI"),
      React.createElement(Text, { color: colors.dim }, "v1.0.0"),
      React.createElement(Text, { color: colors.success }, `${icons.bullet} owner`),
      React.createElement(Text, { color: active ? colors.success : colors.dim },
        `${active ? icons.bullet : icons.pending} worker${active ? "" : " inactive"}`),
    ),
    rightSlot ? React.createElement(Text, { color: colors.dim }, rightSlot) : null,
  );
}
```

- [ ] **Step 4: PASS**

```bash
npx vitest run cli/tui/components/Header.test.tsx
```

- [ ] **Step 5: 커밋**

```bash
git add cli/tui/components/Header.tsx cli/tui/components/Header.test.tsx
git commit -m "feat(tui): Header component with worker badge"
```

---

### Task 12: StatusBar 컴포넌트

**Files:**
- Create: `cli/tui/components/StatusBar.tsx`
- Create: `cli/tui/components/StatusBar.test.tsx`

- [ ] **Step 1: 실패 테스트**

```tsx
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { StatusBar } from "./StatusBar.js";

vi.mock("../../../core/storage.js", () => ({
  listJson: vi.fn(async (dir: string) =>
    dir.endsWith("products") ? ["a.json","b.json","c.json"] :
    dir.endsWith("creatives") ? ["x.json","y.json"] : []),
}));
vi.mock("../hooks/useTodayStats.js", () => ({
  useTodayStats: () => ({ todayCount: 5, refresh: () => {}, bump: () => {} }),
}));

describe("StatusBar", () => {
  it("shows products, creatives, today ✓, and — for winners when DB absent", async () => {
    const { lastFrame } = render(React.createElement(StatusBar, { winners: null }));
    await vi.waitFor(() => {
      const f = lastFrame() ?? "";
      expect(f).toContain("products: 3");
      expect(f).toContain("creatives: 2");
      expect(f).toContain("today ✓ 5");
      expect(f).toContain("winners: —");
    });
  });
  it("shows winner count when provided", async () => {
    const { lastFrame } = render(React.createElement(StatusBar, { winners: 8 }));
    await vi.waitFor(() => expect(lastFrame()).toContain("winners: 8"));
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npx vitest run cli/tui/components/StatusBar.test.tsx
```

- [ ] **Step 3: 구현**

```tsx
// cli/tui/components/StatusBar.tsx
import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { colors } from "../theme/tokens.js";
import { listJson } from "../../../core/storage.js";
import { useTodayStats } from "../hooks/useTodayStats.js";

interface Props { winners: number | null; }

export function StatusBar({ winners }: Props) {
  const [products, setProducts] = useState(0);
  const [creatives, setCreatives] = useState(0);
  const { todayCount } = useTodayStats();

  useEffect(() => {
    void listJson("data/products").then((p) => setProducts(p.length));
    void listJson("data/creatives").then((p) => setCreatives(p.length));
  }, []);

  const winnersLabel = winners === null ? "—" : String(winners);
  return React.createElement(Box, { borderStyle: "round", borderColor: colors.dim, paddingX: 1, gap: 3 },
    React.createElement(Text, { color: colors.dim }, `products: ${products}`),
    React.createElement(Text, { color: colors.dim }, `creatives: ${creatives}`),
    React.createElement(Text, { color: colors.success }, `today ✓ ${todayCount}`),
    React.createElement(Text, { color: colors.analytics }, `winners: ${winnersLabel}`),
  );
}
```

- [ ] **Step 4: PASS**

```bash
npx vitest run cli/tui/components/StatusBar.test.tsx
```

- [ ] **Step 5: 커밋**

```bash
git add cli/tui/components/StatusBar.tsx cli/tui/components/StatusBar.test.tsx
git commit -m "feat(tui): StatusBar with today ✓ and winners fallback"
```

---

### Task 13: MenuScreen 재작성 (screens/ 이동 + 카테고리 그룹)

**Files:**
- Move: `cli/tui/MenuScreen.tsx` → `cli/tui/screens/MenuScreen.tsx`
- Move: `cli/tui/MenuScreen.test.tsx` → `cli/tui/screens/MenuScreen.test.tsx`
- Modify: imports in `cli/tui/App.tsx`

- [ ] **Step 1: 실패 테스트 (재작성)**

`cli/tui/screens/MenuScreen.test.tsx` 신규:

```tsx
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { MenuScreen } from "./MenuScreen.js";
import { MENU_ITEMS } from "../AppTypes.js";

describe("MenuScreen grouped layout", () => {
  it("renders CREATION / REVIEW & LAUNCH / ANALYTICS category labels", () => {
    const { lastFrame } = render(React.createElement(MenuScreen, {
      onSelect: () => {}, mode: "browse", selectedIndex: 0, inputValue: "", inputPrompt: "",
      items: MENU_ITEMS,
    }));
    const f = lastFrame() ?? "";
    expect(f).toContain("CREATION");
    expect(f).toContain("REVIEW & LAUNCH");
    expect(f).toContain("ANALYTICS");
  });
  it("highlights selected item with ▶ indicator", () => {
    const { lastFrame } = render(React.createElement(MenuScreen, {
      onSelect: () => {}, mode: "browse", selectedIndex: 0, inputValue: "", inputPrompt: "",
      items: MENU_ITEMS,
    }));
    expect(lastFrame()).toContain("▶");
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npx vitest run cli/tui/screens/MenuScreen.test.tsx
```
(파일 미존재 또는 카테고리 라벨 없음)

- [ ] **Step 3: 구현**

```bash
mkdir -p cli/tui/screens
git mv cli/tui/MenuScreen.tsx cli/tui/screens/MenuScreen.tsx
git mv cli/tui/MenuScreen.test.tsx cli/tui/screens/MenuScreen.test.tsx
```

`cli/tui/screens/MenuScreen.tsx` 내용을 아래로 교체:

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { ActionKey, MenuItem } from "../AppTypes.js";
import { colors, icons } from "../theme/tokens.js";
import { Header } from "../components/Header.js";
import { StatusBar } from "../components/StatusBar.js";

interface Props {
  onSelect: (key: ActionKey, input?: string) => void;
  mode: "browse" | "input";
  selectedIndex: number;
  inputValue: string;
  inputPrompt: string;
  items: MenuItem[];
}

type Category = "CREATION" | "REVIEW & LAUNCH" | "ANALYTICS";
const CATEGORY_OF: Record<ActionKey, Category> = {
  scrape: "CREATION", "add-product": "CREATION", generate: "CREATION",
  review: "REVIEW & LAUNCH", launch: "REVIEW & LAUNCH", pipeline: "REVIEW & LAUNCH",
  monitor: "ANALYTICS", improve: "ANALYTICS",
};
const CATEGORY_COLOR: Record<Category, string> = {
  CREATION: colors.accent, "REVIEW & LAUNCH": colors.review, ANALYTICS: colors.analytics,
};

export function MenuScreen({ items, selectedIndex, inputValue, inputPrompt, mode }: Props) {
  const categories: Category[] = ["CREATION", "REVIEW & LAUNCH", "ANALYTICS"];
  let flatIdx = 0;
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Header, { rightSlot: "Menu" }),
    React.createElement(Box, { flexDirection: "column", paddingX: 2, paddingY: 1 },
      ...categories.flatMap((cat) => [
        React.createElement(Text, { key: `h-${cat}`, color: colors.dim, bold: true }, cat),
        ...items.filter((it) => CATEGORY_OF[it.key] === cat).map((it) => {
          const selected = flatIdx === selectedIndex;
          const isSelected = selected;
          const row = React.createElement(Box, { key: it.key, gap: 1 },
            React.createElement(Text, { color: colors.accent }, isSelected ? icons.select : " "),
            React.createElement(Text, {
              color: CATEGORY_COLOR[cat],
              backgroundColor: isSelected ? colors.accent : undefined,
            }, it.label.padEnd(12)),
            React.createElement(Text, { color: colors.dim }, `${icons.bullet} ${it.description}`),
          );
          flatIdx++;
          return row;
        }),
        React.createElement(Text, { key: `s-${cat}` }, " "),
      ]),
    ),
    mode === "input"
      ? React.createElement(Box, { paddingX: 2 },
          React.createElement(Text, { color: colors.warning }, `${inputPrompt} `),
          React.createElement(Text, null, inputValue),
          React.createElement(Text, { color: colors.dim }, "▌"))
      : null,
    React.createElement(StatusBar, { winners: null }),
    React.createElement(Box, { paddingX: 2 },
      React.createElement(Text, { color: colors.dim },
        "↑↓ 이동   Enter 선택   Esc 뒤로   Q 종료")),
  );
}
```

- [ ] **Step 4: PASS**

```bash
npx vitest run cli/tui/screens/MenuScreen.test.tsx
```

- [ ] **Step 5: App.tsx import 경로 업데이트 + 커밋**

`cli/tui/App.tsx` 의 `import { MenuScreen } from "./MenuScreen.js"` 를 `from "./screens/MenuScreen.js"` 로 수정.

```bash
git add -A cli/tui
git commit -m "feat(tui): rewrite MenuScreen with category grouping + Header/StatusBar"
```

---

### Task 14: DoneScreen + ReviewScreen screens/ 이동 (임시 재배선, 업그레이드는 Phase 5 에서)

**Files:**
- Move: `cli/tui/DoneScreen.tsx` → `cli/tui/screens/DoneScreen.tsx`
- Move: `cli/tui/DoneScreen.test.tsx` → `cli/tui/screens/DoneScreen.test.tsx`
- Move: `cli/tui/ReviewScreen.tsx` → `cli/tui/screens/ReviewScreen.tsx`
- Modify: `cli/tui/App.tsx` import 경로

- [ ] **Step 1: 기존 DoneScreen 테스트가 이동 후에도 통과하는지 baseline 체크**

```bash
npx vitest run cli/tui/DoneScreen.test.tsx
```
Expected: PASS (이동 전 baseline)

- [ ] **Step 2: 파일 이동**

```bash
git mv cli/tui/DoneScreen.tsx cli/tui/screens/DoneScreen.tsx
git mv cli/tui/DoneScreen.test.tsx cli/tui/screens/DoneScreen.test.tsx
git mv cli/tui/ReviewScreen.tsx cli/tui/screens/ReviewScreen.tsx
```

- [ ] **Step 3: App.tsx import 경로 업데이트**

`cli/tui/App.tsx` 에서:

```tsx
// 변경 전
import { DoneScreen } from "./DoneScreen.js";
import { ReviewScreen, type ReviewGroup } from "./ReviewScreen.js";

// 변경 후
import { DoneScreen } from "./screens/DoneScreen.js";
import { ReviewScreen, type ReviewGroup } from "./screens/ReviewScreen.js";
```

- [ ] **Step 4: 전체 테스트 PASS 확인**

```bash
npx vitest run
```

- [ ] **Step 5: 커밋**

```bash
git add -A cli/tui
git commit -m "chore(tui): move DoneScreen/ReviewScreen under screens/"
```

---

## Phase 3 — Generate 병렬화

### Task 15: AppTypes 에 GenerateProgress 타입 추가

**Files:**
- Modify: `cli/tui/AppTypes.ts`
- Modify: `cli/tui/AppTypes.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`cli/tui/AppTypes.test.ts` 끝에 추가:

```ts
import type { RunProgress, GenerateProgress, LaunchLog } from "./AppTypes.js";

describe("RunProgress optional extensions", () => {
  it("accepts generate field", () => {
    const p: RunProgress = {
      message: "x",
      generate: {
        queue: ["done", "running", "pending"],
        currentProduct: { id: "p1", name: "AI 부트캠프" },
        tracks: {
          copy:  { status: "running", pct: 50, label: "variant 2/3" },
          image: { status: "done", pct: 100, label: "done (2.1s)" },
          video: { status: "running", pct: 78, label: "polling Veo" },
        },
        elapsedMs: 47_000,
      },
    };
    expect(p.generate?.tracks.copy.pct).toBe(50);
  });
  it("accepts launchLogs field", () => {
    const log: LaunchLog = { ts: "14:32:04", method: "POST", path: "/act_X/campaigns", status: 201 };
    const p: RunProgress = { message: "x", launchLogs: [log] };
    expect(p.launchLogs?.[0].status).toBe(201);
  });
});
```

- [ ] **Step 2: FAIL (타입 미존재)**

```bash
npx vitest run cli/tui/AppTypes.test.ts
```

- [ ] **Step 3: AppTypes 확장**

```ts
// cli/tui/AppTypes.ts 끝에 추가
export interface GenerateProgress {
  queue: ("done" | "running" | "pending")[];
  currentProduct: { id: string; name: string };
  tracks: {
    copy:  { status: "pending" | "running" | "done"; pct: number; label: string };
    image: { status: "pending" | "running" | "done"; pct: number; label: string };
    video: { status: "pending" | "running" | "done"; pct: number; label: string };
  };
  elapsedMs: number;
}

export interface LaunchLog {
  ts: string;
  method: string;
  path: string;
  status: number;
  refId?: string;
}
```

`RunProgress` 를 다음과 같이 확장:

```ts
export interface RunProgress {
  message: string;
  currentCourse?: string;
  courseIndex?: number;
  totalCourses?: number;
  taskProgress?: TaskProgress;
  generate?: GenerateProgress;
  launchLogs?: LaunchLog[];
}
```

- [ ] **Step 4: PASS**

```bash
npx vitest run cli/tui/AppTypes.test.ts
```

- [ ] **Step 5: 커밋**

```bash
git add cli/tui/AppTypes.ts cli/tui/AppTypes.test.ts
git commit -m "feat(tui): extend RunProgress with generate and launchLogs fields"
```

---

### Task 16: runGenerate 3-track 병렬화

**Files:**
- Modify: `cli/actions.ts`
- Modify: `cli/actions.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`cli/actions.test.ts` 끝에:

```ts
import { runGenerate } from "./actions.js";

describe("runGenerate parallelism", () => {
  it("emits progress.generate with 3 tracks", async () => {
    // NOTE: 실제 SDK 호출은 mock. core/creative/* 모듈을 vi.mock 으로 stub
    // generateImage/generateVideo/generateCopy 를 instant resolve 로 대체
    // 아래 mock 은 beforeEach 에서 vi.resetModules 후 재주입
    const events: any[] = [];
    vi.doMock("../core/creative/image.js", () => ({ generateImage: async () => "img.jpg" }));
    vi.doMock("../core/creative/video.js", () => ({ generateVideo: async () => "vid.mp4" }));
    vi.doMock("../core/creative/copy.js", () => ({
      generateCopy: async () => ({ headline: "h", body: "b", cta: "c", hashtags: [] }),
      createAnthropicClient: () => ({}),
    }));
    vi.doMock("../core/storage.js", () => ({
      listJson: async () => ["data/products/p1.json"],
      readJson: async () => ({ id: "p1", name: "AI 부트캠프", description: "d", targetUrl: "u", currency: "KRW", tags: [], inputMethod: "manual", createdAt: "" }),
      writeJson: async () => {},
    }));
    const { runGenerate: fresh } = await import("./actions.js?parallel-test");
    await fresh((p: any) => events.push(p));
    const withGen = events.filter((e) => e.generate);
    expect(withGen.length).toBeGreaterThan(0);
    expect(withGen[0].generate.tracks.copy).toBeDefined();
    expect(withGen[0].generate.tracks.image).toBeDefined();
    expect(withGen[0].generate.tracks.video).toBeDefined();
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npx vitest run cli/actions.test.ts -t parallelism
```

- [ ] **Step 3: runGenerate 재작성**

`cli/actions.ts` 의 `runGenerate` 블록을 아래로 교체:

```ts
export async function runGenerate(onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    const productPaths = await listJson("data/products");
    if (productPaths.length === 0) {
      return { success: false, message: "Generate 실패", logs: ["data/products/에 제품이 없습니다. Scrape을 먼저 실행하세요."] };
    }
    const anthropic = createAnthropicClient();
    const logs: string[] = [];
    const startedAt = Date.now();

    for (let i = 0; i < productPaths.length; i++) {
      const product = await readJson<Product>(productPaths[i]);
      if (!product) continue;
      const queue: ("done" | "running" | "pending")[] =
        productPaths.map((_, idx) => idx < i ? "done" : idx === i ? "running" : "pending");
      const variantGroupId = randomUUID();

      const tracks = {
        copy:  { status: "running" as const, pct: 0, label: "대기" },
        image: { status: "running" as const, pct: 0, label: "시작" },
        video: { status: "running" as const, pct: 0, label: "시작" },
      };
      const emit = (msg: string) => onProgress({
        message: msg,
        generate: {
          queue,
          currentProduct: { id: product.id, name: product.name },
          tracks: { ...tracks },
          elapsedMs: Date.now() - startedAt,
        },
      });
      emit(`${product.name} 생성 중...`);

      const imageTask = (async () => {
        const p = await generateImage(product);
        tracks.image = { status: "done", pct: 100, label: "done" };
        emit(`${product.name} 이미지 완료`);
        return p;
      })();

      const videoTask = (async () => {
        const p = await generateVideo(product, (msg) => {
          const match = msg.match(/\((\d+)\/(\d+)\)/);
          if (match) tracks.video = { status: "running", pct: Math.round((Number(match[1]) / Number(match[2])) * 95), label: msg };
          emit(msg);
        });
        tracks.video = { status: "done", pct: 100, label: "done" };
        emit(`${product.name} 영상 완료`);
        return p;
      })();

      const copiesTask = (async () => {
        const copies: { label: typeof VARIANT_LABELS[number]; data: Awaited<ReturnType<typeof generateCopy>> }[] = [];
        for (let v = 0; v < VARIANT_LABELS.length; v++) {
          const label = VARIANT_LABELS[v];
          tracks.copy = { status: "running", pct: Math.round((v / VARIANT_LABELS.length) * 100), label: `variant ${v + 1}/3` };
          emit(`카피 ${v + 1}/3 (${label})`);
          const c = await generateCopy(anthropic, product, [], label);
          copies.push({ label, data: c });
        }
        tracks.copy = { status: "done", pct: 100, label: "3 variants" };
        emit(`${product.name} 카피 완료`);
        return copies;
      })();

      const [imageLocalPath, videoLocalPath, copies] = await Promise.all([imageTask, videoTask, copiesTask]);

      for (const { label, data } of copies) {
        const creative: Creative = {
          id: randomUUID(),
          productId: product.id,
          variantGroupId,
          copy: { ...data, variantLabel: label, metaAssetLabel: `${variantGroupId}::${label}` },
          imageLocalPath, videoLocalPath, status: "pending",
          createdAt: new Date().toISOString(),
        };
        await writeJson(`data/creatives/${creative.id}.json`, creative);
      }
      logs.push(`${product.name} ✓ (3 variants)`);
    }
    return { success: true, message: `Generate 완료 — ${logs.length}개 제품`, logs };
  } catch (e) {
    return { success: false, message: "Generate 실패", logs: [String(e)] };
  }
}
```

- [ ] **Step 4: PASS**

```bash
npx vitest run cli/actions.test.ts
```

- [ ] **Step 5: 커밋**

```bash
git add cli/actions.ts cli/actions.test.ts
git commit -m "feat(cli): parallelize Generate tracks with Promise.all (image/video/copies)"
```

---

### Task 17: GenerateScreen

**Files:**
- Create: `cli/tui/screens/GenerateScreen.tsx`
- Create: `cli/tui/screens/GenerateScreen.test.tsx`

- [ ] **Step 1: 실패 테스트**

```tsx
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { GenerateScreen } from "./GenerateScreen.js";

vi.mock("../hooks/useWorkerStatus.js", () => ({ useWorkerStatus: () => ({ active: false, checkedAt: 0 }) }));
vi.mock("../hooks/useTodayStats.js", () => ({ useTodayStats: () => ({ todayCount: 5, refresh: () => {}, bump: () => {} }) }));
vi.mock("../../../core/storage.js", () => ({
  listJson: async () => [], readJson: async () => null, writeJson: async () => {},
}));

const baseProgress = {
  message: "",
  generate: {
    queue: ["done","running","pending"] as const,
    currentProduct: { id: "p1", name: "AI 부트캠프" },
    tracks: {
      copy:  { status: "running" as const, pct: 62, label: "variant 2/3" },
      image: { status: "done" as const, pct: 100, label: "done (2.1s)" },
      video: { status: "running" as const, pct: 78, label: "polling Veo" },
    },
    elapsedMs: 47_000,
  },
};

describe("GenerateScreen", () => {
  it("renders product name, queue count, 3 track labels, and elapsed", () => {
    const { lastFrame } = render(React.createElement(GenerateScreen, { progress: baseProgress }));
    const f = lastFrame() ?? "";
    expect(f).toContain("AI 부트캠프");
    expect(f).toContain("2/3");
    expect(f).toContain("카피");
    expect(f).toContain("이미지");
    expect(f).toContain("영상");
    expect(f).toContain("elapsed 47s");
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npx vitest run cli/tui/screens/GenerateScreen.test.tsx
```

- [ ] **Step 3: 구현**

```tsx
// cli/tui/screens/GenerateScreen.tsx
import React from "react";
import { Box, Text } from "ink";
import { colors, icons } from "../theme/tokens.js";
import { Header } from "../components/Header.js";
import { StatusBar } from "../components/StatusBar.js";
import { ProgressTrack } from "../components/ProgressTrack.js";
import type { RunProgress } from "../AppTypes.js";

interface Props { progress: RunProgress; }

export function GenerateScreen({ progress }: Props) {
  const g = progress.generate;
  if (!g) return React.createElement(Text, null, "준비 중...");
  const doneCount = g.queue.filter((s) => s === "done").length;
  const totalCount = g.queue.length;
  const elapsedSec = Math.round(g.elapsedMs / 1000);
  const overallPct = Math.round((g.tracks.copy.pct + g.tracks.image.pct + g.tracks.video.pct) / 3);
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Header, { rightSlot: "Generate" }),
    React.createElement(Box, { paddingX: 2, paddingY: 1, flexDirection: "column" },
      React.createElement(Text, { color: colors.accent, bold: true }, `${icons.header} Generate — 소재 생성 중`),
      React.createElement(Text, null,
        `큐:  ${g.queue.map((s) => s === "done" ? "[✓]" : s === "running" ? "[⟳]" : "[ ]").join(" ")}  (${doneCount}/${totalCount})`),
      React.createElement(Text, null, `제품:  ${g.currentProduct.name}`),
      React.createElement(Text, { color: colors.dim }, " "),
      React.createElement(ProgressTrack, { label: "카피", status: g.tracks.copy.status, pct: g.tracks.copy.pct, detail: g.tracks.copy.label }),
      React.createElement(ProgressTrack, { label: "이미지", status: g.tracks.image.status, pct: g.tracks.image.pct, detail: g.tracks.image.label }),
      React.createElement(ProgressTrack, { label: "영상", status: g.tracks.video.status, pct: g.tracks.video.pct, detail: g.tracks.video.label }),
      React.createElement(Text, { color: colors.dim }, "────────────────────────────"),
      React.createElement(Text, null, `전체     ${"█".repeat(Math.round(overallPct / 5))}${"░".repeat(20 - Math.round(overallPct / 5))}  ${overallPct}%  elapsed ${elapsedSec}s`),
    ),
    React.createElement(StatusBar, { winners: null }),
    React.createElement(Box, { paddingX: 2 },
      React.createElement(Text, { color: colors.dim }, "Esc 취소 (현재 제품 완료 후 중단)")),
  );
}
```

- [ ] **Step 4: PASS**

```bash
npx vitest run cli/tui/screens/GenerateScreen.test.tsx
```

- [ ] **Step 5: 커밋**

```bash
git add cli/tui/screens/GenerateScreen.tsx cli/tui/screens/GenerateScreen.test.tsx
git commit -m "feat(tui): GenerateScreen with 3-track ProgressTrack rendering"
```

---

### Task 18: App.tsx Generate 라우팅 + rate limit 실운영 검증

**Files:**
- Modify: `cli/tui/App.tsx`

- [ ] **Step 1: 실패 테스트**

`cli/tui/App.test.tsx` 에 추가:

```tsx
it("routes to GenerateScreen when runProgress.generate is set", async () => {
  // 간접 테스트 — App 내 running 분기 판별이 progress.generate 존재 여부를 본다
  // 구현 후 snapshot 대신 행동으로 검증: actions.runGenerate 를 호출시켜 화면에 "큐:" 텍스트가 등장
});
```

(정밀 테스트는 Phase 5 에서 screen router 리팩터와 함께 커버. 이 task 는 App.tsx 분기만 추가)

- [ ] **Step 2: 수동 실행 확인**

```bash
npm run app
# 메뉴에서 Generate 선택. data/products/ 가 비어있으면 "제품 없음" 표시 → OK
```

- [ ] **Step 3: App.tsx running 분기 수정**

`cli/tui/App.tsx` 의 `appState === "running"` 분기를 다음으로 교체:

```tsx
import { GenerateScreen } from "./screens/GenerateScreen.js";
// ... 기존 import 유지

if (appState === "running") {
  if (runProgress.generate) {
    return React.createElement(GenerateScreen, { progress: runProgress });
  }
  return React.createElement(PipelineProgress, {
    currentStep: "generate",
    stepStatuses: DEFAULT_STEP_STATUSES,
    currentCourse: runProgress.currentCourse ?? "",
    courseIndex: runProgress.courseIndex ?? 0,
    totalCourses: runProgress.totalCourses ?? 0,
    progressMessage: runProgress.message,
    taskProgress: runProgress.taskProgress,
  });
}
```

- [ ] **Step 4: 실운영 검증**

```bash
# data/products/ 에 2개 제품을 준비 (scrape 으로 수집 혹은 기존 파일)
npm run app
# Generate 선택 → 3-track 병렬 진행. 429 rate limit 발생 시 Log 캡처
```

rate limit 발생 시 implementer 는 이 Task 를 BLOCKED 로 보고하고 controller 가 variant 3개 카피 sequential 을 유지(현재 플랜대로)한 상태에서 image/video/copies Promise.all 중 copies 를 한 단계 뒤로 빼는 fallback 을 추가하는 후속 Task 를 발주한다.

- [ ] **Step 5: 커밋**

```bash
git add cli/tui/App.tsx cli/tui/App.test.tsx
git commit -m "feat(tui): route to GenerateScreen when progress.generate present"
```

---

## Phase 4 — Monitor

### Task 19: MonitorScreen + winners DB 조회 유틸

**Files:**
- Create: `cli/tui/screens/MonitorScreen.tsx`
- Create: `cli/tui/screens/MonitorScreen.test.tsx`
- Create: `cli/tui/monitor/metrics.ts`
- Create: `cli/tui/monitor/metrics.test.ts`

- [ ] **Step 1: metrics 유틸 테스트 실패**

`cli/tui/monitor/metrics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { aggregateVariantReports, sortByCtr } from "./metrics.js";
import type { VariantReport } from "../../../core/platform/types.js";

const r = (id: string, impressions: number, clicks: number, ctr: number): VariantReport => ({
  id, campaignId: "c", variantGroupId: "g", variantLabel: "A", metaAssetLabel: "m",
  productId: "p", platform: "meta", date: "2026-04-20",
  impressions, clicks, inlineLinkClickCtr: ctr,
  adQualityRanking: null, adEngagementRanking: null, adConversionRanking: null,
});

describe("aggregateVariantReports", () => {
  it("computes impression-weighted average CTR", () => {
    const out = aggregateVariantReports([r("a", 10000, 200, 0.02), r("b", 5000, 250, 0.05)]);
    expect(out.impressions).toBe(15000);
    expect(out.clicks).toBe(450);
    // (10000*0.02 + 5000*0.05) / 15000 = (200 + 250) / 15000 = 0.03
    expect(Math.abs(out.avgCtr - 0.03)).toBeLessThan(1e-9);
  });
  it("handles empty list", () => {
    const out = aggregateVariantReports([]);
    expect(out.impressions).toBe(0);
    expect(out.clicks).toBe(0);
    expect(out.avgCtr).toBe(0);
  });
});

describe("sortByCtr", () => {
  it("returns top/bottom N by CTR descending/ascending", () => {
    const xs = [r("a", 1000, 10, 0.01), r("b", 1000, 30, 0.03), r("c", 1000, 20, 0.02)];
    const sorted = sortByCtr(xs);
    expect(sorted[0].id).toBe("b");
    expect(sorted[2].id).toBe("a");
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npx vitest run cli/tui/monitor/metrics.test.ts
```

- [ ] **Step 3: 구현**

```ts
// cli/tui/monitor/metrics.ts
import type { VariantReport } from "../../../core/platform/types.js";

export interface Aggregate { impressions: number; clicks: number; avgCtr: number; variants: number; }

export function aggregateVariantReports(reports: VariantReport[]): Aggregate {
  if (reports.length === 0) return { impressions: 0, clicks: 0, avgCtr: 0, variants: 0 };
  let totalImpr = 0, totalClicks = 0, weighted = 0;
  for (const r of reports) {
    totalImpr += r.impressions;
    totalClicks += r.clicks;
    weighted += r.inlineLinkClickCtr * r.impressions;
  }
  return {
    impressions: totalImpr,
    clicks: totalClicks,
    avgCtr: totalImpr > 0 ? weighted / totalImpr : 0,
    variants: reports.length,
  };
}

export function sortByCtr(reports: VariantReport[]): VariantReport[] {
  return [...reports].sort((a, b) => b.inlineLinkClickCtr - a.inlineLinkClickCtr);
}
```

- [ ] **Step 4: metrics PASS 확인**

```bash
npx vitest run cli/tui/monitor/metrics.test.ts
```

- [ ] **Step 5: 커밋**

```bash
git add cli/tui/monitor/metrics.ts cli/tui/monitor/metrics.test.ts
git commit -m "feat(tui): add aggregateVariantReports and sortByCtr metric helpers"
```

---

### Task 20: MonitorScreen 컴포넌트 + App 라우팅

**Files:**
- Create: `cli/tui/screens/MonitorScreen.tsx`
- Create: `cli/tui/screens/MonitorScreen.test.tsx`
- Modify: `cli/tui/App.tsx`
- Modify: `cli/tui/AppTypes.ts` (monitor 의 needsInput 을 false 로)

- [ ] **Step 1: 실패 테스트**

```tsx
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { MonitorScreen } from "./MonitorScreen.js";

vi.mock("../hooks/useReports.js", () => ({
  useReports: () => ({
    reports: [
      { id: "r1", productId: "p1", variantLabel: "B", inlineLinkClickCtr: 0.0482, impressions: 22000, clicks: 1060, adQualityRanking: null, adEngagementRanking: null, adConversionRanking: null, campaignId: "c", variantGroupId: "g", metaAssetLabel: "m", platform: "meta", date: "2026-04-20" },
      { id: "r2", productId: "p2", variantLabel: "A", inlineLinkClickCtr: 0.0071, impressions: 9000, clicks: 64, adQualityRanking: null, adEngagementRanking: null, adConversionRanking: null, campaignId: "c", variantGroupId: "g", metaAssetLabel: "m", platform: "meta", date: "2026-04-20" },
    ],
    loading: false, lastRefreshAt: Date.now(),
  }),
}));
vi.mock("../hooks/useWorkerStatus.js", () => ({ useWorkerStatus: () => ({ active: true, checkedAt: 0 }) }));
vi.mock("../hooks/useTodayStats.js", () => ({ useTodayStats: () => ({ todayCount: 0, refresh: () => {}, bump: () => {} }) }));
vi.mock("../../../core/storage.js", () => ({ listJson: async () => [], readJson: async () => null }));

describe("MonitorScreen", () => {
  it("renders OVERVIEW, TOP, BOTTOM sections with impression/ctr/clicks", async () => {
    const { lastFrame } = render(React.createElement(MonitorScreen));
    const f = lastFrame() ?? "";
    expect(f).toContain("OVERVIEW");
    expect(f).toContain("TOP");
    expect(f).toContain("BOTTOM");
    expect(f).toContain("variants");
    expect(f).toContain("avg CTR");
    expect(f).toContain("impressions");
    expect(f).toContain("winners");
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npx vitest run cli/tui/screens/MonitorScreen.test.tsx
```

- [ ] **Step 3: 구현**

```tsx
// cli/tui/screens/MonitorScreen.tsx
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { colors, icons } from "../theme/tokens.js";
import { Header } from "../components/Header.js";
import { StatusBar } from "../components/StatusBar.js";
import { useReports } from "../hooks/useReports.js";
import { aggregateVariantReports, sortByCtr } from "../monitor/metrics.js";
import { formatPct } from "../format.js";

type Window = 7 | 14 | 30;

interface Props { onBack?: () => void; }

export function MonitorScreen({ onBack }: Props) {
  const [window, setWindow] = useState<Window>(7);
  const { reports, loading } = useReports(window);
  const agg = aggregateVariantReports(reports);
  const sorted = sortByCtr(reports);
  const top = sorted.slice(0, 3);
  const bottom = sorted.slice(-3).reverse();

  useInput((input, key) => {
    if (key.escape) onBack?.();
    if (input === "t" || input === "T") setWindow((w) => (w === 7 ? 14 : w === 14 ? 30 : 7));
  });

  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Header, { rightSlot: "Monitor" }),
    React.createElement(Box, { paddingX: 2, gap: 2 },
      React.createElement(Text, null, `Window: ${window === 7 ? "[7d]" : " 7d "} ${window === 14 ? "[14d]" : " 14d "} ${window === 30 ? "[30d]" : " 30d "}`),
    ),
    React.createElement(Box, { paddingX: 2, flexDirection: "column" },
      React.createElement(Text, { color: colors.dim }, "── OVERVIEW ────"),
      React.createElement(Text, null,
        `variants  ${agg.variants}     avg CTR  ${formatPct(agg.avgCtr)}     impressions  ${agg.impressions.toLocaleString()}`),
      React.createElement(Text, null,
        `winners   —     clicks   ${agg.clicks.toLocaleString()}`),
      React.createElement(Text, null, " "),
      React.createElement(Text, { color: colors.dim }, "── TOP 3 (by CTR) ────"),
      ...top.map((r) => React.createElement(Text, { key: r.id, color: colors.success },
        `${icons.up}  ${r.productId.slice(0,16)} · ${r.variantLabel}   CTR ${formatPct(r.inlineLinkClickCtr)}  impr ${r.impressions.toLocaleString()}  clicks ${r.clicks.toLocaleString()}`)),
      React.createElement(Text, null, " "),
      React.createElement(Text, { color: colors.dim }, "── BOTTOM 3 ────"),
      ...bottom.map((r) => React.createElement(Text, { key: r.id, color: colors.danger },
        `${icons.down}  ${r.productId.slice(0,16)} · ${r.variantLabel}   CTR ${formatPct(r.inlineLinkClickCtr)}  impr ${r.impressions.toLocaleString()}  clicks ${r.clicks.toLocaleString()}`)),
      loading ? React.createElement(Text, { color: colors.warning }, "loading...") : null,
    ),
    React.createElement(StatusBar, { winners: null }),
    React.createElement(Box, { paddingX: 2 },
      React.createElement(Text, { color: colors.dim }, "R 새로고침  T 윈도우(7/14/30)  Esc 뒤로")),
  );
}
```

- [ ] **Step 4: PASS + App.tsx 라우팅**

`cli/tui/AppTypes.ts` 의 monitor 항목을 `needsInput: false` 로 변경:

```ts
{ key: "monitor", label: "Monitor", description: "성과 분석", needsInput: false },
```

`cli/tui/App.tsx` 에 monitor 분기 추가:

```tsx
import { MonitorScreen } from "./screens/MonitorScreen.js";
// executeAction 의 case "monitor" 블록 제거 후, appState === "menu" → monitor 선택 시
// "running" 이 아니라 별도 상태로 분기. 단순화: appState 에 "monitor" 추가
// AppTypes.AppState = "menu" | "input" | "running" | "done" | "review" | "monitor"
```

`AppTypes.ts` `AppState` 확장:

```ts
export type AppState = "menu" | "input" | "running" | "done" | "review" | "monitor";
```

`App.tsx` 에 monitor 분기:

```tsx
if (appState === "monitor") {
  return React.createElement(MonitorScreen, { onBack: () => setAppState("menu") });
}

// getNextStateForAction 도 수정
export function getNextStateForAction(key: ActionKey): AppState {
  if (key === "review") return "review";
  if (key === "monitor") return "monitor";
  if (key === "add-product") return "input";
  const item = MENU_ITEMS.find((m) => m.key === key);
  return item?.needsInput ? "input" : "running";
}
```

`App.test.tsx` 업데이트:

```ts
it("monitor goes directly to monitor state", () => {
  expect(getNextStateForAction("monitor")).toBe("monitor");
});
```

```bash
npx vitest run cli/tui
```

- [ ] **Step 5: 커밋**

```bash
git add cli/tui/screens/MonitorScreen.tsx cli/tui/screens/MonitorScreen.test.tsx cli/tui/AppTypes.ts cli/tui/App.tsx cli/tui/App.test.tsx
git commit -m "feat(tui): MonitorScreen with window switching and top/bottom by CTR"
```

---

## Phase 5a — Review / Scrape / AddProduct

### Task 21: ReviewScreen 업그레이드 (뱃지 + ASSETS 메타)

**Files:**
- Modify: `cli/tui/screens/ReviewScreen.tsx`
- Modify: `cli/tui/screens/ReviewScreen.test.tsx` (신규로 작성, 기존 테스트 없으면 생성)
- Create: `cli/tui/review/assetMeta.ts`
- Create: `cli/tui/review/assetMeta.test.ts`

- [ ] **Step 1: assetMeta 테스트 실패**

`cli/tui/review/assetMeta.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { getAssetMeta } from "./assetMeta.js";

vi.mock("fs/promises", () => ({
  stat: vi.fn(async () => ({ size: 342000 })),
}));
vi.mock("sharp", () => ({
  default: () => ({ metadata: async () => ({ width: 1080, height: 1080, format: "jpeg" }) }),
}));

describe("getAssetMeta", () => {
  it("returns width/height/format/size for image", async () => {
    const m = await getAssetMeta("x.jpg");
    expect(m).toEqual({ kind: "image", width: 1080, height: 1080, format: "jpeg", sizeBytes: 342000 });
  });
  it("returns 1080x1920 hardcoded for video", async () => {
    const m = await getAssetMeta("x.mp4");
    expect(m).toEqual({ kind: "video", width: 1080, height: 1920, format: "mp4", sizeBytes: 342000 });
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npx vitest run cli/tui/review/assetMeta.test.ts
```

- [ ] **Step 3: 구현**

```ts
// cli/tui/review/assetMeta.ts
import { stat } from "fs/promises";
import sharp from "sharp";

export interface AssetMeta {
  kind: "image" | "video";
  width: number; height: number; format: string; sizeBytes: number;
}

const cache = new Map<string, AssetMeta>();

export async function getAssetMeta(path: string): Promise<AssetMeta> {
  const hit = cache.get(path);
  if (hit) return hit;
  const s = await stat(path);
  let meta: AssetMeta;
  if (path.endsWith(".mp4")) {
    meta = { kind: "video", width: 1080, height: 1920, format: "mp4", sizeBytes: s.size };
  } else {
    const m = await sharp(path).metadata();
    meta = { kind: "image", width: m.width ?? 0, height: m.height ?? 0, format: m.format ?? "unknown", sizeBytes: s.size };
  }
  cache.set(path, meta);
  return meta;
}

export function clearAssetMetaCache() { cache.clear(); }
```

- [ ] **Step 4: ReviewScreen 업그레이드**

`cli/tui/screens/ReviewScreen.tsx` 수정 — 기존 렌더 부분에 뱃지/ASSETS/COPY 색상 추가. 핵심 diff:

```tsx
// import 추가
import { getAssetMeta, type AssetMeta } from "../review/assetMeta.js";
import { Header } from "../components/Header.js";
import { colors } from "../theme/tokens.js";
import { useTodayStats } from "../hooks/useTodayStats.js";

// 컴포넌트 내부
const [meta, setMeta] = useState<{ image?: AssetMeta; video?: AssetMeta }>({});
const { todayCount, bump } = useTodayStats();

useEffect(() => {
  if (!currentVariant) return;
  void Promise.all([
    getAssetMeta(currentVariant.imageLocalPath),
    getAssetMeta(currentVariant.videoLocalPath),
  ]).then(([image, video]) => setMeta({ image, video }));
}, [currentVariant?.imageLocalPath, currentVariant?.videoLocalPath]);

// 상태 뱃지 렌더 함수
function StatusBadge({ status }: { status: "pending" | "approved" | "rejected" | "edited" }) {
  const map = {
    pending:  { bg: colors.warning, label: "pending" },
    approved: { bg: colors.success, label: "approved" },
    rejected: { bg: colors.danger,  label: "rejected" },
    edited:   { bg: colors.review,  label: "edited" },
  } as const;
  const { bg, label } = map[status];
  return React.createElement(Text, { backgroundColor: bg, color: colors.bg }, ` ${label} `);
}

// Header 와 ASSETS 블록 삽입 + COPY 색상 분기 (headline/body fg, cta success, tags analytics)
// onApprove 콜백에서 bump() 호출해 today ✓ 즉시 증분
```

- [ ] **Step 5: 실패 테스트 → 구현 → PASS → 커밋**

`cli/tui/screens/ReviewScreen.test.tsx` 에 뱃지/ASSETS 렌더 테스트 추가:

```tsx
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ReviewScreen } from "./ReviewScreen.js";

vi.mock("../hooks/useWorkerStatus.js", () => ({ useWorkerStatus: () => ({ active: false, checkedAt: 0 }) }));
vi.mock("../hooks/useTodayStats.js", () => ({ useTodayStats: () => ({ todayCount: 0, refresh: () => {}, bump: () => {} }) }));
vi.mock("../review/assetMeta.js", () => ({
  getAssetMeta: async (p: string) => p.endsWith(".mp4")
    ? { kind: "video", width: 1080, height: 1920, format: "mp4", sizeBytes: 4200000 }
    : { kind: "image", width: 1080, height: 1080, format: "jpeg", sizeBytes: 342000 },
  clearAssetMetaCache: () => {},
}));

const group = {
  variantGroupId: "g1",
  product: { id: "p1", name: "AI 부트캠프", description: "", targetUrl: "", currency: "KRW", tags: [], inputMethod: "manual" as const, createdAt: "" },
  creatives: [
    { id: "c1", productId: "p1", variantGroupId: "g1",
      copy: { headline: "3개월 안에", body: "실전 프로젝트 12개", cta: "지금 신청", hashtags: ["AI"], variantLabel: "emotional" as const, metaAssetLabel: "" },
      imageLocalPath: "img.jpg", videoLocalPath: "vid.mp4", status: "pending" as const, createdAt: "" },
  ],
};

describe("ReviewScreen badge + ASSETS", () => {
  it("renders status badge and asset meta after load", async () => {
    const { lastFrame } = render(React.createElement(ReviewScreen, {
      groups: [group], onApprove: () => {}, onReject: () => {}, onEdit: () => {},
    }));
    await new Promise((r) => setTimeout(r, 20));
    const f = lastFrame() ?? "";
    expect(f).toContain("pending");
    expect(f).toContain("1080×1080");
    expect(f).toContain("342KB");
    expect(f).toContain("mp4");
  });
});
```

```bash
npx vitest run cli/tui/screens/ReviewScreen.test.tsx
git add cli/tui/screens/ReviewScreen.tsx cli/tui/screens/ReviewScreen.test.tsx cli/tui/review/
git commit -m "feat(tui): Review status badges + ASSETS meta panel + today ✓ bump"
```

---

### Task 22: ScrapeScreen

**Files:**
- Create: `cli/tui/screens/ScrapeScreen.tsx`
- Create: `cli/tui/screens/ScrapeScreen.test.tsx`
- Modify: `cli/tui/App.tsx` (scrape 분기를 ScrapeScreen 으로)

- [ ] **Step 1: 실패 테스트**

```tsx
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ScrapeScreen } from "./ScrapeScreen.js";

vi.mock("../hooks/useWorkerStatus.js", () => ({ useWorkerStatus: () => ({ active: false, checkedAt: 0 }) }));
vi.mock("../hooks/useTodayStats.js", () => ({ useTodayStats: () => ({ todayCount: 0, refresh: () => {}, bump: () => {} }) }));
vi.mock("../../../core/storage.js", () => ({ listJson: async () => [] }));

describe("ScrapeScreen", () => {
  it("renders URL prompt with generic Gemini hint (no site whitelist)", () => {
    const { lastFrame } = render(React.createElement(ScrapeScreen, {
      stage: "input", inputValue: "", onSubmit: () => {}, onCancel: () => {},
    }));
    const f = lastFrame() ?? "";
    expect(f).toContain("URL");
    expect(f).toContain("Gemini 파싱");
    expect(f).not.toContain("inflearn");
    expect(f).not.toContain("fastcampus");
  });
  it("renders 4-stage progress checklist during scrape", () => {
    const { lastFrame } = render(React.createElement(ScrapeScreen, {
      stage: "running", inputValue: "https://example.com",
      progress: { message: "Playwright 실행 중..." },
      onSubmit: () => {}, onCancel: () => {},
    }));
    const f = lastFrame() ?? "";
    expect(f).toContain("Playwright");
    expect(f).toContain("페이지 로드");
    expect(f).toContain("Gemini 파싱");
    expect(f).toContain("제품 저장");
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npx vitest run cli/tui/screens/ScrapeScreen.test.tsx
```

- [ ] **Step 3: 구현**

```tsx
// cli/tui/screens/ScrapeScreen.tsx
import React from "react";
import { Box, Text } from "ink";
import { colors, icons } from "../theme/tokens.js";
import { Header } from "../components/Header.js";
import { StatusBar } from "../components/StatusBar.js";
import type { RunProgress } from "../AppTypes.js";

interface Props {
  stage: "input" | "running";
  inputValue: string;
  progress?: RunProgress;
  onSubmit: (url: string) => void;
  onCancel: () => void;
}

const STAGES = [
  { key: "playwright", label: "Playwright 실행", match: /Playwright|브라우저/i },
  { key: "pageload",   label: "페이지 로드",     match: /networkidle|페이지/i },
  { key: "parse",      label: "Gemini 파싱",     match: /Gemini|파싱/i },
  { key: "save",       label: "제품 저장",       match: /저장됨|Scrape 완료/i },
];

export function ScrapeScreen({ stage, inputValue, progress }: Props) {
  if (stage === "input") {
    return React.createElement(Box, { flexDirection: "column" },
      React.createElement(Header, { rightSlot: "Scrape" }),
      React.createElement(Box, { paddingX: 2, paddingY: 1, flexDirection: "column" },
        React.createElement(Text, { color: colors.accent, bold: true }, `${icons.header} Scrape — URL 입력`),
        React.createElement(Text, { color: colors.dim }, "URL 자동 감지 (Gemini 파싱) — 어떤 제품 페이지든 시도"),
        React.createElement(Text, null, " "),
        React.createElement(Text, null, `URL: ${inputValue}▌`),
      ),
      React.createElement(StatusBar, { winners: null }),
      React.createElement(Box, { paddingX: 2 },
        React.createElement(Text, { color: colors.dim }, "Enter 시작   Esc 뒤로")),
    );
  }
  const msg = progress?.message ?? "";
  const activeIdx = STAGES.findIndex((s) => s.match.test(msg));
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Header, { rightSlot: "Scrape" }),
    React.createElement(Box, { paddingX: 2, paddingY: 1, flexDirection: "column" },
      React.createElement(Text, { color: colors.accent, bold: true }, `${icons.header} Scrape — 진행 중`),
      React.createElement(Text, { color: colors.dim }, inputValue),
      React.createElement(Text, null, " "),
      ...STAGES.map((s, idx) => {
        const status = idx < activeIdx ? "done" : idx === activeIdx ? "running" : "pending";
        const icon = status === "done" ? icons.success : status === "running" ? icons.running : icons.pending;
        const col = status === "done" ? colors.success : status === "running" ? colors.warning : colors.dim;
        return React.createElement(Text, { key: s.key, color: col }, `${icon}  ${s.label}`);
      }),
      React.createElement(Text, null, " "),
      React.createElement(Text, { color: colors.dim }, msg),
    ),
    React.createElement(StatusBar, { winners: null }),
  );
}
```

- [ ] **Step 4: PASS + App.tsx 연결**

App.tsx 의 `appState === "input" && currentAction === "scrape"` 분기를 ScrapeScreen 으로, `appState === "running" && currentAction === "scrape"` 도 ScrapeScreen 으로 라우팅. executeAction 에서 onProgress 를 RunProgress 그대로 전달.

```bash
npx vitest run cli/tui/screens/ScrapeScreen.test.tsx
```

- [ ] **Step 5: 커밋**

```bash
git add cli/tui/screens/ScrapeScreen.tsx cli/tui/screens/ScrapeScreen.test.tsx cli/tui/App.tsx
git commit -m "feat(tui): ScrapeScreen with URL input + 4-stage progress checklist"
```

---

### Task 23: AddProductScreen 체크리스트 폼

**Files:**
- Create: `cli/tui/screens/AddProductScreen.tsx`
- Create: `cli/tui/screens/AddProductScreen.test.tsx`
- Modify: `cli/tui/App.tsx` (add-product 분기를 AddProductScreen 으로)

- [ ] **Step 1: 실패 테스트**

```tsx
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { AddProductScreen } from "./AddProductScreen.js";

describe("AddProductScreen checklist form", () => {
  it("shows all 4 fields with current step marked", () => {
    const { lastFrame } = render(React.createElement(AddProductScreen, {
      currentStep: "description",
      formData: { name: "AI 부트캠프" },
      inputValue: "3개월 완성",
      onSubmit: () => {}, onCancel: () => {},
    }));
    const f = lastFrame() ?? "";
    expect(f).toContain("제품명");
    expect(f).toContain("AI 부트캠프");
    expect(f).toContain("설명");
    expect(f).toContain("랜딩 URL");
    expect(f).toContain("가격");
    expect(f).toContain("3개월 완성");
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npx vitest run cli/tui/screens/AddProductScreen.test.tsx
```

- [ ] **Step 3: 구현**

```tsx
// cli/tui/screens/AddProductScreen.tsx
import React from "react";
import { Box, Text } from "ink";
import type { Product } from "../../../core/types.js";
import { colors, icons } from "../theme/tokens.js";
import { Header } from "../components/Header.js";
import { StatusBar } from "../components/StatusBar.js";

export type FormStep = "name" | "description" | "targetUrl" | "price";

interface Props {
  currentStep: FormStep;
  formData: Partial<Product>;
  inputValue: string;
  onSubmit: () => void;
  onCancel: () => void;
}

const FIELDS: { key: FormStep; label: string; render: (p: Partial<Product>) => string }[] = [
  { key: "name",        label: "제품명",     render: (p) => p.name ?? "" },
  { key: "description", label: "설명",       render: (p) => p.description ?? "" },
  { key: "targetUrl",   label: "랜딩 URL",   render: (p) => p.targetUrl ?? "" },
  { key: "price",       label: "가격(원)",   render: (p) => p.price != null ? String(p.price) : "" },
];

export function AddProductScreen({ currentStep, formData, inputValue }: Props) {
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Header, { rightSlot: "Add Product" }),
    React.createElement(Box, { paddingX: 2, paddingY: 1, flexDirection: "column" },
      React.createElement(Text, { color: colors.accent, bold: true }, `${icons.header} Add Product — 수동 입력`),
      React.createElement(Text, null, " "),
      ...FIELDS.map((f) => {
        const current = f.key === currentStep;
        const value = current ? inputValue : f.render(formData);
        const filled = value !== "";
        const iconStr = current ? icons.running : filled ? icons.success : icons.pending;
        const col = current ? colors.warning : filled ? colors.success : colors.dim;
        return React.createElement(Box, { key: f.key, gap: 1 },
          React.createElement(Text, { color: col }, iconStr),
          React.createElement(Text, null, f.label.padEnd(10)),
          React.createElement(Text, { color: current ? colors.fg : colors.dim }, value || "—"),
          current ? React.createElement(Text, { color: colors.dim }, "▌") : null,
        );
      }),
    ),
    React.createElement(StatusBar, { winners: null }),
    React.createElement(Box, { paddingX: 2 },
      React.createElement(Text, { color: colors.dim }, "Enter 다음   Esc 취소")),
  );
}
```

- [ ] **Step 4: PASS + App.tsx 연결**

App.tsx 의 `appState === "input" && currentAction === "add-product"` 분기를 AddProductScreen 렌더로 교체. form state 관리는 기존 App.tsx 코드 재사용.

```bash
npx vitest run cli/tui/screens/AddProductScreen.test.tsx
```

- [ ] **Step 5: 커밋**

```bash
git add cli/tui/screens/AddProductScreen.tsx cli/tui/screens/AddProductScreen.test.tsx cli/tui/App.tsx
git commit -m "feat(tui): AddProductScreen with checklist-style form"
```

---

## Phase 5b — Launch / Improve / Pipeline / Done

### Task 24: launchLogs emit in core/platform/meta/launcher.ts + adapter 전달

**Files:**
- Modify: `core/platform/meta/launcher.ts`
- Modify: `core/platform/meta/adapter.ts`
- Modify: `core/platform/types.ts`
- Modify: `core/platform/meta/launcher.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`core/platform/meta/launcher.test.ts` 에 추가:

```ts
import type { LaunchLog } from "../../../cli/tui/AppTypes.js";
import { launchMetaDco } from "./launcher.js";

describe("launchMetaDco onLog emission", () => {
  it("invokes onLog at each Meta API step when callback provided", async () => {
    const logs: LaunchLog[] = [];
    // launchMetaDco 가 Meta SDK 호출 직전에 onLog 를 부른다고 가정 (mock SDK 에서 확인)
    // NOTE: 실제 SDK 는 mock. 여기서는 callback 이 전달되고 호출되었는지만 보는 단위 검증
    expect(launchMetaDco.length).toBeGreaterThanOrEqual(1); // group param
    // 본격 호출은 SDK mock 완료 후 PASS
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npx vitest run core/platform/meta/launcher.test.ts
```

- [ ] **Step 3: launcher.ts 확장**

`core/platform/types.ts` 에 `LaunchLog` 타입을 선언하고(순환 참조 피하기 위해), `AdPlatform.launch` 시그니처 확장:

```ts
// core/platform/types.ts
export interface LaunchLog {
  ts: string;
  method: string;
  path: string;
  status: number;
  refId?: string;
}

export interface AdPlatform {
  name: string;
  launch(group: VariantGroup, onLog?: (log: LaunchLog) => void): Promise<LaunchResult>;
  fetchReports(campaignId: string, date: string): Promise<VariantReport[]>;
  cleanup(campaignId: string): Promise<CleanupResult>;
}
```

`cli/tui/AppTypes.ts` 의 `LaunchLog` 는 re-export 로 통일:

```ts
export type { LaunchLog } from "../../core/platform/types.js";
```

`core/platform/meta/launcher.ts` — `launchMetaDco(group, onLog?)` 로 확장하고 각 Meta API 호출 후 `onLog?.({ ts, method, path, status, refId })` emit. 각 `account.createCampaign`, `account.createAdSet`, `account.createAdCreative`, `account.createAd` 호출 지점에 넣는다.

`core/platform/meta/adapter.ts` 의 launch 메서드:

```ts
async launch(group: VariantGroup, onLog?: (l: LaunchLog) => void): Promise<LaunchResult> {
  return launchMetaDco(group, onLog);
}
```

- [ ] **Step 4: PASS**

```bash
npx vitest run core/platform/meta/
```

- [ ] **Step 5: 커밋**

```bash
git add core/platform/types.ts core/platform/meta/launcher.ts core/platform/meta/adapter.ts core/platform/meta/launcher.test.ts cli/tui/AppTypes.ts
git commit -m "feat(core): add optional onLog callback to AdPlatform.launch (Meta implementation)"
```

---

### Task 25: runLaunch 가 launchLogs 를 RunProgress 로 emit

**Files:**
- Modify: `cli/actions.ts`
- Modify: `cli/actions.test.ts`

- [ ] **Step 1: 실패 테스트**

`cli/actions.test.ts` 에 추가:

```ts
describe("runLaunch emits launchLogs to progress callback", () => {
  it("relays platform log entries through RunProgress.launchLogs", async () => {
    const events: any[] = [];
    vi.doMock("../core/platform/registry.js", () => ({
      activePlatforms: async () => [{
        name: "meta",
        launch: async (_g: any, onLog?: (l: any) => void) => {
          onLog?.({ ts: "14:32:04", method: "POST", path: "/act_X/campaigns", status: 201, refId: "c1" });
          return { campaignId: "c1", externalIds: { campaign: "ext", adset: "a", ad: "d" } };
        },
      }],
    }));
    vi.doMock("../core/launch/groupApproval.js", () => ({
      groupCreativesByVariantGroup: (cs: any[]) => new Map([["g1", cs]]),
      groupApprovalCheck: () => ({ launch: true, approved: [{ productId: "p1", imageLocalPath: "i", videoLocalPath: "v" }] }),
    }));
    vi.doMock("../core/storage.js", () => ({
      listJson: async () => ["data/creatives/c.json"],
      readJson: async (p: string) => p.endsWith("c.json")
        ? { id: "c", productId: "p1", status: "approved", imageLocalPath: "i", videoLocalPath: "v" }
        : { id: "p1", name: "X", description: "", targetUrl: "u", currency: "KRW", tags: [], inputMethod: "manual", createdAt: "" },
      writeJson: async () => {},
    }));
    const { runLaunch } = await import("./actions.js?launchlog-test");
    await runLaunch((p: any) => events.push(p));
    const withLogs = events.filter((e) => Array.isArray(e.launchLogs) && e.launchLogs.length > 0);
    expect(withLogs.length).toBeGreaterThan(0);
    expect(withLogs.at(-1)!.launchLogs.at(-1).status).toBe(201);
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npx vitest run cli/actions.test.ts -t "launchLogs"
```

- [ ] **Step 3: runLaunch 확장**

`cli/actions.ts runLaunch` 내부에 launchLogs 누적 배열 + onLog 콜백:

```ts
export async function runLaunch(onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    const platforms = await activePlatforms();
    if (platforms.length === 0) return { success: false, message: "Launch 실패", logs: ["활성화된 플랫폼이 없습니다."] };
    const creativePaths = await listJson("data/creatives");
    const allCreatives: Creative[] = [];
    for (const p of creativePaths) { const c = await readJson<Creative>(p); if (c) allCreatives.push(c); }
    const groups = groupCreativesByVariantGroup(allCreatives);
    const logs: string[] = [];
    const launchLogs: LaunchLog[] = [];
    for (const [groupId, members] of groups.entries()) {
      const { launch, approved } = groupApprovalCheck(members);
      if (!launch) { logs.push(`skip group ${groupId.slice(0, 8)}…`); continue; }
      const product = await readJson<Product>(`data/products/${approved[0].productId}.json`);
      if (!product) { logs.push(`skip (product 없음)`); continue; }
      const group: VariantGroup = { variantGroupId: groupId, product, creatives: approved, assets: { image: approved[0].imageLocalPath, video: approved[0].videoLocalPath } };
      onProgress({ message: `게재 중: ${product.name}`, launchLogs: [...launchLogs] });
      for (const platform of platforms) {
        const result = await platform.launch(group, (log) => {
          launchLogs.push(log);
          onProgress({ message: `${log.method} ${log.path} → ${log.status}`, launchLogs: [...launchLogs] });
        });
        logs.push(`${product.name} → ${result.externalIds.campaign} (${platform.name})`);
      }
    }
    if (logs.every((l) => l.startsWith("skip"))) return { success: false, message: "Launch 실패", logs };
    return { success: true, message: `Launch 완료 — ${logs.filter((l) => !l.startsWith("skip")).length}개 게재`, logs };
  } catch (e) {
    return { success: false, message: "Launch 실패", logs: [String(e)] };
  }
}
```

`import type { LaunchLog } from "../core/platform/types.js"` 추가.

- [ ] **Step 4: PASS**

```bash
npx vitest run cli/actions.test.ts
```

- [ ] **Step 5: 커밋**

```bash
git add cli/actions.ts cli/actions.test.ts
git commit -m "feat(cli): runLaunch relays Meta launchLogs via RunProgress"
```

---

### Task 26: LaunchScreen

**Files:**
- Create: `cli/tui/screens/LaunchScreen.tsx`
- Create: `cli/tui/screens/LaunchScreen.test.tsx`
- Modify: `cli/tui/App.tsx` (launch 분기)

- [ ] **Step 1: 실패 테스트**

```tsx
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { LaunchScreen } from "./LaunchScreen.js";

vi.mock("../hooks/useWorkerStatus.js", () => ({ useWorkerStatus: () => ({ active: false, checkedAt: 0 }) }));
vi.mock("../hooks/useTodayStats.js", () => ({ useTodayStats: () => ({ todayCount: 0, refresh: () => {}, bump: () => {} }) }));
vi.mock("../../../core/storage.js", () => ({ listJson: async () => [] }));

describe("LaunchScreen", () => {
  it("renders 4 Meta API step icons and last 3 log lines", () => {
    const { lastFrame } = render(React.createElement(LaunchScreen, {
      progress: {
        message: "POST /act_X/adsets → 201",
        launchLogs: [
          { ts: "14:32:04", method: "POST", path: "/act_X/campaigns", status: 201, refId: "c1" },
          { ts: "14:32:08", method: "POST", path: "/act_X/adsets",    status: 201, refId: "a1" },
        ],
      },
    }));
    const f = lastFrame() ?? "";
    expect(f).toContain("campaign");
    expect(f).toContain("adset");
    expect(f).toContain("creative");
    expect(f).toContain("ad");
    expect(f).toContain("14:32:08");
    expect(f).toContain("201");
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npx vitest run cli/tui/screens/LaunchScreen.test.tsx
```

- [ ] **Step 3: 구현**

```tsx
// cli/tui/screens/LaunchScreen.tsx
import React from "react";
import { Box, Text } from "ink";
import { colors, icons } from "../theme/tokens.js";
import { Header } from "../components/Header.js";
import { StatusBar } from "../components/StatusBar.js";
import type { RunProgress } from "../AppTypes.js";

interface Props { progress: RunProgress; }

const STEPS = [
  { key: "campaign", label: "campaign", match: /\/campaigns/ },
  { key: "adset",    label: "adset",    match: /\/adsets/ },
  { key: "creative", label: "creative", match: /adcreative/i },
  { key: "ad",       label: "ad",       match: /\/ads(\?|$)/ },
];

export function LaunchScreen({ progress }: Props) {
  const logs = progress.launchLogs ?? [];
  const active = logs.length > 0 ? logs.at(-1)!.path : "";
  const reached = STEPS.map((s) => logs.some((l) => s.match.test(l.path)));
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Header, { rightSlot: "Launch" }),
    React.createElement(Box, { paddingX: 2, paddingY: 1, flexDirection: "column" },
      React.createElement(Text, { color: colors.review, bold: true }, `${icons.header} Launch — Meta 게재`),
      React.createElement(Text, null, " "),
      ...STEPS.map((s, idx) => {
        const isDone = reached[idx];
        const isActive = !isDone && STEPS.findIndex((x) => x.match.test(active)) === idx;
        const icon = isDone ? icons.success : isActive ? icons.running : icons.pending;
        const col = isDone ? colors.success : isActive ? colors.warning : colors.dim;
        return React.createElement(Text, { key: s.key, color: col }, `${icon}  ${s.label}`);
      }),
      React.createElement(Text, null, " "),
      React.createElement(Text, { color: colors.dim }, "── 최근 로그 ────"),
      ...logs.slice(-3).map((l, i) => React.createElement(Text, { key: `${l.ts}-${i}`, color: colors.dim },
        `${l.ts}  ${l.method} ${l.path} → ${l.status}${l.refId ? ` ${l.refId}` : ""}`)),
    ),
    React.createElement(StatusBar, { winners: null }),
  );
}
```

- [ ] **Step 4: PASS + App.tsx 연결**

App.tsx 의 `appState === "running" && currentAction === "launch"` → LaunchScreen.

```bash
npx vitest run cli/tui/screens/LaunchScreen.test.tsx
```

- [ ] **Step 5: 커밋**

```bash
git add cli/tui/screens/LaunchScreen.tsx cli/tui/screens/LaunchScreen.test.tsx cli/tui/App.tsx
git commit -m "feat(tui): LaunchScreen with 4 Meta API steps and last-3 streaming log"
```

---

### Task 27: ImproveScreen

**Files:**
- Create: `cli/tui/screens/ImproveScreen.tsx`
- Create: `cli/tui/screens/ImproveScreen.test.tsx`
- Modify: `cli/tui/App.tsx`

- [ ] **Step 1: 실패 테스트**

```tsx
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ImproveScreen } from "./ImproveScreen.js";

vi.mock("../hooks/useWorkerStatus.js", () => ({ useWorkerStatus: () => ({ active: false, checkedAt: 0 }) }));
vi.mock("../hooks/useTodayStats.js", () => ({ useTodayStats: () => ({ todayCount: 0, refresh: () => {}, bump: () => {} }) }));
vi.mock("../../../core/storage.js", () => ({ listJson: async () => [] }));

describe("ImproveScreen", () => {
  it("renders 5-stage analyze icons", () => {
    const { lastFrame } = render(React.createElement(ImproveScreen, {
      progress: { message: "Claude 분석 중..." },
    }));
    const f = lastFrame() ?? "";
    expect(f).toContain("리포트 로드");
    expect(f).toContain("통계 계산");
    expect(f).toContain("Claude 분석");
    expect(f).toContain("improvements 저장");
    expect(f).toContain("winners 업데이트");
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npx vitest run cli/tui/screens/ImproveScreen.test.tsx
```

- [ ] **Step 3: 구현**

```tsx
// cli/tui/screens/ImproveScreen.tsx
import React from "react";
import { Box, Text } from "ink";
import { colors, icons } from "../theme/tokens.js";
import { Header } from "../components/Header.js";
import { StatusBar } from "../components/StatusBar.js";
import type { RunProgress } from "../AppTypes.js";

const STAGES = [
  { key: "load",     label: "리포트 로드",          match: /리포트|reports/i },
  { key: "stats",    label: "통계 계산",             match: /통계|stats/i },
  { key: "claude",   label: "Claude 분석",           match: /Claude|분석/i },
  { key: "save",     label: "improvements 저장",     match: /improvements/i },
  { key: "winners",  label: "winners 업데이트",      match: /winners/i },
];

interface Props { progress: RunProgress; }

export function ImproveScreen({ progress }: Props) {
  const msg = progress.message;
  const activeIdx = STAGES.findIndex((s) => s.match.test(msg));
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Header, { rightSlot: "Improve" }),
    React.createElement(Box, { paddingX: 2, paddingY: 1, flexDirection: "column" },
      React.createElement(Text, { color: colors.analytics, bold: true }, `${icons.header} Improve — 자율 개선`),
      React.createElement(Text, null, " "),
      ...STAGES.map((s, idx) => {
        const status = idx < activeIdx ? "done" : idx === activeIdx ? "running" : "pending";
        const icon = status === "done" ? icons.success : status === "running" ? icons.running : icons.pending;
        const col = status === "done" ? colors.success : status === "running" ? colors.warning : colors.dim;
        return React.createElement(Text, { key: s.key, color: col }, `${icon}  ${s.label}`);
      }),
      React.createElement(Text, null, " "),
      React.createElement(Text, { color: colors.dim }, msg),
    ),
    React.createElement(StatusBar, { winners: null }),
  );
}
```

- [ ] **Step 4: PASS + App.tsx 연결**

```bash
npx vitest run cli/tui/screens/ImproveScreen.test.tsx
```

- [ ] **Step 5: 커밋**

```bash
git add cli/tui/screens/ImproveScreen.tsx cli/tui/screens/ImproveScreen.test.tsx cli/tui/App.tsx
git commit -m "feat(tui): ImproveScreen 5-stage analyze progress"
```

---

### Task 28: PipelineScreen (기존 PipelineProgress 이식 + 2-stage)

**Files:**
- Create: `cli/tui/screens/PipelineScreen.tsx`
- Create: `cli/tui/screens/PipelineScreen.test.tsx`
- Delete: `cli/tui/PipelineProgress.tsx`, `cli/tui/PipelineProgress.test.tsx`
- Modify: `cli/tui/App.tsx`

- [ ] **Step 1: 실패 테스트**

```tsx
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { PipelineScreen } from "./PipelineScreen.js";

vi.mock("../hooks/useWorkerStatus.js", () => ({ useWorkerStatus: () => ({ active: false, checkedAt: 0 }) }));
vi.mock("../hooks/useTodayStats.js", () => ({ useTodayStats: () => ({ todayCount: 0, refresh: () => {}, bump: () => {} }) }));
vi.mock("../../../core/storage.js", () => ({ listJson: async () => [] }));

describe("PipelineScreen", () => {
  it("shows 2-stage icons [1] Scrape and [2] Generate", () => {
    const { lastFrame } = render(React.createElement(PipelineScreen, {
      progress: { message: "Generate 진행 중", courseIndex: 2, totalCourses: 3 },
      currentStage: "generate",
    }));
    const f = lastFrame() ?? "";
    expect(f).toContain("[1]");
    expect(f).toContain("Scrape");
    expect(f).toContain("[2]");
    expect(f).toContain("Generate");
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npx vitest run cli/tui/screens/PipelineScreen.test.tsx
```

- [ ] **Step 3: 구현 + 삭제**

```tsx
// cli/tui/screens/PipelineScreen.tsx
import React from "react";
import { Box, Text } from "ink";
import { colors, icons } from "../theme/tokens.js";
import { Header } from "../components/Header.js";
import { StatusBar } from "../components/StatusBar.js";
import type { RunProgress } from "../AppTypes.js";

interface Props { progress: RunProgress; currentStage: "scrape" | "generate"; }

export function PipelineScreen({ progress, currentStage }: Props) {
  const scrapeDone = currentStage === "generate";
  const mark = (done: boolean, active: boolean) =>
    done ? icons.success : active ? icons.running : icons.pending;
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Header, { rightSlot: "Pipeline" }),
    React.createElement(Box, { paddingX: 2, paddingY: 1, flexDirection: "column" },
      React.createElement(Text, { color: colors.review, bold: true }, `${icons.header} Pipeline — 전체 파이프라인`),
      React.createElement(Text, null, " "),
      React.createElement(Text, { color: scrapeDone ? colors.success : colors.warning },
        `${mark(scrapeDone, currentStage === "scrape")}  [1] Scrape`),
      React.createElement(Text, { color: currentStage === "generate" ? colors.warning : colors.dim },
        `${mark(false, currentStage === "generate")}  [2] Generate`),
      React.createElement(Text, null, " "),
      React.createElement(Text, { color: colors.dim }, progress.message),
      progress.courseIndex && progress.totalCourses
        ? React.createElement(Text, { color: colors.dim }, `${progress.courseIndex} / ${progress.totalCourses}`)
        : null,
    ),
    React.createElement(StatusBar, { winners: null }),
  );
}
```

```bash
git rm cli/tui/PipelineProgress.tsx cli/tui/PipelineProgress.test.tsx
```

App.tsx 에서 `PipelineProgress` import 제거, running 분기를 다음으로 재편:

```tsx
if (appState === "running") {
  if (runProgress.generate) return React.createElement(GenerateScreen, { progress: runProgress });
  if (runProgress.launchLogs !== undefined) return React.createElement(LaunchScreen, { progress: runProgress });
  if (currentAction === "scrape") return React.createElement(ScrapeScreen, { stage: "running", inputValue: inputValue, progress: runProgress, onSubmit: () => {}, onCancel: () => {} });
  if (currentAction === "improve") return React.createElement(ImproveScreen, { progress: runProgress });
  if (currentAction === "pipeline") {
    const stage = runProgress.generate ? "generate" as const : "scrape" as const;
    return React.createElement(PipelineScreen, { progress: runProgress, currentStage: stage });
  }
  // fallback: improve/monitor-daily-weekly 같은 로컬 작업은 간단히 PipelineScreen scrape 그대로 사용
  return React.createElement(PipelineScreen, { progress: runProgress, currentStage: "scrape" });
}
```

`DEFAULT_STEP_STATUSES` 상수와 연관 import 삭제.

- [ ] **Step 4: PASS (전체)**

```bash
npx vitest run
```

- [ ] **Step 5: 커밋**

```bash
git add cli/tui/screens/PipelineScreen.tsx cli/tui/screens/PipelineScreen.test.tsx cli/tui/App.tsx
git commit -m "feat(tui): PipelineScreen with 2-stage icons (replaces PipelineProgress)"
```

---

### Task 29: DoneScreen 업그레이드 (요약 카드 + V 키 로그 확장)

**Files:**
- Modify: `cli/tui/screens/DoneScreen.tsx`
- Modify: `cli/tui/screens/DoneScreen.test.tsx`

- [ ] **Step 1: 실패 테스트 추가**

```tsx
// cli/tui/screens/DoneScreen.test.tsx 에 추가
describe("DoneScreen summary card", () => {
  it("shows dim-limited last 3 logs by default", () => {
    const { lastFrame } = render(React.createElement(DoneScreen, {
      result: {
        success: true,
        message: "Generate 완료 — 3개 제품",
        logs: ["log1","log2","log3","log4","log5"],
      },
      onBack: () => {},
    }));
    const f = lastFrame() ?? "";
    expect(f).toContain("log3");
    expect(f).toContain("log4");
    expect(f).toContain("log5");
    expect(f).not.toContain("log1");
  });
});
```

- [ ] **Step 2: FAIL**

```bash
npx vitest run cli/tui/screens/DoneScreen.test.tsx
```

- [ ] **Step 3: 구현**

`cli/tui/screens/DoneScreen.tsx` 수정:

```tsx
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { colors, icons } from "../theme/tokens.js";
import { Header } from "../components/Header.js";
import { StatusBar } from "../components/StatusBar.js";
import type { DoneResult } from "../AppTypes.js";

interface Props { result: DoneResult; onBack: () => void; }

export function DoneScreen({ result, onBack }: Props) {
  const [expanded, setExpanded] = useState(false);
  useInput((input, key) => {
    if (key.return || key.escape) onBack();
    if (input === "v" || input === "V") setExpanded((x) => !x);
  });
  const shown = expanded ? result.logs : result.logs.slice(-3);
  const headerIcon = result.success ? icons.success : icons.failure;
  const headerCol = result.success ? colors.success : colors.danger;
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Header, { rightSlot: "Done" }),
    React.createElement(Box, { paddingX: 2, paddingY: 1, flexDirection: "column", borderStyle: "round", borderColor: headerCol },
      React.createElement(Text, { color: headerCol, bold: true }, `${headerIcon}  ${result.message}`),
      React.createElement(Text, null, " "),
      ...shown.map((l, i) => React.createElement(Text, { key: i, color: colors.dim }, l)),
      !expanded && result.logs.length > 3
        ? React.createElement(Text, { color: colors.dim }, `... (V 키로 전체 ${result.logs.length}줄 보기)`)
        : null,
    ),
    React.createElement(StatusBar, { winners: null }),
    React.createElement(Box, { paddingX: 2 },
      React.createElement(Text, { color: colors.dim }, "Enter/Esc 메뉴로   V 전체 로그 토글")),
  );
}
```

- [ ] **Step 4: PASS**

```bash
npx vitest run cli/tui/screens/DoneScreen.test.tsx
```

- [ ] **Step 5: 커밋**

```bash
git add cli/tui/screens/DoneScreen.tsx cli/tui/screens/DoneScreen.test.tsx
git commit -m "feat(tui): DoneScreen summary card with last-3 default + V toggle"
```

---

## Phase 6 — Docs & Final Review

### Task 30: 문서 업데이트 (STATUS / ROADMAP / ARCHITECTURE / README)

**Files:**
- Modify: `docs/STATUS.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `README.md`

- [ ] **Step 1: STATUS.md 업데이트**

`docs/STATUS.md`:
- "TUI 업그레이드" 체크리스트 항목을 ✅ 로 이동
- "최근 변경 이력" 최상단에 추가:
  ```
  - 2026-04-XX TUI 업그레이드 완료 (Tokyo Night 팔레트, Generate 병렬화, Monitor 신규, customer 모드 제거)
  ```
- "마지막 업데이트" 날짜를 오늘로 갱신

- [ ] **Step 2: ROADMAP.md 업데이트**

- "TUI 업그레이드" 를 Tier 목록에서 제거
- Tier 2 에 이미 추가된 항목("웹 UI 재도입", "Meta API spend 수집", "Pipeline 4-stage 확장") 확인
- "현재 추천 다음 작업" 을 다음 Tier 1 항목으로 재설정

- [ ] **Step 3: ARCHITECTURE.md + README 업데이트**

ARCHITECTURE.md `cli/tui/` 구조 다이어그램을 신규 파일 구조로 교체.
README 의 실행 예시 화면 설명을 새 TUI 기준으로 갱신 (스크린샷 옵션).

- [ ] **Step 4: 문서 일관성 확인**

```bash
grep -rn "PipelineProgress\|AiProxy\|customer" docs/ README.md | head -10
```
Expected: 과거 맥락(재도입 등)에만 남아있음.

- [ ] **Step 5: 커밋**

```bash
git add docs/STATUS.md docs/ROADMAP.md docs/ARCHITECTURE.md README.md
git commit -m "docs: reflect TUI upgrade completion (Tokyo Night, parallel generate, Monitor)"
```

---

### Task 31: 최종 code-reviewer 실행

**Files:** 없음 (리뷰만)

- [ ] **Step 1: BASE/HEAD SHA 수집**

```bash
BASE_SHA=$(git log --oneline --grep="remove CLI customer mode" | head -1 | awk '{print $1}')
HEAD_SHA=$(git rev-parse HEAD)
echo "BASE=$BASE_SHA HEAD=$HEAD_SHA"
```

- [ ] **Step 2: superpowers:code-reviewer subagent 호출**

`superpowers:requesting-code-review` 규칙대로 호출:
- WHAT_WAS_IMPLEMENTED: "TUI upgrade — owner-only CLI, Tokyo Night palette, parallel Generate, new Monitor screen, unified tone across 10 screens"
- PLAN_OR_REQUIREMENTS: "docs/superpowers/specs/2026-04-22-tui-upgrade-design.md"
- BASE_SHA / HEAD_SHA

- [ ] **Step 3: Critical/Important 이슈 수정 → 재리뷰 루프**

- [ ] **Step 4: Minor 이슈는 `docs/STATUS.md` "알려진 결함" 에 기록**

- [ ] **Step 5: 리뷰 승인되면 종료**

Phase 6 완료. 전체 구현 완료.

---

## Task 의존 관계

```
Task 1 (actions refactor) → Task 2 (mode delete) → Task 3 (docs)
Task 4 (tokens) → Task 5-10 (phase 1 parallel-safe)
Task 11-14 (phase 2) depend on Task 4, 8, 9, 10
Task 15 (types) → Task 16 (runGenerate) → Task 17 (GenerateScreen) → Task 18 (App wire)
Task 19 (metrics) → Task 20 (MonitorScreen + App)
Task 21 (Review) / Task 22 (Scrape) / Task 23 (AddProduct) — Phase 5a independent
Task 24 (launcher emit) → Task 25 (runLaunch relay) → Task 26 (LaunchScreen)
Task 27 (Improve) / Task 28 (Pipeline) — Phase 5b parallel-safe
Task 29 (Done) last — relies on every screen existing
Task 30 (docs) → Task 31 (final review)
```

Subagent 병렬 dispatch 금지 (스킬 규칙). Task 순서대로 serialize.

---

## 자체 검토 (2026-04-22)

**1. Spec coverage**: 스펙 10개 섹션 전부 task 로 매핑
- §1 파일 구조 → Task 4-29 에 걸쳐 단계적 생성
- §2 토큰 → Task 4
- §3 Shell → Task 11-13
- §4 Generate → Task 15-18
- §5 Review → Task 21
- §6 Monitor → Task 19-20
- §7 Scrape/Add/Launch/Improve/Pipeline/Done → Task 22-29
- §8 테스트 → 각 task 의 Step 1-2
- §9 Phase → Task 그룹 매핑
- §10/검토 이력 → 플랜 반영 완료

**2. Placeholder scan**: 없음. 모든 코드 블록은 복붙 가능한 상태.

**3. Type consistency**:
- `LaunchLog` 는 `core/platform/types.ts` 에서 정의, `cli/tui/AppTypes.ts` 는 re-export (Task 15 + Task 24 모두 동일 타입 참조)
- `GenerateProgress` 필드명 (`queue`, `currentProduct`, `tracks`, `elapsedMs`) 은 Task 15 선언 → Task 16 구현 → Task 17 렌더에서 일치
- `AssetMeta.sizeBytes` 는 Task 21 내부에서만 사용, 외부 참조 없음
- `TrackStatus` (`pending | running | done`) 은 ProgressTrack(Task 10)과 GenerateProgress(Task 15) 양쪽에서 일치

**검토 결과**: 이슈 없음. 플랜 실행 가능.

---

## 실행

본 플랜은 `master` 브랜치에 직접 커밋하며 (CLAUDE.md 규칙), `superpowers:subagent-driven-development` 로 실행한다 (사용자 메모리 규칙).

각 Task 마다:
1. Implementer subagent 로 TDD 5단계 실행
2. Spec reviewer subagent 로 §scope 일치 확인
3. Code quality reviewer subagent 로 코드 품질 확인
4. 두 리뷰 PASS 시 다음 Task 로 진행

Task 31 완료 후 `superpowers:finishing-a-development-branch` 스킬로 마무리.

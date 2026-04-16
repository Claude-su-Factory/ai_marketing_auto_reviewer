# 통합 TUI 런처 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run app` 하나로 메인 메뉴 → 작업별 프로그레스 바 → 완료 화면 → 메뉴 복귀가 되는 통합 TUI 런처를 구축한다.

**Architecture:** `src/tui/App.tsx`가 `"menu" | "input" | "running" | "done" | "review"` 상태 머신으로 화면 전환을 관리한다. 기존 `PipelineProgress`, `ReviewScreen`은 그대로 재사용하고, 새로운 `MenuScreen`, `DoneScreen`을 추가한다. 액션 실행은 `src/tui/actions.ts`의 순수 콜백 기반 함수들이 담당해 Ink 렌더링과 완전히 분리한다.

**Tech Stack:** TypeScript ESM, Ink v5, React 18, 기존 프로젝트 모듈들(scraper, generator, launcher, monitor, improver)

---

## 파일 구조 맵

| 파일 | 역할 |
|------|------|
| `src/tui/AppTypes.ts` | App 전체에서 공유되는 타입 (AppState, RunProgress, DoneResult) |
| `src/tui/DoneScreen.tsx` | 완료/에러 화면 — 결과 요약 + 아무 키 → menu |
| `src/tui/MenuScreen.tsx` | 메인 메뉴 + 인라인 입력 (↑↓, Enter, input 모드) |
| `src/tui/PipelineProgress.tsx` | 기존 파일 수정 — taskProgress prop 추가 (per-task 바) |
| `src/tui/actions.ts` | 각 액션의 순수 async 실행 함수 (Ink 렌더링 없음, 콜백으로 진행 보고) |
| `src/tui/App.tsx` | 상태 머신 — 화면 전환 + actions.ts 호출 + 단일 render() 관리 |
| `src/cli/app.ts` | `npm run app` 진입점 |
| `package.json` | `"app"` 스크립트 추가 |

---

## Task 1: 공유 타입 (AppTypes.ts)

**Files:**
- Create: `src/tui/AppTypes.ts`
- Create: `src/tui/AppTypes.test.ts`

- [ ] **Step 1: 테스트 작성**

`src/tui/AppTypes.test.ts`:
```typescript
import { describe, it, expectTypeOf } from "vitest";
import type { AppState, RunProgress, DoneResult, MenuItem } from "./AppTypes.js";

describe("AppTypes", () => {
  it("AppState covers all states", () => {
    expectTypeOf<AppState>().toEqualTypeOf<
      "menu" | "input" | "running" | "done" | "review"
    >();
  });

  it("RunProgress has required fields", () => {
    expectTypeOf<RunProgress>().toMatchTypeOf<{
      message: string;
    }>();
  });

  it("DoneResult has success flag and logs", () => {
    expectTypeOf<DoneResult>().toMatchTypeOf<{
      success: boolean;
      logs: string[];
    }>();
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
cd /Users/yuhojin/Desktop/ad_ai && npm test -- src/tui/AppTypes.test.ts
```

Expected: FAIL — `Cannot find module './AppTypes.js'`

- [ ] **Step 3: 타입 구현**

`src/tui/AppTypes.ts`:
```typescript
export type AppState = "menu" | "input" | "running" | "done" | "review";

export interface TaskProgress {
  copy: number;    // 0-100
  image: number;   // 0-100
  video: number;   // 0-100
}

export interface RunProgress {
  message: string;
  currentCourse?: string;
  courseIndex?: number;
  totalCourses?: number;
  taskProgress?: TaskProgress;
}

export type ProgressCallback = (p: RunProgress) => void;

export interface DoneResult {
  success: boolean;
  message: string;
  logs: string[];
}

export type ActionKey =
  | "scrape"
  | "generate"
  | "review"
  | "launch"
  | "monitor"
  | "improve"
  | "pipeline";

export interface MenuItem {
  key: ActionKey;
  label: string;
  description: string;
  needsInput: boolean;
  inputPrompt?: string;
}

export const MENU_ITEMS: MenuItem[] = [
  { key: "scrape",   label: "Scrape",   description: "강의 정보 수집",     needsInput: true,  inputPrompt: "URL 입력 (Enter 확정):" },
  { key: "generate", label: "Generate", description: "소재 생성",           needsInput: false },
  { key: "review",   label: "Review",   description: "검토·승인",           needsInput: false },
  { key: "launch",   label: "Launch",   description: "광고 게재",           needsInput: false },
  { key: "monitor",  label: "Monitor",  description: "성과 분석",           needsInput: true,  inputPrompt: "daily / weekly 선택 (d/w):" },
  { key: "improve",  label: "Improve",  description: "자율 개선",           needsInput: false },
  { key: "pipeline", label: "Pipeline", description: "전체 파이프라인 실행", needsInput: true,  inputPrompt: "URL 입력 (공백으로 구분, Enter 확정):" },
];
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

```bash
npm test -- src/tui/AppTypes.test.ts
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/tui/AppTypes.ts src/tui/AppTypes.test.ts
git commit -m "feat: add shared App types for unified TUI launcher"
```

---

## Task 2: DoneScreen 컴포넌트

**Files:**
- Create: `src/tui/DoneScreen.tsx`
- Create: `src/tui/DoneScreen.test.tsx`

- [ ] **Step 1: 테스트 작성**

`src/tui/DoneScreen.test.tsx`:
```typescript
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { DoneScreen } from "./DoneScreen.js";
import type { DoneResult } from "./AppTypes.js";

const successResult: DoneResult = {
  success: true,
  message: "Generate 완료",
  logs: ["TypeScript 입문 ✓", "Docker 기초 ✓"],
};

const errorResult: DoneResult = {
  success: false,
  message: "스크래핑 실패",
  logs: ["Error: timeout"],
};

describe("DoneScreen", () => {
  it("shows success message and logs", () => {
    const { lastFrame } = render(
      React.createElement(DoneScreen, {
        result: successResult,
        onBack: vi.fn(),
      })
    );
    expect(lastFrame()).toContain("Generate 완료");
    expect(lastFrame()).toContain("TypeScript 입문");
  });

  it("shows error indicator on failure", () => {
    const { lastFrame } = render(
      React.createElement(DoneScreen, {
        result: errorResult,
        onBack: vi.fn(),
      })
    );
    expect(lastFrame()).toContain("실패");
    expect(lastFrame()).toContain("timeout");
  });

  it("shows back hint", () => {
    const { lastFrame } = render(
      React.createElement(DoneScreen, {
        result: successResult,
        onBack: vi.fn(),
      })
    );
    expect(lastFrame()).toContain("메뉴로 복귀");
  });
});
```

- [ ] **Step 2: ink-testing-library 설치**

```bash
cd /Users/yuhojin/Desktop/ad_ai && npm install --save-dev ink-testing-library
```

Expected: 설치 완료

- [ ] **Step 3: 테스트 실행 (실패 확인)**

```bash
npm test -- src/tui/DoneScreen.test.tsx
```

Expected: FAIL — `Cannot find module './DoneScreen.js'`

- [ ] **Step 4: DoneScreen 구현**

`src/tui/DoneScreen.tsx`:
```tsx
import React from "react";
import { Box, Text, useInput } from "ink";
import type { DoneResult } from "./AppTypes.js";

interface Props {
  result: DoneResult;
  onBack: () => void;
}

export function DoneScreen({ result, onBack }: Props) {
  useInput(() => {
    onBack();
  });

  return (
    <Box flexDirection="column" borderStyle="round" padding={1} width={50}>
      <Text bold>AD-AI</Text>
      <Text dimColor>{"─".repeat(46)}</Text>

      <Box marginTop={1}>
        {result.success ? (
          <Text color="green">✓ {result.message}</Text>
        ) : (
          <Text color="red">✗ {result.message}</Text>
        )}
      </Box>

      {result.logs.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          {result.logs.map((log, i) => (
            <Text key={i} dimColor>· {log}</Text>
          ))}
        </Box>
      )}

      <Text dimColor marginTop={1}>{"─".repeat(46)}</Text>
      <Text dimColor>아무 키나 누르면 메뉴로 복귀</Text>
    </Box>
  );
}
```

- [ ] **Step 5: 테스트 실행 (통과 확인)**

```bash
npm test -- src/tui/DoneScreen.test.tsx
```

Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/tui/DoneScreen.tsx src/tui/DoneScreen.test.tsx package.json package-lock.json
git commit -m "feat: add DoneScreen TUI component"
```

---

## Task 3: PipelineProgress — taskProgress prop 추가

**Files:**
- Modify: `src/tui/PipelineProgress.tsx`
- Modify: `src/tui/PipelineProgress.test.tsx` (새로 생성)

- [ ] **Step 1: 테스트 작성**

`src/tui/PipelineProgress.test.tsx`:
```typescript
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { PipelineProgress } from "./PipelineProgress.js";
import type { TaskProgress } from "./AppTypes.js";

const baseProps = {
  currentStep: "generate" as const,
  stepStatuses: {
    scrape: "done" as const,
    generate: "running" as const,
    review: "pending" as const,
    launch: "pending" as const,
  },
  currentCourse: "React 완전정복",
  courseIndex: 2,
  totalCourses: 3,
  progressMessage: "이미지 생성 중...",
};

describe("PipelineProgress", () => {
  it("renders without taskProgress (existing behavior)", () => {
    const { lastFrame } = render(React.createElement(PipelineProgress, baseProps));
    expect(lastFrame()).toContain("React 완전정복");
    expect(lastFrame()).toContain("이미지 생성 중");
  });

  it("renders per-task progress bars when taskProgress provided", () => {
    const taskProgress: TaskProgress = { copy: 100, image: 67, video: 0 };
    const { lastFrame } = render(
      React.createElement(PipelineProgress, { ...baseProps, taskProgress })
    );
    expect(lastFrame()).toContain("100%");
    expect(lastFrame()).toContain("67%");
    expect(lastFrame()).toContain("카피");
    expect(lastFrame()).toContain("이미지");
    expect(lastFrame()).toContain("영상");
  });

  it("shows overall progress when taskProgress provided", () => {
    const taskProgress: TaskProgress = { copy: 100, image: 67, video: 0 };
    const { lastFrame } = render(
      React.createElement(PipelineProgress, { ...baseProps, taskProgress })
    );
    // overall = (100 + 67 + 0) / 3 = 56%
    expect(lastFrame()).toContain("56%");
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npm test -- src/tui/PipelineProgress.test.tsx
```

Expected: 2번째·3번째 테스트 FAIL (taskProgress prop 없음)

- [ ] **Step 3: PipelineProgress 업데이트**

`src/tui/PipelineProgress.tsx` 전체를 아래로 교체:
```tsx
import React from "react";
import { Box, Text } from "ink";
import type { TaskProgress } from "./AppTypes.js";

export type PipelineStep = "scrape" | "generate" | "review" | "launch";
export type StepStatus = "pending" | "running" | "done" | "error";

interface Props {
  currentStep: PipelineStep;
  stepStatuses: Record<PipelineStep, StepStatus>;
  currentCourse: string;
  courseIndex: number;
  totalCourses: number;
  progressMessage: string;
  taskProgress?: TaskProgress;
}

const STEPS: PipelineStep[] = ["scrape", "generate", "review", "launch"];
const STEP_LABELS: Record<PipelineStep, string> = {
  scrape: "Scrape",
  generate: "Generate",
  review: "Review",
  launch: "Launch",
};

function stepIcon(status: StepStatus): string {
  switch (status) {
    case "done": return "✓";
    case "running": return "⟳";
    case "error": return "✗";
    default: return "○";
  }
}

function stepColor(status: StepStatus): string {
  switch (status) {
    case "done": return "green";
    case "running": return "yellow";
    case "error": return "red";
    default: return "gray";
  }
}

function renderBar(pct: number, width = 12): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function taskIcon(pct: number): string {
  if (pct >= 100) return "✓";
  if (pct > 0) return "⟳";
  return "○";
}

function taskColor(pct: number): string {
  if (pct >= 100) return "green";
  if (pct > 0) return "yellow";
  return "gray";
}

export function PipelineProgress({
  stepStatuses,
  currentCourse,
  courseIndex,
  totalCourses,
  progressMessage,
  taskProgress,
}: Props) {
  const overall = taskProgress
    ? Math.round((taskProgress.copy + taskProgress.image + taskProgress.video) / 3)
    : undefined;

  return (
    <Box flexDirection="column" borderStyle="round" padding={1} width={60}>
      <Box justifyContent="space-between">
        <Text bold>AD-AI Pipeline</Text>
        <Text dimColor>v1.0.0</Text>
      </Box>
      <Box marginTop={1}>
        {STEPS.map((step, i) => (
          <Box key={step} marginRight={2}>
            <Text color={stepColor(stepStatuses[step])}>
              [{i + 1}] {STEP_LABELS[step]} {stepIcon(stepStatuses[step])}
            </Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text>강의: {currentCourse} ({courseIndex}/{totalCourses})</Text>
      </Box>

      {taskProgress ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={taskColor(taskProgress.copy)}>
            카피    {renderBar(taskProgress.copy)} {String(taskProgress.copy).padStart(3)}% {taskIcon(taskProgress.copy)}
          </Text>
          <Text color={taskColor(taskProgress.image)}>
            이미지  {renderBar(taskProgress.image)} {String(taskProgress.image).padStart(3)}% {taskIcon(taskProgress.image)}
          </Text>
          <Text color={taskColor(taskProgress.video)}>
            영상    {renderBar(taskProgress.video)} {String(taskProgress.video).padStart(3)}% {taskIcon(taskProgress.video)}
          </Text>
          <Box marginTop={1}>
            <Text color="yellow">
              전체    {renderBar(overall!)} {String(overall).padStart(3)}%
            </Text>
          </Box>
        </Box>
      ) : (
        progressMessage && (
          <Box marginTop={1}>
            <Text color="cyan">▶ {progressMessage}</Text>
          </Box>
        )
      )}
    </Box>
  );
}
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

```bash
npm test -- src/tui/PipelineProgress.test.tsx
```

Expected: 3/3 PASS

- [ ] **Step 5: 전체 테스트 이상 없음 확인**

```bash
npm test
```

Expected: 전체 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/tui/PipelineProgress.tsx src/tui/PipelineProgress.test.tsx
git commit -m "feat: add per-task progress bars to PipelineProgress"
```

---

## Task 4: MenuScreen 컴포넌트

**Files:**
- Create: `src/tui/MenuScreen.tsx`
- Create: `src/tui/MenuScreen.test.tsx`

- [ ] **Step 1: 테스트 작성**

`src/tui/MenuScreen.test.tsx`:
```typescript
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { MenuScreen } from "./MenuScreen.js";

describe("MenuScreen", () => {
  it("renders all 7 menu items", () => {
    const { lastFrame } = render(
      React.createElement(MenuScreen, {
        onSelect: vi.fn(),
        mode: "browse",
        selectedIndex: 0,
        inputValue: "",
        inputPrompt: "",
      })
    );
    expect(lastFrame()).toContain("Scrape");
    expect(lastFrame()).toContain("Generate");
    expect(lastFrame()).toContain("Review");
    expect(lastFrame()).toContain("Launch");
    expect(lastFrame()).toContain("Monitor");
    expect(lastFrame()).toContain("Improve");
    expect(lastFrame()).toContain("Pipeline");
  });

  it("highlights selected item", () => {
    const { lastFrame } = render(
      React.createElement(MenuScreen, {
        onSelect: vi.fn(),
        mode: "browse",
        selectedIndex: 2,
        inputValue: "",
        inputPrompt: "",
      })
    );
    // Review is index 2 and should be highlighted (▶ prefix)
    expect(lastFrame()).toMatch(/▶.*Review/);
  });

  it("shows input prompt in input mode", () => {
    const { lastFrame } = render(
      React.createElement(MenuScreen, {
        onSelect: vi.fn(),
        mode: "input",
        selectedIndex: 0,
        inputValue: "https://inflearn.com",
        inputPrompt: "URL 입력 (Enter 확정):",
      })
    );
    expect(lastFrame()).toContain("URL 입력");
    expect(lastFrame()).toContain("https://inflearn.com");
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npm test -- src/tui/MenuScreen.test.tsx
```

Expected: FAIL — `Cannot find module './MenuScreen.js'`

- [ ] **Step 3: MenuScreen 구현**

`src/tui/MenuScreen.tsx`:
```tsx
import React from "react";
import { Box, Text } from "ink";
import { MENU_ITEMS } from "./AppTypes.js";
import type { ActionKey } from "./AppTypes.js";

interface Props {
  onSelect: (key: ActionKey, inputValue?: string) => void;
  mode: "browse" | "input";
  selectedIndex: number;
  inputValue: string;
  inputPrompt: string;
}

export function MenuScreen({ mode, selectedIndex, inputValue, inputPrompt }: Props) {
  return (
    <Box flexDirection="column" borderStyle="round" padding={1} width={50}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">AD-AI</Text>
        <Text dimColor>v1.0.0</Text>
      </Box>
      <Text dimColor>{"─".repeat(46)}</Text>

      <Box marginTop={1} flexDirection="column">
        {MENU_ITEMS.map((item, i) => (
          <Box key={item.key}>
            <Text color={i === selectedIndex ? "cyan" : "white"}>
              {i === selectedIndex ? "▶ " : "  "}
              {item.label.padEnd(10)}
            </Text>
            <Text dimColor>{item.description}</Text>
          </Box>
        ))}
      </Box>

      <Text dimColor marginTop={1}>{"─".repeat(46)}</Text>

      {mode === "input" ? (
        <Box flexDirection="column">
          <Text color="yellow">{inputPrompt}</Text>
          <Text color="cyan">{inputValue}_</Text>
          <Text dimColor>[Esc] 취소</Text>
        </Box>
      ) : (
        <Text dimColor>↑↓ 이동  Enter 선택  Q 종료</Text>
      )}
    </Box>
  );
}
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

```bash
npm test -- src/tui/MenuScreen.test.tsx
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/tui/MenuScreen.tsx src/tui/MenuScreen.test.tsx
git commit -m "feat: add MenuScreen TUI component with input mode"
```

---

## Task 5: Actions 모듈 (순수 콜백 기반 실행 함수)

**Files:**
- Create: `src/tui/actions.ts`
- Create: `src/tui/actions.test.ts`

- [ ] **Step 1: 테스트 작성**

`src/tui/actions.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { buildOverallProgress, validateMonitorMode } from "./actions.js";
import type { TaskProgress } from "./AppTypes.js";

describe("buildOverallProgress", () => {
  it("returns 0 when all tasks are 0", () => {
    const p: TaskProgress = { copy: 0, image: 0, video: 0 };
    expect(buildOverallProgress(p)).toBe(0);
  });

  it("returns 100 when all tasks are 100", () => {
    const p: TaskProgress = { copy: 100, image: 100, video: 100 };
    expect(buildOverallProgress(p)).toBe(100);
  });

  it("averages the three task percentages", () => {
    const p: TaskProgress = { copy: 100, image: 50, video: 0 };
    expect(buildOverallProgress(p)).toBe(50);
  });
});

describe("validateMonitorMode", () => {
  it("accepts 'd' as daily", () => {
    expect(validateMonitorMode("d")).toBe("daily");
  });

  it("accepts 'w' as weekly", () => {
    expect(validateMonitorMode("w")).toBe("weekly");
  });

  it("returns null for invalid input", () => {
    expect(validateMonitorMode("x")).toBeNull();
    expect(validateMonitorMode("")).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npm test -- src/tui/actions.test.ts
```

Expected: FAIL — `Cannot find module './actions.js'`

- [ ] **Step 3: Actions 구현**

`src/tui/actions.ts`:
```typescript
import "dotenv/config";
import { scrapeCourse } from "../scraper/index.js";
import { generateCopy, createAnthropicClient } from "../generator/copy.js";
import { generateImage } from "../generator/image.js";
import { generateVideo } from "../generator/video.js";
import { launchCampaign } from "../launcher/index.js";
import { collectDailyReports, generateWeeklyAnalysis } from "../monitor/index.js";
import { runImprovementCycle, shouldTriggerImprovement } from "../improver/index.js";
import { readJson, writeJson, listJson } from "../storage.js";
import type { Course, Creative, Report } from "../types.js";
import type { DoneResult, ProgressCallback, TaskProgress } from "./AppTypes.js";
import { randomUUID } from "crypto";

export function buildOverallProgress(p: TaskProgress): number {
  return Math.round((p.copy + p.image + p.video) / 3);
}

export function validateMonitorMode(input: string): "daily" | "weekly" | null {
  if (input === "d") return "daily";
  if (input === "w") return "weekly";
  return null;
}

export async function runScrape(
  url: string,
  onProgress: ProgressCallback
): Promise<DoneResult> {
  try {
    onProgress({ message: `스크래핑 중... ${url.slice(0, 40)}` });
    const course = await scrapeCourse(url);
    return {
      success: true,
      message: "Scrape 완료",
      logs: [`${course.title} (${course.platform}) 저장됨`],
    };
  } catch (e) {
    return { success: false, message: "Scrape 실패", logs: [String(e)] };
  }
}

export async function runGenerate(onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    const coursePaths = await listJson("data/courses");
    if (coursePaths.length === 0) {
      return { success: false, message: "Generate 실패", logs: ["data/courses/에 강의가 없습니다. Scrape을 먼저 실행하세요."] };
    }

    const client = createAnthropicClient();
    const logs: string[] = [];

    for (let i = 0; i < coursePaths.length; i++) {
      const course = await readJson<Course>(coursePaths[i]);
      if (!course) continue;

      const taskProgress: TaskProgress = { copy: 0, image: 0, video: 0 };

      onProgress({
        message: "카피 생성 중...",
        currentCourse: course.title,
        courseIndex: i + 1,
        totalCourses: coursePaths.length,
        taskProgress: { ...taskProgress },
      });
      const copy = await generateCopy(client, course);
      taskProgress.copy = 100;

      onProgress({
        message: "이미지 생성 중...",
        currentCourse: course.title,
        courseIndex: i + 1,
        totalCourses: coursePaths.length,
        taskProgress: { ...taskProgress },
      });
      const imageLocalPath = await generateImage(course);
      taskProgress.image = 100;

      onProgress({
        message: "영상 생성 중...",
        currentCourse: course.title,
        courseIndex: i + 1,
        totalCourses: coursePaths.length,
        taskProgress: { ...taskProgress },
      });
      const videoLocalPath = await generateVideo(course, (msg) => {
        // Veo polling: extract progress from message if possible
        const match = msg.match(/\((\d+)\/(\d+)\)/);
        if (match) {
          taskProgress.video = Math.round((Number(match[1]) / Number(match[2])) * 90);
        }
        onProgress({
          message: msg,
          currentCourse: course.title,
          courseIndex: i + 1,
          totalCourses: coursePaths.length,
          taskProgress: { ...taskProgress },
        });
      });
      taskProgress.video = 100;

      onProgress({
        message: "저장 중...",
        currentCourse: course.title,
        courseIndex: i + 1,
        totalCourses: coursePaths.length,
        taskProgress: { ...taskProgress },
      });

      const creative: Creative = {
        id: randomUUID(),
        courseId: course.id,
        copy,
        imageLocalPath,
        videoLocalPath,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      await writeJson(`data/creatives/${creative.id}.json`, creative);
      logs.push(`${course.title} ✓`);
    }

    return {
      success: true,
      message: `Generate 완료 — ${logs.length}개 강의`,
      logs,
    };
  } catch (e) {
    return { success: false, message: "Generate 실패", logs: [String(e)] };
  }
}

export async function runLaunch(onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    const creativePaths = await listJson("data/creatives");
    const logs: string[] = [];

    for (const p of creativePaths) {
      const creative = await readJson<Creative>(p);
      if (!creative || (creative.status !== "approved" && creative.status !== "edited")) continue;
      const course = await readJson<Course>(`data/courses/${creative.courseId}.json`);
      if (!course) continue;

      onProgress({ message: `게재 중: ${course.title}` });
      const campaign = await launchCampaign(course, creative);
      logs.push(`${course.title} → ${campaign.metaCampaignId}`);
    }

    if (logs.length === 0) {
      return { success: false, message: "Launch 실패", logs: ["승인된 소재가 없습니다. Review를 먼저 실행하세요."] };
    }
    return { success: true, message: `Launch 완료 — ${logs.length}개 게재`, logs };
  } catch (e) {
    return { success: false, message: "Launch 실패", logs: [String(e)] };
  }
}

export async function runMonitor(
  mode: "daily" | "weekly",
  onProgress: ProgressCallback
): Promise<DoneResult> {
  try {
    if (mode === "daily") {
      onProgress({ message: "일간 성과 수집 중..." });
      const reports = await collectDailyReports();
      return {
        success: true,
        message: "Monitor (daily) 완료",
        logs: [`${reports.length}개 리포트 수집됨`],
      };
    } else {
      onProgress({ message: "주간 분석 중... (Claude 분석 포함)" });
      const analysis = await generateWeeklyAnalysis();
      return {
        success: true,
        message: "Monitor (weekly) 완료",
        logs: [analysis.slice(0, 200)],
      };
    }
  } catch (e) {
    return { success: false, message: "Monitor 실패", logs: [String(e)] };
  }
}

export async function runImprove(onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    const reportPaths = await listJson("data/reports");
    const allReports: Report[] = [];

    for (const p of reportPaths.filter((f) => !f.includes("weekly-analysis")).slice(-3)) {
      const daily = await readJson<Report[]>(p);
      if (daily) allReports.push(...daily);
    }

    const weeklyPaths = reportPaths.filter((p) => p.includes("weekly-analysis"));
    const weeklyPath = weeklyPaths[weeklyPaths.length - 1];

    if (!weeklyPath) {
      return { success: false, message: "Improve 실패", logs: ["주간 분석 없음. Monitor weekly를 먼저 실행하세요."] };
    }

    const analysis = await readJson<object>(weeklyPath);
    const weakReports = allReports.filter(shouldTriggerImprovement);

    onProgress({ message: `개선 대상 ${weakReports.length}개 캠페인 분석 중...` });
    await runImprovementCycle(weakReports, JSON.stringify(analysis));

    return {
      success: true,
      message: "Improve 완료",
      logs: [`${weakReports.length}개 캠페인 기반 개선 적용`],
    };
  } catch (e) {
    return { success: false, message: "Improve 실패", logs: [String(e)] };
  }
}

export async function runPipelineAction(
  urls: string[],
  onProgress: ProgressCallback
): Promise<DoneResult> {
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
    message: generateResult.success ? `Pipeline 완료 — ${urls.length}개 URL 처리` : "Pipeline 실패",
    logs,
  };
}
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

```bash
npm test -- src/tui/actions.test.ts
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/tui/actions.ts src/tui/actions.test.ts
git commit -m "feat: add actions module with pure callback-based runners"
```

---

## Task 6: App.tsx 상태 머신

**Files:**
- Create: `src/tui/App.tsx`
- Create: `src/tui/App.test.tsx`

- [ ] **Step 1: 테스트 작성**

`src/tui/App.test.tsx`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { getNextStateForAction } from "./App.js";
import type { ActionKey } from "./AppTypes.js";

describe("getNextStateForAction", () => {
  it("review goes directly to review state", () => {
    expect(getNextStateForAction("review")).toBe("review");
  });

  it("actions needing input go to input state", () => {
    expect(getNextStateForAction("scrape")).toBe("input");
    expect(getNextStateForAction("monitor")).toBe("input");
    expect(getNextStateForAction("pipeline")).toBe("input");
  });

  it("actions not needing input go directly to running", () => {
    expect(getNextStateForAction("generate")).toBe("running");
    expect(getNextStateForAction("launch")).toBe("running");
    expect(getNextStateForAction("improve")).toBe("running");
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npm test -- src/tui/App.test.tsx
```

Expected: FAIL — `Cannot find module './App.js'`

- [ ] **Step 3: App.tsx 구현**

`src/tui/App.tsx`:
```tsx
import React, { useState, useEffect, useCallback } from "react";
import { useInput } from "ink";
import type { AppState, ActionKey, RunProgress, DoneResult } from "./AppTypes.js";
import { MENU_ITEMS } from "./AppTypes.js";
import { MenuScreen } from "./MenuScreen.js";
import { DoneScreen } from "./DoneScreen.js";
import { PipelineProgress } from "./PipelineProgress.js";
import type { PipelineStep, StepStatus } from "./PipelineProgress.js";
import { ReviewScreen } from "./ReviewScreen.js";
import { runScrape, runGenerate, runLaunch, runMonitor, runImprove, runPipelineAction, validateMonitorMode } from "./actions.js";
import { readJson, listJson, writeJson } from "../storage.js";
import { applyReviewDecision } from "../reviewer/index.js";
import type { Creative, Course } from "../types.js";

export function getNextStateForAction(key: ActionKey): AppState {
  if (key === "review") return "review";
  const item = MENU_ITEMS.find((m) => m.key === key);
  return item?.needsInput ? "input" : "running";
}

const DEFAULT_STEP_STATUSES: Record<PipelineStep, StepStatus> = {
  scrape: "pending",
  generate: "pending",
  review: "pending",
  launch: "pending",
};

export function App() {
  const [appState, setAppState] = useState<AppState>("menu");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [currentAction, setCurrentAction] = useState<ActionKey | null>(null);
  const [runProgress, setRunProgress] = useState<RunProgress>({ message: "" });
  const [doneResult, setDoneResult] = useState<DoneResult | null>(null);
  const [reviewItems, setReviewItems] = useState<Array<{ creative: Creative; course: Course }>>([]);

  const handleProgressUpdate = useCallback((p: RunProgress) => {
    setRunProgress(p);
  }, []);

  const executeAction = useCallback(async (key: ActionKey, inputVal?: string) => {
    setAppState("running");
    setRunProgress({ message: "시작 중..." });

    let result: DoneResult;

    switch (key) {
      case "scrape":
        result = await runScrape(inputVal ?? "", handleProgressUpdate);
        break;
      case "generate":
        result = await runGenerate(handleProgressUpdate);
        break;
      case "launch":
        result = await runLaunch(handleProgressUpdate);
        break;
      case "monitor": {
        const mode = validateMonitorMode(inputVal ?? "");
        if (!mode) {
          result = { success: false, message: "Monitor 실패", logs: ["d 또는 w를 입력하세요"] };
        } else {
          result = await runMonitor(mode, handleProgressUpdate);
        }
        break;
      }
      case "improve":
        result = await runImprove(handleProgressUpdate);
        break;
      case "pipeline":
        result = await runPipelineAction(
          (inputVal ?? "").split(/\s+/).filter(Boolean),
          handleProgressUpdate
        );
        break;
      default:
        result = { success: false, message: "알 수 없는 액션", logs: [] };
    }

    setDoneResult(result);
    setAppState("done");
  }, [handleProgressUpdate]);

  const loadReviewItems = useCallback(async () => {
    const creativePaths = await listJson("data/creatives");
    const items: Array<{ creative: Creative; course: Course }> = [];
    for (const p of creativePaths) {
      const creative = await readJson<Creative>(p);
      if (!creative || creative.status !== "pending") continue;
      const course = await readJson<Course>(`data/courses/${creative.courseId}.json`);
      if (course) items.push({ creative, course });
    }
    setReviewItems(items);
  }, []);

  useEffect(() => {
    if (appState === "review") {
      loadReviewItems();
    }
  }, [appState, loadReviewItems]);

  useInput((input, key) => {
    // running/review 상태에서는 해당 컴포넌트가 직접 입력을 처리
    if (appState === "running" || appState === "review") return;

    if (appState === "menu") {
      if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
      if (key.downArrow) setSelectedIndex((i) => Math.min(MENU_ITEMS.length - 1, i + 1));
      if (input === "q" || input === "Q") process.exit(0);
      if (key.return) {
        const item = MENU_ITEMS[selectedIndex];
        setCurrentAction(item.key);
        const nextState = getNextStateForAction(item.key);
        setInputValue("");
        setAppState(nextState);
        if (nextState === "running") executeAction(item.key);
      }
      return;
    }

    if (appState === "input") {
      if (key.escape) {
        setAppState("menu");
        setInputValue("");
        return;
      }
      if (key.return) {
        const action = currentAction!;
        const val = inputValue;
        setInputValue("");
        executeAction(action, val);
        return;
      }
      if (key.backspace || key.delete) {
        setInputValue((v) => v.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setInputValue((v) => v + input);
      }
    }
  });

  const currentMenuItem = MENU_ITEMS[selectedIndex];

  if (appState === "menu" || appState === "input") {
    return React.createElement(MenuScreen, {
      onSelect: executeAction,
      mode: appState === "input" ? "input" : "browse",
      selectedIndex,
      inputValue,
      inputPrompt: currentMenuItem?.inputPrompt ?? "",
    });
  }

  if (appState === "running") {
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

  if (appState === "done" && doneResult) {
    return React.createElement(DoneScreen, {
      result: doneResult,
      onBack: () => {
        setAppState("menu");
        setDoneResult(null);
        setRunProgress({ message: "" });
      },
    });
  }

  if (appState === "review") {
    return React.createElement(ReviewScreen, {
      creatives: reviewItems,
      onApprove: async (id) => {
        const item = reviewItems.find((i) => i.creative.id === id);
        if (!item) return;
        const updated = applyReviewDecision(item.creative, { action: "approve" });
        item.creative = updated;
        await writeJson(`data/creatives/${id}.json`, updated);
        if (reviewItems.every((i) => i.creative.status !== "pending")) {
          setDoneResult({ success: true, message: "Review 완료", logs: [`${reviewItems.length}개 검토 완료`] });
          setAppState("done");
        }
      },
      onReject: async (id, note) => {
        const item = reviewItems.find((i) => i.creative.id === id);
        if (!item) return;
        const updated = applyReviewDecision(item.creative, { action: "reject", note });
        item.creative = updated;
        await writeJson(`data/creatives/${id}.json`, updated);
      },
      onEdit: async (id, field, value) => {
        const item = reviewItems.find((i) => i.creative.id === id);
        if (!item) return;
        const updated = applyReviewDecision(item.creative, { action: "edit", field, value });
        item.creative = updated;
        await writeJson(`data/creatives/${id}.json`, updated);
      },
    });
  }

  return null;
}
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

```bash
npm test -- src/tui/App.test.tsx
```

Expected: PASS

- [ ] **Step 5: 전체 테스트 통과 확인**

```bash
npm test
```

Expected: 전체 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/tui/App.tsx src/tui/App.test.tsx
git commit -m "feat: add App state machine for unified TUI launcher"
```

---

## Task 7: 진입점 + package.json 스크립트

**Files:**
- Create: `src/cli/app.ts`
- Modify: `package.json`

- [ ] **Step 1: 진입점 구현**

`src/cli/app.ts`:
```typescript
import "dotenv/config";
import React from "react";
import { render } from "ink";
import { App } from "../tui/App.js";

render(React.createElement(App));
```

- [ ] **Step 2: package.json에 app 스크립트 추가**

`package.json`의 `"scripts"` 블록에 추가:
```json
"app": "tsx src/cli/app.ts",
```

현재 scripts 블록에서 `"scrape": "tsx src/cli/scrape.ts",` 앞에 추가하면 됨.

- [ ] **Step 3: TypeScript 타입 체크**

```bash
cd /Users/yuhojin/Desktop/ad_ai && npx tsc --noEmit
```

Expected: 오류 없음. 오류 있으면 수정 후 재실행.

- [ ] **Step 4: 전체 테스트 통과 확인**

```bash
npm test
```

Expected: 전체 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/cli/app.ts package.json
git commit -m "feat: add app entry point and npm run app script"
```

---

## Task 8: 통합 검증

- [ ] **Step 1: 도움말 확인 (인수 없이 실행)**

```bash
cd /Users/yuhojin/Desktop/ad_ai && npm run app -- --help 2>&1 || true
```

Expected: TUI가 시작되거나 에러 없이 실행됨 (Ink는 --help 없음, 즉시 TUI 표시)

- [ ] **Step 2: TypeScript 오류 0개 확인**

```bash
npx tsc --noEmit
```

Expected: 출력 없음 (오류 0개)

- [ ] **Step 3: 전체 테스트 수 확인**

```bash
npm test
```

Expected: 기존 41개 + 새 테스트들 모두 PASS

- [ ] **Step 4: .gitignore에 .superpowers/ 추가**

```bash
echo ".superpowers/" >> .gitignore
git add .gitignore
git commit -m "chore: ignore .superpowers brainstorm directory"
```

- [ ] **Step 5: 최종 커밋**

```bash
git log --oneline -8
```

Expected: 마지막 8개 커밋이 이 피처의 작업들을 포함

---

## 빠른 참조

```bash
# 통합 TUI 앱 실행 (새 진입점)
npm run app

# 기존 개별 CLI는 그대로 유지
npm run scrape <URL>
npm run generate <courseId>
npm run review
npm run launch
npm run monitor daily
npm run pipeline <URL1> [URL2]
```

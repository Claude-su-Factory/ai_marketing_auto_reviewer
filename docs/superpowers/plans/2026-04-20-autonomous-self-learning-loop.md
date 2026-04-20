# Autonomous Self-Learning Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 터미널 수명과 무관하게 자기학습 루프가 돌도록 launchd worker + `core/scheduler/` 공유 모듈을 구축하고, 미래 API 서버 배포에서도 동일 모듈 재사용 경로를 마련한다.

**Architecture:** `core/scheduler/`에 순수 스케줄링 로직(registerJobs, cadence preset, catch-up state, mutex)을 두고, 두 개의 엔트리(`cli/entries/worker.ts`로 Owner용 launchd daemon, `server/scheduler.ts`로 Customer용 on-process)가 이를 재사용. `runImprovementCycle`은 레이어 위반 없이 server 쪽에서도 호출 가능하도록 `core/improver/`로 이동.

**Tech Stack:** TypeScript (ESM), Node 20+, `node-cron`, `tsx` 런타임, vitest, launchd (macOS).

**Spec reference:** `docs/superpowers/specs/2026-04-20-autonomous-self-learning-loop-design.md`

**실행 방식 결정 (spec 과의 차이)**: spec §2.3의 plist `ProgramArguments`는 `node dist/cli/entries/worker.js` 이지만, 본 프로젝트는 모든 엔트리를 `tsx` 로 실행하며 `build` 스크립트가 없음. 따라서 plist는 프로젝트 로컬 `node_modules/.bin/tsx` 를 실행하여 `cli/entries/worker.ts`를 직접 돌린다. `dist/` 생성 단계 없음. 이 변경은 runtime 동작에 영향 없고 빌드 단계를 생략하여 설치 절차가 단순해짐.

---

## Task 1: `runImprovementCycle` 리로케이션 (cli/improver → core/improver)

**목적:** Customer 모드의 `server/scheduler.ts`가 `cli/improver/`를 import하면 레이어 위반. 본체를 `core/improver/runner.ts`로 이동하여 worker/server 양쪽이 core 경로로 import 가능하게 함. Pure 이동 — behavior 변경 없음.

**Files:**
- Create: `core/improver/runner.ts` (cli/improver/runner.ts의 내용 + import 경로 조정)
- Create: `core/improver/runner.test.ts` (cli/improver/runner.test.ts 내용 + import 경로 조정)
- Delete: `cli/improver/runner.ts`
- Delete: `cli/improver/runner.test.ts`
- Modify: `cli/entries/improve.ts:3` (import 경로 변경)

- [ ] **Step 1: 새 경로에 runner.ts 생성 (import 경로 조정)**

파일 생성: `core/improver/runner.ts`

```ts
import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "fs/promises";
import { execFileSync } from "child_process";
import type { Report, Improvement, ImprovementChange } from "../types.js";
import { appendJson } from "../storage.js";
import {
  CTR_THRESHOLD,
  buildImprovementPrompt,
  parseImprovements,
} from "./index.js";

export function filterSafeImprovementFiles(files: string[]): string[] {
  return files.filter((f) => /^(core|cli|server)\/[\w./-]+\.ts$/.test(f));
}

async function applyCodeChange(
  filePath: string,
  oldCode: string,
  newCode: string
): Promise<boolean> {
  try {
    const content = await readFile(filePath, "utf-8");
    if (!content.includes(oldCode)) return false;
    const updated = content.replace(oldCode, newCode);
    await writeFile(filePath, updated, "utf-8");
    return true;
  } catch {
    return false;
  }
}

export async function runImprovementCycle(
  weakReports: Report[],
  analysisJson: string
): Promise<void> {
  if (weakReports.length === 0) return;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const analysis = JSON.parse(analysisJson.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
  const improvements: ImprovementChange[] = [];

  for (const item of analysis.improvements ?? []) {
    if (!item.targetFile) continue;

    let currentCode: string;
    try {
      currentCode = await readFile(item.targetFile, "utf-8");
    } catch {
      continue;
    }

    const prompt = buildImprovementPrompt(
      item.targetFile,
      currentCode,
      `CTR ${weakReports[0].ctr}% — 임계값 ${CTR_THRESHOLD}% 미달`,
      item.issue
    );

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    const change = parseImprovements(text);

    if (!change.file || !change.oldCode || !change.newCode) continue;

    const applied = await applyCodeChange(change.file, change.oldCode, change.newCode);
    if (!applied) continue;

    improvements.push({
      file: change.file,
      type: item.changeType ?? "prompt_update",
      before: change.oldCode,
      after: change.newCode,
    });
  }

  if (improvements.length === 0) return;

  const improvement: Improvement = {
    date: new Date().toISOString().split("T")[0],
    trigger: `${weakReports.length}개 캠페인 CTR 임계값 미달`,
    changes: improvements,
  };

  const dateKey = improvement.date;
  await appendJson(`data/improvements/${dateKey}.json`, improvement);

  try {
    const changedFiles = improvements.map((c) => c.file);
    const safeFiles = filterSafeImprovementFiles(changedFiles);
    if (safeFiles.length === 0) return;

    const dataFile = `data/improvements/${dateKey}.json`;
    execFileSync("git", ["add", ...safeFiles, dataFile]);
    execFileSync("git", [
      "commit",
      "-m",
      `improve: auto-optimize pipeline (${safeFiles.length} changes) [${dateKey}]`,
    ]);
    console.log(`[Improver] ${safeFiles.length}개 개선 적용 및 커밋 완료`);
  } catch (e) {
    console.warn("[Improver] git 커밋 실패:", e);
  }
}
```

- [ ] **Step 2: 새 경로에 테스트 파일 생성**

파일 생성: `core/improver/runner.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { filterSafeImprovementFiles } from "./runner.js";

describe("filterSafeImprovementFiles", () => {
  it("accepts core/ paths with .ts extension", () => {
    expect(filterSafeImprovementFiles(["core/improver/index.ts"])).toEqual([
      "core/improver/index.ts",
    ]);
  });

  it("accepts cli/ paths with .ts extension", () => {
    expect(filterSafeImprovementFiles(["cli/actions.ts"])).toEqual([
      "cli/actions.ts",
    ]);
  });

  it("accepts server/ paths with .ts extension", () => {
    expect(filterSafeImprovementFiles(["server/billing.ts"])).toEqual([
      "server/billing.ts",
    ]);
  });

  it("rejects legacy src/ paths", () => {
    expect(filterSafeImprovementFiles(["src/legacy.ts"])).toEqual([]);
  });

  it("rejects .tsx files", () => {
    expect(filterSafeImprovementFiles(["cli/tui/App.tsx"])).toEqual([]);
  });

  it("rejects non-.ts extensions", () => {
    expect(filterSafeImprovementFiles(["core/config.json"])).toEqual([]);
  });

  it("rejects paths starting with slash", () => {
    expect(filterSafeImprovementFiles(["/etc/passwd"])).toEqual([]);
  });

  it("rejects paths not starting with a layer prefix", () => {
    expect(filterSafeImprovementFiles(["data/products/x.ts"])).toEqual([]);
  });

  it("filters a mixed list, keeping only safe entries", () => {
    const input = [
      "core/types.ts",
      "src/old.ts",
      "cli/tui/App.tsx",
      "server/auth.ts",
    ];
    expect(filterSafeImprovementFiles(input)).toEqual([
      "core/types.ts",
      "server/auth.ts",
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(filterSafeImprovementFiles([])).toEqual([]);
  });
});
```

- [ ] **Step 3: 새 테스트 실행 — 모두 통과 확인**

Run: `npx vitest run core/improver/runner.test.ts`
Expected: 10 tests pass.

- [ ] **Step 4: `cli/entries/improve.ts` import 경로 변경**

Modify: `cli/entries/improve.ts:3`

Before:
```ts
import { runImprovementCycle } from "../improver/runner.js";
```

After:
```ts
import { runImprovementCycle } from "../../core/improver/runner.js";
```

- [ ] **Step 5: 구 경로 파일 삭제**

Run:
```bash
rm cli/improver/runner.ts cli/improver/runner.test.ts
```

`cli/improver/` 디렉터리가 비었으면 삭제:
```bash
rmdir cli/improver 2>/dev/null || true
```

- [ ] **Step 6: 전체 테스트 + tsc 확인**

Run: `npm test && npx tsc --noEmit`
Expected: 모든 기존 테스트 통과 (137개), tsc 에러 없음. runner 관련 10 테스트는 이제 `core/improver/runner.test.ts`에서 실행됨.

- [ ] **Step 7: 커밋**

```bash
git add core/improver/runner.ts core/improver/runner.test.ts cli/entries/improve.ts
git add -u cli/improver/  # 삭제된 파일 반영
git commit -m "refactor: move runImprovementCycle from cli/improver to core/improver

Enables future server/scheduler.ts to import without layer violation.
Pure move — no behavior change. 10 tests retained."
```

---

## Task 2: `core/scheduler/mutex.ts` 추가

**목적:** 한 worker 프로세스 내에서 catch-up과 cron fire 콜백이 동시에 실행되는 것을 막는 in-process 직렬화 유틸. spec §3.3.

**Files:**
- Create: `core/scheduler/mutex.ts`
- Create: `core/scheduler/mutex.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

파일 생성: `core/scheduler/mutex.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { createMutex } from "./mutex.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createMutex", () => {
  it("순차 실행을 강제한다 (동시 호출이 직렬화됨)", async () => {
    const mutex = createMutex();
    const log: string[] = [];
    const a = mutex(async () => {
      log.push("a-start");
      await delay(20);
      log.push("a-end");
    });
    const b = mutex(async () => {
      log.push("b-start");
      await delay(5);
      log.push("b-end");
    });
    await Promise.all([a, b]);
    expect(log).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("콜백이 throw 해도 큐를 계속 진행한다", async () => {
    const mutex = createMutex();
    const a = mutex(async () => {
      throw new Error("boom");
    });
    const b = mutex(async () => "ok" as const);
    await expect(a).rejects.toThrow("boom");
    await expect(b).resolves.toBe("ok");
  });

  it("반환값을 그대로 전달한다", async () => {
    const mutex = createMutex();
    const result = await mutex(async () => 42);
    expect(result).toBe(42);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx vitest run core/scheduler/mutex.test.ts`
Expected: FAIL (`mutex.js` 파일이 없음).

- [ ] **Step 3: 구현**

파일 생성: `core/scheduler/mutex.ts`

```ts
export type Mutex = <T>(fn: () => Promise<T>) => Promise<T>;

export function createMutex(): Mutex {
  let tail: Promise<unknown> = Promise.resolve();
  return async function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = tail;
    let release!: () => void;
    tail = new Promise<void>((r) => {
      release = r;
    });
    try {
      await prev;
    } catch {
      // 이전 작업 실패는 다음 작업 실행을 막지 않음
    }
    try {
      return await fn();
    } finally {
      release();
    }
  };
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npx vitest run core/scheduler/mutex.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: 커밋**

```bash
git add core/scheduler/mutex.ts core/scheduler/mutex.test.ts
git commit -m "feat: add in-process mutex for scheduler job serialization

Prevents catch-up and cron fire callbacks from running concurrently
within the worker process. Continues queue on rejection."
```

---

## Task 3: `core/scheduler/cadence.ts` + `core/scheduler/state.ts` 추가

**목적:** Cadence preset 상수 2개(Owner/Server)와 catch-up 판단 로직. spec §3.2, §3.6.

**Files:**
- Create: `core/scheduler/cadence.ts`
- Create: `core/scheduler/state.ts`
- Create: `core/scheduler/state.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (shouldCatchup)**

파일 생성: `core/scheduler/state.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { shouldCatchup } from "./state.js";
import { OWNER_CADENCE, SERVER_CADENCE } from "./cadence.js";

describe("shouldCatchup", () => {
  it("lastCollect 가 catchupCollectMs 를 초과했으면 collect true (Owner)", () => {
    const state = {
      lastCollect: "2026-04-19T00:00:00Z",
      lastAnalyze: "2026-04-19T00:00:00Z",
    };
    const now = Date.parse("2026-04-19T06:00:00Z"); // 6h 경과
    const result = shouldCatchup(state, OWNER_CADENCE, now);
    expect(result.collect).toBe(true); // Owner collect = 6h
    expect(result.analyze).toBe(false); // 2d 미만
  });

  it("주기 미만이면 두 값 모두 false", () => {
    const state = {
      lastCollect: "2026-04-19T00:00:00Z",
      lastAnalyze: "2026-04-19T00:00:00Z",
    };
    const now = Date.parse("2026-04-19T01:00:00Z"); // 1h
    const result = shouldCatchup(state, OWNER_CADENCE, now);
    expect(result.collect).toBe(false);
    expect(result.analyze).toBe(false);
  });

  it("null state 면 두 값 모두 true (최초 기동)", () => {
    const state = { lastCollect: null, lastAnalyze: null };
    const now = Date.now();
    const result = shouldCatchup(state, OWNER_CADENCE, now);
    expect(result.collect).toBe(true);
    expect(result.analyze).toBe(true);
  });

  it("Server cadence 에서는 24h 경과해야 collect true", () => {
    const state = {
      lastCollect: "2026-04-19T00:00:00Z",
      lastAnalyze: "2026-04-19T00:00:00Z",
    };
    const oneHour = Date.parse("2026-04-19T01:00:00Z");
    const twentyFour = Date.parse("2026-04-20T00:00:00Z");
    expect(shouldCatchup(state, SERVER_CADENCE, oneHour).collect).toBe(false);
    expect(shouldCatchup(state, SERVER_CADENCE, twentyFour).collect).toBe(true);
  });

  it("analyze 는 2d 경과해야 true (Owner)", () => {
    const state = {
      lastCollect: "2026-04-19T00:00:00Z",
      lastAnalyze: "2026-04-19T00:00:00Z",
    };
    const oneDay = Date.parse("2026-04-20T00:00:00Z");
    const twoDays = Date.parse("2026-04-21T00:00:00Z");
    expect(shouldCatchup(state, OWNER_CADENCE, oneDay).analyze).toBe(false);
    expect(shouldCatchup(state, OWNER_CADENCE, twoDays).analyze).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx vitest run core/scheduler/state.test.ts`
Expected: FAIL (`state.js`, `cadence.js` 없음).

- [ ] **Step 3: cadence.ts 구현**

파일 생성: `core/scheduler/cadence.ts`

```ts
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface Cadence {
  collectCron: string;
  analyzeCron: string;
  catchupCollectMs: number;
  catchupAnalyzeMs: number;
}

export const OWNER_CADENCE: Cadence = {
  collectCron: "0 */6 * * *",
  analyzeCron: "0 9 */2 * *",
  catchupCollectMs: 6 * HOUR,
  catchupAnalyzeMs: 2 * DAY,
};

export const SERVER_CADENCE: Cadence = {
  collectCron: "0 9 * * *",
  analyzeCron: "0 9 * * 1",
  catchupCollectMs: 24 * HOUR,
  catchupAnalyzeMs: 7 * DAY,
};
```

- [ ] **Step 4: state.ts 구현 (shouldCatchup + I/O helper)**

파일 생성: `core/scheduler/state.ts`

```ts
import { readJson, writeJson } from "../storage.js";
import type { Cadence } from "./cadence.js";

export const WORKER_STATE_PATH = "data/worker-state.json";

export interface WorkerState {
  lastCollect: string | null;
  lastAnalyze: string | null;
}

export interface CatchupDecision {
  collect: boolean;
  analyze: boolean;
}

export interface SchedulerDeps {
  collectDailyReports: () => Promise<unknown>;
  generateWeeklyAnalysis: () => Promise<unknown>;
  runImprovementCycle: () => Promise<unknown>;
}

export function shouldCatchup(
  state: WorkerState,
  cadence: Cadence,
  now: number,
): CatchupDecision {
  const collectAge = state.lastCollect
    ? now - Date.parse(state.lastCollect)
    : Infinity;
  const analyzeAge = state.lastAnalyze
    ? now - Date.parse(state.lastAnalyze)
    : Infinity;
  return {
    collect: collectAge >= cadence.catchupCollectMs,
    analyze: analyzeAge >= cadence.catchupAnalyzeMs,
  };
}

async function readState(): Promise<WorkerState> {
  return (
    (await readJson<WorkerState>(WORKER_STATE_PATH)) ?? {
      lastCollect: null,
      lastAnalyze: null,
    }
  );
}

export async function updateStateField(
  field: keyof WorkerState,
): Promise<void> {
  const state = await readState();
  state[field] = new Date().toISOString();
  await writeJson(WORKER_STATE_PATH, state);
}

export async function runCatchupIfNeeded(
  deps: SchedulerDeps,
  cadence: Cadence,
): Promise<void> {
  const state = await readState();
  const decision = shouldCatchup(state, cadence, Date.now());

  if (decision.collect) {
    try {
      await deps.collectDailyReports();
      await updateStateField("lastCollect");
    } catch (e) {
      console.error("[scheduler] catchup collect failed:", e);
    }
  }
  if (decision.analyze) {
    try {
      await deps.generateWeeklyAnalysis();
      await deps.runImprovementCycle();
      await updateStateField("lastAnalyze");
    } catch (e) {
      console.error("[scheduler] catchup analyze failed:", e);
    }
  }
}
```

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `npx vitest run core/scheduler/state.test.ts`
Expected: 5 tests pass.

- [ ] **Step 6: 커밋**

```bash
git add core/scheduler/cadence.ts core/scheduler/state.ts core/scheduler/state.test.ts
git commit -m "feat: add scheduler cadence presets and catch-up state logic

OWNER_CADENCE: 6h collect / 2d analyze for personal Mac owner mode.
SERVER_CADENCE: 24h / 7d for Customer API server deployment.
shouldCatchup is pure; runCatchupIfNeeded orchestrates file I/O."
```

---

## Task 4: `core/scheduler/index.ts` (registerJobs)

**목적:** cron 콜백 등록 + state 갱신 + mutex 직렬화를 연결. spec §2.1, §3.5.

**Files:**
- Create: `core/scheduler/index.ts`
- Create: `core/scheduler/index.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

파일 생성: `core/scheduler/index.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { registerJobs, type CronLike, type SchedulerDeps } from "./index.js";
import { OWNER_CADENCE } from "./cadence.js";

const passthrough = <T>(fn: () => Promise<T>) => fn();

function makeFakeCron() {
  const calls: Array<[string, () => Promise<void>]> = [];
  const cron: CronLike = {
    schedule: (expr, fn) => {
      calls.push([expr, fn as () => Promise<void>]);
    },
  };
  return { cron, calls };
}

function makeDeps(): SchedulerDeps {
  return {
    collectDailyReports: vi.fn(async () => []),
    generateWeeklyAnalysis: vi.fn(async () => ""),
    runImprovementCycle: vi.fn(async () => {}),
  };
}

describe("registerJobs", () => {
  it("collectCron 과 analyzeCron 두 스케줄을 등록한다", () => {
    const { cron, calls } = makeFakeCron();
    registerJobs(cron, makeDeps(), OWNER_CADENCE, passthrough, vi.fn());
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe("0 */6 * * *");
    expect(calls[1][0]).toBe("0 9 */2 * *");
  });

  it("analyze 콜백은 generateWeeklyAnalysis → runImprovementCycle 순서로 호출한다", async () => {
    const log: string[] = [];
    const deps: SchedulerDeps = {
      collectDailyReports: vi.fn(async () => []),
      generateWeeklyAnalysis: vi.fn(async () => {
        log.push("analyze");
        return "";
      }),
      runImprovementCycle: vi.fn(async () => {
        log.push("improve");
      }),
    };
    const { cron, calls } = makeFakeCron();
    registerJobs(cron, deps, OWNER_CADENCE, passthrough, vi.fn());
    await calls[1][1]();
    expect(log).toEqual(["analyze", "improve"]);
  });

  it("collect 콜백이 성공하면 onComplete('lastCollect') 를 호출한다", async () => {
    const deps = makeDeps();
    const onComplete = vi.fn(async () => {});
    const { cron, calls } = makeFakeCron();
    registerJobs(cron, deps, OWNER_CADENCE, passthrough, onComplete);
    await calls[0][1]();
    expect(onComplete).toHaveBeenCalledWith("lastCollect");
  });

  it("analyze 콜백이 성공하면 onComplete('lastAnalyze') 를 호출한다", async () => {
    const deps = makeDeps();
    const onComplete = vi.fn(async () => {});
    const { cron, calls } = makeFakeCron();
    registerJobs(cron, deps, OWNER_CADENCE, passthrough, onComplete);
    await calls[1][1]();
    expect(onComplete).toHaveBeenCalledWith("lastAnalyze");
  });

  it("mutex 를 경유해서 실행한다 (runExclusive 가 호출됨)", async () => {
    const deps = makeDeps();
    const runExclusive = vi.fn(async <T>(fn: () => Promise<T>) => fn());
    const { cron, calls } = makeFakeCron();
    registerJobs(cron, deps, OWNER_CADENCE, runExclusive, vi.fn());
    await calls[0][1]();
    expect(runExclusive).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx vitest run core/scheduler/index.test.ts`
Expected: FAIL (`index.js` 없음).

- [ ] **Step 3: 구현**

파일 생성: `core/scheduler/index.ts`

```ts
import type { Cadence } from "./cadence.js";
import type { SchedulerDeps, WorkerState } from "./state.js";

export type { SchedulerDeps } from "./state.js";

export interface CronLike {
  schedule: (expr: string, fn: () => void | Promise<void>) => void;
}

export type RunExclusive = <T>(fn: () => Promise<T>) => Promise<T>;

export type StateFieldUpdater = (field: keyof WorkerState) => Promise<void>;

export function registerJobs(
  cron: CronLike,
  deps: SchedulerDeps,
  cadence: Cadence,
  runExclusive: RunExclusive,
  onComplete: StateFieldUpdater,
): void {
  cron.schedule(cadence.collectCron, () =>
    runExclusive(async () => {
      try {
        await deps.collectDailyReports();
        await onComplete("lastCollect");
      } catch (e) {
        console.error("[scheduler] collect job failed:", e);
      }
    }),
  );
  cron.schedule(cadence.analyzeCron, () =>
    runExclusive(async () => {
      try {
        await deps.generateWeeklyAnalysis();
        await deps.runImprovementCycle();
        await onComplete("lastAnalyze");
      } catch (e) {
        console.error("[scheduler] analyze job failed:", e);
      }
    }),
  );
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npx vitest run core/scheduler/index.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: 전체 테스트 + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: 모든 테스트 통과 (137 + 3 mutex + 5 state + 5 index = 150), tsc 에러 없음.

- [ ] **Step 6: 커밋**

```bash
git add core/scheduler/index.ts core/scheduler/index.test.ts
git commit -m "feat: add registerJobs to wire cron callbacks with state updates

Callback composition: runExclusive(deps → onComplete). Failures are
logged and swallowed so cron keeps firing. State update field names
match WorkerState keys."
```

---

## Task 5: `cli/entries/worker.ts` + launchd plist + install 스크립트

**목적:** Owner 모드 daemon 엔트리. launchd가 이를 프로세스로 기동하고 프로젝트 내 `tsx` 로 TS 직접 실행. spec §2.2, §2.3, §2.6.

**Files:**
- Create: `cli/entries/worker.ts`
- Create: `scripts/com.adai.worker.plist`
- Create: `scripts/install-worker.sh`
- Modify: `.gitignore` (append `logs/`)

- [ ] **Step 1: worker.ts 생성**

파일 생성: `cli/entries/worker.ts`

```ts
import "dotenv/config";
import cron from "node-cron";
import { registerJobs } from "../../core/scheduler/index.js";
import { OWNER_CADENCE } from "../../core/scheduler/cadence.js";
import {
  runCatchupIfNeeded,
  updateStateField,
} from "../../core/scheduler/state.js";
import { createMutex } from "../../core/scheduler/mutex.js";
import {
  collectDailyReports,
  generateWeeklyAnalysis,
} from "../../core/campaign/monitor.js";
import { runImprovementCycle as runCycle } from "../../core/improver/runner.js";
import { readJson, listJson } from "../../core/storage.js";
import { shouldTriggerImprovement } from "../../core/improver/index.js";
import type { Report } from "../../core/types.js";

async function runImprovementCycle(): Promise<void> {
  const reportPaths = await listJson("data/reports");
  const allReports: Report[] = [];
  for (const p of reportPaths.slice(-3)) {
    const daily = await readJson<Report[]>(p);
    if (daily) allReports.push(...daily);
  }
  const weeklyPaths = reportPaths.filter((p) => p.includes("weekly-analysis"));
  const latest = weeklyPaths[weeklyPaths.length - 1];
  if (!latest) return;
  const analysis = await readJson<object>(latest);
  const weak = allReports.filter(shouldTriggerImprovement);
  await runCycle(weak, JSON.stringify(analysis));
}

const mutex = createMutex();
const deps = {
  collectDailyReports,
  generateWeeklyAnalysis,
  runImprovementCycle,
};

registerJobs(cron, deps, OWNER_CADENCE, mutex, updateStateField);
console.log("[worker] scheduler registered (Owner cadence), awaiting cron fires");

void mutex(async () => {
  await runCatchupIfNeeded(deps, OWNER_CADENCE);
}).catch((err) => {
  console.error("[worker] catchup failed:", err);
});

process.stdin.resume();
```

**주**: `runImprovementCycle` wrapper는 `cli/entries/improve.ts`가 주간 분석 파일을 읽어 `runCycle`에 전달하는 로직을 worker에서도 사용하기 위함. `cli/entries/improve.ts`와 로직 동일하지만 process.exit가 없고 데이터 없을 시 조용히 반환.

- [ ] **Step 2: launchd plist 템플릿 생성**

파일 생성: `scripts/com.adai.worker.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.adai.worker</string>
  <key>ProgramArguments</key>
  <array>
    <string>__TSX_PATH__</string>
    <string>cli/entries/worker.ts</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>WorkingDirectory</key><string>__PROJECT_ROOT__</string>
  <key>StandardOutPath</key><string>__PROJECT_ROOT__/logs/worker.log</string>
  <key>StandardErrorPath</key><string>__PROJECT_ROOT__/logs/worker.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>META_ACCESS_TOKEN</key><string>__INJECT__</string>
    <key>META_AD_ACCOUNT_ID</key><string>__INJECT__</string>
    <key>ANTHROPIC_API_KEY</key><string>__INJECT__</string>
    <key>PATH</key><string>/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
```

- [ ] **Step 3: install 스크립트 생성**

파일 생성: `scripts/install-worker.sh`

```bash
#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TSX_PATH="$PROJECT_ROOT/node_modules/.bin/tsx"
PLIST_SRC="$PROJECT_ROOT/scripts/com.adai.worker.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.adai.worker.plist"

if [ ! -x "$TSX_PATH" ]; then
  echo "Error: $TSX_PATH not found. Run 'npm install' first." >&2
  exit 1
fi

mkdir -p "$PROJECT_ROOT/logs"
mkdir -p "$HOME/Library/LaunchAgents"

sed -e "s|__PROJECT_ROOT__|$PROJECT_ROOT|g" \
    -e "s|__TSX_PATH__|$TSX_PATH|g" \
    "$PLIST_SRC" > "$PLIST_DST"

launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"

echo "Worker installed: $PLIST_DST"
echo "Logs: $PROJECT_ROOT/logs/worker.{log,err}"
echo ""
echo "NEXT STEP: Edit $PLIST_DST and replace __INJECT__ with real token"
echo "  values (META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, ANTHROPIC_API_KEY)."
echo "Then reload:"
echo "  launchctl unload $PLIST_DST && launchctl load $PLIST_DST"
```

- [ ] **Step 4: install 스크립트 실행 권한 부여**

Run:
```bash
chmod +x scripts/install-worker.sh
```

- [ ] **Step 5: `.gitignore`에 logs/ 추가**

`.gitignore` 하단에 한 줄 append:

Run:
```bash
echo "logs/" >> .gitignore
```

확인:
```bash
tail -5 .gitignore
```
Expected: 마지막 줄이 `logs/`.

- [ ] **Step 6: tsc 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 7: worker.ts dry-run (짧게)**

Run:
```bash
timeout 3 npx tsx cli/entries/worker.ts 2>&1 | head -5 || true
```
Expected: `[worker] scheduler registered (Owner cadence), awaiting cron fires` 출력 확인. 3초 후 SIGTERM으로 종료됨 (정상).

- [ ] **Step 8: 커밋**

```bash
git add cli/entries/worker.ts scripts/com.adai.worker.plist scripts/install-worker.sh .gitignore
git commit -m "feat: add launchd worker for Owner-mode self-learning daemon

cli/entries/worker.ts wires core/scheduler with OWNER_CADENCE,
mutex serialization, and background catch-up on boot.
install-worker.sh copies plist to LaunchAgents with project-path
substitution. __INJECT__ env vars must be filled manually."
```

---

## Task 6: `server/scheduler.ts` + `server/index.ts` 훅

**목적:** Customer 모드에서 동일 스케줄러를 on-process로 등록. spec §2.5.

**Files:**
- Create: `server/scheduler.ts`
- Create: `server/scheduler.test.ts`
- Modify: `server/index.ts:92` (listen 직전에 `await startScheduler()` 호출)

- [ ] **Step 1: 실패 테스트 작성**

파일 생성: `server/scheduler.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../core/scheduler/index.js", () => ({
  registerJobs: vi.fn(),
}));
vi.mock("../core/scheduler/state.js", () => ({
  runCatchupIfNeeded: vi.fn(async () => {}),
  updateStateField: vi.fn(async () => {}),
}));
vi.mock("../core/campaign/monitor.js", () => ({
  collectDailyReports: vi.fn(async () => []),
  generateWeeklyAnalysis: vi.fn(async () => ""),
}));
vi.mock("../core/improver/runner.js", () => ({
  runImprovementCycle: vi.fn(async () => {}),
}));

describe("startScheduler", () => {
  it("SERVER_CADENCE 로 registerJobs 를 호출한다", async () => {
    const { startScheduler } = await import("./scheduler.js");
    const { registerJobs } = await import("../core/scheduler/index.js");
    const { SERVER_CADENCE } = await import("../core/scheduler/cadence.js");
    await startScheduler();
    expect(registerJobs).toHaveBeenCalledTimes(1);
    const calledCadence = (registerJobs as any).mock.calls[0][2];
    expect(calledCadence).toEqual(SERVER_CADENCE);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx vitest run server/scheduler.test.ts`
Expected: FAIL (`scheduler.js` 없음).

- [ ] **Step 3: 구현**

파일 생성: `server/scheduler.ts`

```ts
import cron from "node-cron";
import { registerJobs } from "../core/scheduler/index.js";
import { SERVER_CADENCE } from "../core/scheduler/cadence.js";
import {
  runCatchupIfNeeded,
  updateStateField,
} from "../core/scheduler/state.js";
import { createMutex } from "../core/scheduler/mutex.js";
import {
  collectDailyReports,
  generateWeeklyAnalysis,
} from "../core/campaign/monitor.js";
import { runImprovementCycle as runCycle } from "../core/improver/runner.js";
import { readJson, listJson } from "../core/storage.js";
import { shouldTriggerImprovement } from "../core/improver/index.js";
import type { Report } from "../core/types.js";

async function runImprovementCycle(): Promise<void> {
  const reportPaths = await listJson("data/reports");
  const allReports: Report[] = [];
  for (const p of reportPaths.slice(-3)) {
    const daily = await readJson<Report[]>(p);
    if (daily) allReports.push(...daily);
  }
  const weeklyPaths = reportPaths.filter((p) => p.includes("weekly-analysis"));
  const latest = weeklyPaths[weeklyPaths.length - 1];
  if (!latest) return;
  const analysis = await readJson<object>(latest);
  const weak = allReports.filter(shouldTriggerImprovement);
  await runCycle(weak, JSON.stringify(analysis));
}

export async function startScheduler(): Promise<void> {
  const mutex = createMutex();
  const deps = {
    collectDailyReports,
    generateWeeklyAnalysis,
    runImprovementCycle,
  };
  registerJobs(cron, deps, SERVER_CADENCE, mutex, updateStateField);
  console.log("[scheduler] registered (Server cadence)");
  void mutex(async () => {
    await runCatchupIfNeeded(deps, SERVER_CADENCE);
  }).catch((err) => {
    console.error("[scheduler] catchup failed:", err);
  });
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npx vitest run server/scheduler.test.ts`
Expected: 1 test passes.

- [ ] **Step 5: `server/index.ts`에 훅 삽입**

Modify: `server/index.ts:92-95` — `app.listen` 블록 직전에 `await startScheduler()` 호출.

Before:
```ts
// Cleanup old video files
setInterval(cleanupOldFiles, 60 * 60 * 1000);
cleanupOldFiles();

app.listen(PORT, () => {
  console.log(`[Usage Server] Running on ${SERVER_URL}`);
  console.log(`[Usage Server] DB: server/data.db`);
});
```

After:
```ts
// Cleanup old video files
setInterval(cleanupOldFiles, 60 * 60 * 1000);
cleanupOldFiles();

// Start self-learning scheduler (Server cadence)
await startScheduler();

app.listen(PORT, () => {
  console.log(`[Usage Server] Running on ${SERVER_URL}`);
  console.log(`[Usage Server] DB: server/data.db`);
});
```

Also add the import at the top (near other imports):

Before (near line 17):
```ts
import { cleanupOldFiles } from "./jobs/videoJob.js";
```

After:
```ts
import { cleanupOldFiles } from "./jobs/videoJob.js";
import { startScheduler } from "./scheduler.js";
```

- [ ] **Step 6: 전체 테스트 + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: 모든 테스트 통과, tsc 에러 없음.

- [ ] **Step 7: 커밋**

```bash
git add server/scheduler.ts server/scheduler.test.ts server/index.ts
git commit -m "feat: hook server boot to start shared self-learning scheduler

Uses SERVER_CADENCE (24h/7d) and shares core/scheduler with the
launchd worker. Catch-up runs in background on boot. Enables
Customer-mode API server to perform autonomous self-improvement
identically to Owner-mode worker."
```

---

## Task 7: 구 `cli/monitor/scheduler.ts` 제거 + `cli/entries/monitor.ts` 정리

**목적:** worker가 대체하므로 구 스케줄러 제거. `monitor` 엔트리는 수동 트리거용(`daily`, `weekly`)만 남김. spec §5.3, §5.4.

**Files:**
- Delete: `cli/monitor/scheduler.ts`
- Modify: `cli/entries/monitor.ts` (mode=cron 브랜치 제거, 기본 모드 요구)

- [ ] **Step 1: `cli/monitor/scheduler.ts` 삭제**

Run:
```bash
rm cli/monitor/scheduler.ts
rmdir cli/monitor 2>/dev/null || true
```

- [ ] **Step 2: `cli/entries/monitor.ts` 수정**

Modify: `cli/entries/monitor.ts` (전체 교체)

After:
```ts
import "dotenv/config";
import {
  collectDailyReports,
  generateWeeklyAnalysis,
} from "../../core/campaign/monitor.js";

const mode = process.argv[2];
if (mode === "daily") {
  const reports = await collectDailyReports();
  console.log(`${reports.length}개 리포트 수집 완료`);
} else if (mode === "weekly") {
  const analysis = await generateWeeklyAnalysis();
  console.log(analysis);
} else {
  console.error("Usage: npm run monitor -- daily|weekly");
  console.error(
    "(cron mode removed; autonomous scheduling is handled by the worker daemon)",
  );
  process.exit(1);
}
```

- [ ] **Step 3: tsc 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음. 제거된 `startCronScheduler` import가 남아있는 파일 없는지 tsc가 검증.

- [ ] **Step 4: 전체 테스트**

Run: `npm test`
Expected: 모든 테스트 통과. `cli/monitor/scheduler.ts` 관련 테스트는 없었으므로 테스트 수 변화 없음.

- [ ] **Step 5: 커밋**

```bash
git add -u cli/monitor cli/entries/monitor.ts
git commit -m "refactor: remove cli/monitor/scheduler.ts (superseded by worker daemon)

npm run monitor now requires explicit 'daily' or 'weekly' mode for
manual trigger. Autonomous cron scheduling is handled by
cli/entries/worker.ts (launchd) and server/scheduler.ts."
```

---

## Task 8: 문서 갱신 (STATUS, ROADMAP, ARCHITECTURE, README)

**목적:** 프로젝트 필수 문서 업데이트 규칙(CLAUDE.md) 준수.

**Files:**
- Modify: `docs/STATUS.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `README.md`

- [ ] **Step 1: `docs/STATUS.md` 갱신**

Modify: `docs/STATUS.md`

(a) 마지막 업데이트 날짜를 `2026-04-20` 으로 변경.

(b) "서비스 컴포넌트 상태" 표에 새 행 추가 (`테스트 (vitest)` 행 위에):

```markdown
| 자기학습 워커 (launchd daemon) | ✅ 구현 완료 | `cli/entries/worker.ts`, `scripts/com.adai.worker.plist` |
| 스케줄러 (공유 모듈) | ✅ 구현 완료 | `core/scheduler/` |
```

(c) "최근 변경 이력" 맨 위에 한 줄 추가:

```markdown
- 2026-04-20 feat: 자율 자기학습 루프 launchd worker 구축 (core/scheduler 공유 모듈 + Owner 6h/2d, Server 24h/7d cadence + catch-up)
```

- [ ] **Step 2: `docs/ROADMAP.md` 갱신**

Modify: `docs/ROADMAP.md`

현재 파일 상태 기준: 마지막 업데이트 `2026-04-19`, Tier 1 비어있음, Tier 3에 "자율 개선 루프 강화 (현재는 프롬프트 수정 수준, 본격적 코드 변경 루프 필요)" 항목 존재.

(a) `마지막 업데이트: 2026-04-19` → `마지막 업데이트: 2026-04-20` 변경.

(b) Tier 3의 "자율 개선 루프 강화" 항목을 다음으로 갱신:

Before:
```
- 자율 개선 루프 강화 (현재는 프롬프트 수정 수준, 본격적 코드 변경 루프 필요)
```

After:
```
- 자율 개선 루프 강화 (launchd 인프라 구축 완료 — 2026-04-20. 추가 개선: 분석 히스토리 재주입, 개선 실패 알림 등)
```

**변경 근거**: 본 플랜이 자기학습 루프의 실행 인프라(터미널 독립, cron 연결, dual-mode)를 구축했으므로 Tier 3 항목은 완전 제거하지 않고 "인프라 완료" 표기를 남긴다. 향후 더 깊은 개선(코드 변경 범위 확대 등)은 별건.

- [ ] **Step 3: `docs/ARCHITECTURE.md` 갱신**

Modify: `docs/ARCHITECTURE.md`

현재 `## 핵심 설계 결정` 섹션은 §1~§8 (마지막은 "8. 레이어드 구조")까지 존재. 그 뒤에 §9 추가:

```markdown
### 9. 자율 자기학습 워커 (launchd daemon + 공유 스케줄러)

**결정**: 자기학습 루프는 TUI/터미널 수명과 독립된 프로세스로 실행하며, Owner 모드(개인 Mac)는 launchd LaunchAgent, Customer 모드(API 서버)는 `server/index.ts` 기동 훅으로 동일 `core/scheduler/` 모듈을 재사용한다.

**Why**:
- TUI 내부 cron은 터미널 닫으면 죽어 학습이 중단됨
- Owner 모드만 따로 서버를 띄우는 건 과잉 (Stripe/auth/rate-limit 서비스 불필요)
- `core/scheduler/`를 pure 모듈로 두면 두 entry가 동일 로직을 공유

**How**:
- `core/scheduler/{index,cadence,state,mutex}.ts` — pure. registerJobs는 CronLike + Deps + Cadence + mutex + onComplete를 주입받음
- `cli/entries/worker.ts` — launchd가 프로젝트 내 `node_modules/.bin/tsx`로 실행. OWNER_CADENCE(6h/2d)
- `server/scheduler.ts` — `server/index.ts`가 기동 시 `await startScheduler()` 호출. SERVER_CADENCE(24h/7d)
- `data/worker-state.json` — `lastCollect`, `lastAnalyze` 타임스탬프. 기동 시 `shouldCatchup`으로 밀린 작업 재실행 (Mac 슬립 대응)
- 프로세스 내 async 직렬화는 `core/scheduler/mutex.ts`의 promise-chain 뮤텍스로 보장. 프로세스 간 중복은 launchd 단일 인스턴스 보증
```

아키텍처 다이어그램이 문서 내에 있다면 3-프로세스 구조(TUI / Worker / Server) 반영. 다이어그램 포맷은 기존 스타일 따름.

- [ ] **Step 4: `README.md` 갱신 — Worker 설치 섹션 추가**

Modify: `README.md` — 적절한 위치(예: "설치" 섹션 끝 또는 신규 "자기학습 워커" 섹션)에 추가:

```markdown
## 자기학습 워커 설치 (Owner 모드, macOS)

자율 개선 루프를 터미널과 무관하게 상시 실행하려면 launchd daemon으로 워커를 등록합니다.

```bash
npm install                           # tsx 등 의존성 설치 확인
bash scripts/install-worker.sh
```

설치 후 `~/Library/LaunchAgents/com.adai.worker.plist` 를 편집해서 3개 `__INJECT__` 자리를 실제 토큰 값으로 교체:

- `META_ACCESS_TOKEN`
- `META_AD_ACCOUNT_ID`
- `ANTHROPIC_API_KEY`

재로드:

```bash
launchctl unload ~/Library/LaunchAgents/com.adai.worker.plist
launchctl load ~/Library/LaunchAgents/com.adai.worker.plist
```

로그 확인:

```bash
tail -f logs/worker.log
tail -f logs/worker.err
```

워커는 6시간마다 일간 성과를 수집하고 2일마다 주간 분석 + 자동 개선 사이클을 실행합니다. Mac이 슬립이었다면 깨어난 직후 밀린 작업을 자동으로 catch-up합니다.

제거:

```bash
launchctl unload ~/Library/LaunchAgents/com.adai.worker.plist
rm ~/Library/LaunchAgents/com.adai.worker.plist
```
```

- [ ] **Step 5: 커밋**

```bash
git add docs/STATUS.md docs/ROADMAP.md docs/ARCHITECTURE.md README.md
git commit -m "docs: update STATUS/ROADMAP/ARCHITECTURE/README for self-learning worker

Reflect launchd worker + core/scheduler + server hook. Adds README
install steps for LaunchAgent setup and env var injection."
```

- [ ] **Step 6: 최종 확인**

Run:
```bash
npm test
npx tsc --noEmit
git log --oneline -10
```

Expected:
- 모든 테스트 통과 (150+ 개, mutex 3 + state 5 + index 5 + server scheduler 1 추가)
- tsc 에러 없음
- 최근 커밋 8개가 Task 1~8 에 해당

---

## 구현 이후 수동 검증 (선택)

이 플랜 범위에는 테스트로 자동화되지 않는 launchd 동작 검증이 포함됨. 구현 완료 후 사용자가 직접:

```bash
bash scripts/install-worker.sh
# plist 편집해서 __INJECT__ 치환
launchctl list | grep com.adai.worker   # 등록 확인
tail -f logs/worker.log                 # "scheduler registered" 확인
ps -ef | grep worker.ts                 # 프로세스 실행 확인
```

슬립 catch-up 검증은 실제 Mac 슬립/깨우기 사이클 + `data/worker-state.json` timestamp 조작으로 유도. 본 플랜 범위 밖.

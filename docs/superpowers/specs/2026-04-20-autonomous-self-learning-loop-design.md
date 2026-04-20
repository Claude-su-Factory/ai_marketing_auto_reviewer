# 자율 자기학습 루프 설계

작성: 2026-04-20

## 배경

SP4 레이어드 리팩터와 SP4 후속 정리(Fix 1~4) 완료 후, 자기학습 루프 자체는 코드 레벨에서 동작한다(`runImprovementCycle`이 `core/creative/*.ts`의 프롬프트를 수정하고 git 커밋). 그러나 운영 관점에서 3가지 결함이 남아있다:

1. **개선(`runImprovementCycle`)이 cron에 연결되지 않음** — 수동 `npm run improve` 호출에만 의존
2. **스케줄러가 터미널 수명에 종속** — `cli/monitor/scheduler.ts`가 node-cron으로 돌지만 `npm run monitor` 프로세스가 죽으면 같이 죽음. 터미널 닫으면 학습 중단.
3. **Owner(TUI) / Customer(미래 API 서버) 모드 간 스케줄링 공유 부재** — 같은 자기학습 로직을 두 모드 모두에서 돌릴 경로가 없음

사용자는 개인 Mac에서 TUI로 Meta 광고를 운영하며, 미래에는 API 서버 배포도 계획 중. 두 환경 모두에서 **터미널 종속 없이** 자기학습 루프가 지속 실행되어야 한다.

## 목표

- 터미널/TUI 수명과 독립된 자기학습 루프
- Owner 모드(개인 Mac)와 Customer 모드(미래 API 서버) 모두에서 동일한 스케줄링 로직 재사용
- Mac 슬립 시 missed fire에 대한 catch-up 보장
- Owner 모드에서 기본값보다 공격적인 분석 주기

**비목표**: Customer 배포 파이프라인, `data/` SQLite 이관, 분석 히스토리 재주입, cadence 런타임 변경, 분산 리더 선출, 토큰 자동 갱신 (5.1 참조).

## 전제 (사용자 확인)

- 주기 전략: 일일 수집 + 주간 개선 (기본)
- 운영 환경: 개인 Mac. 평소 슬립, 깨어남 시 catch-up 허용
- Meta API 자격증명: 사용자가 런타임에 주입. 설계는 존재를 전제
- 학습의 영속성: Claude 세션이 아닌 **코드(git)와 데이터(JSON 파일)**에 저장됨. 세션 재생성/재배포 무관

---

## 섹션 1 — 아키텍처 개요

**3개의 독립 프로세스, 1개의 공유 데이터 디렉터리**

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│  TUI (owner) │     │  Worker (daemon) │     │  API Server  │
│  cli/entries │     │  cli/entries/    │     │  server/     │
│  /app.ts     │     │  worker.ts       │     │  index.ts    │
└──────┬───────┘     └────────┬─────────┘     └──────┬───────┘
       │                      │                      │
       └──────────┬───────────┴──────────┬───────────┘
                  ▼                      ▼
          data/ (JSON 파일)      core/scheduler/ (공유 로직)
```

- **TUI**: 광고 생성/검토/런치 인터랙션. 스케줄러 없음.
- **Worker**: launchd LaunchAgent. `core/scheduler`를 node-cron으로 구동. Owner 모드 전용. 개인 Mac에서 상시 실행.
- **API Server**: Customer 모드 배포 시 기동. 시작 루틴에서 동일 `core/scheduler`를 on-process로 등록.

### 공유 계약

모두 `data/` JSON 파일(`campaigns/`, `reports/`, `worker-state.json`)에 읽고 쓴다. git 커밋은 worker/server만 수행 (TUI는 사용자 인터랙션 세션이므로 자동 커밋 금지).

### 원칙

1. `core/scheduler/`는 pure — node-cron, `bizSdk`, `Anthropic` 등 I/O는 주입/지연 호출
2. Worker와 TUI 동시 실행 허용 — worker는 읽기+쓰기, TUI는 읽기 위주. `appendJson`은 이미 atomic에 가까움
3. Worker는 단일 인스턴스 — launchd가 중복 실행 방지. Lock 파일은 YAGNI

### 학습의 영속성 (명시)

자기학습은 **Claude API 세션에 저장되는 것이 아니라** 아래 위치에 물리적으로 기록된다:

| 학습 내용 | 저장 위치 | 재배포 영향 |
|----------|----------|------------|
| 프롬프트/코드 개선 | git 커밋된 소스 파일 | 재배포 시 최신 커밋 포함 → 그대로 적용 |
| 성과 데이터 | `data/reports/YYYY-MM-DD.json` | persistent volume 필요 (Customer 모드) |
| 주간 분석 결과 | `data/reports/weekly-analysis-*.json` | 동일 |

Claude API는 매번 stateless 호출이지만, 위 데이터가 input으로 들어가므로 학습 맥락이 보존된다. Owner 모드에서는 로컬 디스크로 자연 영속. Customer 모드 배포 시에는 persistent volume 필수 (별건 스펙).

---

## 섹션 2 — 컴포넌트 설계

### 2.1 `core/scheduler/` (신규, pure 로직)

```
core/scheduler/
├── index.ts        — 공개 API: registerJobs(cron, deps, cadence)
├── cadence.ts      — OWNER_CADENCE, SERVER_CADENCE preset
├── state.ts        — shouldCatchup 순수 함수 + WorkerState 타입
├── index.test.ts
└── state.test.ts
```

```ts
// core/scheduler/index.ts
export interface SchedulerDeps {
  collectDailyReports: () => Promise<unknown>;
  generateWeeklyAnalysis: () => Promise<unknown>;
  runImprovementCycle: () => Promise<unknown>;
}

export interface CronLike {
  schedule: (expr: string, fn: () => void | Promise<void>) => void;
}

export interface Cadence {
  collectCron: string;
  analyzeCron: string;
  catchupCollectMs: number;
  catchupAnalyzeMs: number;
}

export function registerJobs(
  cron: CronLike,
  deps: SchedulerDeps,
  cadence: Cadence,
  runExclusive: <T>(fn: () => Promise<T>) => Promise<T>,
): void {
  cron.schedule(cadence.collectCron, () => runExclusive(async () => {
    await deps.collectDailyReports();
    await updateStateField("lastCollect");
  }));
  cron.schedule(cadence.analyzeCron, () => runExclusive(async () => {
    await deps.generateWeeklyAnalysis();
    await deps.runImprovementCycle();
    await updateStateField("lastAnalyze");
  }));
}
```

**왜 pure?** `CronLike` 추상화로 fake 스케줄러 주입 가능. deps와 mutex 주입으로 I/O 없는 단위 테스트 가능. `updateStateField`는 state.ts에서 import되는 내부 helper (fs 의존이지만 경계 명확).

### 2.2 `cli/entries/worker.ts` (신규)

```ts
import cron from "node-cron";
import { registerJobs } from "../../core/scheduler/index.js";
import { OWNER_CADENCE } from "../../core/scheduler/cadence.js";
import { runCatchupIfNeeded } from "../../core/scheduler/state.js";
import { collectDailyReports, generateWeeklyAnalysis } from "../../core/campaign/monitor.js";
import { runImprovementCycle } from "../../core/improver/runner.js";

const deps = { collectDailyReports, generateWeeklyAnalysis, runImprovementCycle };

// cron 을 먼저 등록해서 다음 정시 fire 를 놓치지 않음
registerJobs(cron, deps, OWNER_CADENCE);
console.log("[worker] scheduler registered, awaiting cron fires");

// catch-up 은 백그라운드로 실행 (분석+개선이 수 분 걸릴 수 있으므로 main loop 차단 금지)
void runCatchupIfNeeded(deps, OWNER_CADENCE).catch((err) => {
  console.error("[worker] catchup failed:", err);
});

process.stdin.resume();                              // keep process alive
```

프로세스 수명: launchd 관리. 로그는 plist의 `StandardOutPath`/`StandardErrorPath`로 파일 리다이렉트.

**catch-up 과 cron 동시 실행 충돌**: catch-up 실행 중 cron fire가 발생하면 같은 job이 동시 진행될 수 있음. 해결은 섹션 3.3의 in-process 직렬화 로직에서 다룸.

### 2.3 launchd plist

`scripts/com.adai.worker.plist` (템플릿):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.adai.worker</string>
  <key>ProgramArguments</key>
  <array>
    <string>__NODE_PATH__</string>
    <string>__PROJECT_ROOT__/dist/cli/entries/worker.js</string>
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
  </dict>
</dict>
</plist>
```

`KeepAlive` + `RunAtLoad`: 데몬이 죽으면 launchd가 재시작. 부팅 시 자동 기동. Mac 슬립 시 놓친 cron fire는 launchd가 자동 catch-up 하지 **않으므로** 섹션 3.2의 `runCatchupIfNeeded`로 자체 처리.

### 2.4 `runImprovementCycle` 리로케이션 (사전 조건)

현재 `cli/improver/runner.ts`의 `runImprovementCycle`은 CLI 경로에 있음. Customer 모드(server)가 이를 호출하려면 `server/` → `cli/` 레이어 위반이 됨.

**해결**: `runImprovementCycle`을 `core/improver/runner.ts`로 이동. CLI 전용 로직(TUI 로그 출력 등)이 섞여 있다면 pure 부분만 core로 분리, CLI 표시 레이어는 `cli/improver/runner.ts`에 thin wrapper로 남김.

현재 `cli/improver/runner.ts`의 내용 확인 결과 (이 스펙 작성 시점):
- `runImprovementCycle`은 `readJson`/`writeFile`/`applyCodeChange` 등 storage/fs 의존. Pure하지 않지만 CLI-UI 의존도 없음
- 같은 파일의 `filterSafeImprovementFiles` (순수)와 `CTR_THRESHOLD` import만 함께 이동하면 됨
- `cli/improver/runner.test.ts` 도 `core/improver/runner.test.ts`로 이동

이동 후 import 체계:
```ts
// core/improver/runner.ts  (이동됨)
export function filterSafeImprovementFiles(...) { ... }
export async function runImprovementCycle(...) { ... }

// cli/entries/worker.ts
import { runImprovementCycle } from "../../core/improver/runner.js";

// server/scheduler.ts
import { runImprovementCycle } from "../core/improver/runner.js";
```

### 2.5 `server/scheduler.ts` (신규, Customer 모드 훅)

```ts
import cron from "node-cron";
import { registerJobs } from "../core/scheduler/index.js";
import { SERVER_CADENCE } from "../core/scheduler/cadence.js";
import { runCatchupIfNeeded } from "../core/scheduler/state.js";
import { collectDailyReports, generateWeeklyAnalysis } from "../core/campaign/monitor.js";
import { runImprovementCycle } from "../core/improver/runner.js";

export async function startScheduler(): Promise<void> {
  const deps = { collectDailyReports, generateWeeklyAnalysis, runImprovementCycle };
  // catch-up 은 cron 등록 후 백그라운드로 실행 (섹션 3.2 참조)
  registerJobs(cron, deps, SERVER_CADENCE);
  void runCatchupIfNeeded(deps, SERVER_CADENCE).catch((err) => {
    console.error("[scheduler] catchup failed:", err);
  });
}
```

`server/index.ts` 기동 루틴에서 `await startScheduler()` 호출. Customer 배포 시 서버가 worker 역할 겸함.

### 2.6 `scripts/install-worker.sh` (신규)

```bash
#!/bin/bash
set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_PATH="$(which node)"
PLIST_SRC="$PROJECT_ROOT/scripts/com.adai.worker.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.adai.worker.plist"

# 1. TypeScript 빌드
npm run build

# 2. 로그 디렉터리 생성
mkdir -p "$PROJECT_ROOT/logs"

# 3. plist 치환 후 설치
sed -e "s|__PROJECT_ROOT__|$PROJECT_ROOT|g" \
    -e "s|__NODE_PATH__|$NODE_PATH|g" \
    "$PLIST_SRC" > "$PLIST_DST"

# 4. 기존 등록 해제 후 재등록 (멱등성)
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"

echo "Worker installed. Logs: $PROJECT_ROOT/logs/worker.{log,err}"
echo "환경변수(META_ACCESS_TOKEN 등)는 plist를 직접 편집하거나 launchctl setenv로 주입하세요."
```

**환경변수 주입 절차** (install-worker.sh는 `__INJECT__`를 치환하지 않음 — 사용자 수동 편집):

1. `bash scripts/install-worker.sh` 실행 → plist가 `~/Library/LaunchAgents/com.adai.worker.plist`에 경로 치환된 상태로 설치됨
2. 설치된 plist를 에디터로 열어 `__INJECT__` 3곳을 실제 토큰 값으로 치환
3. `launchctl unload ~/Library/LaunchAgents/com.adai.worker.plist && launchctl load ~/Library/LaunchAgents/com.adai.worker.plist` 로 재등록

템플릿 `scripts/com.adai.worker.plist`는 `__INJECT__` 플레이스홀더를 유지한 채 커밋. 설치된 `~/Library/LaunchAgents/...`는 실제 토큰이 들어가므로 git 외부 영역(사용자 홈)에 위치 → 유출 위험 없음.

대안: `launchctl setenv KEY VALUE` 로 사용자 세션 전역에 환경변수 주입 후 plist의 `EnvironmentVariables` 항목 제거. 이 방식은 Mac 로그인 유지 시에만 유효.

---

## 섹션 3 — 데이터 흐름 및 Catch-up

### 3.1 정상 흐름

```
[collectCron fires]                      [analyzeCron fires]
      │                                        │
      ▼                                        ▼
collectDailyReports()                  generateWeeklyAnalysis()
      │                                        │
      ▼                                        ▼
  Meta API 호출                          최근 7일치 reports 읽기
  (fetchInsights 루프)                          │
      │                                        ▼
      ▼                                Claude 호출 → JSON 개선 제안
data/reports/                                   │
YYYY-MM-DD.json                                 ▼
  (append)                           weekly-analysis-YYYY-MM-DD.json
                                                │
                                                ▼
                                       runImprovementCycle()
                                                │
                                                ▼
                                       Claude patch → applyCodeChange()
                                                │
                                                ▼
                                       git add + git commit
```

### 3.2 Catch-up 전략

**문제**: Mac이 `analyzeCron` fire 시각에 슬립이면 node-cron은 fire를 **완전히 스킵**. 다음 주기까지 기다림.

**해결**: `data/worker-state.json`에 마지막 성공 시각 기록 + 기동 시 + 각 cron fire 후 검사.

```ts
// core/scheduler/state.ts
export interface WorkerState {
  lastCollect: string | null;    // ISO timestamp
  lastAnalyze: string | null;
}

export interface CatchupDecision {
  collect: boolean;
  analyze: boolean;
}

export function shouldCatchup(
  state: WorkerState,
  cadence: Cadence,
  now: number
): CatchupDecision {
  const collectAge = state.lastCollect ? now - Date.parse(state.lastCollect) : Infinity;
  const analyzeAge = state.lastAnalyze ? now - Date.parse(state.lastAnalyze) : Infinity;
  return {
    collect: collectAge >= cadence.catchupCollectMs,
    analyze: analyzeAge >= cadence.catchupAnalyzeMs,
  };
}

export async function runCatchupIfNeeded(
  deps: SchedulerDeps,
  cadence: Cadence
): Promise<void> {
  const state = (await readJson<WorkerState>("data/worker-state.json"))
    ?? { lastCollect: null, lastAnalyze: null };
  const decision = shouldCatchup(state, cadence, Date.now());

  if (decision.collect) {
    await deps.collectDailyReports();
    state.lastCollect = new Date().toISOString();
  }
  if (decision.analyze) {
    await deps.generateWeeklyAnalysis();
    await deps.runImprovementCycle();
    state.lastAnalyze = new Date().toISOString();
  }
  await writeJson("data/worker-state.json", state);
}
```

**state 갱신 시점**: catch-up에서도 갱신하고, cron fire 성공 시에도 갱신해야 함. 섹션 3.5 참조.

**판정 근거**: Owner cadence는 `catchupCollectMs = 6h`, `catchupAnalyzeMs = 2d`. Server cadence는 `24h`, `7d`. 각 cadence와 동일하거나 소폭 여유를 둘 수도 있지만, 정확히 일치시키면 슬립 중 한 주기를 놓쳤을 때 깨어나자마자 실행.

### 3.3 중복 실행 방지 및 in-process 직렬화

**프로세스 간**:
- Worker 단일 인스턴스: launchd `KeepAlive` + 단일 plist로 보장
- TUI와 동시 실행: TUI는 스케줄러 미포함이라 스케줄 측 충돌 없음. 다만 TUI는 `data/campaigns/`에 쓰기가 있음(캠페인 생성/런치 시) → worker가 `data/reports/`에 쓰는 것과 경로가 다르므로 실제 파일 충돌 없음. `data/worker-state.json`은 worker 전용이라 TUI 손대지 않음
- Server 재시작 catch-up: 직전에 이미 실행됐으면 `shouldCatchup`이 false 반환 → 중복 실행 없음

**프로세스 내 (async race)**:

같은 worker 프로세스 안에서도:
- catch-up 이 백그라운드로 돌고 있을 때 정시 cron fire 발생
- collectCron 과 analyzeCron 이 같은 정각에 fire (예: 자정 00:00)

→ 같은 job 이 동시 실행되거나 state 파일 write race 발생 가능.

**해결: 간단한 promise-based 뮤텍스**

```ts
// core/scheduler/mutex.ts
export function createMutex() {
  let tail: Promise<unknown> = Promise.resolve();
  return async function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = tail;
    let release!: () => void;
    tail = new Promise((r) => { release = r; });
    await prev;
    try { return await fn(); }
    finally { release(); }
  };
}
```

- `registerJobs`, `runCatchupIfNeeded`, state writer 모두 같은 mutex 인스턴스로 감싸면 순차 실행 보장
- 외부 분산 락이 아닌 단일 프로세스 내 직렬화라 node-cron 콜백 오버랩 케이스에만 적용
- TUI/server/worker 각자의 프로세스는 별도 mutex — 프로세스 간 충돌은 state 파일이 `shouldCatchup`의 시간 비교로 방지

### 3.4 실패 시 동작

- **Meta API 실패**: `fetchInsights` try/catch로 null 반환. 해당 캠페인만 스킵, 전체 job은 성공으로 간주 → state 갱신.
- **Claude 호출 실패**: job 전체 throw. state **갱신하지 않음** → 다음 기동/cron fire에서 재시도.
- **`applyCodeChange` 실패**: 기존 구현대로 해당 item만 스킵, 나머지 진행. job 자체는 성공.
- **git commit 실패**: 스킵, 경고 로그. state 갱신 여부는 `runImprovementCycle`의 반환/throw 정책을 따름 (현재 throw하지 않음 → state 갱신됨. 다음 주기에 재시도 효과).
- **`writeJson("worker-state.json")` 실패 (디스크 full, 권한 등)**: catch + 경고 로그 후 무시. 다음 기동 시 state 파일이 오래되어 보이므로 catch-up이 반복 실행됨. 실사용에서 디스크 full 은 Mac 전체가 동작 불능 상태이므로 worker 선에서 복구 책임지지 않음. 운영자가 로그로 감지.
- **catch-up 자체 실패**: worker.ts의 `void runCatchupIfNeeded(...).catch(log)` 로 swallow. cron 등록은 이미 완료되어 있으므로 다음 cron fire 로 자연 복구.

### 3.5 cron fire 시 state 갱신

`registerJobs`의 콜백에서도 state를 갱신해야 catch-up과 일관됨. 위 2.1의 `registerJobs` 시그니처가 이미 `updateStateField` 호출을 포함.

`updateStateField`는 state 파일을 read-modify-write. 같은 프로세스 내 async race는 3.3의 mutex로 직렬화되고, 프로세스 간 race는 launchd 단일 인스턴스 보장으로 존재하지 않음.

### 3.6 Cadence Presets

```ts
// core/scheduler/cadence.ts
const HOUR = 3600_000;
const DAY = 24 * HOUR;

export const OWNER_CADENCE: Cadence = {
  collectCron: "0 */6 * * *",        // 매 6시간 (00, 06, 12, 18시)
  analyzeCron: "0 9 */2 * *",        // 2일마다 09:00
  catchupCollectMs: 6 * HOUR,
  catchupAnalyzeMs: 2 * DAY,
};

export const SERVER_CADENCE: Cadence = {
  collectCron: "0 9 * * *",          // 매일 09:00
  analyzeCron: "0 9 * * 1",          // 월요일 09:00
  catchupCollectMs: 24 * HOUR,
  catchupAnalyzeMs: 7 * DAY,
};
```

**Owner 주기 선택 근거**: 수집은 Meta API 무료이므로 4배 자주 해도 비용 증가 없음 — 시간대별 성과 패턴 파악 가능. 분석+개선은 48시간치 샘플이면 통계적으로 유의미하면서도 주간 대비 3.5배 빠른 iteration.

---

## 섹션 4 — 테스트 전략

### 4.1 `core/scheduler/index.test.ts`

Pure 로직. Fake cron + fake deps + passthrough mutex 주입:

```ts
const passthrough = <T,>(fn: () => Promise<T>) => fn();

test("registerJobs 가 collectCron, analyzeCron 에 대해 스케줄을 등록한다", () => {
  const calls: [string, () => Promise<void>][] = [];
  const fakeCron: CronLike = { schedule: (expr, fn) => { calls.push([expr, fn as any]); } };
  const deps: SchedulerDeps = {
    collectDailyReports: vi.fn(async () => []),
    generateWeeklyAnalysis: vi.fn(async () => ""),
    runImprovementCycle: vi.fn(async () => {}),
  };
  registerJobs(fakeCron, deps, OWNER_CADENCE, passthrough);
  expect(calls[0][0]).toBe("0 */6 * * *");
  expect(calls[1][0]).toBe("0 9 */2 * *");
});

test("analyze 콜백은 generateWeeklyAnalysis → runImprovementCycle 순서로 호출한다", async () => {
  const log: string[] = [];
  const deps: SchedulerDeps = {
    collectDailyReports: vi.fn(async () => []),
    generateWeeklyAnalysis: vi.fn(async () => { log.push("analyze"); return ""; }),
    runImprovementCycle: vi.fn(async () => { log.push("improve"); }),
  };
  const calls: [string, () => Promise<void>][] = [];
  const fakeCron: CronLike = { schedule: (expr, fn) => { calls.push([expr, fn as any]); } };
  registerJobs(fakeCron, deps, OWNER_CADENCE, passthrough);
  await calls[1][1]();
  expect(log).toEqual(["analyze", "improve"]);
});
```

### 4.1b `core/scheduler/mutex.test.ts`

```ts
test("createMutex 는 순차 실행을 강제한다", async () => {
  const mutex = createMutex();
  const log: string[] = [];
  const a = mutex(async () => { log.push("a-start"); await delay(20); log.push("a-end"); });
  const b = mutex(async () => { log.push("b-start"); await delay(10); log.push("b-end"); });
  await Promise.all([a, b]);
  expect(log).toEqual(["a-start", "a-end", "b-start", "b-end"]);
});

test("createMutex 는 throw 후에도 큐를 계속 진행한다", async () => {
  const mutex = createMutex();
  const a = mutex(async () => { throw new Error("boom"); });
  const b = mutex(async () => "ok");
  await expect(a).rejects.toThrow("boom");
  await expect(b).resolves.toBe("ok");
});
```

### 4.2 `core/scheduler/state.test.ts`

```ts
test("shouldCatchup: lastCollect 가 catchupCollectMs 이상 경과하면 collect true", () => {
  const state: WorkerState = { lastCollect: "2026-04-19T00:00:00Z", lastAnalyze: null };
  const now = Date.parse("2026-04-19T06:00:00Z");    // 6h 경과
  const result = shouldCatchup(state, OWNER_CADENCE, now);
  expect(result.collect).toBe(true);                  // Owner: 6h 기준 충족
  expect(result.analyze).toBe(true);                  // null → Infinity > 2d
});

test("shouldCatchup: 주기 미만이면 skip", () => {
  const state: WorkerState = {
    lastCollect: "2026-04-19T00:00:00Z",
    lastAnalyze: "2026-04-19T00:00:00Z",
  };
  const now = Date.parse("2026-04-19T01:00:00Z");    // 1h 경과
  const result = shouldCatchup(state, OWNER_CADENCE, now);
  expect(result.collect).toBe(false);
  expect(result.analyze).toBe(false);
});
```

순수 함수이므로 timestamp만 비교. 파일 I/O는 경계(`runCatchupIfNeeded`)에서만 발생.

### 4.3 `cli/entries/worker.ts`

단위 테스트 없음. `registerJobs` + `runCatchupIfNeeded` + `process.stdin.resume()`의 세 줄짜리 bootstrap. 로직은 모두 `core/scheduler/`에 있고 거기서 테스트됨.

**수동 검증 체크리스트** (README 문서화):
- `bash scripts/install-worker.sh` 실행 후 `launchctl list | grep com.adai.worker`로 등록 확인
- `logs/worker.log`에 "[worker] scheduler registered" 로그 확인
- `ps -ef | grep worker.js`로 프로세스 실행 확인
- Mac 슬립 → 깨어남 시퀀스 후 `data/worker-state.json` timestamp 갱신 확인

### 4.4 `server/scheduler.test.ts`

Smoke test: `startScheduler()` 호출 시 `registerJobs`가 `SERVER_CADENCE`로 호출되는지 확인.

```ts
test("startScheduler 는 SERVER_CADENCE 로 registerJobs 를 호출한다", async () => {
  // registerJobs 와 runCatchupIfNeeded 를 스파이 처리, cadence 인자만 검증
  // (구체 구현은 구현 시 결정)
});
```

### 4.5 비테스트 영역

- launchd plist 자체 — 수동 검증. `launchctl list | grep adai`로 등록 상태만 확인
- 실제 Meta API / Claude 호출 — 기존 `core/campaign/monitor.test.ts`, `core/improver/index.test.ts`, `cli/improver/runner.test.ts`가 담당
- git commit 동작 — `applyCodeChange`의 기존 스코프
- 설치 스크립트(`install-worker.sh`) — 수동 실행 검증

---

## 섹션 5 — 비범위 및 문서 업데이트

### 5.1 비범위

- **Customer 배포 파이프라인 전체**: `server/scheduler.ts` 훅만 추가. Docker/K8s 배포, persistent volume 구성은 별건
- **`data/` → SQLite 이관**: 파일 시스템 영속성 전제. Customer 모드에서 필요 시 별건 스펙
- **분석 히스토리 재주입**: "지난주 개선 내역을 이번 주 분석에 포함"은 YAGNI. 현재 스펙은 영속성만 보장
- **Cadence 런타임 변경**: preset 2개로 충분. Hot reload YAGNI
- **Lock 파일 / 분산 리더 선출**: launchd 단일 인스턴스 보장. Customer 레플리카는 현재 없음
- **개선 실패 알림(Slack/이메일)**: 로그 파일로 충분. Tier 3
- **Meta 토큰 60일 만료 자동 갱신**: 수동 관리. 만료 시 `fetchInsights`가 null 반환 → 기존 방어 로직 처리
- **로그 로테이션**: `logs/worker.log`, `logs/worker.err` 무한 누적. 실사용 규모에서 수 개월 단위로 MB 급. 운영자가 필요 시 수동 truncate 또는 `newsyslog` 설정. Tier 3
- **`cli/monitor/scheduler.ts` 와 `cli/entries/monitor.ts` mode=cron 제거**: 본 스펙에서 제거 대상. 수동 트리거용 `mode=daily`, `mode=weekly`는 유지

### 5.2 문서 업데이트

구현 후 반드시:
- `docs/STATUS.md`: "자기학습 워커 (launchd)" 컴포넌트 추가, 최근 변경 이력에 한 줄, 마지막 업데이트 날짜 갱신
- `docs/ROADMAP.md`: "자기학습 루프 cron 연결" 관련 항목 제거, 다음 작업 재설정
- `docs/ARCHITECTURE.md`: §8에 Worker 프로세스 추가. 3-프로세스 다이어그램 갱신. "왜 launchd인가" 설계 결정(Why) 추가
- `README.md`: Worker 설치 방법(install-worker.sh 실행, 환경변수 주입, 로그 확인 경로) 섹션 추가

### 5.3 파일 구조 요약

```
신규:
  core/scheduler/index.ts
  core/scheduler/cadence.ts
  core/scheduler/state.ts
  core/scheduler/mutex.ts
  core/scheduler/index.test.ts
  core/scheduler/state.test.ts
  core/scheduler/mutex.test.ts
  core/improver/runner.ts            (cli/improver/runner.ts 이동)
  core/improver/runner.test.ts       (cli/improver/runner.test.ts 이동)
  cli/entries/worker.ts
  server/scheduler.ts
  server/scheduler.test.ts
  scripts/com.adai.worker.plist
  scripts/install-worker.sh

수정:
  server/index.ts                    (기동 시 await startScheduler() 호출)
  cli/entries/improve.ts             (runImprovementCycle import 경로 갱신)
  docs/STATUS.md
  docs/ROADMAP.md
  docs/ARCHITECTURE.md
  README.md

제거:
  cli/monitor/scheduler.ts           (worker 로 대체)
  cli/improver/runner.ts             (core 로 이동됨)
  cli/improver/runner.test.ts        (core 로 이동됨)
  cli/entries/monitor.ts 내 mode=cron 브랜치 (mode=daily, mode=weekly 유지)
```

### 5.4 마이그레이션 영향

- 기존 `npm run monitor -- --cron` 사용자는 없음(로컬 개발자 본인). 제거 안전
- `runImprovementCycle` 이동: `cli/improver/runner.ts` → `core/improver/runner.ts`. 이를 import하는 `cli/entries/improve.ts`와 신규 `cli/entries/worker.ts`, `server/scheduler.ts`는 새 경로 사용
- `core/campaign/monitor.ts` 의 `collectDailyReports`, `generateWeeklyAnalysis` export 재사용 (변경 없음)
- 기존 data/ 구조 변경 없음. `worker-state.json` 추가만
- 로그 디렉터리 `logs/` 신규 (`.gitignore` 추가)

---

## 작업 순서 (구현 단계 제안, plan에서 구체화)

1. `runImprovementCycle` 리로케이션: `cli/improver/runner.ts` → `core/improver/runner.ts` (테스트 파일 동반 이동 + `cli/entries/improve.ts` import 경로 갱신)
2. `core/scheduler/` — mutex, cadence, state, registerJobs + 각 테스트
3. `cli/entries/worker.ts` + plist 템플릿 + install-worker.sh
4. `server/scheduler.ts` + `server/index.ts` 기동 훅
5. `cli/monitor/scheduler.ts` 제거 + `cli/entries/monitor.ts` mode=cron 제거
6. 문서 갱신 (STATUS, ROADMAP, ARCHITECTURE, README), `.gitignore`에 `logs/` 추가

각 단계는 독립 커밋. 1이 먼저여야 2·3·4가 core 경로로 import 가능.

---

## 검토 이력

- 2026-04-20 초안 작성
- 2026-04-20 자체 검토 패치:
  - Critical: `server/` → `cli/improver/` import 레이어 위반 해소 — `runImprovementCycle`을 `core/improver/runner.ts`로 이동하는 사전 단계 추가 (§2.4)
  - Critical: worker-state.json async write race 대응 — in-process promise mutex 도입, `registerJobs` 시그니처에 `runExclusive` 주입 (§3.3, §2.1)
  - Important: 기동 시 catch-up 동기 실행으로 인한 cron fire 지연 해소 — cron 등록 먼저, catch-up은 백그라운드로 전환 (§2.2, §2.5)
  - Important: state write 실패 / catch-up 실패 케이스 명시 (§3.4)
  - Important: 로그 로테이션 비범위 명시 (§5.1)
  - Minor: §2.1과 §3.5의 `registerJobs` 예시 일치화
  - Minor: 환경변수 주입 절차 (`__INJECT__` 수동 편집 필요) 명시 (§2.3)
  - Minor: TUI "읽기 위주" 표현을 "경로가 다른 파일에 쓰므로 충돌 없음"으로 정정 (§3.3)

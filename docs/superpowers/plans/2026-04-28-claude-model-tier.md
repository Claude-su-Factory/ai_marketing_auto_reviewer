# Claude 모델 tier 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 6 callsites 의 하드코딩 `claude-sonnet-4-6` 을 use-case 별 상수로 centralize. Parser 는 Haiku 4.5 다운그레이드 (~73% 비용 절감 / scrape), Copy/Analysis/Improver 는 Sonnet 4.6 유지.

**Architecture:** 1 atomic commit. 신규 `packages/core/src/config/claudeModels.ts` 에 4 use-case 상수 (`MODEL_PARSER`/`MODEL_COPY`/`MODEL_ANALYSIS`/`MODEL_IMPROVER`) 정의. 6 callsites 가 import 후 사용. 테스트 1 신규 + 1 갱신.

**Tech Stack:** TypeScript, vitest, Anthropic SDK. tsx 런타임.

**Spec:** `docs/superpowers/specs/2026-04-28-claude-model-tier-design.md` (commit `a1e88f9`)

**브랜치:** master 직접 commit (CLAUDE.md 정책).

**견적:** ~2.3h.

**Subagent 호출:**
- `superpowers:code-reviewer` (model ID centralize 패턴 검증)
- DEFAULT_PROMPTS / buildCopyPrompt 변경 없음 → `marketing-copy-reviewer` 트리거 안 함
- `packages/core/src/platform/meta/*` 무변경 → `meta-platform-expert` 트리거 안 함

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
Expected 최상단: `a1e88f9 docs(specs): add Claude 모델 tier 분리 design spec`

- [ ] **Step 3: Test baseline**
```bash
npm test 2>&1 | grep "Test Files\|Tests " | tail -3
```
Expected: 449 passing + 1 useReports 알려진 flake.

- [ ] **Step 4: TypeScript clean**
```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
npx tsc --noEmit -p packages/cli/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
npx tsc --noEmit -p packages/server/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
```
Expected: 0 errors after filter.

- [ ] **Step 5: 모든 callsite 사전 확인**
```bash
grep -rn "claude-sonnet-4-6\|claude-haiku" packages/ --include="*.ts" | grep -v "\.test\."
```
Expected 6 hits:
- `packages/core/src/improver/runner.ts:109`
- `packages/core/src/product/parser.ts:38`
- `packages/core/src/campaign/monitor.ts:152`
- `packages/core/src/creative/copy.ts:17`
- `packages/server/src/routes/aiAnalyze.ts:31`
- `packages/cli/src/actions.ts:265`

만약 라인 번호가 위와 다르면 (다른 commit 으로 인한 shift) 실제 위치 사용.

---

## Task 1: 신규 `claudeModels.ts` 작성

**Files:**
- Create: `packages/core/src/config/claudeModels.ts`

- [ ] **Step 1: 신규 파일 작성**

```ts
/** Claude 모델 ID — use-case 별 tier 분리. 변경 시 이 파일 1곳만 수정. */

// HTML → JSON 추출 (mechanical, schema 강제, 한국어 nuance 영향 작음)
export const MODEL_PARSER = "claude-haiku-4-5";

// 한국어 광고 카피 작성 (한국어 nuance + banned-pattern 준수 critical)
export const MODEL_COPY = "claude-sonnet-4-6";

// CTR 분석 + prompt 개선안 제안 (reasoning + 자기학습 input)
export const MODEL_ANALYSIS = "claude-sonnet-4-6";

// 분석 결과로 prompt 재작성 (모든 미래 카피 영향, very high stakes)
export const MODEL_IMPROVER = "claude-sonnet-4-6";
```

- [ ] **Step 2: TypeScript check (이 파일 단독)**

```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep "claudeModels" | head
```
Expected: 0 errors (export 만 있는 단순 파일).

---

## Task 2: 신규 `claudeModels.test.ts` 작성

**Files:**
- Create: `packages/core/src/config/claudeModels.test.ts`

- [ ] **Step 1: 3 케이스 테스트 작성**

```ts
import { describe, it, expect } from "vitest";
import { MODEL_PARSER, MODEL_COPY, MODEL_ANALYSIS, MODEL_IMPROVER } from "./claudeModels.js";

describe("Claude model tier constants", () => {
  it("exports MODEL_PARSER as Haiku tier (low-stakes mechanical)", () => {
    expect(MODEL_PARSER).toMatch(/haiku/);
  });

  it("exports MODEL_COPY / MODEL_ANALYSIS / MODEL_IMPROVER as Sonnet tier (high-stakes Korean nuance + reasoning)", () => {
    expect(MODEL_COPY).toMatch(/sonnet/);
    expect(MODEL_ANALYSIS).toMatch(/sonnet/);
    expect(MODEL_IMPROVER).toMatch(/sonnet/);
  });

  it("all constants are non-empty Anthropic model IDs", () => {
    for (const id of [MODEL_PARSER, MODEL_COPY, MODEL_ANALYSIS, MODEL_IMPROVER]) {
      expect(id).toMatch(/^claude-/);
      expect(id.length).toBeGreaterThan(8);
    }
  });
});
```

- [ ] **Step 2: 테스트 실행**

```bash
npx vitest run packages/core/src/config/claudeModels.test.ts 2>&1 | tail -5
```
Expected: 3 cases passing.

---

## Task 3: `parser.ts` — MODEL_PARSER 사용 (Haiku 다운그레이드)

**Files:**
- Modify: `packages/core/src/product/parser.ts:1-3` (import 추가), `:38` (model 변경)

- [ ] **Step 1: import 추가 (line 1-3 영역)**

기존:
```ts
import Anthropic from "@anthropic-ai/sdk";
import type { Product } from "../types.js";
import { randomUUID } from "crypto";
```

변경 후 (3번째 import 다음 추가):
```ts
import Anthropic from "@anthropic-ai/sdk";
import type { Product } from "../types.js";
import { randomUUID } from "crypto";
import { MODEL_PARSER } from "../config/claudeModels.js";
```

- [ ] **Step 2: line 38 model 변경**

기존:
```ts
const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  ...
```

변경:
```ts
const response = await client.messages.create({
  model: MODEL_PARSER,
  ...
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
```
Expected: 0 errors.

---

## Task 4: `parser.test.ts` — model assertion 갱신

**Files:**
- Modify: `packages/core/src/product/parser.test.ts:55, 59`

- [ ] **Step 1: 테스트 description + assertion 갱신**

기존 (line 55, 59 영역):
```ts
it("uses claude-sonnet-4-6 model with system prompt + ephemeral cache", async () => {
  ...
  expect(callArgs.model).toBe("claude-sonnet-4-6");
  ...
});
```

변경:
```ts
it("uses Haiku tier (MODEL_PARSER) with system prompt + ephemeral cache", async () => {
  ...
  expect(callArgs.model).toMatch(/haiku/);
  ...
});
```

(description 의 "claude-sonnet-4-6" → "Haiku tier (MODEL_PARSER)" 로 변경, assertion 의 `toBe` → `toMatch(/haiku/)` 로 변경. 미래 모델 업그레이드 시 갱신 부담 회피.)

- [ ] **Step 2: 테스트 실행**

```bash
npx vitest run packages/core/src/product/parser.test.ts 2>&1 | tail -5
```
Expected: 9 cases passing (parser.test.ts 의 모든 케이스 — 신규 케이스 추가 안 함, 기존 1 케이스 갱신).

---

## Task 5: `creative/copy.ts` — MODEL_COPY 사용

**Files:**
- Modify: `packages/core/src/creative/copy.ts:1-5` (import), `:17` (model)

- [ ] **Step 1: import 추가**

기존 import 그룹 끝부분에 추가:
```ts
import { MODEL_COPY } from "../config/claudeModels.js";
```

- [ ] **Step 2: line 17 model 변경**

기존:
```ts
model: "claude-sonnet-4-6",
```

변경:
```ts
model: MODEL_COPY,
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
```
Expected: 0 errors.

- [ ] **Step 4: copy.test.ts 영향 확인**

```bash
grep -n "claude-sonnet-4-6\|claude-haiku" packages/core/src/creative/copy.test.ts
```
Expected: 0 hits (copy.test.ts 가 모델 ID 직접 검증 안 함). 만약 있으면 동일 패턴 (`/sonnet/` toMatch) 으로 갱신.

---

## Task 6: `campaign/monitor.ts` — MODEL_ANALYSIS 사용

**Files:**
- Modify: `packages/core/src/campaign/monitor.ts:1-9` (import), `:152` (model)

- [ ] **Step 1: import 추가**

기존 import 그룹 끝부분에 추가:
```ts
import { MODEL_ANALYSIS } from "../config/claudeModels.js";
```

- [ ] **Step 2: line 152 model 변경**

기존:
```ts
model: "claude-sonnet-4-6",
```

변경:
```ts
model: MODEL_ANALYSIS,
```

- [ ] **Step 3: TypeScript check + monitor.test.ts 영향 확인**

```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
grep -n "claude-sonnet-4-6\|claude-haiku" packages/core/src/campaign/monitor.test.ts 2>&1 | head
```
Expected: 0 TS errors, 0 grep hits.

---

## Task 7: `improver/runner.ts` — MODEL_IMPROVER 사용

**Files:**
- Modify: `packages/core/src/improver/runner.ts:1-15` (import), `:109` (model)

- [ ] **Step 1: import 추가**

기존 import 그룹 끝부분 (line 16-17 근처) 에 추가:
```ts
import { MODEL_IMPROVER } from "../config/claudeModels.js";
```

(상단의 다른 imports 와 같은 그룹에 둘 것 — `getCtrThreshold` import 등 따라가는 위치.)

- [ ] **Step 2: line 109 model 변경**

기존:
```ts
model: "claude-sonnet-4-6",
```

변경:
```ts
model: MODEL_IMPROVER,
```

- [ ] **Step 3: TypeScript check + runner.test.ts 영향 확인**

```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
grep -n "claude-sonnet-4-6\|claude-haiku" packages/core/src/improver/runner.test.ts 2>&1 | head
```
Expected: 0 TS errors, 0 grep hits.

---

## Task 8: `cli/actions.ts` — MODEL_ANALYSIS 사용 (runMonitor weekly)

**Files:**
- Modify: `packages/cli/src/actions.ts:1-31` (import), `:265` (model)

- [ ] **Step 1: import 추가**

기존 import 그룹의 `@ad-ai/core/...` 영역에 추가:
```ts
import { MODEL_ANALYSIS } from "@ad-ai/core/config/claudeModels.js";
```

(cli 는 workspace path `@ad-ai/core/...` 사용 — 다른 core import 와 같은 패턴.)

- [ ] **Step 2: line 265 model 변경**

기존:
```ts
const response = await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: 1024, messages: [{ role: "user", content: prompt }] });
```

변경:
```ts
const response = await client.messages.create({ model: MODEL_ANALYSIS, max_tokens: 1024, messages: [{ role: "user", content: prompt }] });
```

- [ ] **Step 3: TypeScript check + actions.test.ts 영향 확인**

```bash
npx tsc --noEmit -p packages/cli/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
grep -n "claude-sonnet-4-6\|claude-haiku" packages/cli/src/actions.test.ts 2>&1 | head
```
Expected: 0 TS errors, 0 grep hits.

---

## Task 9: `server/routes/aiAnalyze.ts` — MODEL_ANALYSIS 사용

**Files:**
- Modify: `packages/server/src/routes/aiAnalyze.ts:1-9` (import), `:31` (model)

- [ ] **Step 1: import 추가**

기존 import 그룹의 `@ad-ai/core/...` 영역에 추가:
```ts
import { MODEL_ANALYSIS } from "@ad-ai/core/config/claudeModels.js";
```

- [ ] **Step 2: line 31 model 변경**

기존:
```ts
model: "claude-sonnet-4-6",
```

변경:
```ts
model: MODEL_ANALYSIS,
```

- [ ] **Step 3: TypeScript check + aiAnalyze.test.ts 영향 확인**

```bash
npx tsc --noEmit -p packages/server/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
grep -rn "claude-sonnet-4-6\|claude-haiku" packages/server/src 2>&1 | grep -v "\.test\." | head
```
Expected: 0 TS errors. grep 결과가 0 hits 면 server 측 모든 callsite 정리 완료.

---

## Task 10: 전체 테스트 + grep verification + STATUS + commit

### Task 10.1: 최종 verification

- [ ] **Step 1: 전체 테스트**

```bash
npm test 2>&1 | grep "Test Files\|Tests " | tail -3
```
Expected: 452 passing + 1 useReports flake (449 baseline + 3 신규 케이스).

- [ ] **Step 2: TypeScript clean**

```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
npx tsc --noEmit -p packages/cli/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
npx tsc --noEmit -p packages/server/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
```
Expected: 0 errors after filter.

- [ ] **Step 3: grep verification — 하드코딩 문자열 사라짐**

```bash
grep -rn "claude-sonnet-4-6\|claude-haiku-4-5" packages/ --include="*.ts" | grep -v "claudeModels\.ts" | wc -l
```
Expected: **0 hits** (claudeModels.ts 의 정의 외 production 코드에 하드코딩 없음).

```bash
grep -rn "claude-sonnet-4-6\|claude-haiku-4-5" packages/ --include="*.ts" --include="*.tsx" | head
```
Expected: claudeModels.ts (정의) + claudeModels.test.ts (값 검증 안 하지만 모델 카테고리 검증) — 추가 hit 없음.

- [ ] **Step 4: grep verification — 신규 상수 사용**

```bash
grep -rn "MODEL_PARSER\|MODEL_COPY\|MODEL_ANALYSIS\|MODEL_IMPROVER" packages/ --include="*.ts" | wc -l
```
Expected: 12+ hits — 정의 (4) + import (6) + 사용 (6) + 테스트 (4 references) — 누적 ~20.

### Task 10.2: STATUS.md 갱신 + R-G2 등록

- [ ] **Step 1: STATUS.md line 3 마지막 업데이트 갱신 (이미 2026-04-28 일 가능성)**

확인:
```bash
head -3 docs/STATUS.md
```
이미 `2026-04-28` 이면 변경 불필요.

- [ ] **Step 2: 알려진 결함 R-G 그룹에 R-G2 추가**

R-G1 entry 다음에 새 R-G2 등록:

```markdown
- **R-G2** Parser Haiku 추출 quality monitor (2026-04-28, Claude 모델 tier 분리 commit) — `parser.ts` 가 Sonnet 4.6 → Haiku 4.5 다운그레이드. 한국어 페이지 추출 정확도 변화 가능 — 특히 `learningOutcomes` / `differentiators` 필드 추출 quality 가 광고 카피 풍부화 효과 직결. 운영 1주 후 추출 결과 verify. 만약 빈 배열 빈도 ↑ 이면: (a) Parser 를 Sonnet 으로 되돌림 (`MODEL_PARSER` 1 줄 변경) 또는 (b) Haiku 용 system prompt 강화 (추출 규칙 명시화).
```

- [ ] **Step 3: 최근 변경 이력 entry 추가**

```markdown
- 2026-04-28 refactor(claude tier): 6 callsites 의 하드코딩 `claude-sonnet-4-6` → use-case 별 상수 (`MODEL_PARSER`/`MODEL_COPY`/`MODEL_ANALYSIS`/`MODEL_IMPROVER`) 로 centralize. Parser 만 Haiku 4.5 다운그레이드 (~73% 비용 절감 / scrape, $0.012 → $0.003). Copy/Analysis/Improver 는 Sonnet 4.6 유지 (한국어 nuance + reasoning critical). 신규 `packages/core/src/config/claudeModels.ts` + 3 테스트. R-G2 (Parser Haiku quality monitor) 등록.
```

### Task 10.3: 명시적 add + commit

- [ ] **Step 1: 명시적 add (NEVER `-A`)**

```bash
git add packages/core/src/config/claudeModels.ts \
  packages/core/src/config/claudeModels.test.ts \
  packages/core/src/product/parser.ts \
  packages/core/src/product/parser.test.ts \
  packages/core/src/creative/copy.ts \
  packages/core/src/campaign/monitor.ts \
  packages/core/src/improver/runner.ts \
  packages/cli/src/actions.ts \
  packages/server/src/routes/aiAnalyze.ts \
  docs/STATUS.md
```

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(claude): tier 분리 — Parser → Haiku 4.5, 나머지 Sonnet 4.6 (use-case 별 상수)

6 callsites 의 하드코딩 `claude-sonnet-4-6` 을 use-case 별 상수로 centralize.
Parser 만 Haiku 4.5 다운그레이드 (~73% 비용 절감 / scrape, $0.012 → $0.003).
Copy / Analysis / Improver 는 Sonnet 4.6 유지 (한국어 nuance + reasoning critical).

신규 packages/core/src/config/claudeModels.ts:
- MODEL_PARSER = "claude-haiku-4-5" (HTML→JSON 추출, mechanical)
- MODEL_COPY = "claude-sonnet-4-6" (한국어 광고 카피 + banned-pattern 준수)
- MODEL_ANALYSIS = "claude-sonnet-4-6" (CTR 분석 + prompt 개선안)
- MODEL_IMPROVER = "claude-sonnet-4-6" (prompt 재작성, 모든 미래 카피 영향)

호출처 6 (3 packages):
- core/product/parser.ts:38 → MODEL_PARSER
- core/creative/copy.ts:17 → MODEL_COPY
- core/campaign/monitor.ts:152 → MODEL_ANALYSIS
- core/improver/runner.ts:109 → MODEL_IMPROVER
- cli/actions.ts:265 (runMonitor weekly analysis) → MODEL_ANALYSIS
- server/routes/aiAnalyze.ts:31 (server proxy, 미실행) → MODEL_ANALYSIS

테스트 +3 (claudeModels.test.ts: tier 패턴 검증 / Anthropic ID 형식 검증):
- 미래 모델 업그레이드 시 테스트 갱신 부담 회피 — `/haiku/`, `/sonnet/` regex 매치만.

parser.test.ts: 모델 assertion `claude-sonnet-4-6` → `/haiku/` toMatch (1 케이스 갱신).

기존 callsites 의 mock 기반 테스트 (copy/monitor/improver/actions/aiAnalyze) 는 모델 ID 직접 검증 안 함 — 영향 없음.

비용 효과:
- Parser 1 호출: $0.012 → $0.003 (~73% 절감)
- Anthropic prompt cache (`cache_control: ephemeral`) 가 Haiku 에서도 동작 — first call 외 추가 절감
- 10 제품 / 주 scrape 기준 ~$0.09 / 주 절약

운영 monitor:
- R-G2 STATUS 등록 — Parser Haiku 추출 quality 1주 후 verify. learningOutcomes/differentiators 빈 배열 빈도 ↑ 이면 Sonnet 되돌림 또는 prompt 강화.

Spec: docs/superpowers/specs/2026-04-28-claude-model-tier-design.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Final verification**

```bash
git log --oneline -3
npm test 2>&1 | grep "Test Files\|Tests " | tail -3
```
Expected: HEAD = 신규 commit, 452 tests passing + 1 useReports flake.

---

## Task 11: code-reviewer 검토

- [ ] **Step 1: superpowers:code-reviewer 호출**

`Agent` 도구로 `superpowers:code-reviewer`. 컨텍스트:

```
WHAT_WAS_IMPLEMENTED: spec §4 (Tasks 1-9) — 신규 claudeModels.ts + 6 callsite refactor + 1 신규 테스트 파일 + 1 기존 테스트 갱신.
PLAN_OR_REQUIREMENTS: 본 plan Tasks 1-10
BASE_SHA: a1e88f9 (spec commit)
HEAD_SHA: <Commit SHA from Task 10.3>

검증 포인트:
- claudeModels.ts 의 4 상수 export 정확 + 코멘트 use-case 명시
- 6 callsites 모두 import + 상수 사용 (하드코딩 문자열 제거)
- import path 정확 (core 내부는 `../config/claudeModels.js`, cli/server 는 `@ad-ai/core/config/claudeModels.js`)
- parser.test.ts 의 model assertion 갱신이 미래 업그레이드 부담 회피 (`/haiku/` toMatch)
- 다른 callsite 테스트 (copy/monitor/improver/actions/aiAnalyze) 가 mock 기반이라 영향 없음 — grep 으로 verify
- TypeScript 0 errors after filter
- STATUS R-G2 등록 + 변경 이력 entry
- 신규 테스트 3 케이스가 미래 모델 업그레이드 시 갱신 부담 회피 (regex pattern 만 검증)
- Anthropic prompt cache (cache_control: ephemeral) 가 Haiku 에서도 정상 동작 — Anthropic SDK 타입 또는 docs 기준 verify
```

- [ ] **Step 2: 발견 이슈 처리**

Critical / Important: 즉시 수정 후 재검토 (별 fixup commit). Minor: STATUS R-G 그룹에 추가 또는 수용.

---

## 완료 조건 (Definition of Done)

- [ ] 1 commit land (또는 + reviewer fixup commits 가능)
- [ ] `npm test` ~452 passing + 1 useReports 알려진 flake
- [ ] TypeScript clean (filter facebook-nodejs)
- [ ] grep 검증:
  - `grep -rn "claude-sonnet-4-6\|claude-haiku-4-5" packages/ --include="*.ts" | grep -v "claudeModels\.ts" | wc -l` → 0 hits
  - `grep -rn "MODEL_PARSER\|MODEL_COPY\|MODEL_ANALYSIS\|MODEL_IMPROVER" packages/ --include="*.ts" | wc -l` → 12+ hits
- [ ] 수동 검증 (사용자 직접):
  - `npm run app` → Scrape 실행 → 실제로 Haiku 사용되는지 (Anthropic console usage / 응답 시간 / 토큰 비용 으로 verify)
  - learningOutcomes / differentiators 추출 quality 양호 (R-G2 monitor 시작점)
- [ ] code-reviewer 검토 통과
- [ ] STATUS.md R-G2 등록 + 변경 이력 entry

---

## 작업 시간 견적

| 단계 | 시간 |
|---|---|
| Task 0 (pre-flight) | 0.1h |
| Tasks 1-2 (claudeModels.ts + test) | 0.2h |
| Tasks 3-9 (6 callsite edit + parser.test 갱신) | 0.5h |
| Task 10 (verification + STATUS + commit) | 0.3h |
| Task 11 (code-reviewer + 수정) | 0.5h |
| 안정화 | 0.2h |
| **합계** | **~1.8h** |

(Spec 의 견적 ~2.3h 보다 약간 짧음 — plan 작성 시간 제외.)

---

## Self-Review

### Spec coverage 매핑

| Spec section | Plan task | 검증 |
|---|---|---|
| §1 배경 | Plan header | ✅ |
| §2.1 결정 (4) | Tasks 1-9 | ✅ |
| §2.2 범위 밖 | Plan 본문 미포함 (의도) | ✅ |
| §3.1 코드 상수 vs config | Task 1 (claudeModels.ts 만 정의) | ✅ |
| §3.2 use-case 별 명명 | Task 1 (4 상수) | ✅ |
| §3.3 비용 효과 | Plan commit message + STATUS 변경 이력 | ✅ |
| §4.1 신규 claudeModels.ts | Task 1 | ✅ |
| §4.2.1 parser.ts | Task 3 | ✅ |
| §4.2.2 copy.ts | Task 5 | ✅ |
| §4.2.3 monitor.ts | Task 6 | ✅ |
| §4.2.4 actions.ts | Task 8 | ✅ |
| §4.2.5 aiAnalyze.ts | Task 9 | ✅ |
| §4.2.6 runner.ts | Task 7 | ✅ |
| §5.1 신규 테스트 | Task 2 | ✅ |
| §5.2 기존 테스트 영향 (parser.test 갱신) | Task 4 + Tasks 5/6/7/8/9 의 grep verify | ✅ |
| §5.3 통합 검증 (수동) | DoD "수동 검증" | ✅ |
| §5.4 회귀 위험 | Task 11 + R-G2 등록 | ✅ |
| §6 영속 데이터 | Plan 본문 미포함 (없음) | ✅ |
| §7 리스크/롤백 | Plan 본문 미포함 (1 commit revert) | ✅ |
| §8 작업 순서 | Plan 1 commit | ✅ |
| §9 시간 견적 | Plan 본문 | ✅ |
| §10 DoD | Plan DoD 섹션 | ✅ |
| §11 Open Questions | Plan 본문 미포함 (spec 위임) | ✅ |

### Placeholder scan

- "TBD", "TODO", "implement later": 0건 ✅
- "Add appropriate error handling" / "Similar to Task N": 0건 ✅
- 모든 step 코드 본체 명시 ✅
- 모든 grep 명령 + Expected output 명시 ✅

### Type consistency

- `MODEL_PARSER` / `MODEL_COPY` / `MODEL_ANALYSIS` / `MODEL_IMPROVER` 4 상수 — Task 1 정의 + Tasks 3/5/6/7/8/9 사용 + Task 2 테스트 모두 동일 이름. ✅
- import path 일관:
  - core 내부 (parser/copy/monitor/runner): `../config/claudeModels.js`
  - cli (actions.ts): `@ad-ai/core/config/claudeModels.js`
  - server (aiAnalyze.ts): `@ad-ai/core/config/claudeModels.js`
- ✅ 다른 core 파일의 import 패턴과 일치

이슈 없음.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-28-claude-model-tier.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Tasks 0-10 implementer + code-reviewer (Task 11).

**2. Inline Execution** — CLAUDE.md 가 Inline 사용 금지 — *해당 없음*.

CLAUDE.md 정책상 **Subagent-Driven 만 허용**. 진행 시 `superpowers:subagent-driven-development` 스킬 호출.

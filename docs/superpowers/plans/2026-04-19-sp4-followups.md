# SP4 후속 정리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SP4 리팩터 직후 남은 3개 follow-up (자율 개선 regex 복구, CTR_THRESHOLD 단일 출처화, ROADMAP 정정)을 정리한다.

**Architecture:** 순수 리팩터 + 테스트 추가. 기능 복구 1건(Fix 1), 코드 품질 1건(Fix 2), 문서 갱신 1건(Fix 3). Fix 1은 regex 필터링 로직을 순수 함수로 추출하여 테스트 가능하게 만든다.

**Tech Stack:** TypeScript ESM, Vitest, Node.js.

**Spec:** [`docs/superpowers/specs/2026-04-19-sp4-followups-design.md`](../specs/2026-04-19-sp4-followups-design.md)

---

## 파일 구조

| 경로 | 작업 |
|------|------|
| `cli/improver/runner.ts` | Fix 1: regex 변경 + `filterSafeImprovementFiles` 순수 함수 export. Fix 2: `CTR_THRESHOLD` 로컬 선언 제거 후 import. |
| `cli/improver/runner.test.ts` | Fix 1: 신규 파일. `filterSafeImprovementFiles` 테스트. |
| `core/improver/index.ts` | Fix 2: `CTR_THRESHOLD`에 `export` 추가. |
| `docs/ROADMAP.md` | Fix 3: "SP4 후속 정리" 줄 제거. |
| `docs/STATUS.md` | Fix 3: 최근 변경 이력에 한 줄 추가. |

---

### Task 1: Fix 1 — 자율 개선 regex 복구 + 순수 함수 추출

**Files:**
- Modify: `cli/improver/runner.ts:88-94`
- Create: `cli/improver/runner.test.ts`

**Context:** SP4로 `src/`가 삭제된 후 `cli/improver/runner.ts:92`의 `/^src\/[\w./-]+\.ts$/` regex는 Claude가 제안한 모든 파일 경로를 거부한다 → `safeFiles.length === 0` early return → 자율 개선 루프 사실상 사망. regex를 3개 레이어(core/cli/server)로 확장하고, 테스트 가능하도록 필터링 로직을 export된 순수 함수로 추출한다.

- [ ] **Step 1: 실패 테스트 작성**

Create `cli/improver/runner.test.ts`:

```typescript
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

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run cli/improver/runner.test.ts`
Expected: FAIL with import error (`filterSafeImprovementFiles` not exported).

- [ ] **Step 3: 구현 — `cli/improver/runner.ts` 수정**

`cli/improver/runner.ts:88-94` 구간을 아래와 같이 변경. 기존 `.filter((f) => /^src\/.../.test(f))` 인라인 호출을 `filterSafeImprovementFiles()`로 대체하고, 해당 순수 함수를 파일 상단 근처(CTR_THRESHOLD 다음)에 export로 선언.

현재 코드:
```typescript
    const changedFiles = improvements.map((c) => c.file);

    // Validate each file path (only allow src/*.ts files)
    const safeFiles = changedFiles.filter((f) =>
      /^src\/[\w./-]+\.ts$/.test(f)
    );
    if (safeFiles.length === 0) return;
```

변경 후:
```typescript
    const changedFiles = improvements.map((c) => c.file);
    const safeFiles = filterSafeImprovementFiles(changedFiles);
    if (safeFiles.length === 0) return;
```

그리고 `CTR_THRESHOLD` 선언 아래(Task 1 완료 시점에는 아직 core에서 import 안 함)에 새 함수 추가:

```typescript
export function filterSafeImprovementFiles(files: string[]): string[] {
  return files.filter((f) => /^(core|cli|server)\/[\w./-]+\.ts$/.test(f));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run cli/improver/runner.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: 전체 테스트 회귀 확인**

Run: `npx vitest run`
Expected: 기존 127 테스트 + 신규 10 테스트 = 137 테스트 통과. tsc 추가로:

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: 커밋**

```bash
git add cli/improver/runner.ts cli/improver/runner.test.ts
git commit -m "$(cat <<'EOF'
fix(improver): restore auto-improvement loop after SP4 refactor

src/ 경로 화이트리스트 regex가 SP4 이후 항상 false가 되어
자율 개선 루프가 실질적으로 멈춰있던 문제를 수정한다.
regex를 /^(core|cli|server)\//로 확장하고, 필터링 로직을
filterSafeImprovementFiles 순수 함수로 추출하여 테스트 가능하게 만든다.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Fix 2 — CTR_THRESHOLD 단일 출처화

**Files:**
- Modify: `core/improver/index.ts:3`
- Modify: `cli/improver/runner.ts:6,8`

**Context:** `CTR_THRESHOLD`가 core와 cli 양쪽에 중복 선언되어 있음. 같은 env var를 읽으므로 런타임 값은 동일하지만, 한 쪽만 바꾸면 drift할 수 있는 코드 smell. core를 단일 출처로 만들고 cli는 import.

- [ ] **Step 1: `core/improver/index.ts`에 export 추가**

파일 `core/improver/index.ts:3` 변경:

Before:
```typescript
const CTR_THRESHOLD = Number(process.env.CTR_IMPROVEMENT_THRESHOLD ?? 1.5);
```

After:
```typescript
export const CTR_THRESHOLD = Number(process.env.CTR_IMPROVEMENT_THRESHOLD ?? 1.5);
```

(파일의 나머지 — `shouldTriggerImprovement`, `buildImprovementPrompt`, `parseImprovements` — 전부 그대로.)

- [ ] **Step 2: `cli/improver/runner.ts`에서 로컬 선언 제거하고 import**

파일 `cli/improver/runner.ts`의 import 섹션(현재 line 6)을 확장하고 로컬 선언(현재 line 8)을 제거.

Before (line 6, 8):
```typescript
import { buildImprovementPrompt, parseImprovements } from "../../core/improver/index.js";

const CTR_THRESHOLD = Number(process.env.CTR_IMPROVEMENT_THRESHOLD ?? 1.5);
```

After:
```typescript
import {
  CTR_THRESHOLD,
  buildImprovementPrompt,
  parseImprovements,
} from "../../core/improver/index.js";
```

**주의:** Task 1에서 `cli/improver/runner.ts`가 이미 수정되었으므로 line 번호가 시프트되었을 수 있다. `CTR_THRESHOLD =` 문자열을 grep으로 찾아 정확한 위치를 확인 후 제거한다. `filterSafeImprovementFiles` 함수나 Anthropic import는 건드리지 않는다.

- [ ] **Step 3: 테스트 회귀 확인**

Run: `npx vitest run`
Expected: 137 테스트 통과 (Task 1 이후 기준). `shouldTriggerImprovement`와 `runImprovementCycle`의 동작이 불변임을 기존 테스트로 간접 검증.

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: 커밋**

```bash
git add core/improver/index.ts cli/improver/runner.ts
git commit -m "$(cat <<'EOF'
refactor(improver): make CTR_THRESHOLD a single source of truth in core

core와 cli 양쪽에 중복 선언되어 있던 CTR_THRESHOLD를
core/improver/index.ts에서 export하고 cli/improver/runner.ts는
import로 참조하도록 변경. 런타임 값은 불변 (같은 env var 읽음).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Fix 3 — 문서 갱신 (ROADMAP + STATUS)

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/STATUS.md`

**Context:** Fix 1·2 완료 시점에 ROADMAP의 "SP4 후속 정리" 항목은 완전히 해소됨. 이미 `.DS_Store`가 `.gitignore:1`에 있었으므로 해당 지적도 stale. 두 항목 모두 제거하고, STATUS 최근 변경 이력에 한 줄 추가.

- [ ] **Step 1: `docs/ROADMAP.md`에서 "SP4 후속 정리" 줄 제거**

파일 `docs/ROADMAP.md`의 Tier 2 섹션에서 다음 줄을 삭제:

```markdown
- SP4 후속 정리 (CTR_THRESHOLD 중복 제거, `cli/improver/runner.ts`의 `/^src\//` 경로 regex 현대화, `.DS_Store` gitignore 추가)
```

(삭제 후 Tier 2는 4개 항목이 남는다: 프로덕션 배포, 고객 셀프서비스, 영상 실패율, 통합 테스트.)

- [ ] **Step 2: `docs/STATUS.md` 최근 변경 이력 갱신**

파일 `docs/STATUS.md`의 "최근 변경 이력" 섹션 최상단에 아래 줄을 추가. 기존 가장 위 줄(`- 2026-04-19 refactor: SP4 레이어드 리팩터 완료...`) 바로 위에 삽입.

```markdown
- 2026-04-19 fix: 자율 개선 루프의 src/ 경로 화이트리스트 regex를 core/cli/server로 현대화 + CTR_THRESHOLD 단일 출처화
```

그리고 이력이 11개가 되면 맨 아래 줄 1개를 제거해 10개로 유지 (STATUS.md 하단 업데이트 규칙 주석 참조).

현재 이력 마지막 줄:
```markdown
- 2026-04-17 feat: deduct-first 패턴 기반 빌링 서비스 + 환불 로직 추가
```

이 줄이 11번째가 되므로 함께 삭제한다.

- [ ] **Step 3: "마지막 업데이트" 날짜 확인**

`docs/STATUS.md`와 `docs/ROADMAP.md` 상단의 "마지막 업데이트: 2026-04-19"가 이미 오늘 날짜이므로 변경 불필요. 다만 실제 파일 내용을 확인하여 다른 날짜면 2026-04-19로 갱신.

- [ ] **Step 4: 커밋**

```bash
git add docs/ROADMAP.md docs/STATUS.md
git commit -m "$(cat <<'EOF'
docs: record SP4 followups completion

ROADMAP: Tier 2에서 'SP4 후속 정리' 항목 제거 (Fix 1·2 완료로 해소).
STATUS: 최근 변경 이력에 regex 현대화 + CTR_THRESHOLD 단일 출처화 추가,
가장 오래된 항목 1개 제거하여 10개 유지.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## 완료 판정

세 Task가 모두 완료되면:
- `npx vitest run` → 137 테스트 통과 (기존 127 + 신규 10)
- `npx tsc --noEmit` → 0 errors
- `git log --oneline -3` → 3개의 새 커밋 (Task 1, 2, 3)
- 자율 개선 루프가 core/cli/server 경로에서 정상 동작 (실제 실행은 별건)
- CTR_THRESHOLD가 core/improver/index.ts 한 곳에서만 선언
- ROADMAP에 "SP4 후속 정리" 줄 없음, STATUS에 Fix 이력 한 줄 추가

---

## 위험 / 주의사항

- **Task 2의 line number 시프트:** Task 1이 `cli/improver/runner.ts`를 수정한 뒤에 Task 2가 같은 파일을 또 수정한다. Task 2는 line number가 아닌 문자열 매칭으로 위치를 찾아야 함. 계획의 Step 2에서 grep 사용을 명시.
- **tsconfig include 변경 없음:** SP4 Task 12에서 이미 `cli/**/*` 포함됨. 신규 테스트 파일은 자동 컴파일 대상.
- **자율 개선 실제 동작 검증은 비범위:** 이 plan은 regex와 순수 함수만 검증한다. Claude API 호출, 파일 패치, git 커밋 실제 플로우 테스트는 owner 모드에서 수동 확인 사안.

# SP4 후속 정리 설계

작성: 2026-04-19

## 배경

SP4 레이어드 리팩터(`src/` → `core/` + `cli/` + `server/`)의 최종 코드 리뷰에서 다음 follow-up 3건이 제기되었다. 최초 2건은 실제 수정이 필요하고, 3번째는 이미 해결되어 있으나 문서에 잔존해 있어 정정한다.

1. `cli/improver/runner.ts:92`의 `/^src\/.../` regex가 SP4 이후 **항상 false** — 자율 개선 루프가 사실상 사망
2. `CTR_THRESHOLD` 상수가 `core/improver/index.ts`와 `cli/improver/runner.ts` 양쪽에 중복 선언
3. `.DS_Store` gitignore — 이미 `.gitignore:1`에 존재 (follow-up 항목 자체가 stale)

---

## 목표

- 자율 개선 루프가 신규 레이어드 경로를 정상 인식하도록 복구
- `CTR_THRESHOLD` 단일 출처(core) 확립
- ROADMAP의 stale 항목 제거

**비목표:** 동작 변경, 새 기능 추가, 다른 중복 상수 정리 — YAGNI.

---

## Fix 1: Improver 경로 화이트리스트 현대화

### 현재 상태

```ts
// cli/improver/runner.ts:89-94
const safeFiles = changedFiles.filter((f) =>
  /^src\/[\w./-]+\.ts$/.test(f)
);
if (safeFiles.length === 0) return;
```

자율 개선이 제안한 파일 경로가 `src/` 접두사일 때만 패치를 적용하는 안전 가드. SP4로 `src/`가 완전히 제거된 이후, 이 필터는 Claude가 어떤 경로를 제안하든 전부 reject → `safeFiles.length === 0` → 함수 early return → 실제 코드 수정이 일어나지 않는다.

### 변경

```ts
const safeFiles = changedFiles.filter((f) =>
  /^(core|cli|server)\/[\w./-]+\.ts$/.test(f)
);
```

- 3개 레이어 모두 허용. `server/`도 포함하는 것은 자율 개선이 서버 프롬프트를 수정해야 할 경우를 위해.
- 문자 클래스 `[\w./-]`와 `.ts$`는 변경 없음 (path traversal 방지 + .ts 한정 의도 유지).

### 테스트

`cli/improver/runner.test.ts`가 있다면 확장, 없으면 신규 파일. 최소 케이스:
- `core/improver/index.ts` → 통과
- `cli/tui/App.tsx` → 차단 (.ts가 아님 — `.tsx` 미지원은 기존 동작과 동일)
- `server/billing.ts` → 통과
- `src/legacy.ts` → 차단 (존재하지 않는 레이어)
- `../etc/passwd` → 차단 (path traversal)
- `/etc/passwd` → 차단 (슬래시로 시작, 레이어 접두사 아님)

**주의:** 이 regex의 목적은 **레이어 화이트리스트 + .ts 확장자 한정**이지 path traversal 방어가 아니다. 예를 들어 `core/../server/secret.ts`는 문자 클래스가 `.`을 허용하므로 regex는 통과시킨다. 현재 스코프에서는 기존 설계를 그대로 유지(Claude가 `..`를 포함하는 경로를 제안할 가능성이 낮고, 자율 개선은 owner 모드 전용이라 신뢰 경계가 다름). 필요 시 별건으로 `path.normalize()` 기반 방어를 추가.

`applyCodeChange()`를 실제 파일 쓰기 없이 테스트하려면 함수 시그니처를 fs 의존성 주입 가능하게 바꿔야 하는데, 이는 scope creep. 대신 regex만 따로 export해서 테스트하거나, 필터링 로직을 `filterSafeFiles(files: string[]): string[]` 순수 함수로 추출해 테스트.

**선택**: 순수 함수 추출 방식. Pure 함수이므로 `core/improver/index.ts`가 아니라 `cli/improver/runner.ts` 내부에 두되 export만 추가 (자율 개선은 cli 전용이므로 core에 올릴 이유 없음).

---

## Fix 2: CTR_THRESHOLD 단일 출처화

### 현재 상태

```ts
// core/improver/index.ts:3
const CTR_THRESHOLD = Number(process.env.CTR_IMPROVEMENT_THRESHOLD ?? 1.5);

// cli/improver/runner.ts:8
const CTR_THRESHOLD = Number(process.env.CTR_IMPROVEMENT_THRESHOLD ?? 1.5);
```

같은 env var를 읽으므로 런타임 값은 항상 동일하지만, 한 쪽만 바꾸면 다른 쪽이 drift하는 함정.

### 변경

`core/improver/index.ts`에서 `export const CTR_THRESHOLD` 추가. `cli/improver/runner.ts`는 로컬 선언 제거하고 import.

```ts
// core/improver/index.ts
export const CTR_THRESHOLD = Number(process.env.CTR_IMPROVEMENT_THRESHOLD ?? 1.5);

// cli/improver/runner.ts
import { CTR_THRESHOLD } from "../../core/improver/index.js";
```

### 동작 영향

없음. `process.env` 읽는 시점은 모듈 로드 시점이고, `core/improver/index.ts`가 양 consumer(shouldTriggerImprovement 호출자, runImprovementCycle 로그 문자열)보다 먼저 import되는 구조는 그대로. 런타임 값은 불변.

### 테스트

별도 신규 테스트 불필요. 기존 `core/improver/index.test.ts`에서 이미 간접 검증 중이며, `cli/improver/runner.ts`의 로그 문자열은 관찰 가치가 낮음.

---

## Fix 3: ROADMAP 정정

### 현재 상태

```
- SP4 후속 정리 (CTR_THRESHOLD 중복 제거, `cli/improver/runner.ts`의 `/^src\//` 경로 regex 현대화, `.DS_Store` gitignore 추가)
```

`.DS_Store`는 이미 `.gitignore:1`에 있으므로 이 지적은 stale.

### 변경

- ROADMAP Tier 2의 해당 줄에서 `.DS_Store gitignore 추가` 제거
- Fix 1·2가 완료되면 "SP4 후속 정리" 항목 자체를 Tier 2에서 완전 제거하고 STATUS.md 최근 변경 이력에 한 줄 추가

---

## 작업 순서

1. Fix 1 — regex 수정 + 순수 함수 추출 + 테스트 추가 + 커밋
2. Fix 2 — `CTR_THRESHOLD` export/import 변경 + 커밋
3. Fix 3 — STATUS/ROADMAP 갱신 + 커밋

각 Fix는 독립적이라 순서 바꿔도 되지만, Fix 1이 기능 복구라 먼저.

---

## 비범위

- 자율 개선 루프의 다른 개선 (예: `.tsx` 지원, 테스트 파일 제외 등)은 별건으로 분리
- 다른 env var 기반 상수 중복 조사 — 현재 알려진 것이 `CTR_THRESHOLD` 하나뿐이므로 예방적 스캔은 YAGNI
- ARCHITECTURE.md 업데이트 — 설계 결정이 바뀐 게 아니므로 불필요

---

## 검토 이력

- 2026-04-19 초안 작성
- 2026-04-19 자체 검토: Fix 1 테스트 케이스의 path traversal 관련 오해 소지 정정. regex의 의도는 레이어 화이트리스트이며 path traversal 방어는 비범위임을 명시.
- 2026-04-19 구현 완료: Fix 1 (d2aec79) regex 확장 + 10 테스트 신규 추가, Fix 2 (f098383) CTR_THRESHOLD core export/cli import, Fix 3 (cdc2c24) ROADMAP/STATUS 갱신. 137 테스트 통과, tsc 클린.

# Claude 모델 tier 분리 — Parser → Haiku, 나머지 Sonnet 유지

**작성일:** 2026-04-28
**스펙 종류:** 비용 최적화 + 명시화 refactor
**관련:** `packages/core/src/product/parser.ts`, `packages/core/src/creative/copy.ts`, `packages/core/src/campaign/monitor.ts`, `packages/core/src/improver/runner.ts`, `packages/cli/src/actions.ts`, `packages/server/src/routes/aiAnalyze.ts`

---

## 1. 배경 (Why)

### 1.1 동기

현재 코드베이스는 6 곳에서 `claude-sonnet-4-6` 을 하드코딩 — Parser / Copy / Analysis / Improver / runMonitor weekly analysis / server analyze proxy.

각 호출처의 stakes:

| 호출처 | 작업 | Stakes | 적합 모델 |
|---|---|---|---|
| Parser (`product/parser.ts`) | HTML → JSON 추출 | 낮음 — schema 강제, mechanical | **Haiku 4.5** |
| Copy generation (`creative/copy.ts`) | 한국어 광고 카피 3 variants | 높음 — 한국어 nuance + banned-pattern 준수 | Sonnet 4.6 |
| Weekly analysis (`campaign/monitor.ts`) | CTR 리포트 분석 + prompt 개선안 제안 | 높음 — 자기학습 input | Sonnet 4.6 |
| Improver (`improver/runner.ts`) | 분석 결과로 prompt 재작성 | 매우 높음 — 모든 미래 카피 영향 | Sonnet 4.6 |
| `cli/actions.ts:runMonitor` | weekly analysis 호출 (#3 의 CLI 진입점) | 높음 (#3 와 동일) | Sonnet 4.6 |
| `server/routes/aiAnalyze.ts` | analysis proxy (server, 미실행) | 높음 (#3 와 동일) | Sonnet 4.6 |

→ **6 사이트 중 1 사이트 (Parser) 만 Haiku 다운그레이드**. 나머지 5 사이트 Sonnet 유지.

### 1.2 본 spec 의 목표

1. Parser 만 Haiku 4.5 로 변경 → 비용 절감
2. 모델 ID 를 코드 1 곳 (`packages/core/src/config/claudeModels.ts`) 에 use-case 별 상수로 centralize → 의도 명시 + 미래 모델 업그레이드 시 1 줄 변경
3. 6 callsites 가 use-case 별 상수 import

---

## 2. 범위

### 2.1 결정

| 결정 | 채택 |
|---|---|
| 모델 ID 정의 위치 | 신규 `packages/core/src/config/claudeModels.ts` (코드 상수 — config.toml 안 거침) |
| 명명 규칙 | Use-case 별 상수 4개 — `MODEL_PARSER` / `MODEL_COPY` / `MODEL_ANALYSIS` / `MODEL_IMPROVER` |
| Parser 모델 | `claude-haiku-4-5` |
| Copy / Analysis / Improver 모델 | `claude-sonnet-4-6` 유지 |

### 2.2 범위 밖 (deferred)

| 안 하는 것 | 이유 |
|---|---|
| Anthropic 모델 auto-discovery | Google 과 달리 Anthropic 모델 deprecation 빈도 낮음 — manual 상수로 충분 |
| Copy / Analysis / Improver 다운그레이드 | 한국어 nuance + 자기학습 input 품질 critical — Sonnet 유지 |
| `config.toml` 에 모델 ID 옵션 추가 | 사용자 의사결정 — config 안 거치고 코드 상수 유지 (Google 모델 시 결정과 일관) |

---

## 3. 핵심 결정

### 3.1 코드 상수 vs config

사용자 이전 결정 (Google 모델 auto-discovery 시) 와 일관 — config 안 거침. Anthropic 은 deprecation 빈도 낮아 자동 디스커버리 불필요. 코드 상수 1 곳에서 관리.

### 3.2 Use-case 별 명명 (vs HIGH/LOW)

`MODEL_HIGH` / `MODEL_LOW` (semantic tier 2개) 도 가능했으나:
- 6 callsites 가 4 use-case 로 묶여 있음 (Analysis 가 3 사이트 공유)
- 미래 한 사이트만 모델 변경 (e.g. Improver 만 Sonnet 4.7) 시 use-case 별이 1 줄 변경, tier 별은 새 상수 도입 필요
- 4 상수도 부담 작음

→ `MODEL_PARSER` / `MODEL_COPY` / `MODEL_ANALYSIS` / `MODEL_IMPROVER` 4 상수.

### 3.3 비용 효과

Parser 1 호출 비용:
- Sonnet 4.6: $3 / 1M input + $15 / 1M output → ~$0.012 / scrape (8000 input + 150 output 기준)
- Haiku 4.5: $0.8 / 1M input + $4 / 1M output → ~$0.003 / scrape

절감: **~$0.009 / scrape**, ~73% 다운그레이드. Anthropic prompt cache (parser system prompt 의 `cache_control: ephemeral`) 가 Haiku 에서도 동작 — cached input 90% 할인, 첫 호출 외 cost 추가 절감.

10 제품 / 주 scrape 기준 ~$0.09 / 주 절약. 작지만 확실 + 코드 명시화 부수효과.

---

## 4. 코드 상세

### 4.1 신규 `packages/core/src/config/claudeModels.ts`

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

### 4.2 6 callsites 변경

각 파일에서 하드코딩 `"claude-sonnet-4-6"` → use-case 별 상수 import:

**4.2.1 `packages/core/src/product/parser.ts:38`** (Parser → Haiku)

```ts
// 상단 import 추가
import { MODEL_PARSER } from "../config/claudeModels.js";

// line 38
const response = await client.messages.create({
  model: MODEL_PARSER,  // was: "claude-sonnet-4-6"
  ...
});
```

**4.2.2 `packages/core/src/creative/copy.ts:17`** (Copy → Sonnet)

```ts
import { MODEL_COPY } from "../config/claudeModels.js";

// line 17
model: MODEL_COPY,
```

**4.2.3 `packages/core/src/campaign/monitor.ts:152`** (Analysis → Sonnet)

```ts
import { MODEL_ANALYSIS } from "../config/claudeModels.js";

// line 152
model: MODEL_ANALYSIS,
```

**4.2.4 `packages/cli/src/actions.ts:265`** (CLI Monitor weekly analysis → Sonnet)

```ts
import { MODEL_ANALYSIS } from "@ad-ai/core/config/claudeModels.js";

// line 265
const response = await client.messages.create({ model: MODEL_ANALYSIS, ... });
```

**4.2.5 `packages/server/src/routes/aiAnalyze.ts:31`** (Server Analyze proxy → Sonnet)

```ts
import { MODEL_ANALYSIS } from "@ad-ai/core/config/claudeModels.js";

// line 31
model: MODEL_ANALYSIS,
```

**4.2.6 `packages/core/src/improver/runner.ts:109`** (Improver → Sonnet)

```ts
import { MODEL_IMPROVER } from "../config/claudeModels.js";

// line 109
model: MODEL_IMPROVER,
```

---

## 5. 테스트 전략

### 5.1 신규 테스트 파일

`packages/core/src/config/claudeModels.test.ts`:

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

3 cases. 모델 ID 정확 문자열 검증 안 함 (미래 업그레이드 시 갱신 부담 회피) — tier 패턴 (`haiku` vs `sonnet`) 만 검증.

### 5.2 기존 테스트 영향

#### 갱신 필요 검증

- `packages/core/src/product/parser.test.ts` — line 60-62 의 `expect(callArgs.model).toBe("claude-sonnet-4-6")` 가 있다면 → `MODEL_PARSER` 또는 `/haiku/` 매치로 변경.
- `packages/core/src/creative/copy.test.ts` — line 84의 `expect(call.system[0].text).toBe(DEFAULT_PROMPTS.copy.systemPrompt)` 는 영향 없음 (systemPrompt 검증). model ID 직접 검증 있는지 grep verify.

#### 영향 없을 가능성 높은 사이트

- `packages/core/src/campaign/monitor.test.ts` — mock Anthropic, 모델 ID 직접 검증 안 할 것
- `packages/core/src/improver/runner.test.ts` — mock 사용
- `packages/cli/src/actions.test.ts` — runMonitor mock
- `packages/server/src/routes/aiAnalyze.test.ts` (있다면) — server 미실행

plan 단계에서 grep `"claude-sonnet-4-6"` packages/ --include="*.test.*" 로 fixture 확인.

### 5.3 통합 검증 (수동)

1. Parser 호출: `npm run app` → Scrape 실행 → 모델이 Haiku 사용 확인 (Anthropic console 의 usage 로그 / 응답 시간 / 토큰 비용)
2. learningOutcomes / differentiators 추출 quality 확인 — 한국어 강의 페이지에서 빈 배열 자주 나오면 Haiku quality 문제 (R-G2 등록)

### 5.4 회귀 위험

#### Critical
**없음** — 단순 모델 ID 변경 + 호출 패턴 동일.

#### Important

**Important #1**: Parser 가 Sonnet → Haiku 로 다운그레이드 시 한국어 페이지 추출 정확도 변화 가능. learningOutcomes / differentiators 필드 추출 quality 영향 큼 (광고 카피 풍부화 효과 직결). 운영 1주 후 추출 결과 verify — STATUS R-G2 등록.

**Important #2**: Anthropic prompt cache (`cache_control: ephemeral`) 가 Haiku 4.5 에서도 동작 — Anthropic 공식 문서 기준 모든 모델 지원이지만 실 호출 시 confirm 필요. plan 단계에서 Anthropic SDK 타입 또는 docs 확인.

#### Minor
- 6 callsites 모두 단순 mechanical edit
- 신규 파일 1개 + 4 상수 — 코드 surface 부담 작음

---

## 6. 영속 데이터 마이그레이션

**필요 없음** — 모델 ID 변경 + 데이터 schema 변동 없음. 기존 `data/learned/prompts.json` 도 영향 없음 (DEFAULT_PROMPTS 변경 없음).

---

## 7. 리스크 + 롤백

`git revert <SHA>` — 1 commit 단순 복구.

---

## 8. 작업 순서 (1 commit atomic)

**Files (~10):**
- 신규: `packages/core/src/config/claudeModels.ts`, `packages/core/src/config/claudeModels.test.ts`
- 수정: `parser.ts`, `creative/copy.ts`, `campaign/monitor.ts`, `improver/runner.ts`, `cli/actions.ts`, `server/routes/aiAnalyze.ts`
- 수정 가능 (plan grep verify): `parser.test.ts` (model ID assertion 가능)

**Subagent 트리거**:
- `superpowers:code-reviewer` — model ID centralize 패턴 검증
- DEFAULT_PROMPTS / buildCopyPrompt 변경 없음 → `marketing-copy-reviewer` 트리거 안 함
- `packages/core/src/platform/meta/*` 무변경 → `meta-platform-expert` 트리거 안 함

---

## 9. 작업 시간 견적

| 단계 | 시간 |
|---|---|
| Spec 작성 + 자체 검토 | 0.4h |
| Plan 작성 | 0.2h |
| 신규 파일 작성 + 6 callsite edit + 테스트 | 0.7h |
| Parser 테스트 갱신 (model assertion 있다면) + grep verify | 0.3h |
| code-reviewer + 수정 | 0.5h |
| 안정화 | 0.2h |
| **합계** | **~2.3h** |

---

## 10. Definition of Done

- [ ] 1 commit land
- [ ] `npm test` 모두 passing (~452 예상 — 449 + 3 신규 케이스)
- [ ] TypeScript clean (filter facebook-nodejs)
- [ ] grep 검증:
  - `grep -rn "claude-sonnet-4-6\|claude-haiku-4-5" packages/ --include="*.ts" --include="*.tsx" | grep -v "claudeModels\.ts" | wc -l` → 0 hits in non-config files
  - `grep -rn "MODEL_PARSER\|MODEL_COPY\|MODEL_ANALYSIS\|MODEL_IMPROVER" packages/ --include="*.ts" | wc -l` → 7+ hits (1 정의 + 6 callsite + 1+ test)
- [ ] 수동 검증:
  - Scrape 실행 → Parser 가 Haiku 사용 확인 (응답 빠르고 비용 낮음)
  - learningOutcomes / differentiators 추출 quality 양호 (R-G2 monitor)
- [ ] code-reviewer 검토 통과
- [ ] STATUS.md R-G2 (Parser Haiku quality monitor) 등록 + 변경 이력 entry

---

## 11. Open Questions / 후속 작업

### 11.1 R-G2 monitoring

운영 1주 후 Parser Haiku 추출 quality 확인. 만약 learningOutcomes 빈 배열 빈도 ↑ 이면:
- (a) Parser 를 Sonnet 으로 되돌림 (1 line 변경)
- (b) Haiku 용 prompt 강화 (system prompt 의 추출 규칙 명시화)

### 11.2 Anthropic prompt cache 검증

Haiku 4.5 가 `cache_control: ephemeral` 지원 — Anthropic 공식 docs (2026-04 기준) 모든 4.x 모델 지원. 실 호출 시 cache hit rate 모니터.

---

## 12. 검토 이력

### 2026-04-28 — 초안 작성 + 자체 검토

5점 점검:

1. **외부 참조 검증**: 6 callsites 모두 grep 으로 확인 (parser:38, copy:17, monitor:152, runner:109, actions:265, aiAnalyze:31). ✅
2. **추측 문구 색출**: Anthropic 단가 ($3/$15 sonnet vs $0.8/$4 haiku) — 공식 단가. 73% 절감은 input token 단가 비교 (8000:150 ratio 시 input dominant). ✅
3. **관심사 분리**: 신규 파일 1 (model ID 정의) / 6 callsite import / 신규 테스트 — 3 영역 분리. ✅
4. **Deferral 남용**: 1건 (R-G2 monitoring) — 정당한 monitor-then-refine. ✅
5. **구체 예시**: 신규 파일 본체 + 6 callsite 표 + 테스트 케이스 + DoD 검증 명령 명시. ✅

### 종합

- Critical: 0건
- Important: 2건 (R-G2 monitoring, Anthropic prompt cache verify) — 모두 운영 monitor / plan grep
- Minor: 2건 (작은 변경, 4 상수 부담 작음)

다음 단계: 사용자 검토 → 승인 시 `superpowers:writing-plans` 으로 plan 작성.

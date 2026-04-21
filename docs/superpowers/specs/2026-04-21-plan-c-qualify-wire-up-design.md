# Plan C Qualify 프로덕션 Wire-up 디자인

작성일: 2026-04-21
상태: 디자인 확정, 구현 계획 작성 대기

---

## 0. 배경 및 목표

Plan C 코어 모듈(`core/rag/`)은 2026-04-21에 완료되어 Winner DB + Voyage RAG 인프라가 갖춰졌으나, 스케줄러의 `qualify` 단계는 noop으로 유예된 상태(STATUS.md 기준). `cli/entries/worker.ts`와 `server/scheduler.ts`의 TODO 주석이 남아 있으며, 현재 상태로는 launchd/서버 스케줄러가 돌아도 `data/creatives.db` winners 테이블이 영원히 비어있어 RAG few-shot 주입이 결과적으로 0건이다.

본 디자인은 qualify 단계를 실제 프로덕션 경로에 연결하여, 자기 학습 루프(성과 → winner 선발 → embedding 저장 → 다음 제품 생성 시 few-shot 주입)가 실제로 순환하게 만든다.

### 0.1 프로젝트 맥락

이 프로젝트의 목표는 "광고 자동화 + 자기 학습 루프로 광고 효과 극대화"이며, qualify wire-up은 그 루프의 유일하게 끊어져 있는 연결 고리다. 따라서 이 작업은 기능 추가가 아니라 **루프 완성**이 목적이다.

### 0.2 원래 Plan C에서 유예한 이유

`creativeIdResolver(agg)` → Creative.id 매핑 규칙 미확정. aggregate는 `campaignId::variantLabel` 복합키를 가지지만 Creative는 UUID 식별자를 가지며, 두 세계를 연결할 결정론적 resolver를 한 파일에 몰아넣을지 / 분리할지에 대한 판단이 필요했다. 본 디자인에서는 Plan B 데이터 모델(`variantGroupId` + `variantLabel`이 Creative를 유일 식별)을 활용하여 resolver를 완전히 제거하고 `findCreativeByVariant(variantGroupId, label)` 단일 조회로 단순화한다.

---

## 1. Qualify 데이터 파이프라인

### 1.1 단계 순서

```
Stage 1 (aggregate): VariantReport[] → aggregateVariantReports → VariantAgg[]
Stage 2 (qualify):
  ├─ passesThreshold(agg, medianCtr)로 필터 ────────┐
  ├─ 필터 통과본 → variantGroupId로 groupBy          │
  ├─ 각 그룹에서 pickBestPerVariantGroup로 best 선택 │
  └─ 선택된 winner 후보 → embed → dedup → insert ───┘
Stage 3 (runCycle): 독립 (본 디자인 범위 밖)
```

### 1.2 핵심 결정: "필터 먼저, 그룹 나중"

**결정**: `passesThreshold` 필터를 **먼저** 적용한 뒤 variantGroupId로 묶고, 각 그룹에서 최고 CTR 1개를 선택한다.

**이유**: 반대 순서(그룹→best→filter)를 쓰면 다음 회귀가 생긴다.

> 같은 그룹 안에 A(CTR 4.8%, imp 300 — threshold 탈락), B(CTR 4.3%, imp 800 — 통과), C(CTR 4.0%, imp 900 — 통과)가 있으면, best-first는 A를 뽑고 threshold에서 탈락시켜 그룹 통째로 버린다. 올바른 순서는 A를 먼저 제외한 후 B/C 중 best(B)를 선발.

### 1.3 `pickBestPerVariantGroup` 함수 계약

```ts
function pickBestPerVariantGroup(aggs: VariantAgg[]): VariantAgg[]
```

- 동일 `variantGroupId`를 공유하는 원소들을 묶어 각 그룹에서 1개씩 반환
- 선택 기준: `inlineLinkClickCtr` 내림차순
- 동점 타이브레이커: `impressions` 내림차순 → `variantLabel` 사전순(emotional < numerical < urgency)
- 순수 함수, 입력 불변
- 빈 입력은 `[]`

**구체 예시**:
- 입력 `[A{g1, emo, ctr=5%, imp=100}, B{g1, num, ctr=5%, imp=200}, C{g2, urg, ctr=3%}]` → `[B, C]`
- 입력 `[A{g1, emo, ctr=5%, imp=100}, B{g1, num, ctr=5%, imp=100}]` → `[A]` (label 사전순)

### 1.4 Creative.status 필터 정책

qualify는 Creative.status(`approved`/`pending`/`rejected`/`externally_modified`)를 **필터링하지 않는다**. 런칭 실패한 Creative도 성능 지표만 충분하면 winner로 간주한다. 근거: RAG의 목적은 "잘 팔리는 카피 패턴 학습"이지 "런칭 성공 카피 학습"이 아니다.

---

## 2. `createQualifyJob` 팩토리 인터페이스

### 2.1 새 파일: `core/rag/qualifyJob.ts`

```ts
export interface QualifyJobOverrides {
  voyage?: VoyageClient;
  creativesDbPath?: string;   // default: "data/creatives.db"
  creativesDir?: string;      // default: "data/creatives"
  productsDir?: string;       // default: "data/products"
}

export type QualifyJob = (reports: VariantReport[]) => Promise<{ inserted: number; skipped: number }>;

export function createQualifyJob(overrides?: QualifyJobOverrides): QualifyJob;
```

### 2.2 생명 주기

- **팩토리 호출 시점**: 스케줄러/워커 **부팅 시 1회**. Voyage 클라이언트도 이 시점 1회 생성하고 closure로 캡쳐.
- **반환된 job 호출 시점**: cron tick마다 invocation. 매 invocation에서 `createCreativesDb(path)` 호출 → qualifyWinners 실행 → `db.close()`를 `try/finally`로 보장.
- **Voyage 클라이언트**: factory-scope로 고정. tick마다 재생성하지 않음 (비용이 아니라 의도 명확성 이유).

### 2.3 DB 동시성

`creatives.db`는 WAL 모드이고 winners 테이블 PK는 UUID. Owner 워커(6h) + Server 스케줄러(24h)가 동시 기동하더라도 같은 (variantGroupId, variantLabel) 조합에 대해 서로 다른 UUID가 생성되므로 중복 삽입은 `store.hasCreative(creativeId)` dedup으로 차단한다. WAL은 reader를 블록하지 않으며 winners 테이블 쓰기는 짧고 간헐적이므로 락 충돌은 이론적으로 가능하지만 실무적으로 무시 가능.

### 2.4 Scan 전략

`findCreativeByVariant`와 `loadProduct`는 tick마다 전체 스캔:

- `findCreativeByVariant(variantGroupId, variantLabel)`: `data/creatives/*.json`을 모두 읽어 in-memory Map을 만들고 `${variantGroupId}::${variantLabel}` 키로 조회. qualify 1회 실행 동안 캐시, 실행 끝나면 폐기.
- `loadProduct(productId)`: `data/products/${productId}.json` 단일 파일 읽기.

근거: 현재 운영 중인 규모에서는 스캔 비용 < 코드 단순함의 이득. 규모 증가(creatives 수천 이상)로 tick 지연이 체감되는 시점에 index 구축을 별도 chore로 격상.

### 2.5 `qualifyWinners` 시그니처 변경

기존:
```ts
qualifyWinners(reports, deps: QualifyDeps, opts: { creativeIdResolver })
```

변경:
```ts
qualifyWinners(reports, deps: QualifyDeps)   // opts 제거
```

`QualifyDeps`에서:
- 제거: `loadCreative: (creativeId: string) => Promise<Creative | null>`
- 추가: `findCreativeByVariant: (variantGroupId: string, variantLabel: string) => Promise<Creative | null>`
- 유지: `loadProduct`, `embed`, `store`

`RetrieveDeps`(`core/rag/retriever.ts`)와 `QualifyDeps`(`core/rag/types.ts`)는 서로 다른 파일에 정의되어 있고 구성 필드도 겹치지 않으므로 본 변경이 retriever 경로에 파급되지 않는다. Task 2 착수 전 이 사실을 재확인한다.

---

## 3. 데이터 플로우 + 에러 처리

### 3.1 Tick 흐름

```
cron fire → mutex.acquire()
  → runScheduledImprovementCycle(cadence, deps_with_qualify)
    → Stage 1: aggregate
         try { aggregates = aggregate(reports) } catch { log, abort tick }
    → Stage 2: qualify(aggregates)
         try { await qualify(aggregates) } catch { log, continue }
    → Stage 3: runCycle()
         try { await runCycle() } catch { log, continue }
  → mutex.release()
```

### 3.2 에러 분류

| 분류 | 예 | 처리 | 관측 |
|------|----|------|------|
| Fatal (stage abort) | `createCreativesDb` 실패, `data/creatives/*` 디렉토리 read 실패 | throw → improvementCycle catch → stage 실패 로그 → 다음 stage 계속 | stage failure log |
| Hard per-agg | `voyage.embed` throw (API 장애 / 쿼터 초과) | qualify 전체 중단, 부분 커밋 없음. **경고: 이 경우 `[qualify] inserted=X skipped=Y` 요약 로그가 찍히지 않는다** (운영자 가시성 한계, 향후 chore) | stage failure log |
| Soft per-agg | `findCreativeByVariant` null / `loadProduct` null / `shouldSkipInsert` true / `hasCreative` true | silent skip, skipped++ | 최종 요약 로그 `[qualify] inserted=N skipped=M` |

### 3.3 Idempotence 계약

동일 입력 → 동일 출력. 재실행해도 `store.hasCreative` dedup으로 중복 insert 없음. UUID PK와 `hasCreative(creativeId)` 체크가 이중 방어층.

### 3.4 명시적 범위 밖

- Winner DB retention TTL (무기한 보존)
- Voyage embedding retry / 구조적 telemetry (stage failure log + summary counter만)

---

## 4. 테스트 전략

### 4.1 `core/rag/qualifier.test.ts` — 수정 + 추가

**A. 기존 4개 qualifyWinners 테스트 리팩터**: `{ creativeIdResolver }` opts 제거, `loadCreative` → `findCreativeByVariant` 시그니처로 전환.

**B. `pickBestPerVariantGroup` 독립 describe 블록 (신규 4 tests)**:

| # | 이름 | 시나리오 | 기대 |
|---|------|----------|------|
| P1 | `returns [] for empty input` | [] | [] |
| P2 | `picks best CTR per variantGroupId` | g1에 A(ctr=3%)/B(ctr=5%), g2에 C(ctr=4%) | [B, C] |
| P3 | `tie-break: ctr tie → impressions desc` | A(ctr=5%, imp=100), B(ctr=5%, imp=200) | [B] |
| P4 | `tie-break: ctr+imp tie → variantLabel lex asc` | A(emo, ctr=5%, imp=100), B(num, ctr=5%, imp=100) | [A] (emotional < numerical) |

**C. threshold-then-group 순서 통합 테스트 (신규 2 tests in qualifyWinners describe)**:

| # | 이름 | 시나리오 | 기대 |
|---|------|----------|------|
| Q1 | `filters below-threshold before grouping` | g1 같은 variantGroup: A(300 imp, CTR 4.8% — imp 부족으로 탈락), B(800 imp, CTR 4.3% — 통과), C(900 imp, CTR 4.0% — 통과) | A 제외 후 B/C 중 B 선택 → inserted=1 |
| Q2 | `sibling chosen when best fails threshold` | g1 best CTR variant가 imp 부족이어도 통과한 sibling 존재 | sibling inserted (그룹 통째로 버려지지 않음) |

### 4.2 `core/rag/qualifyJob.test.ts` — 신규

tmpdir fixture + `:memory:` DB + fake voyage.

| # | 이름 | 시나리오 | 기대 |
|---|------|----------|------|
| J1 | `end-to-end: fixtures → DB insert` | tmpdir에 2 products, 6 creatives (2 그룹 × 3 label), VariantReport 2개 중 하나만 threshold 통과. `store.loadAll()=[]` 빈 DB이므로 dedup 비활성 | winners 테이블 정확히 1 row, 14 컬럼 값 일치 |
| J2 | `findCreativeByVariant matches (variantGroupId, variantLabel)` | 같은 variantGroupId를 공유하는 3개 개별 creative.json 파일 (Plan B 구조: 제품당 emotional/numerical/urgency 각 별도 파일) | 각 label 조회가 올바른 Creative.id 반환 |
| J3 | `DB lifecycle — opens once per invocation, closes via finally` | 같은 factory 반환 job을 2회 연속 호출. 첫 close가 제대로 됐으면 두 번째 open 성공 | 2회 모두 resolve, winners 테이블 건수 누적 |

**Fake voyage**: 각 텍스트 원소에 서로 다른 1-hot 512d 벡터 할당 → dedup 경로가 켜져도 cosine < 0.95 보장.

```ts
const fakeVoyage: VoyageClient = {
  async embed(texts) {
    return texts.map((_, i) => {
      const v = new Array(512).fill(0);
      v[i % 512] = 1;
      return v;
    });
  },
};
```

### 4.3 스케줄러 wire-up — 테스트 추가 없음

`cli/entries/worker.ts`와 `server/scheduler.ts`는 `createQualifyJob()` 호출 + deps 객체에 `qualify` 필드 추가만. `registerJobs` 시그니처 불변 → 기존 `core/scheduler/index.test.ts` 커버 범위 안. 수동 smoke로 보강.

### 4.4 회귀 방지

- 현재 HEAD 기준 통과 테스트 집합 유지 (개수는 HEAD에서 재측정, 고정 숫자 명시하지 않음)
- `improvementCycle.test.ts`의 aggregate/qualify/runCycle 3-stage DI 계약 유지

### 4.5 명시적 범위 밖

- launchd 실제 fire 통합 테스트
- Voyage 실 API 호출 테스트 (항상 fake)

---

## 5. 구현 순서 / Rollout

### 5.1 Task 분할

| # | Task | 파일 | 검증 |
|---|------|------|------|
| 1 | `pickBestPerVariantGroup` 순수 helper + 단위 테스트 P1-P4 | `core/rag/qualifier.ts`, `core/rag/qualifier.test.ts` | vitest pass (4 new) |
| 2 | `qualifyWinners` 시그니처 리팩터 + 통합 테스트 Q1-Q2 + 기존 4 수정 (착수 전 `types.ts`의 `RetrieveDeps` / `QualifyDeps` 분리 확인) | `core/rag/qualifier.ts`, `core/rag/types.ts`, `core/rag/qualifier.test.ts` | vitest pass (qualifyWinners block 6 tests) |
| 3 | `core/rag/qualifyJob.ts` factory + 테스트 J1-J3 | `core/rag/qualifyJob.ts` (신규), `core/rag/qualifyJob.test.ts` (신규) | vitest pass (3 new) |
| 4 | Scheduler wire-up (worker.ts + scheduler.ts 1 커밋) | `cli/entries/worker.ts`, `server/scheduler.ts` | `tsc --noEmit` + 기존 scheduler 테스트 pass |
| 5 | Manual smoke: `data/creatives.db` 및 `data/creatives/*.json` 존재 확인(없으면 `runPipeline` 1회로 fixture 채우기) → worker 한 틱 강제 실행 → `[qualify] inserted=N skipped=M` 로그 확인 | — | 수동 |
| 6 | `superpowers:code-reviewer` 최종 리뷰 | — | 리뷰 통과 |
| 7 | 문서 업데이트: `docs/STATUS.md`(🟡→✅, 최근 변경 이력, 마지막 업데이트 날짜), `docs/ROADMAP.md`(현재 추천 다음 작업 = "Plan C 실운영 검증"으로 승격), 필요 시 `docs/ARCHITECTURE.md` | docs/ | diff 리뷰 |

### 5.2 커밋 규칙

Task별 1 커밋(Task 4는 2파일이지만 동일 변경이므로 1 커밋 유지). 메시지 접두: `feat:` / `refactor:` / `test:` / `docs:`.

### 5.3 Rollout 리스크

- **DB 마이그레이션 없음**: `createCreativesDb`가 이미 winners 테이블 생성.
- **실패 격리**: qualify stage 실패는 `improvementCycle`이 try/catch → log+continue (§3.2). aggregate/runCycle에 파급 없음.
- **롤백 경로**: `deps.qualify` 주입 제거만으로 이전 noop 상태 복귀. 데이터는 additive이므로 손실 없음.
- **첫 production fire**: Owner worker 6h, Server 24h cadence. 수동 tick(Task 5)으로 즉시 검증.

### 5.4 명시적 범위 밖

- Retention TTL, 구조적 telemetry, Voyage embedding retry (별도 chore)
- launchd plist 수정 없음 (cadence 유지)

---

## 6. 관련 문서

- 원본 Plan C 스펙: `docs/superpowers/plans/2026-04-21-plan-c-winner-db-voyage-rag.md` §2082-2083 (wire-up 유예 명시)
- `docs/STATUS.md` — 현 상태 🟡
- `docs/ROADMAP.md` — "현재 추천 다음 작업" = 본 wire-up

---

## 검토 이력

### 2026-04-21 — 브레인스토밍 섹션별 자체 검토

Section 1~5 각각 CLAUDE.md "검토 깊이 요구사항" 5개 점검을 적용한 자체 검토를 본 스펙 작성 전에 수행 완료. 주요 이슈 및 반영:

- **Section 1**: best-first 후 threshold 필터 순서 오류(필터 통과 sibling 상실) → "filter 먼저, group 나중"으로 정정. Section §1.2 구체 예시 포함.
- **Section 2**: Voyage client lifecycle 애매 ("그때마다 재생성해도 비용 없음") → factory-scope 1회 생성으로 고정 (§2.2).
- **Section 3**: Deferral 3개(경계값) + Hard per-agg 로깅 공백 누락 → Deferral 2개로 축소, 에러 테이블에 "요약 로그 찍히지 않음" 경고 명시 (§3.2).
- **Section 4**: `pickBestPerVariantGroup`을 통합 테스트 안에 묻음 → 독립 describe 블록으로 분리 (§4.1). "테스트 262 통과" 고정 수 → "HEAD 기준 통과 집합 유지"로 완화 (§4.4). Tie-break 구체 예시 부재 → P3/P4 추가. J3의 DB close spy 불가 → 2회 연속 호출 검증으로 재정의.
- **Section 5**: 문서 업데이트를 smoke/리뷰 앞에 두면 "완료 일자" 의미 훼손 → Task 순서 교체 (§5.1 Task 5→6→7).

Critical: 없음 (모두 작성 중 발견·수정).

### 2026-04-21 — 스펙 저장 후 자체 검토

Critical: 없음.

Important I1: §2.5에서 `RetrieveDeps`/`QualifyDeps` 위치를 "`types.ts`에서 분리"로 기술했으나 실제로는 RetrieveDeps가 `retriever.ts:109`에 정의되어 있어 위치 주장이 부정확. 물리 분리 사실은 맞으므로 실제 경로로 문구 수정.

Minor:
- §2.3 "락 충돌도 거의 없다" 정성 추측 → WAL/쓰기 빈도 근거 보강.
- §2.4 "현 운영 스케일(수백 creatives)" 정량 미검증 → "현재 운영 중인 규모"로 완화, 격상 임계값(creatives 수천 이상)만 기준 제시.

모두 본 커밋 내 패치 완료.

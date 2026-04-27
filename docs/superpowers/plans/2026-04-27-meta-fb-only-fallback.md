# Meta FB-only Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `[platforms.meta].instagram_actor_id` 를 schema 에서 optional 로 전환하고, 값 유무에 따라 광고 placement 동적 분기 — 있으면 FB+IG 동시 게재, 없으면 FB only.

**Architecture:** 1 atomic commit. 5 production files + 4 test files 변경. TypeScript compile 이 안전망 (schema 변경 + launcher 호출처 + testing.ts omit 타입이 같은 commit 에서 sync).

**Tech Stack:** TypeScript, vitest, Zod. tsx 런타임.

**Spec:** `docs/superpowers/specs/2026-04-27-meta-fb-only-fallback-design.md` (커밋 `439c937`)

**브랜치:** master 직접 커밋 (CLAUDE.md 정책).

**견적:** ~2시간 (코드 0.5h + 테스트 0.5h + 문서 0.2h + subagent reviews 0.8h)

---

## Task 0: Pre-flight

### Task 0.1: 환경 + baseline 확인

**Files:** 없음 (검증만)

- [ ] **Step 1: 작업 트리 깨끗**
```bash
git status --short
```
Expected: 빈 출력 또는 `.claude/scheduled_tasks.lock` 만.

- [ ] **Step 2: HEAD = spec commit**
```bash
git log --oneline -3
```
Expected 최상단: `439c937 docs(specs): add Meta instagram_actor_id optional + FB-only fallback design spec`

- [ ] **Step 3: 테스트 baseline**
```bash
npm test 2>&1 | tail -5
```
Expected: **392 tests passing** (post-prompt-as-data refactor + scaffold).

- [ ] **Step 4: TypeScript clean**
```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
npx tsc --noEmit -p packages/cli/tsconfig.json 2>&1 | head
```
Expected: 0 errors after filtering pre-existing facebook SDK warnings.

---

## Task 1: Schema + Testing helper 변경

### Task 1.1: `config/schema.ts` 의 `instagram_actor_id` 옵셔널화

**Files:**
- Modify: `packages/core/src/config/schema.ts:9`

- [ ] **Step 1: 변경 (1 라인)**

`packages/core/src/config/schema.ts` 의 `MetaPlatform` 정의 (라인 5-10) 에서 `instagram_actor_id` 라인:

```ts
// Before (line 9)
  instagram_actor_id: z.string().regex(/^\d+$/),

// After
  instagram_actor_id: z.string().regex(/^\d+$/).optional(),
```

다른 필드 (access_token, ad_account_id, page_id) 는 그대로.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head -20
```

Expected: type 의존하는 곳에서 일부 에러 발생 가능 (`Config["platforms"]["meta"]["instagram_actor_id"]` 가 `string` → `string | undefined` 로 좁아짐). launcher.ts:127 의 `instagram_actor_id: meta.instagram_actor_id` 는 여전히 string-or-undefined 할당이라 OK. 만약 다른 곳에 strict access 가 있으면 그 위치 메모.

### Task 1.2: `config/testing.ts` 의 `omit` 타입 + loop 분기 추가

**Files:**
- Modify: `packages/core/src/config/testing.ts:70-83`

- [ ] **Step 1: 본체 변경**

`packages/core/src/config/testing.ts` 의 `makeTestConfig` 시그니처 + body:

```ts
// Before (lines 70-83)
export function makeTestConfig(
  overrides: DeepPartial<Config> = {},
  omit: ReadonlyArray<"billing" | "platforms.meta" | "ai.anthropic" | "ai.google" | "ai.voyage"> = []
): Config {
  const merged = deepMerge(BASE_CONFIG, overrides);
  for (const path of omit) {
    if (path === "billing") delete (merged as any).billing;
    else if (path === "platforms.meta") delete (merged as any).platforms.meta;
    else if (path === "ai.anthropic") delete (merged as any).ai.anthropic;
    else if (path === "ai.google") delete (merged as any).ai.google;
    else if (path === "ai.voyage") delete (merged as any).ai.voyage;
  }
  return merged;
}

// After
export function makeTestConfig(
  overrides: DeepPartial<Config> = {},
  omit: ReadonlyArray<
    | "billing"
    | "platforms.meta"
    | "platforms.meta.instagram_actor_id"
    | "ai.anthropic"
    | "ai.google"
    | "ai.voyage"
  > = []
): Config {
  const merged = deepMerge(BASE_CONFIG, overrides);
  for (const path of omit) {
    if (path === "billing") delete (merged as any).billing;
    else if (path === "platforms.meta") delete (merged as any).platforms.meta;
    else if (path === "platforms.meta.instagram_actor_id") {
      if (merged.platforms.meta) delete merged.platforms.meta.instagram_actor_id;
    }
    else if (path === "ai.anthropic") delete (merged as any).ai.anthropic;
    else if (path === "ai.google") delete (merged as any).ai.google;
    else if (path === "ai.voyage") delete (merged as any).ai.voyage;
  }
  return merged;
}
```

- [ ] **Step 2: 테스트 빌드 확인**

```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep "testing.ts\|makeTestConfig" | head
```

Expected: 0 hits (testing.ts 자체는 깨끗). 만약 makeTestConfig 호출처에서 type 좁아지는 issue 있으면 해당 호출 위치 확인.

### Task 1.3: `config/testing.test.ts` 신규 케이스 추가

**Files:**
- Modify: `packages/core/src/config/testing.test.ts`

- [ ] **Step 1: 현재 testing.test.ts 구조 확인**

```bash
cat packages/core/src/config/testing.test.ts
```

기존 케이스 확인 (omit 동작 테스트 있을 것).

- [ ] **Step 2: 신규 케이스 추가**

기존 describe 안 또는 새 describe 로 추가:

```ts
it("omits platforms.meta.instagram_actor_id when in omit list, preserves other meta fields", () => {
  const cfg = makeTestConfig({}, ["platforms.meta.instagram_actor_id"]);
  expect(cfg.platforms.meta?.instagram_actor_id).toBeUndefined();
  expect(cfg.platforms.meta?.access_token).toBe("test-meta-token");
  expect(cfg.platforms.meta?.ad_account_id).toBe("act_0000000000");
  expect(cfg.platforms.meta?.page_id).toBe("0000000000");
});
```

- [ ] **Step 3: 테스트 실행**

```bash
npx vitest run packages/core/src/config/testing.test.ts 2>&1 | tail -10
```

Expected: 기존 케이스 + 1 신규 통과.

---

## Task 2: Launcher 동적 placement 분기

### Task 2.1: `meta/launcher.ts:buildAdSetTargeting` 본체 변경

**Files:**
- Modify: `packages/core/src/platform/meta/launcher.ts:19-28`

- [ ] **Step 1: 본체 교체**

`packages/core/src/platform/meta/launcher.ts` 의 `buildAdSetTargeting` 함수 (라인 19-28):

```ts
// Before
export function buildAdSetTargeting() {
  const cfg = getConfig();
  return {
    age_min: cfg.defaults.target_age_min,
    age_max: cfg.defaults.target_age_max,
    geo_locations: { countries: ["KR"] },
    publisher_platforms: ["instagram"],
    instagram_positions: ["stream", "story", "reels"],
  };
}

// After
export function buildAdSetTargeting() {
  const cfg = getConfig();
  const igActorId = cfg.platforms.meta?.instagram_actor_id;
  const igEnabled = Boolean(igActorId);

  const publisher_platforms: string[] = ["facebook"];
  if (igEnabled) publisher_platforms.push("instagram");

  const targeting: {
    age_min: number;
    age_max: number;
    geo_locations: { countries: string[] };
    publisher_platforms: string[];
    facebook_positions: string[];
    instagram_positions?: string[];
  } = {
    age_min: cfg.defaults.target_age_min,
    age_max: cfg.defaults.target_age_max,
    geo_locations: { countries: ["KR"] },
    publisher_platforms,
    facebook_positions: ["feed", "story", "video_feeds", "marketplace"],
  };

  if (igEnabled) {
    targeting.instagram_positions = ["stream", "story", "reels"];
  }

  return targeting;
}
```

`requireMeta()` 대신 `cfg.platforms.meta?.instagram_actor_id` 직접 옵셔널 access — schema optional 변경 후 자연스러움.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
```

Expected: 0 errors.

### Task 2.2: `meta/launcher.ts:launchMetaDco` 의 `createAdCreative` 분기

**Files:**
- Modify: `packages/core/src/platform/meta/launcher.ts:122-131`

- [ ] **Step 1: object_story_spec 조건부 빌드**

`packages/core/src/platform/meta/launcher.ts` 의 createAdCreative 호출 (라인 122-131):

```ts
// Before
    // 5. Create DCO ad creative
    const meta = requireMeta();
    const adCreative = await account.createAdCreative([], {
      name: `${group.product.name} - DCO Creative`,
      object_story_spec: {
        page_id: meta.page_id,
        instagram_actor_id: meta.instagram_actor_id,
      },
      asset_feed_spec: assetFeedSpec,
    });

// After
    // 5. Create DCO ad creative
    const meta = requireMeta();
    const objectStorySpec: { page_id: string; instagram_actor_id?: string } = {
      page_id: meta.page_id,
    };
    if (meta.instagram_actor_id) {
      objectStorySpec.instagram_actor_id = meta.instagram_actor_id;
    }
    const adCreative = await account.createAdCreative([], {
      name: `${group.product.name} - DCO Creative`,
      object_story_spec: objectStorySpec,
      asset_feed_spec: assetFeedSpec,
    });
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
```

Expected: 0 errors.

---

## Task 3: 테스트 추가

### Task 3.1: `meta/launcher.test.ts` 의 `buildAdSetTargeting` 케이스 강화 + 신규

**Files:**
- Modify: `packages/core/src/platform/meta/launcher.test.ts`

- [ ] **Step 1: 기존 케이스 강화 + 신규 케이스 추가**

기존 `describe("buildAdSetTargeting")` 블록 (현재 1개 it, "targets South Korea on Instagram by default") 을 다음으로 교체:

```ts
import { setConfigForTesting } from "../../config/index.js";
import { makeTestConfig } from "../../config/testing.js";

describe("buildAdSetTargeting", () => {
  it("includes facebook + instagram in publisher_platforms when IG actor configured (default)", () => {
    // BASE_CONFIG already has instagram_actor_id; vitest.setup.ts injects it.
    const targeting = buildAdSetTargeting();
    expect(targeting.geo_locations.countries).toContain("KR");
    expect(targeting.publisher_platforms).toEqual(["facebook", "instagram"]);
    expect(targeting.facebook_positions).toEqual(
      expect.arrayContaining(["feed", "story", "video_feeds", "marketplace"]),
    );
    expect(targeting.instagram_positions).toEqual(["stream", "story", "reels"]);
  });

  it("excludes instagram from publisher_platforms when IG actor missing", () => {
    setConfigForTesting(makeTestConfig({}, ["platforms.meta.instagram_actor_id"]));
    const targeting = buildAdSetTargeting();
    expect(targeting.publisher_platforms).toEqual(["facebook"]);
    expect(targeting.facebook_positions).toEqual(
      expect.arrayContaining(["feed", "story", "video_feeds", "marketplace"]),
    );
    // instagram_positions 가 undefined 또는 미존재
    expect((targeting as any).instagram_positions).toBeUndefined();
  });
});
```

기존 import 라인이 `import { buildCampaignName, buildAdSetTargeting, buildAdConfig, launchMetaDco } from "./launcher.js";` 형태 — 그대로 유지하고 `setConfigForTesting`/`makeTestConfig` import 만 추가.

- [ ] **Step 2: 테스트 실행**

```bash
npx vitest run packages/core/src/platform/meta/launcher.test.ts 2>&1 | tail -15
```

Expected: 기존 4 describe 모두 통과 + buildAdSetTargeting 가 1 → 2 케이스로 확장. 총 ~6 cases passing.

### Task 3.2: `config/schema.test.ts` IG-missing accept 케이스 신규

**Files:**
- Modify: `packages/core/src/config/schema.test.ts`

- [ ] **Step 1: 신규 케이스 추가**

기존 describe `"ConfigSchema"` 블록 끝에 추가:

```ts
it("accepts meta config without instagram_actor_id (optional)", () => {
  const r = ConfigSchema.safeParse({
    ...validBase,
    platforms: {
      enabled: ["meta"],
      meta: {
        access_token: "tok",
        ad_account_id: "act_1234567890",
        page_id: "1234567890",
        // instagram_actor_id 의도적 누락
      },
    },
  });
  expect(r.success).toBe(true);
});
```

`validBase` 는 기존 테스트의 const (라인 5-16).

- [ ] **Step 2: 테스트 실행**

```bash
npx vitest run packages/core/src/config/schema.test.ts 2>&1 | tail -10
```

Expected: 기존 5+ 케이스 + 1 신규 통과.

### Task 3.3: `platform/registry.test.ts` IG-missing accept 케이스 신규

**Files:**
- Modify: `packages/core/src/platform/registry.test.ts`

- [ ] **Step 1: 신규 케이스 추가**

기존 `describe("validatePlatform")` 블록 안 적절한 위치에 추가:

```ts
it("accepts meta config without instagram_actor_id (optional field)", () => {
  const cfg = makeTestConfig({}, ["platforms.meta.instagram_actor_id"]);
  const r = validatePlatform("meta", cfg);
  expect(r.ok).toBe(true);
});
```

`makeTestConfig` 는 이미 import 됨.

- [ ] **Step 2: 테스트 실행**

```bash
npx vitest run packages/core/src/platform/registry.test.ts 2>&1 | tail -10
```

Expected: 기존 케이스 + 1 신규 통과.

### Task 3.4: 전체 테스트 그린 확인

- [ ] **Step 1: `npm test`**

```bash
npm test 2>&1 | tail -10
```

Expected: **392 + 4 = 396 tests passing** (4 신규: testing.test.ts +1, launcher.test.ts +1, schema.test.ts +1, registry.test.ts +1). buildAdSetTargeting 의 기존 1개 → 2개로 확장이라 net +1.

만약 다른 테스트 회귀 발생 시 (예: 기존 테스트가 `publisher_platforms: ["instagram"]` 정확 매칭 검증 — 단 `arrayContaining` 패턴이라 회귀 없을 가능성 높음), 회귀 원인 파악 후 적절히 수정.

---

## Task 4: 문서 업데이트

### Task 4.1: `config.example.toml` 갱신

**Files:**
- Modify: `config.example.toml`

- [ ] **Step 1: instagram_actor_id 줄 주석 + 설명**

`config.example.toml` 의 `[platforms.meta]` 섹션 (현재 `instagram_actor_id` 줄):

```bash
grep -n "instagram_actor_id" config.example.toml
```

기존 줄을 다음으로 변경:

```toml
# instagram_actor_id = "1234567890"  # optional. 미설정 시 Facebook 전용 광고. 설정 시 FB+IG 동시 게재.
```

(이미 주석 처리돼있을 수 있음 — 확인 후 설명 부분 갱신.)

### Task 4.2: `docs/STATUS.md` 최근 변경 이력

**Files:**
- Modify: `docs/STATUS.md`

- [ ] **Step 1: 마지막 업데이트 날짜**

라인 3 (`마지막 업데이트:`) → `2026-04-27`.

- [ ] **Step 2: 최근 변경 이력 entry 추가**

`## 최근 변경 이력` 섹션 맨 위에 추가:

```markdown
- 2026-04-27 feat(meta): `instagram_actor_id` 를 schema 에서 optional 로 전환. `buildAdSetTargeting` 이 `publisher_platforms` 동적 분기 — 값 있으면 `["facebook", "instagram"]` + IG positions, 없으면 `["facebook"]` + FB positions only. `createAdCreative` 의 `object_story_spec.instagram_actor_id` 도 조건부 포함. IG biz account 미연결 사용자도 광고 게재 가능. 1 commit atomic. 396 tests 통과.
```

---

## Task 5: Subagent reviews + Commit

### Task 5.1: `meta-platform-expert` subagent 호출

CLAUDE.md "Subagent 호출 규칙" — `packages/core/src/platform/meta/launcher.ts` 수정 → meta-platform-expert 호출 필수.

- [ ] **Step 1: diff 확보**

```bash
git diff --stat
git diff packages/core/src/platform/meta/launcher.ts > /tmp/launcher-diff.txt
wc -l /tmp/launcher-diff.txt
```

- [ ] **Step 2: meta-platform-expert 호출**

`Agent` 도구로 `meta-platform-expert`. 검증 포인트:
- `publisher_platforms: ["facebook"]` 이 Meta DCO 의 valid 한 단일 platform 광고 셋업인지
- `facebook_positions: ["feed", "story", "video_feeds", "marketplace"]` enum 값이 Meta Marketing API 의 정확한 placement 값인지 (`right_hand_column` 제외 결정 검토)
- `object_story_spec` 에서 `instagram_actor_id` 누락 시 Meta API 가 `page_id` 만으로 정상 광고 생성하는지 (Facebook actor 만)
- `cfg.platforms.meta?.instagram_actor_id` 옵셔널 access 가 launcher 안에서 안전한지 (`requireMeta()` 와 일관성)

- [ ] **Step 3: 발견 이슈 처리**

Critical/Important: 즉시 수정 후 재검토.
Minor: STATUS 알려진 결함에 추가 또는 수용 (이번 spec scope 안에서 fix 가능하면 fix).

### Task 5.2: `superpowers:code-reviewer` 호출

- [ ] **Step 1: code-reviewer 호출**

`Agent` 도구로 `superpowers:code-reviewer`. WHAT_WAS_IMPLEMENTED: spec §2-§5 의 코드/테스트 변경. PLAN_OR_REQUIREMENTS: 본 plan. BASE_SHA: `439c937`. HEAD_SHA: 아직 commit 전.

- [ ] **Step 2: 발견 이슈 처리**

### Task 5.3: 명시적 add + Commit

- [ ] **Step 1: 변경 파일 확인**

```bash
git status --short
```

Expected: 8 files modified (5 production: schema.ts, testing.ts, launcher.ts, config.example.toml, STATUS.md + 4 test: testing.test.ts, launcher.test.ts, schema.test.ts, registry.test.ts).

- [ ] **Step 2: 명시적 add (-A 사용 금지)**

```bash
git add packages/core/src/config/schema.ts \
  packages/core/src/config/schema.test.ts \
  packages/core/src/config/testing.ts \
  packages/core/src/config/testing.test.ts \
  packages/core/src/platform/meta/launcher.ts \
  packages/core/src/platform/meta/launcher.test.ts \
  packages/core/src/platform/registry.test.ts \
  config.example.toml \
  docs/STATUS.md
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(meta): make instagram_actor_id optional + dynamic FB/IG placement

config/schema.ts: instagram_actor_id 를 .optional() 로 전환. IG biz account 미연결 사용자도 config 검증 통과.

meta/launcher.ts:buildAdSetTargeting: publisher_platforms 동적 분기 — IG actor 있으면 ["facebook", "instagram"] + facebook_positions + instagram_positions, 없으면 ["facebook"] + facebook_positions only. facebook_positions 표준 4개 (feed, story, video_feeds, marketplace) 명시 — DCO 자동 ranking 환경에서 충분.

meta/launcher.ts:launchMetaDco: createAdCreative 의 object_story_spec.instagram_actor_id 조건부 포함. meta.instagram_actor_id truthy 일 때만 spec 에 추가. Meta API 가 page_id 만으로도 Facebook actor 광고 생성 정상.

config/testing.ts: omit 타입에 "platforms.meta.instagram_actor_id" 추가 + loop 분기. 테스트가 IG actor 없는 시나리오 명시적 표현 가능.

테스트:
- launcher.test.ts: buildAdSetTargeting 의 IG-있음/없음 두 분기 케이스
- schema.test.ts: instagram_actor_id 누락 config 가 schema 통과 확인
- registry.test.ts: validatePlatform("meta") 가 IG 누락도 ok 반환 확인
- testing.test.ts: omit 헬퍼가 instagram_actor_id 만 정확히 제거 확인

config.example.toml: instagram_actor_id 줄 주석 처리 + 의미 설명 ("미설정 시 Facebook 전용 광고. 설정 시 FB+IG 동시 게재").

docs/STATUS.md: 최근 변경 이력 + 마지막 업데이트.

마이그레이션 zero (현재 사용자 캠페인 미게재 + IG 미연결 상태).

Spec: docs/superpowers/specs/2026-04-27-meta-fb-only-fallback-design.md
EOF
)"
```

- [ ] **Step 4: 최종 verification**

```bash
git log --oneline -5
npm test 2>&1 | tail -5
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
```

Expected: HEAD = 새 commit, 396 tests passing, 0 TS errors.

---

## 완료 조건 (Definition of Done)

- [ ] 1 commit (atomic — schema + launcher + testing + tests + config.example + STATUS)
- [ ] `npm test` ~396 (392 + 4 신규)
- [ ] `data/learned/prompts.json`, `data/improvements/` 비어있음 유지 (테스트 격리 회귀 없음)
- [ ] grep 검증: launcher.ts 안에서 `meta.instagram_actor_id` 가 truthy check 또는 optional access 통과해서 사용. required 가정 직접 접근 0건
  ```bash
  grep -n "instagram_actor_id" packages/core/src/platform/meta/launcher.ts
  ```
  Expected: ~3 hits — buildAdSetTargeting 의 truthy check + createAdCreative 의 조건부 spread.
- [ ] meta-platform-expert 검토 통과
- [ ] code-reviewer 검토 통과
- [ ] STATUS 마지막 업데이트 = 2026-04-27
- [ ] config.example.toml 주석 갱신

---

## 작업 시간 견적

| 단계 | 시간 |
|---|---|
| Task 0 pre-flight | 0.1h |
| Task 1 schema + testing.ts | 0.3h |
| Task 2 launcher 변경 | 0.4h |
| Task 3 테스트 추가 | 0.5h |
| Task 4 문서 | 0.2h |
| Task 5 subagent reviews + 수정 | 0.8h |
| 안정화 | 0.2h |
| **합계** | **~2.5h** |

---

## Self-Review

### Spec coverage 매핑

| Spec section | Plan task | 검증 |
|---|---|---|
| §1 배경 | Plan header / Goal | ✅ |
| §2.1 범위 안 (8항목) | Tasks 1-4 | ✅ |
| §2.2 범위 밖 | Plan 본문에 언급 안 함 (의도) | ✅ |
| §3.1 분기 동작 표 | Task 2.1 코드 | ✅ |
| §3.2 IG-only 옵션 배제 | spec §2.2 + plan 의 default 동작 | ✅ |
| §3.3 마이그레이션 (zero) | Task 0 Step 4 (data 비어있음 재확인) | ✅ |
| §3.4 Placement enum 검증 | Task 5.1 meta-platform-expert 호출 시 검증 요청 | ✅ |
| §4.1 schema.ts | Task 1.1 | ✅ |
| §4.2 buildAdSetTargeting | Task 2.1 | ✅ |
| §4.3 launchMetaDco createAdCreative | Task 2.2 | ✅ |
| §4.4 registry.ts (변경 불필요) | Plan 본문에 안 둠 (변경 없음) | ✅ |
| §4.5 testing.ts | Task 1.2 | ✅ |
| §4.6 config.example.toml | Task 4.1 | ✅ |
| §5.1 테스트 케이스 | Tasks 3.1-3.3 | ✅ |
| §5.2 테스트 수 delta (~+4 신규) | DoD 396 tests | ✅ |
| §5.3 통합 검증 (object_story_spec unit test 안 함) | Plan 본문에 안 둠 (의도) | ✅ |
| §6 영속 데이터 마이그레이션 (필요 없음) | Task 0 Step 4 | ✅ |
| §7 리스크 + 롤백 | Plan 본문 명시 안 함 (spec 에 있음) | ✅ |
| §8 작업 순서 (1 commit) | Plan Task 5.3 | ✅ |
| §9 시간 견적 | Plan 본문 시간 견적 | ✅ |
| §10 Definition of Done | Plan DoD 섹션 | ✅ |
| §11 Open Questions | Plan 본문 없음 (spec 에 위임) | ✅ |

### Placeholder scan

- "TBD", "TODO", "implement later", "fill in details": 0건 ✅
- "Add appropriate error handling": 0건 ✅
- "Similar to Task N": 0건 (모든 Task 코드 본체 명시) ✅

### Type consistency

- `buildAdSetTargeting` 시그니처 변경 없음 (반환 타입 inferred) ✅
- `cfg.platforms.meta?.instagram_actor_id` 옵셔널 access 일관 ✅
- `objectStorySpec: { page_id: string; instagram_actor_id?: string }` 타입 explicit ✅
- `omit` 타입에 `"platforms.meta.instagram_actor_id"` 추가가 makeTestConfig 호출처에 type-check breaking 없음 (순수 추가) ✅

이슈 없음.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-27-meta-fb-only-fallback.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 각 Task 마다 fresh subagent dispatch + 두 단계 리뷰 (spec + code quality). Task 5 에서 meta-platform-expert + code-reviewer.

**2. Inline Execution** — CLAUDE.md 가 Inline 사용 금지 — *해당 없음*.

CLAUDE.md 정책상 **Subagent-Driven 만 허용**. 진행 시 `superpowers:subagent-driven-development` 스킬 호출.

# Meta `instagram_actor_id` 옵셔널화 — Facebook-only Fallback

**작성일:** 2026-04-27
**스펙 종류:** 설계 + 동작 변경 (광고 placement)
**관련:** `packages/core/src/platform/meta/*`, `packages/core/src/config/schema.ts`

---

## 1. 배경 (Why)

현재 `[platforms.meta].instagram_actor_id` 가 schema 에서 *required* 이고, `meta/launcher.ts:buildAdSetTargeting` 이 `publisher_platforms: ["instagram"]` 으로 *Instagram 전용 DCO 광고* 를 hardcode 한다. 결과:

1. Facebook Page 에 IG biz account 가 연결 안 된 사용자는 config 검증 실패 (Zod) 로 시스템 기동 자체 불가
2. 사용자가 Facebook 만으로 광고 게재하고 싶어도 코드 수정 없이는 불가능
3. `instagram_actor_id` 는 본질적으로 *placement-specific* 옵션 (Meta API 측면) — IG placement 사용 시에만 필요. required 로 두는 건 over-constraint

본 spec 의 목표: `instagram_actor_id` 를 **optional 로** 변경하고, 값 유무에 따라 광고 placement 분기 — 있으면 Facebook + Instagram 동시 게재, 없으면 Facebook 전용.

---

## 2. 범위

### 2.1 범위 안

1. `config/schema.ts`: `instagram_actor_id` 를 `.optional()` 로 변경
2. `meta/launcher.ts:buildAdSetTargeting`: `publisher_platforms` / placements 동적 생성
3. `meta/launcher.ts:launchMetaDco` 의 `createAdCreative` 에서 `object_story_spec.instagram_actor_id` 조건부 포함
4. `platform/registry.ts:validatePlatform`: missing fields 검사에서 `instagram_actor_id` 제외 (이미 schema 에서 옵셔널이라 redundant 검증 불필요)
5. `config/testing.ts`: `omit` 타입에 `"platforms.meta.instagram_actor_id"` 추가 (테스트 분기용)
6. 테스트 추가: IG actor 있을 때 / 없을 때 양쪽 분기 검증
7. `config.example.toml`: `instagram_actor_id` 주석 + 의미 설명 추가
8. 문서: STATUS 최근 변경 이력

### 2.2 범위 밖 (의도적 deferred)

| 안 하는 것 | 이유 |
|---|---|
| IG-only 의도 보존 옵션 (`meta.placements: ["instagram"]`) | 현재 사용자 (소유자) IG 미연결 상태 + 캠페인 미게재 → 마이그레이션 비용 zero. IG-only 가 정말 필요해지면 별 spec |
| `right_hand_column` / `search` / `instream_video` 같은 추가 FB placement | Meta DCO 가 자동 ranking — 표준 4개 (`feed`, `story`, `video_feeds`, `marketplace`) 만 명시 |
| Audience Network / Messenger placement | DCO 광고 일반 케이스 아님 — 별 spec |
| 사용자별 placement preference UI | 단일 사용자 로컬 환경, 필요 시점에 |

---

## 3. 핵심 결정

### 3.1 분기 동작

| `instagram_actor_id` | `publisher_platforms` | `facebook_positions` | `instagram_positions` | `object_story_spec.instagram_actor_id` |
|---|---|---|---|---|
| 값 있음 (`"17841..."`) | `["facebook", "instagram"]` | `["feed", "story", "video_feeds", "marketplace"]` | `["stream", "story", "reels"]` | 포함됨 |
| 미설정 / 주석 | `["facebook"]` | `["feed", "story", "video_feeds", "marketplace"]` | (제외) | (제외) |

### 3.2 분기 동작 — IG-only 옵션 배제

이전 ("IG actor 있으면 IG only") 동작을 *유지하지 않는다*. 이유:

1. schema optional + behavior 분기 (IG actor 있으면 IG only, 없으면 FB only) 는 어색 — *둘 다* 게재 옵션이 영영 없음
2. 광고 효과 측면에서 FB+IG 동시 게재가 한국 시장에서 가장 일반적 ROI 좋음 (IG 의 reach 강력, 특히 20-30대 + Reels)
3. "IG-only" 의도가 정말 필요한 사용자는 별 옵션 (`placements`) 으로 future spec 가능

### 3.3 마이그레이션

기존 사용자 (config.toml 에 `instagram_actor_id` 있음):
- 이전: `publisher_platforms: ["instagram"]` → IG only 게재
- 변경 후: `publisher_platforms: ["facebook", "instagram"]` → FB + IG 동시 게재

이건 *동작 변화*. 다만:
- 현재 사용자 (소유자) 한 명만 존재
- `data/campaigns/` 비어있음 (캠페인 미게재 상태)
- IG biz 연결 없음 → IG actor 미설정 상태 → 변경 후 FB-only 로 가는 path 가 정상

따라서 마이그레이션 비용 zero.

### 3.4 Placement enum 검증

Meta Marketing API TargetingSpec 문서 (https://developers.facebook.com/docs/marketing-api/reference/ad-account/adsets/) 기준:

- `publisher_platforms`: `"facebook"`, `"instagram"`, `"audience_network"`, `"messenger"`
- `facebook_positions`: `"feed"`, `"right_hand_column"`, `"marketplace"`, `"video_feeds"`, `"story"`, `"search"`, `"instream_video"` 등
- `instagram_positions`: `"stream"`, `"story"`, `"explore"`, `"reels"`, `"shop"`, `"profile_feed"` 등

본 spec 선택:
- FB: `feed` (홈 피드), `story` (스토리), `video_feeds` (Reels FB 등가), `marketplace` (마켓플레이스)
- IG: 기존 동작 유지 (`stream`, `story`, `reels`)
- 제외: `right_hand_column` (desktop only), `search`/`instream_video` (별도 광고 종류)

---

## 4. 코드 변경 상세

### 4.1 `packages/core/src/config/schema.ts`

```ts
// Before
const MetaPlatform = z.object({
  access_token: z.string().min(1),
  ad_account_id: z.string().regex(/^act_\d+$/, 'must be "act_" + digits'),
  page_id: z.string().regex(/^\d+$/),
  instagram_actor_id: z.string().regex(/^\d+$/),
});

// After
const MetaPlatform = z.object({
  access_token: z.string().min(1),
  ad_account_id: z.string().regex(/^act_\d+$/, 'must be "act_" + digits'),
  page_id: z.string().regex(/^\d+$/),
  instagram_actor_id: z.string().regex(/^\d+$/).optional(),
});
```

### 4.2 `packages/core/src/platform/meta/launcher.ts:buildAdSetTargeting`

```ts
// Before (lines 19-28)
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

`requireMeta()` 대신 `cfg.platforms.meta?.instagram_actor_id` 직접 접근 — `requireMeta()` 가 throw 시점이 다름 (이미 launcher 진입 시 `initMeta()` 가 검증). `cfg.platforms.meta` 가 undefined 면 launcher 자체가 호출 안 될 흐름 (registry 가 차단).

### 4.3 `packages/core/src/platform/meta/launcher.ts:launchMetaDco` 의 `createAdCreative`

```ts
// Before (lines ~119-126)
const adCreative = await account.createAdCreative([], {
  name: `${group.product.name} - DCO Creative`,
  object_story_spec: {
    page_id: meta.page_id,
    instagram_actor_id: meta.instagram_actor_id,
  },
  asset_feed_spec: assetFeedSpec,
});

// After
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

Meta API 의 `object_story_spec.instagram_actor_id` 는 optional — 없으면 Facebook actor (= page) 만 사용.

### 4.4 `packages/core/src/platform/registry.ts:validatePlatform`

```ts
// Before
if (name === "meta") {
  const meta = cfg.platforms.meta;
  if (!meta) return { ok: false, missing: ["platforms.meta"] };
  const missing: string[] = [];
  if (!meta.access_token) missing.push("platforms.meta.access_token");
  if (!meta.ad_account_id) missing.push("platforms.meta.ad_account_id");
  if (!meta.page_id) missing.push("platforms.meta.page_id");
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
```

본 spec 의 변경: `instagram_actor_id` 검증 라인이 위 코드에 *원래 없음*. registry.ts 는 이미 access_token / ad_account_id / page_id 만 검증. **변경 불필요**.

(spec 작성 단계 검증: `grep "instagram_actor_id" packages/core/src/platform/registry.ts` → 0 hits 확인. 만약 있으면 제거.)

### 4.5 `packages/core/src/config/testing.ts`

```ts
// Before (line 70-72)
export function makeTestConfig(
  overrides: DeepPartial<Config> = {},
  omit: ReadonlyArray<"billing" | "platforms.meta" | "ai.anthropic" | "ai.google" | "ai.voyage"> = []
): Config {

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
```

`omit` loop 에 분기 추가:

```ts
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
```

### 4.6 `config.example.toml`

```toml
[platforms.meta]
# Meta Marketing API access token (System User token 권장)
access_token = "EAA..."
ad_account_id = "act_1234567890"  # "act_" 접두사 포함
page_id = "1234567890"
# instagram_actor_id = "1234567890"  # optional. 미설정 시 Facebook 전용 광고. 설정 시 FB+IG 동시 게재.
```

`instagram_actor_id` 줄을 주석 처리 + 의미 설명. 예시 값 (`"1234567890"`) 은 그대로 두어 사용자가 설정 시 형태 참고 가능.

---

## 5. 테스트 전략

### 5.1 신규/수정 테스트 케이스

#### `meta/launcher.test.ts` — 기존 1개 케이스 보강 + 신규 분기 케이스

기존:
```ts
describe("buildAdSetTargeting", () => {
  it("targets South Korea on Instagram by default", () => {
    const targeting = buildAdSetTargeting();
    expect(targeting.geo_locations.countries).toContain("KR");
    expect(targeting.publisher_platforms).toContain("instagram");
  });
});
```

기존 케이스는 BASE_CONFIG 가 IG actor 포함 → 변경 후에도 통과 (FB + IG 둘 다 publisher_platforms 에). 단 기대치 명확화:

```ts
// After
describe("buildAdSetTargeting", () => {
  it("includes facebook + instagram in publisher_platforms when IG actor configured", () => {
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
    expect(targeting.instagram_positions).toBeUndefined();
  });
});
```

#### `meta/launcher.test.ts` — `launchMetaDco` integration 신규

이미 `launchMetaDco onLog emission` describe 가 있으나 signature check 만 함. 신규 케이스로 `createAdCreative` 의 `object_story_spec` 분기 검증. 단 기존 코드는 actual Meta SDK 호출 mock 없이 시그니처만 검증하는 패턴 — 따라서 새 케이스도 unit-test-friendly 한 layer 에서 검증 권장.

대안: `buildAdSetTargeting` 처럼 `object_story_spec` 도 helper 로 추출 → unit test. 하지만 이건 *추가 refactor* 라 본 spec 범위 밖. 본 spec 에서는 `buildAdSetTargeting` 분기만 unit 테스트.

`launchMetaDco` 내부 `object_story_spec` 분기는 *코드 리뷰* + *수동 검증* 으로 cover (실 Meta API 호출 시 검증 가능). 또는 future spec 에서 helper 추출.

#### `schema.test.ts` 신규

```ts
it("accepts meta config without instagram_actor_id", () => {
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

#### `registry.test.ts` 신규

```ts
it("accepts meta config without instagram_actor_id (optional)", () => {
  const cfg = makeTestConfig({}, ["platforms.meta.instagram_actor_id"]);
  const r = validatePlatform("meta", cfg);
  expect(r.ok).toBe(true);
});
```

#### `testing.test.ts` 신규 (해당 file 있다면)

```ts
it("omits platforms.meta.instagram_actor_id when in omit list", () => {
  const cfg = makeTestConfig({}, ["platforms.meta.instagram_actor_id"]);
  expect(cfg.platforms.meta?.instagram_actor_id).toBeUndefined();
  expect(cfg.platforms.meta?.access_token).toBe("test-meta-token"); // 다른 필드 보존
});
```

### 5.2 테스트 수 delta

| 파일 | 신규/수정 |
|---|---|
| `meta/launcher.test.ts` | +1 신규 케이스 (IG missing) + 1 수정 (기존 강화) |
| `schema.test.ts` | +1 신규 |
| `registry.test.ts` | +1 신규 |
| `testing.test.ts` | +1 신규 |

**대략 +4 신규 + 1 수정**. 기존 392 → ~396.

### 5.3 통합 검증

`launchMetaDco` 의 `object_story_spec` 분기는 unit test 추가 안 함 — 실 API 호출 시 검증. 회귀 위험 mitigation:

- `buildAdSetTargeting` 분기 unit test 가 정상 동작 확인 (publisher_platforms 정확)
- `object_story_spec.instagram_actor_id` 가 `meta.instagram_actor_id` 가 truthy 일 때만 포함되는 단순 분기 — 코드 리뷰가 충분
- 실 운영 시 Meta API 가 invalid `object_story_spec` 거부 → 즉시 발견 가능

---

## 6. 영속 데이터 마이그레이션

**필요 없음**. 

- `data/campaigns/` 비어있음 (이전 작업에서 검증됨)
- 기존 launched 캠페인이 있더라도 `Campaign.externalIds` 구조는 변경 없음 — 이번 spec 은 *생성 시점* 의 placement 만 영향
- 기존 IG-only 게재된 광고가 있으면 그대로 IG only 로 운영됨 (Meta API 가 retroactively 변경 안 함)

---

## 7. 리스크 + 롤백

### 7.1 Critical 위험

**`buildAdSetTargeting` 의 publisher_platforms 변경이 광고 게재 결과 변동**: 기존 IG-only 사용자가 변경 후 FB+IG 동시 게재로 전환됨. 광고 비용 분배가 변할 수 있음 (Meta DCO 가 platform 간 자동 ranking — 보통 IG 가 더 효과 좋아 IG 지출 비중 유지될 가능성 높지만 보장 안 됨).

완화:
- 현재 사용자 (소유자) 가 캠페인 미게재 상태 → 변경 영향 zero
- 미래에 IG-only 의도 사용자가 등장하면 별 옵션 (`meta.placements`) 추가 spec

### 7.2 일반 롤백

`git revert <sha>` 단순 복구. 영속 데이터 마이그레이션 없으므로 rollback 비용 zero.

### 7.3 중간 상태 안전성

본 spec 은 1 commit (atomic). 중간 상태 없음. schema + launcher + testing 모두 동시 변경 (TypeScript 가 inconsistency 잡음).

---

## 8. 작업 순서 (1 commit)

### Commit 1 — instagram_actor_id 옵셔널화 + placement 분기

**Files (modify):**
- `packages/core/src/config/schema.ts` — `.optional()` 추가
- `packages/core/src/config/testing.ts` — omit 타입 + loop 분기
- `packages/core/src/platform/meta/launcher.ts` — `buildAdSetTargeting` 분기 + `createAdCreative` `object_story_spec` 조건부
- `packages/core/src/platform/meta/launcher.test.ts` — 1 수정 + 1 신규
- `packages/core/src/config/schema.test.ts` — 1 신규
- `packages/core/src/platform/registry.test.ts` — 1 신규
- `packages/core/src/config/testing.test.ts` (있다면) — 1 신규
- `config.example.toml` — `instagram_actor_id` 주석 + 설명
- `docs/STATUS.md` — 마지막 업데이트 + 최근 변경 이력

**Subagent 호출:**
- `meta-platform-expert`: `platform/meta/launcher.ts` 수정 → CLAUDE.md "Subagent 호출 규칙" 트리거
- `superpowers:code-reviewer`: 모든 commit 후 검토

---

## 9. 작업 시간 견적

| 단계 | 시간 |
|---|---|
| 코드 변경 (schema + launcher + testing + registry checks) | 0.5h |
| 테스트 작성 (5 신규/수정) | 0.5h |
| 문서 (config.example, STATUS) | 0.2h |
| meta-platform-expert + code-reviewer + 수정 round | 0.8h |
| **합계** | **~2시간** |

---

## 10. Definition of Done

- [ ] `npm test` ~396 passing (392 + 4 신규)
- [ ] `data/learned/prompts.json`, `data/improvements/` 비어있음 유지 (테스트 격리 기능 회귀 없음)
- [ ] grep 검증: `instagram_actor_id` 가 production code 에서 옵셔널 access (`?.`) 또는 `Boolean(...)` check 통해 사용. required 가정한 직접 접근 0건
- [ ] meta-platform-expert 검토 통과
- [ ] code-reviewer 검토 통과
- [ ] STATUS 마지막 업데이트 = 2026-04-27
- [ ] config.example.toml 주석 갱신

---

## 11. Open Questions / 후속 작업

1. **IG-only 의도 보존 옵션** — 현재는 `instagram_actor_id` 있으면 *FB + IG 둘 다*. 만약 IG-only 광고 (예: 브랜드 톤이 IG-first) 가 정말 필요해지면 `meta.placements: ["instagram"]` 같은 별 옵션 spec.
2. **추가 FB placement** — `right_hand_column`, `search`, `instream_video` 등 광고 효과 측정 후 추가 검토.
3. **Audience Network / Messenger** — DCO 일반 케이스 아니지만 운영 시 ROI 데이터 보고 검토.
4. **`object_story_spec` helper 추출** — `launchMetaDco` 내 inline 분기 대신 helper 함수로 추출하면 unit test 가능. 본 spec 범위 밖.

---

## 12. 검토 이력

### 2026-04-27 — 초안 작성 + 섹션 단위 자체 검토

본 스펙은 brainstorming 단계에서 2개 섹션 (결정 사항/동작 + 코드 상세/테스트) 으로 작성. 작은 변경이라 spec 자체 분량 적음.

**Section 1 — Important 1건**
- `facebook_positions` enum 값이 추정 → Meta Marketing API 문서 기준으로 §3.4 에 정확한 enum 명시 + 선택된 4개 (`feed`, `story`, `video_feeds`, `marketplace`) 의 선정 근거 (DCO 자동 ranking 환경에서 표준).

**Section 2 — Minor 1건**
- `right_hand_column` 제외 결정 근거가 약함 → §3.4 에서 "desktop only + Meta DCO 자동 ranking" 으로 정리. 실 운영 시 placement 별 효과 측정 후 조정 가능 (out of scope).

### 2026-04-27 — 스펙 작성 후 자체 검토 (5점 점검)

스펙 작성 직후 추가 자체 검토에서:

- §4.4 의 registry.ts 변경: 본 spec 작성 시 grep 으로 검증 결과 `validatePlatform("meta")` 가 *이미* `instagram_actor_id` 검사 안 함 → "변경 불필요" 명시. 기존 spec draft 에서는 "missing fields 에서 제외" 라고 표현했으나 실제 코드 baseline 에서는 검사 자체 없음. **인라인 수정 완료** (§4.4 본문이 "변경 불필요" 로 작성됨).

- §5.1 의 "기존 케이스 강화" — `expect.arrayContaining(["feed", "story", "video_feeds", "marketplace"])` 사용. 정확한 매칭 (`toEqual([...])`) 보다 느슨하지만 placement 4개 중 일부가 빠지거나 추가돼도 회귀 안 잡음 — 의도된 trade-off (실 운영에서 placement 추가/제거 시 fixture maintenance 비용 줄임). 

### 종합

- Critical: 0건
- Important: 1건 (Section 1, facebook_positions enum 검증). 인라인 수정 완료
- Minor: 1건 (Section 2, right_hand_column 제외 근거). 본문 정리됨

다음 단계: 사용자 검토 → 승인 시 `superpowers:writing-plans` 스킬로 implementation plan 작성.

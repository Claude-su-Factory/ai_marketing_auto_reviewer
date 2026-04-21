# Plan A — Platform Adapter + Meta DCO 마이그레이션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 Meta 전용 런칭 코드를 `AdPlatform` interface 뒤로 분리하고, 2-ad split 구조를 Meta Advantage+ Creative (DCO) `asset_feed_spec` 구조로 전환한다.

**Architecture:** 플랫폼별 로직은 `core/platform/<name>/`에 모아두고 interface `AdPlatform`으로 노출한다. Registry(`core/platform/registry.ts`)가 `.env`의 `AD_PLATFORMS` csv를 파싱해 활성 어댑터 배열을 반환한다. 기존 1 Creative = 1 Campaign 구조를 유지하되, Campaign은 DCO Ad 1개(asset_feed_spec 기반)로 런칭된다. Creative에 `variantGroupId`를 부여하여 Plan B의 multi-variant 확장을 준비한다.

**Tech Stack:** TypeScript, facebook-nodejs-business-sdk (기존), vitest (기존 패턴), tsx (기존 CLI runner).

**Related spec:** `docs/superpowers/specs/2026-04-20-winner-db-variant-orchestration-design.md`

**Branch policy:** 프로젝트 CLAUDE.md 규칙에 따라 master에 직접 커밋. feature 브랜치·PR 사용 안 함.

---

## 파일 구조

**신규 파일:**
- `core/platform/types.ts` — `AdPlatform` interface + `VariantGroup` / `LaunchResult` / `CleanupResult`
- `core/platform/registry.ts` — `activePlatforms()`, env 파싱
- `core/platform/registry.test.ts`
- `core/platform/meta/launcher.ts` — DCO `asset_feed_spec` 기반 런칭
- `core/platform/meta/launcher.test.ts` — 순수 helper 테스트 (SDK 호출 제외)
- `core/platform/meta/monitor.ts` — `body_asset` breakdown 기반 리포트 수집
- `core/platform/meta/monitor.test.ts`
- `core/platform/meta/assetFeedSpec.ts` — `assembleAssetFeedSpec` 순수 함수
- `core/platform/meta/assetFeedSpec.test.ts`
- `core/platform/meta/breakdown.ts` — `parseBodyAssetBreakdown` 순수 함수
- `core/platform/meta/breakdown.test.ts`
- `core/platform/meta/rollback.ts` — rollback 실행 + orphans 기록
- `core/platform/meta/rollback.test.ts`
- `core/platform/meta/adapter.ts` — `MetaAdPlatform` (AdPlatform 구현체, 위 함수들 조립)
- `scripts/migrate-creatives.ts` — 기존 Creative·Campaign 마이그레이션
- `docs/superpowers/specs/2026-04-20-winner-db-variant-orchestration-e2e-checklist.md` — E2E 수동 체크리스트 (Plan A 범위만)

**수정 파일:**
- `core/types.ts` — `Creative`, `Campaign` 확장 (`VariantReport`·`VariantGroup`·`LaunchResult`·`CleanupResult`는 `core/platform/types.ts`에 정의)
- `cli/entries/launch.ts` — adapter 경유 런칭
- `core/campaign/monitor.ts` — `collectDailyReports`를 multi-platform 아이거ator로 재작성 (분석 함수는 유지)
- `server/scheduler.ts` — import 변경 없음 (기존 그대로 호환)
- `cli/entries/worker.ts` — import 변경 없음
- `package.json` — `migrate:creatives` 스크립트 추가
- `docs/ARCHITECTURE.md` — `core/platform/` 디렉토리 추가, §1 시스템 다이어그램 `core/campaign/` → `core/platform/` 변경
- `docs/STATUS.md` — Plan A 완료 항목 추가
- `docs/ROADMAP.md` — Tier 1에서 Plan A 제거, Plan B 승격
- `README.md` — `AD_PLATFORMS` env var 설명 추가

**삭제 파일 (Task 14에서):**
- `core/campaign/launcher.ts` (Meta 로직은 `core/platform/meta/launcher.ts`로 이관됨)
- `core/campaign/launcher.test.ts`

---

## Task 1: Meta DCO API 검증 (preflight — 코드 없음)

이 태스크는 구현 전 1회 수행하는 리서치이다. 결과는 문서로 기록하여 이후 태스크에서 참조한다.

**Files:**
- Create: `docs/superpowers/specs/2026-04-20-meta-dco-api-notes.md`

- [ ] **Step 1: 최신 Meta Marketing API 문서에서 Advantage+ Creative / `asset_feed_spec` 확인**

확인 항목:
1. `asset_feed_spec` 최신 필드 (`titles`, `bodies`, `link_urls`, `images`, `videos`, `call_to_action_types`, `ad_formats`)
2. 각 body/title 객체에 `adlabels` 지원 여부
3. `/{ad_id}/insights`의 `breakdowns: ['body_asset']` 응답 형식 (`body_asset` 객체에 `id`, `text`, `adlabels` 중 무엇이 포함되는지)
4. 현재 사용 중인 facebook-nodejs-business-sdk 버전 (`^20.0.2`)의 `createAdCreative`가 `asset_feed_spec`를 받는지

참고 URL (최신 확인 필수):
- https://developers.facebook.com/docs/marketing-api/advantage-plus-creative
- https://developers.facebook.com/docs/marketing-api/reference/ad-account/adcreatives/
- https://developers.facebook.com/docs/marketing-api/insights/breakdowns/#asset-breakdowns

- [ ] **Step 2: 매핑 전략 결정**

두 가지 경로:
- **A (adlabels 라운드트립):** body에 `adlabels: [{ name: "variant-<uuid>" }]` 부착 → breakdown 응답에서 adlabel 값으로 variantLabel 역매핑
- **B (text 매칭):** body.text 제출 → breakdown의 body_asset.text와 Creative.copy.body를 문자열 비교

최신 문서 확인 후:
- `adlabels`가 breakdown 응답에 포함되면 A 사용
- 포함되지 않으면 B 사용 (`metaAssetLabel` 필드는 그대로 유지하되 text 매칭으로 대체)

- [ ] **Step 3: 결과를 `docs/superpowers/specs/2026-04-20-meta-dco-api-notes.md`에 기록**

기록 형식:
```markdown
# Meta DCO API 검증 노트 (2026-04-20)

## asset_feed_spec 필드 shape (확인 결과)
- titles: [{ text: string, adlabels?: ... }]
- bodies: [...]
- ...

## adlabels 라운드트립 여부
(확인 결과: 되는지 안 되는지)

## 선택된 매핑 전략
A (adlabels) 또는 B (text 매칭)

## SDK 버전 호환성
facebook-nodejs-business-sdk ^20.0.2의 createAdCreative는 asset_feed_spec을 ...
```

- [ ] **Step 4: 커밋**

```bash
git add docs/superpowers/specs/2026-04-20-meta-dco-api-notes.md
git commit -m "docs(plan-a): record Meta DCO API verification notes"
```

---

## Task 2: Platform Adapter 타입 정의

**Files:**
- Create: `core/platform/types.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// core/platform/types.test.ts (임시 — Step 3에서 삭제)
import { describe, it, expectTypeOf } from "vitest";
import type { AdPlatform, VariantGroup, LaunchResult, CleanupResult } from "./types.js";

describe("AdPlatform interface", () => {
  it("has the expected shape", () => {
    expectTypeOf<AdPlatform>().toHaveProperty("name").toEqualTypeOf<string>();
    expectTypeOf<AdPlatform>().toHaveProperty("launch");
    expectTypeOf<AdPlatform>().toHaveProperty("fetchReports");
    expectTypeOf<AdPlatform>().toHaveProperty("cleanup");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run core/platform/types.test.ts
```

Expected: FAIL — `Cannot find module './types.js'`

- [ ] **Step 3: Write `core/platform/types.ts`**

```typescript
import type { Product, Creative } from "../types.js";

export interface VariantGroup {
  variantGroupId: string;
  product: Product;
  creatives: Creative[];
  assets: { image: string; video: string };
}

export interface LaunchResult {
  campaignId: string;
  platform: string;
  externalIds: {
    campaign: string;
    adSet: string;
    ad: string;
  };
}

export interface CleanupResult {
  deleted: string[];
  orphans: { type: "campaign" | "adset" | "ad"; id: string }[];
}

export interface VariantReport {
  id: string;
  campaignId: string;
  variantGroupId: string;
  variantLabel: string;
  metaAssetLabel: string;
  productId: string;
  platform: string;
  date: string;
  impressions: number;
  clicks: number;
  inlineLinkClickCtr: number;
  adQualityRanking: string | null;
  adEngagementRanking: string | null;
  adConversionRanking: string | null;
}

export interface AdPlatform {
  name: string;
  launch(group: VariantGroup): Promise<LaunchResult>;
  fetchReports(campaignId: string, date: string): Promise<VariantReport[]>;
  cleanup(campaignId: string): Promise<CleanupResult>;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run core/platform/types.test.ts
```

Expected: PASS (1 test)

- [ ] **Step 5: Delete the temporary test file**

```bash
rm core/platform/types.test.ts
```

Interface-only 파일은 별도 런타임 테스트 없이 컴파일러가 검증한다. 이 테스트는 Step 3 작성 중 타입 시그니처 확인용일 뿐이다.

- [ ] **Step 6: Commit**

```bash
git add core/platform/types.ts
git commit -m "feat(platform): add AdPlatform interface and supporting types"
```

---

## Task 3: 도메인 타입 확장 (Creative, Campaign)

`core/types.ts`를 수정하여 Plan A가 요구하는 필드를 추가한다. `VariantGroup`·`LaunchResult`·`CleanupResult`·`VariantReport`는 이미 `core/platform/types.ts` (Task 2)에 정의되어 있으므로 `core/types.ts`에는 넣지 않는다.

**Files:**
- Modify: `core/types.ts`
- Test: `core/types.test.ts` (기존 파일 수정)

- [ ] **Step 1: Write the failing test**

`core/types.test.ts` 끝에 다음 block을 append:

```typescript
import type { Creative, Campaign } from "./types.js";

describe("Creative (Plan A extensions)", () => {
  it("has variantGroupId, variantLabel, metaAssetLabel fields", () => {
    const c: Creative = {
      id: "c1",
      productId: "p1",
      variantGroupId: "g1",
      copy: {
        headline: "h",
        body: "b",
        cta: "cta",
        hashtags: ["x"],
        variantLabel: "emotional",
        metaAssetLabel: "variant-abc",
      },
      imageLocalPath: "/tmp/i.png",
      videoLocalPath: "/tmp/v.mp4",
      status: "pending",
      createdAt: "2026-04-20T00:00:00.000Z",
    };
    expect(c.variantGroupId).toBe("g1");
    expect(c.copy.variantLabel).toBe("emotional");
    expect(c.copy.metaAssetLabel).toBe("variant-abc");
  });
});

describe("Campaign (Plan A extensions)", () => {
  it("has variantGroupId, platform, metaAdId (singular), orphans", () => {
    const c: Campaign = {
      id: "cam1",
      variantGroupId: "g1",
      productId: "p1",
      platform: "meta",
      metaCampaignId: "meta-c1",
      metaAdSetId: "meta-as1",
      metaAdId: "meta-ad1",
      launchedAt: "2026-04-20T00:00:00.000Z",
      status: "active",
      orphans: [],
    };
    expect(c.platform).toBe("meta");
    expect(c.metaAdId).toBe("meta-ad1");
    expect(c.orphans).toEqual([]);
  });

  it("accepts launch_failed and externally_modified statuses", () => {
    const failed: Campaign["status"] = "launch_failed";
    const extMod: Campaign["status"] = "externally_modified";
    expect(failed).toBe("launch_failed");
    expect(extMod).toBe("externally_modified");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run core/types.test.ts
```

Expected: FAIL — Type errors on `variantGroupId`, `variantLabel`, `metaAssetLabel`, `platform`, `metaAdId`, `orphans` (missing properties).

- [ ] **Step 3: Update `core/types.ts`**

기존 `Creative`와 `Campaign` 인터페이스를 아래로 교체한다. `Product`·`Report`·`Improvement` 등 다른 타입은 건드리지 않는다.

```typescript
export interface Creative {
  id: string;
  productId: string;
  variantGroupId: string;                   // Plan A 신규 — 같은 제품의 variant 공유 ID
  copy: {
    headline: string;
    body: string;
    cta: string;
    hashtags: string[];
    variantLabel: "emotional" | "numerical" | "urgency"; // Plan A 신규 (Plan A는 "emotional" 기본값)
    metaAssetLabel: string;                 // Plan A 신규 — e.g. "variant-<uuid>"
  };
  imageLocalPath: string;
  videoLocalPath: string;
  status: "pending" | "approved" | "rejected" | "edited";
  reviewNote?: string;
  createdAt: string;
}

export interface Campaign {
  id: string;
  variantGroupId: string;                   // Plan A 신규 — creativeId 대체
  productId: string;
  platform: string;                         // Plan A 신규 — "meta"
  metaCampaignId: string;
  metaAdSetId: string;
  metaAdId: string;                         // Plan A 신규 — DCO Ad 1개 (기존 metaAdIds[] 폐기)
  launchedAt: string;
  status: "active" | "paused" | "completed" | "launch_failed" | "externally_modified";
  orphans: { type: "campaign" | "adset" | "ad"; id: string }[];
}
```

**주의:** 기존 `creativeId: string`과 `metaAdIds: string[]` 필드는 제거된다. 마이그레이션은 Task 5에서 처리한다.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run core/types.test.ts
```

Expected: PASS (원래 테스트 + 새로 추가한 2개)

- [ ] **Step 5: Type-check 전체 프로젝트**

```bash
npx tsc --noEmit
```

Expected: 아직 깨진다. `core/campaign/launcher.ts` 등에서 `creative.id`, `creativeId`, `metaAdIds` 참조. **이건 의도된 상태** — 이후 Task 6/7/11에서 Meta adapter로 이관하며 수정된다. 다음 Task로 진행.

- [ ] **Step 6: Commit**

```bash
git add core/types.ts core/types.test.ts
git commit -m "feat(types): extend Creative and Campaign for variant groups and platform adapter"
```

---

## Task 3.5: Creative constructor 일괄 업데이트

Task 3 후 발견: Creative를 생성하는 다른 코드 경로들(`cli/pipeline.ts`, `cli/entries/generate.ts`, `cli/actions.ts`, `core/reviewer/decisions.test.ts`)이 새 필수 필드(`variantGroupId`, `copy.variantLabel`, `copy.metaAssetLabel`)를 설정하지 않아 타입 에러 발생. Plan A 1단계는 1 Creative = 1 variantGroup이므로 constructor마다 `randomUUID()`로 `variantGroupId`를 생성하고 `variantLabel: "emotional"`, `metaAssetLabel: \`variant-${variantGroupId}\``을 default로 추가한다.

**Files:**
- Modify: `cli/pipeline.ts`
- Modify: `cli/entries/generate.ts`
- Modify: `cli/actions.ts`
- Modify: `core/reviewer/decisions.test.ts`

- [ ] **Step 1: cli/pipeline.ts Creative 생성 부분 수정**

`const variantGroupId = randomUUID();`를 Creative 생성 직전에 추가. Creative 객체에 다음 필드 추가:

```typescript
const variantGroupId = randomUUID();
const creative: Creative = {
  id: randomUUID(),
  productId: product.id,
  variantGroupId,
  copy: {
    ...copy,
    variantLabel: "emotional",
    metaAssetLabel: `variant-${variantGroupId}`,
  },
  imageLocalPath,
  videoLocalPath,
  status: "pending",
  createdAt: new Date().toISOString(),
};
```

(이미 `randomUUID` import가 있다면 재import 금지).

- [ ] **Step 2: cli/entries/generate.ts 동일 수정**

```typescript
const variantGroupId = randomUUID();
const creative: Creative = {
  id: randomUUID(),
  productId: product.id,
  variantGroupId,
  copy: { ...copy, variantLabel: "emotional", metaAssetLabel: `variant-${variantGroupId}` },
  imageLocalPath, videoLocalPath, status: "pending",
  createdAt: new Date().toISOString(),
};
```

- [ ] **Step 3: cli/actions.ts 동일 수정**

같은 패턴으로 `variantGroupId`와 copy 확장을 추가.

- [ ] **Step 4: core/reviewer/decisions.test.ts 픽스처 확장**

```typescript
mockCreative = {
  id: "creative-1",
  productId: "product-1",
  variantGroupId: "group-1",
  copy: {
    headline: "TypeScript 마스터",
    body: "3주 만에 TypeScript 완성",
    cta: "지금 수강하기",
    hashtags: ["#TypeScript"],
    variantLabel: "emotional",
    metaAssetLabel: "variant-group-1",
  },
  imageLocalPath: "data/creatives/product-1-image.jpg",
  videoLocalPath: "data/creatives/product-1-video.mp4",
  // ... 기존 나머지 필드 그대로
};
```

- [ ] **Step 5: 테스트 + 타입체크**

```bash
npx vitest run
npx tsc --noEmit 2>&1 | grep -v "^$"
```

Expected:
- 모든 vitest 통과
- `tsc --noEmit`는 이제 오직 `core/campaign/launcher.ts`, `core/campaign/monitor.ts`, `cli/entries/launch.ts`에서만 에러 — Tasks 12~14가 처리.

- [ ] **Step 6: Commit**

```bash
git add cli/pipeline.ts cli/entries/generate.ts cli/actions.ts core/reviewer/decisions.test.ts
git commit -m "feat(creative): populate variantGroupId and variant metadata in all constructors"
```

---

## Task 4: `assembleAssetFeedSpec` 순수 함수

Meta DCO `asset_feed_spec`를 조립하는 순수 함수. SDK 호출 없이 입력→출력만 변환. Task 1 결과: Meta는 `body_asset` breakdown에서 `adlabels`를 echo하지 않으므로 Strategy B (text 매칭)가 기본이다. 각 body에는 `metaAssetLabel`을 `adlabels`로 선택적으로 부착 (Meta가 향후 echo하기 시작하면 보조 키로 활용 — 현재는 no-op이지만 submit 허용됨).

**Files:**
- Create: `core/platform/meta/assetFeedSpec.ts`
- Test: `core/platform/meta/assetFeedSpec.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// core/platform/meta/assetFeedSpec.test.ts
import { describe, it, expect } from "vitest";
import { assembleAssetFeedSpec } from "./assetFeedSpec.js";
import type { Creative, Product } from "../../types.js";

const mockProduct: Product = {
  id: "p1", name: "Test", description: "desc", targetUrl: "https://example.com",
  currency: "KRW", category: "course", tags: ["x"], inputMethod: "manual",
  createdAt: "2026-04-20T00:00:00.000Z",
};

const mockCreative = (label: "emotional" | "numerical" | "urgency"): Creative => ({
  id: `c-${label}`,
  productId: "p1",
  variantGroupId: "g1",
  copy: {
    headline: "Common Headline",
    body: `Body for ${label}`,
    cta: "LEARN_MORE",
    hashtags: ["ad", "promo"],
    variantLabel: label,
    metaAssetLabel: `variant-${label}-uuid`,
  },
  imageLocalPath: "/tmp/i.png",
  videoLocalPath: "/tmp/v.mp4",
  status: "approved",
  createdAt: "2026-04-20T00:00:00.000Z",
});

describe("assembleAssetFeedSpec", () => {
  it("assembles a spec with 1 title, N bodies, 1 image, 1 video", () => {
    const creatives = [mockCreative("emotional"), mockCreative("numerical")];
    const spec = assembleAssetFeedSpec({
      product: mockProduct,
      creatives,
      imageHash: "IMG_HASH_123",
      videoId: "VID_ID_123",
    });

    expect(spec.titles).toHaveLength(1);
    expect(spec.titles[0].text).toBe("Common Headline");
    expect(spec.bodies).toHaveLength(2);
    expect(spec.images).toEqual([{ hash: "IMG_HASH_123" }]);
    expect(spec.videos).toEqual([{ video_id: "VID_ID_123" }]);
    expect(spec.link_urls).toEqual([{ website_url: "https://example.com" }]);
    expect(spec.call_to_action_types).toEqual(["LEARN_MORE"]);
  });

  it("appends hashtags to each body and attaches adlabels", () => {
    const creatives = [mockCreative("emotional")];
    const spec = assembleAssetFeedSpec({
      product: mockProduct,
      creatives,
      imageHash: "IMG",
      videoId: "VID",
    });

    expect(spec.bodies[0].text).toBe("Body for emotional\n\n#ad #promo");
    expect(spec.bodies[0].adlabels).toEqual([{ name: "variant-emotional-uuid" }]);
  });

  it("rejects empty creatives array", () => {
    expect(() =>
      assembleAssetFeedSpec({
        product: mockProduct,
        creatives: [],
        imageHash: "IMG",
        videoId: "VID",
      }),
    ).toThrow(/at least one creative/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run core/platform/meta/assetFeedSpec.test.ts
```

Expected: FAIL — `Cannot find module './assetFeedSpec.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// core/platform/meta/assetFeedSpec.ts
import type { Creative, Product } from "../../types.js";

export interface AssetFeedSpecInput {
  product: Product;
  creatives: Creative[];
  imageHash: string;
  videoId: string;
}

export interface AssetFeedSpec {
  titles: { text: string }[];
  bodies: { text: string; adlabels: { name: string }[] }[];
  link_urls: { website_url: string }[];
  images: { hash: string }[];
  videos: { video_id: string }[];
  call_to_action_types: string[];
}

export function assembleAssetFeedSpec(input: AssetFeedSpecInput): AssetFeedSpec {
  const { product, creatives, imageHash, videoId } = input;
  if (creatives.length === 0) {
    throw new Error("assembleAssetFeedSpec requires at least one creative");
  }

  const sharedHeadline = creatives[0].copy.headline;
  const sharedCta = creatives[0].copy.cta;

  const bodies = creatives.map((c) => {
    const hashtags = c.copy.hashtags.map((t) => `#${t}`).join(" ");
    const text = hashtags ? `${c.copy.body}\n\n${hashtags}` : c.copy.body;
    return {
      text,
      adlabels: [{ name: c.copy.metaAssetLabel }],
    };
  });

  return {
    titles: [{ text: sharedHeadline }],
    bodies,
    link_urls: [{ website_url: product.targetUrl }],
    images: [{ hash: imageHash }],
    videos: [{ video_id: videoId }],
    call_to_action_types: [sharedCta],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run core/platform/meta/assetFeedSpec.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add core/platform/meta/assetFeedSpec.ts core/platform/meta/assetFeedSpec.test.ts
git commit -m "feat(platform/meta): add assembleAssetFeedSpec pure function"
```

---

## Task 5: `parseBodyAssetBreakdown` 순수 함수

Meta insights `body_asset` breakdown 응답 row를 VariantReport로 변환. Task 1 결과: `body_asset`은 `{id, text}`만 반환하므로 Strategy B (text 매칭) 사용. body_asset.text를 정규화(trim, CRLF→LF)한 뒤 Creative의 `body + "\n\n" + hashtags` 정규화 값과 비교. 매칭 실패 row는 skip.

**Files:**
- Create: `core/platform/meta/breakdown.ts`
- Test: `core/platform/meta/breakdown.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// core/platform/meta/breakdown.test.ts
import { describe, it, expect } from "vitest";
import { parseBodyAssetBreakdown } from "./breakdown.js";
import type { Creative } from "../../types.js";

const mockCreative = (label: "emotional" | "numerical", body: string, hashtags: string[] = []): Creative => ({
  id: `c-${label}`,
  productId: "p1",
  variantGroupId: "g1",
  copy: {
    headline: "H", body, cta: "LEARN_MORE", hashtags,
    variantLabel: label,
    metaAssetLabel: `variant-${label}-uuid`,
  },
  imageLocalPath: "", videoLocalPath: "",
  status: "approved", createdAt: "2026-04-20T00:00:00.000Z",
});

const mockMetaRow = (overrides: object) => ({
  body_asset: { id: "asset-1", text: "body-emotional" },
  impressions: "1000", clicks: "42", inline_link_click_ctr: "4.2",
  quality_ranking: "AVERAGE", engagement_rate_ranking: "ABOVE_AVERAGE",
  conversion_rate_ranking: "UNKNOWN",
  ...overrides,
});

describe("parseBodyAssetBreakdown", () => {
  it("maps a row to VariantReport via body text match (exact)", () => {
    const creatives = [mockCreative("emotional", "body-emotional"), mockCreative("numerical", "body-numerical")];
    const reports = parseBodyAssetBreakdown({
      rows: [mockMetaRow({})],
      creatives,
      campaignId: "cam1",
      productId: "p1",
      platform: "meta",
      date: "2026-04-19",
    });

    expect(reports).toHaveLength(1);
    expect(reports[0].variantLabel).toBe("emotional");
    expect(reports[0].metaAssetLabel).toBe("variant-emotional-uuid");
    expect(reports[0].impressions).toBe(1000);
    expect(reports[0].inlineLinkClickCtr).toBe(4.2);
    expect(reports[0].adQualityRanking).toBe("AVERAGE");
    expect(reports[0].id).toBe("cam1::emotional::2026-04-19");
  });

  it("matches body + hashtags (appended form)", () => {
    const creatives = [mockCreative("emotional", "body-emotional", ["ad", "promo"])];
    const rowWithHashtags = mockMetaRow({
      body_asset: { id: "a-1", text: "body-emotional\n\n#ad #promo" },
    });
    const reports = parseBodyAssetBreakdown({
      rows: [rowWithHashtags],
      creatives,
      campaignId: "cam1",
      productId: "p1",
      platform: "meta",
      date: "2026-04-19",
    });
    expect(reports).toHaveLength(1);
    expect(reports[0].variantLabel).toBe("emotional");
  });

  it("normalizes whitespace and CRLF when comparing", () => {
    const creatives = [mockCreative("emotional", "body-emotional")];
    const rowWithCrlf = mockMetaRow({
      body_asset: { id: "a-1", text: "  body-emotional\r\n" }, // trailing whitespace + CRLF
    });
    const reports = parseBodyAssetBreakdown({
      rows: [rowWithCrlf],
      creatives,
      campaignId: "cam1",
      productId: "p1",
      platform: "meta",
      date: "2026-04-19",
    });
    expect(reports).toHaveLength(1);
    expect(reports[0].variantLabel).toBe("emotional");
  });

  it("skips rows that match no creative body", () => {
    const creatives = [mockCreative("emotional", "body-emotional")];
    const rogueRow = mockMetaRow({
      body_asset: { id: "asset-x", text: "totally-unrelated-copy" },
    });
    const reports = parseBodyAssetBreakdown({
      rows: [rogueRow],
      creatives,
      campaignId: "cam1",
      productId: "p1",
      platform: "meta",
      date: "2026-04-19",
    });
    expect(reports).toEqual([]);
  });

  it("copies ad-level ranking fields to every row", () => {
    const creatives = [mockCreative("emotional", "body-emotional"), mockCreative("numerical", "body-numerical")];
    const rows = [
      mockMetaRow({ body_asset: { id: "1", text: "body-emotional" } }),
      mockMetaRow({ body_asset: { id: "2", text: "body-numerical" } }),
    ];
    const reports = parseBodyAssetBreakdown({
      rows, creatives, campaignId: "cam1", productId: "p1", platform: "meta", date: "2026-04-19",
    });
    expect(reports).toHaveLength(2);
    expect(reports[0].adQualityRanking).toBe("AVERAGE");
    expect(reports[1].adQualityRanking).toBe("AVERAGE");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run core/platform/meta/breakdown.test.ts
```

Expected: FAIL — `Cannot find module './breakdown.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// core/platform/meta/breakdown.ts
import type { Creative } from "../../types.js";
import type { VariantReport } from "../types.js";

interface MetaBodyAsset {
  id: string;
  text: string;
  adlabels?: { name: string }[]; // Meta는 echo 안 함 (Task 1 확인), forward-compat로 유지
}

interface MetaBreakdownRow {
  body_asset: MetaBodyAsset;
  impressions?: string | number;
  clicks?: string | number;
  inline_link_click_ctr?: string | number;
  quality_ranking?: string;
  engagement_rate_ranking?: string;
  conversion_rate_ranking?: string;
}

export interface ParseBreakdownInput {
  rows: MetaBreakdownRow[];
  creatives: Creative[];
  campaignId: string;
  productId: string;
  platform: string;
  date: string;
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function submittedBodyText(c: Creative): string {
  const hashtags = c.copy.hashtags.map((t) => `#${t}`).join(" ");
  return hashtags ? `${c.copy.body}\n\n${hashtags}` : c.copy.body;
}

export function parseBodyAssetBreakdown(input: ParseBreakdownInput): VariantReport[] {
  const { rows, creatives, campaignId, productId, platform, date } = input;

  return rows.flatMap((row) => {
    const match = findMatchingCreative(row.body_asset, creatives);
    if (!match) return [];

    const report: VariantReport = {
      id: `${campaignId}::${match.copy.variantLabel}::${date}`,
      campaignId,
      variantGroupId: match.variantGroupId,
      variantLabel: match.copy.variantLabel,
      metaAssetLabel: match.copy.metaAssetLabel,
      productId,
      platform,
      date,
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      inlineLinkClickCtr: Number(row.inline_link_click_ctr ?? 0),
      adQualityRanking: row.quality_ranking ?? null,
      adEngagementRanking: row.engagement_rate_ranking ?? null,
      adConversionRanking: row.conversion_rate_ranking ?? null,
    };
    return [report];
  });
}

function findMatchingCreative(
  bodyAsset: MetaBodyAsset,
  creatives: Creative[],
): Creative | null {
  // Strategy B (Task 1): Meta는 body_asset.adlabels를 echo하지 않으므로 text 매칭만 사용.
  // 정규화 규칙: CRLF→LF, trim. 제출 시 조립되는 `body + "\n\n" + hashtags`와 비교.
  const assetText = normalize(bodyAsset.text);

  // 1차: 전체 submitted text (body + hashtags) 완전 일치
  const byFull = creatives.find((c) => normalize(submittedBodyText(c)) === assetText);
  if (byFull) return byFull;

  // 2차: body 단독 일치 (Meta가 hashtags를 rendering 과정에서 stripping한 경우 방어)
  const byBody = creatives.find((c) => assetText === normalize(c.copy.body));
  return byBody ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run core/platform/meta/breakdown.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add core/platform/meta/breakdown.ts core/platform/meta/breakdown.test.ts
git commit -m "feat(platform/meta): add parseBodyAssetBreakdown with adlabel + text fallback"
```

---

## Task 6: Platform Registry (`activePlatforms`)

`.env`의 `AD_PLATFORMS` csv 파싱 + credential 확인.

**Files:**
- Create: `core/platform/registry.ts`
- Test: `core/platform/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// core/platform/registry.test.ts
import { describe, it, expect, vi } from "vitest";
import { parseActivePlatformNames, validatePlatformEnv } from "./registry.js";

describe("parseActivePlatformNames", () => {
  it("parses csv into trimmed lowercase array", () => {
    expect(parseActivePlatformNames("meta,tiktok")).toEqual(["meta", "tiktok"]);
    expect(parseActivePlatformNames(" META , TikTok ")).toEqual(["meta", "tiktok"]);
  });
  it("defaults to ['meta'] when undefined or empty", () => {
    expect(parseActivePlatformNames(undefined)).toEqual(["meta"]);
    expect(parseActivePlatformNames("")).toEqual(["meta"]);
  });
  it("de-duplicates entries", () => {
    expect(parseActivePlatformNames("meta,meta")).toEqual(["meta"]);
  });
});

describe("validatePlatformEnv", () => {
  it("returns ok=true when all required vars present", () => {
    const env = { META_ACCESS_TOKEN: "x", META_AD_ACCOUNT_ID: "y", META_PAGE_ID: "z" };
    const r = validatePlatformEnv("meta", env);
    expect(r.ok).toBe(true);
  });
  it("returns ok=false with missing list when some vars absent", () => {
    const env = { META_ACCESS_TOKEN: "x" };
    const r = validatePlatformEnv("meta", env);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toContain("META_AD_ACCOUNT_ID");
      expect(r.missing).toContain("META_PAGE_ID");
    }
  });
  it("rejects unknown platforms", () => {
    const r = validatePlatformEnv("tiktok", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing[0]).toMatch(/not yet supported/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run core/platform/registry.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// core/platform/registry.ts
import type { AdPlatform } from "./types.js";

const REQUIRED_ENV: Record<string, string[]> = {
  meta: ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID", "META_PAGE_ID"],
};

export function parseActivePlatformNames(raw: string | undefined): string[] {
  if (!raw || raw.trim() === "") return ["meta"];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const chunk of raw.split(",")) {
    const name = chunk.trim().toLowerCase();
    if (name && !seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; missing: string[] };

export function validatePlatformEnv(
  name: string,
  env: Record<string, string | undefined>,
): ValidationResult {
  const required = REQUIRED_ENV[name];
  if (!required) {
    return { ok: false, missing: [`platform "${name}" not yet supported`] };
  }
  const missing = required.filter((key) => !env[key]);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

export async function activePlatforms(): Promise<AdPlatform[]> {
  const names = parseActivePlatformNames(process.env.AD_PLATFORMS);
  const platforms: AdPlatform[] = [];
  for (const name of names) {
    const v = validatePlatformEnv(name, process.env);
    if (!v.ok) {
      console.warn(`[platform] skipping "${name}": ${v.missing.join(", ")}`);
      continue;
    }
    if (name === "meta") {
      const { createMetaAdapter } = await import("./meta/adapter.js");
      platforms.push(createMetaAdapter());
    }
  }
  return platforms;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run core/platform/registry.test.ts
```

Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add core/platform/registry.ts core/platform/registry.test.ts
git commit -m "feat(platform): add registry with AD_PLATFORMS parsing and credential validation"
```

---

## Task 7: Meta Adapter — Rollback 헬퍼

롤백 실패 시 orphans 수집. 순수 함수로 분리하여 SDK 호출 없이 테스트 가능하게 만든다.

**Files:**
- Create: `core/platform/meta/rollback.ts`
- Test: `core/platform/meta/rollback.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// core/platform/meta/rollback.test.ts
import { describe, it, expect, vi } from "vitest";
import { executeRollback } from "./rollback.js";

describe("executeRollback", () => {
  it("deletes in reverse order and returns all deleted on success", async () => {
    const calls: string[] = [];
    const deleter = vi.fn(async (type: string, id: string) => {
      calls.push(`${type}:${id}`);
    });

    const result = await executeRollback({
      created: [
        { type: "campaign", id: "c1" },
        { type: "adset", id: "as1" },
        { type: "ad", id: "ad1" },
      ],
      deleter,
    });

    expect(calls).toEqual(["ad:ad1", "adset:as1", "campaign:c1"]);
    expect(result.deleted).toEqual(["ad1", "as1", "c1"]);
    expect(result.orphans).toEqual([]);
  });

  it("collects orphans when a delete throws and continues", async () => {
    const deleter = vi.fn(async (type: string, id: string) => {
      if (type === "adset") throw new Error("meta API failed");
    });

    const result = await executeRollback({
      created: [
        { type: "campaign", id: "c1" },
        { type: "adset", id: "as1" },
        { type: "ad", id: "ad1" },
      ],
      deleter,
    });

    expect(result.deleted).toEqual(["ad1", "c1"]);
    expect(result.orphans).toEqual([{ type: "adset", id: "as1" }]);
  });

  it("handles empty created list", async () => {
    const deleter = vi.fn();
    const result = await executeRollback({ created: [], deleter });
    expect(result.deleted).toEqual([]);
    expect(result.orphans).toEqual([]);
    expect(deleter).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run core/platform/meta/rollback.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// core/platform/meta/rollback.ts
import type { CleanupResult } from "../types.js";

export type MetaResourceType = "campaign" | "adset" | "ad";

export interface CreatedResource {
  type: MetaResourceType;
  id: string;
}

export interface RollbackInput {
  created: CreatedResource[];
  deleter: (type: MetaResourceType, id: string) => Promise<void>;
}

export async function executeRollback(input: RollbackInput): Promise<CleanupResult> {
  const { created, deleter } = input;
  const reversed = [...created].reverse();
  const deleted: string[] = [];
  const orphans: CleanupResult["orphans"] = [];

  for (const resource of reversed) {
    try {
      await deleter(resource.type, resource.id);
      deleted.push(resource.id);
    } catch (err) {
      console.error(`[meta/rollback] failed to delete ${resource.type} ${resource.id}:`, err);
      orphans.push({ type: resource.type, id: resource.id });
    }
  }

  return { deleted, orphans };
}

export async function appendOrphansToDisk(
  orphans: CleanupResult["orphans"],
  writeFn: (path: string, data: unknown) => Promise<void>,
  readFn: <T>(path: string) => Promise<T | null>,
): Promise<void> {
  if (orphans.length === 0) return;
  const existing = (await readFn<CleanupResult["orphans"]>("data/orphans.json")) ?? [];
  await writeFn("data/orphans.json", [...existing, ...orphans]);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run core/platform/meta/rollback.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add core/platform/meta/rollback.ts core/platform/meta/rollback.test.ts
git commit -m "feat(platform/meta): add rollback executor with orphan collection"
```

---

## Task 8: Meta Adapter — Launcher (DCO)

실제 Meta SDK 호출로 DCO 광고를 생성. 순수 함수는 이미 Task 4·7에서 뽑혀있어 여기서는 I/O와 조립만.

**Files:**
- Create: `core/platform/meta/launcher.ts`
- Test: `core/platform/meta/launcher.test.ts` (pure helper만 검증)

- [ ] **Step 1: Write the failing test**

```typescript
// core/platform/meta/launcher.test.ts
import { describe, it, expect } from "vitest";
import { buildCampaignName, buildAdSetTargeting, buildAdConfig } from "./launcher.js";
import type { Product } from "../../types.js";

const mockProduct: Product = {
  id: "p1", name: "Docker 기초", description: "컨테이너 기술",
  targetUrl: "https://inflearn.com/course/docker",
  currency: "KRW", category: "course", price: 44000, tags: ["docker"],
  inputMethod: "scraped", createdAt: "2026-04-16T00:00:00.000Z",
};

describe("buildCampaignName", () => {
  it("includes product name and date", () => {
    const name = buildCampaignName(mockProduct);
    expect(name).toContain("Docker 기초");
    expect(name).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("buildAdSetTargeting", () => {
  it("targets South Korea on Instagram by default", () => {
    const targeting = buildAdSetTargeting();
    expect(targeting.geo_locations.countries).toContain("KR");
    expect(targeting.publisher_platforms).toContain("instagram");
  });
});

describe("buildAdConfig", () => {
  it("has daily budget > 0", () => {
    const config = buildAdConfig();
    expect(config.dailyBudgetKRW).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run core/platform/meta/launcher.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// core/platform/meta/launcher.ts
import bizSdk from "facebook-nodejs-business-sdk";
import { readFile } from "fs/promises";
import { randomUUID } from "crypto";
import type { Product } from "../../types.js";
import type { VariantGroup, LaunchResult } from "../types.js";
import { assembleAssetFeedSpec } from "./assetFeedSpec.js";
import { executeRollback, appendOrphansToDisk, type CreatedResource } from "./rollback.js";
import { readJson, writeJson } from "../../storage.js";

const { AdAccount } = bizSdk as any;

export function buildCampaignName(product: Product): string {
  const date = new Date().toISOString().split("T")[0];
  return `[AD-AI] ${product.name} - ${date}`;
}

export function buildAdSetTargeting() {
  return {
    age_min: Number(process.env.AD_TARGET_AGE_MIN ?? 20),
    age_max: Number(process.env.AD_TARGET_AGE_MAX ?? 45),
    geo_locations: { countries: ["KR"] },
    publisher_platforms: ["instagram"],
    instagram_positions: ["stream", "story", "reels"],
  };
}

export function buildAdConfig() {
  return {
    dailyBudgetKRW: Number(process.env.AD_DAILY_BUDGET_KRW ?? 10000),
    durationDays: Number(process.env.AD_DURATION_DAYS ?? 14),
    objective: "OUTCOME_SALES",
    optimizationGoal: "LINK_CLICKS",
    billingEvent: "IMPRESSIONS",
  };
}

function initMeta() {
  (bizSdk as any).FacebookAdsApi.init(process.env.META_ACCESS_TOKEN!);
  return new AdAccount(process.env.META_AD_ACCOUNT_ID!);
}

async function uploadImage(account: any, imagePath: string): Promise<string> {
  const imageData = await readFile(imagePath);
  const hash = await account.createAdImage([], {
    bytes: imageData.toString("base64"),
  });
  return hash.hash as string;
}

async function uploadVideo(account: any, videoPath: string): Promise<string> {
  const videoBuffer = await readFile(videoPath);
  const video = await account.createAdVideo([], {
    source: videoBuffer,
    title: "Ad Video",
  });
  return video.id as string;
}

async function deleteMetaResource(
  type: "campaign" | "adset" | "ad",
  id: string,
): Promise<void> {
  const api = (bizSdk as any).FacebookAdsApi.getDefaultApi();
  await api.call("DELETE", [id]);
}

export async function launchMetaDco(group: VariantGroup): Promise<LaunchResult> {
  const config = buildAdConfig();
  const account = initMeta();
  const created: CreatedResource[] = [];

  try {
    // 1. Campaign
    const campaign = await account.createCampaign([], {
      name: buildCampaignName(group.product),
      objective: config.objective,
      status: "PAUSED",
      special_ad_categories: [],
    });
    created.push({ type: "campaign", id: campaign.id });

    // 2. AdSet
    const startTime = new Date().toISOString();
    const endTime = new Date(Date.now() + config.durationDays * 86400000).toISOString();
    const adSet = await account.createAdSet([], {
      name: `${group.product.name} - Ad Set`,
      campaign_id: campaign.id,
      daily_budget: config.dailyBudgetKRW,
      targeting: buildAdSetTargeting(),
      optimization_goal: config.optimizationGoal,
      billing_event: config.billingEvent,
      start_time: startTime,
      end_time: endTime,
      status: "PAUSED",
    });
    created.push({ type: "adset", id: adSet.id });

    // 3. Upload assets (image + video)
    const imageHash = await uploadImage(account, group.assets.image);
    const videoId = await uploadVideo(account, group.assets.video);

    // 4. Assemble asset_feed_spec
    const assetFeedSpec = assembleAssetFeedSpec({
      product: group.product,
      creatives: group.creatives,
      imageHash,
      videoId,
    });

    // 5. Create DCO ad creative
    const adCreative = await account.createAdCreative([], {
      name: `${group.product.name} - DCO Creative`,
      object_story_spec: {
        page_id: process.env.META_PAGE_ID!,
        instagram_actor_id: process.env.META_INSTAGRAM_ACTOR_ID,
      },
      asset_feed_spec: assetFeedSpec,
    });

    // 6. Create DCO ad (1 ad per group)
    const ad = await account.createAd([], {
      name: `${group.product.name} - DCO Ad`,
      adset_id: adSet.id,
      creative: { creative_id: adCreative.id },
      status: "PAUSED",
    });
    created.push({ type: "ad", id: ad.id });

    // 7. Persist Campaign record
    const campaignRecord = {
      id: randomUUID(),
      variantGroupId: group.variantGroupId,
      productId: group.product.id,
      platform: "meta" as const,
      metaCampaignId: campaign.id as string,
      metaAdSetId: adSet.id as string,
      metaAdId: ad.id as string,
      launchedAt: new Date().toISOString(),
      status: "paused" as const,
      orphans: [],
    };
    await writeJson(`data/campaigns/${campaignRecord.id}.json`, campaignRecord);

    return {
      campaignId: campaignRecord.id,
      platform: "meta",
      externalIds: {
        campaign: campaign.id,
        adSet: adSet.id,
        ad: ad.id,
      },
    };
  } catch (err) {
    console.error("[meta/launcher] launch failed; rolling back:", err);
    const cleanupResult = await executeRollback({
      created,
      deleter: deleteMetaResource,
    });
    await appendOrphansToDisk(cleanupResult.orphans, writeJson, readJson);
    throw err;
  }
}
```

**주의:** `Campaign.status: "paused"`는 기존 `core/types.ts`에 이미 있던 값이다. Meta 런칭은 `PAUSED` 상태로 생성되고, 사용자가 Meta 대시보드에서 수동 활성화한 뒤 JSON을 `"active"`로 업데이트하는 기존 흐름을 유지한다.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run core/platform/meta/launcher.test.ts
```

Expected: PASS (3 tests — pure helpers만)

- [ ] **Step 5: Commit**

```bash
git add core/platform/meta/launcher.ts core/platform/meta/launcher.test.ts
git commit -m "feat(platform/meta): implement DCO launcher with asset_feed_spec and rollback"
```

---

## Task 9: Meta Adapter — Monitor

Meta insights를 `body_asset` breakdown으로 수집 → VariantReport 생성.

**Files:**
- Create: `core/platform/meta/monitor.ts`
- Test: `core/platform/meta/monitor.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// core/platform/meta/monitor.test.ts
import { describe, it, expect } from "vitest";
import { classifyMetaError } from "./monitor.js";

describe("classifyMetaError", () => {
  it("identifies externally-modified (404) errors", () => {
    const err = { response: { status: 404 } };
    expect(classifyMetaError(err)).toBe("externally_modified");
  });
  it("identifies externally-modified (403) errors", () => {
    const err = { response: { status: 403 } };
    expect(classifyMetaError(err)).toBe("externally_modified");
  });
  it("identifies via Meta error.code 100 (not-found) and 803 (does not exist)", () => {
    expect(classifyMetaError({ response: { data: { error: { code: 100 } } } })).toBe("externally_modified");
    expect(classifyMetaError({ response: { data: { error: { code: 803 } } } })).toBe("externally_modified");
  });
  it("returns 'transient' for anything else", () => {
    expect(classifyMetaError(new Error("network fail"))).toBe("transient");
    expect(classifyMetaError({ response: { status: 500 } })).toBe("transient");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run core/platform/meta/monitor.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// core/platform/meta/monitor.ts
import bizSdk from "facebook-nodejs-business-sdk";
import type { Creative } from "../../types.js";
import type { VariantReport } from "../types.js";
import { readJson, listJson, writeJson } from "../../storage.js";
import { parseBodyAssetBreakdown } from "./breakdown.js";

const { AdAccount, Ad } = bizSdk as any;

export type MetaErrorClass = "externally_modified" | "transient";

export function classifyMetaError(err: unknown): MetaErrorClass {
  const anyErr = err as any;
  const status = anyErr?.response?.status;
  const code = anyErr?.response?.data?.error?.code;
  if (status === 404 || status === 403) return "externally_modified";
  if (code === 100 || code === 803) return "externally_modified";
  return "transient";
}

async function loadCreativesForGroup(variantGroupId: string): Promise<Creative[]> {
  const paths = await listJson("data/creatives");
  const result: Creative[] = [];
  for (const p of paths) {
    const c = await readJson<Creative>(p);
    if (c && c.variantGroupId === variantGroupId) result.push(c);
  }
  return result;
}

export async function fetchMetaVariantReports(
  campaignId: string,
  date: string,
): Promise<VariantReport[]> {
  (bizSdk as any).FacebookAdsApi.init(process.env.META_ACCESS_TOKEN!);

  const { readJson: read } = await import("../../storage.js");
  const campaign = await read<any>(`data/campaigns/${campaignId}.json`);
  if (!campaign) return [];

  const creatives = await loadCreativesForGroup(campaign.variantGroupId);
  const ad = new Ad(campaign.metaAdId);

  try {
    const insights = await ad.getInsights(
      [
        "impressions",
        "clicks",
        "inline_link_click_ctr",
        "quality_ranking",
        "engagement_rate_ranking",
        "conversion_rate_ranking",
      ],
      {
        time_range: { since: date, until: date },
        breakdowns: ["body_asset"],
      },
    );

    const rows = Array.isArray(insights) ? insights.map((r: any) => r._data ?? r) : [];
    return parseBodyAssetBreakdown({
      rows,
      creatives,
      campaignId: campaign.id,
      productId: campaign.productId,
      platform: "meta",
      date,
    });
  } catch (err) {
    const cls = classifyMetaError(err);
    if (cls === "externally_modified") {
      campaign.status = "externally_modified";
      await writeJson(`data/campaigns/${campaignId}.json`, campaign);
      console.warn(`[meta/monitor] campaign ${campaignId} marked externally_modified`);
    } else {
      console.error(`[meta/monitor] transient error on ${campaignId}:`, err);
    }
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run core/platform/meta/monitor.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add core/platform/meta/monitor.ts core/platform/meta/monitor.test.ts
git commit -m "feat(platform/meta): add monitor with body_asset breakdown and error classification"
```

---

## Task 10: Meta Adapter — 조립 (`MetaAdPlatform`)

`AdPlatform` interface를 구현하는 factory.

**Files:**
- Create: `core/platform/meta/adapter.ts`

- [ ] **Step 1: Write the file**

```typescript
// core/platform/meta/adapter.ts
import type { AdPlatform, VariantGroup, LaunchResult, VariantReport, CleanupResult } from "../types.js";
import { launchMetaDco } from "./launcher.js";
import { fetchMetaVariantReports } from "./monitor.js";
import { executeRollback, appendOrphansToDisk } from "./rollback.js";
import { readJson, writeJson } from "../../storage.js";
import bizSdk from "facebook-nodejs-business-sdk";

async function deleteMetaResource(type: "campaign" | "adset" | "ad", id: string): Promise<void> {
  const api = (bizSdk as any).FacebookAdsApi.getDefaultApi();
  await api.call("DELETE", [id]);
}

export function createMetaAdapter(): AdPlatform {
  return {
    name: "meta",
    async launch(group: VariantGroup): Promise<LaunchResult> {
      return launchMetaDco(group);
    },
    async fetchReports(campaignId: string, date: string): Promise<VariantReport[]> {
      return fetchMetaVariantReports(campaignId, date);
    },
    async cleanup(campaignId: string): Promise<CleanupResult> {
      (bizSdk as any).FacebookAdsApi.init(process.env.META_ACCESS_TOKEN!);
      const campaign = await readJson<any>(`data/campaigns/${campaignId}.json`);
      if (!campaign) return { deleted: [], orphans: [] };

      const created = [
        { type: "campaign" as const, id: campaign.metaCampaignId },
        { type: "adset" as const, id: campaign.metaAdSetId },
        { type: "ad" as const, id: campaign.metaAdId },
      ];
      const result = await executeRollback({ created, deleter: deleteMetaResource });
      await appendOrphansToDisk(result.orphans, writeJson, readJson);
      return result;
    },
  };
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep "core/platform" | head -20
```

Expected: No errors in `core/platform/*`. (전체 프로젝트에는 여전히 기존 `core/campaign/launcher.ts`가 깨진 채 남아있다 — 이건 Task 14에서 제거한다.)

- [ ] **Step 3: Commit**

```bash
git add core/platform/meta/adapter.ts
git commit -m "feat(platform/meta): assemble MetaAdPlatform factory implementing AdPlatform"
```

---

## Task 11: Creative·Campaign 마이그레이션 스크립트

기존 `data/creatives/*.json`과 `data/campaigns/*.json`을 신 스키마로 변환.

**Files:**
- Create: `scripts/migrate-creatives.ts`
- Modify: `package.json` (npm script 추가)

- [ ] **Step 1: Write the script**

```typescript
// scripts/migrate-creatives.ts
import "dotenv/config";
import { readdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

const CREATIVES_DIR = "data/creatives";
const CAMPAIGNS_DIR = "data/campaigns";

interface OldCreative {
  id: string; productId: string;
  copy: { headline: string; body: string; cta: string; hashtags: string[] };
  imageLocalPath: string; videoLocalPath: string;
  status: string; reviewNote?: string; createdAt: string;
}

interface OldCampaign {
  id: string;
  creativeId?: string;
  productId: string;
  metaCampaignId: string;
  metaAdSetId: string;
  metaAdIds?: string[];
  launchedAt: string;
  status: string;
}

async function migrateCreatives(): Promise<Map<string, string>> {
  // Returns map: oldCreativeId → variantGroupId
  const groupMap = new Map<string, string>();
  if (!existsSync(CREATIVES_DIR)) {
    console.log(`${CREATIVES_DIR} 없음 — creative 마이그레이션 건너뜀`);
    return groupMap;
  }
  const files = (await readdir(CREATIVES_DIR)).filter((f) => f.endsWith(".json"));
  console.log(`Creative 마이그레이션 대상: ${files.length}개`);

  for (const file of files) {
    const p = path.join(CREATIVES_DIR, file);
    const old = JSON.parse(await readFile(p, "utf-8")) as OldCreative;
    if ("variantGroupId" in old) {
      console.log(`✓ ${file} (이미 마이그레이션됨)`);
      groupMap.set(old.id, (old as any).variantGroupId);
      continue;
    }
    const variantGroupId = randomUUID();
    groupMap.set(old.id, variantGroupId);
    const updated = {
      ...old,
      variantGroupId,
      copy: {
        ...old.copy,
        variantLabel: "emotional" as const,
        metaAssetLabel: `variant-${variantGroupId}`,
      },
    };
    await writeFile(p, JSON.stringify(updated, null, 2), "utf-8");
    console.log(`✓ ${file} (variantGroupId=${variantGroupId})`);
  }
  return groupMap;
}

async function migrateCampaigns(creativeToGroup: Map<string, string>): Promise<void> {
  if (!existsSync(CAMPAIGNS_DIR)) {
    console.log(`${CAMPAIGNS_DIR} 없음 — campaign 마이그레이션 건너뜀`);
    return;
  }
  const files = (await readdir(CAMPAIGNS_DIR)).filter((f) => f.endsWith(".json"));
  console.log(`Campaign 마이그레이션 대상: ${files.length}개`);

  for (const file of files) {
    const p = path.join(CAMPAIGNS_DIR, file);
    const old = JSON.parse(await readFile(p, "utf-8")) as OldCampaign;
    if ("variantGroupId" in old && "platform" in old && "metaAdId" in old) {
      console.log(`✓ ${file} (이미 마이그레이션됨)`);
      continue;
    }
    const variantGroupId =
      (old.creativeId && creativeToGroup.get(old.creativeId)) || randomUUID();
    const metaAdId = old.metaAdIds?.[0] ?? "";
    const updated = {
      id: old.id,
      variantGroupId,
      productId: old.productId,
      platform: "meta",
      metaCampaignId: old.metaCampaignId,
      metaAdSetId: old.metaAdSetId,
      metaAdId,
      launchedAt: old.launchedAt,
      status: old.status,
      orphans: [],
    };
    await writeFile(p, JSON.stringify(updated, null, 2), "utf-8");
    console.log(`✓ ${file} (platform=meta, metaAdId=${metaAdId})`);
  }
}

async function main() {
  const groupMap = await migrateCreatives();
  await migrateCampaigns(groupMap);
  console.log("\n완료.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

`package.json`의 `scripts` 섹션에 한 줄 추가 (기존 `"migrate"` 뒤에):

```json
    "migrate": "tsx scripts/migrate.ts",
    "migrate:creatives": "tsx scripts/migrate-creatives.ts",
```

- [ ] **Step 3: Run script on actual data**

```bash
npm run migrate:creatives
```

Expected: 기존 `data/creatives/*.json`의 각 파일에 `variantGroupId`, `copy.variantLabel`, `copy.metaAssetLabel`이 추가됨. 기존 `data/campaigns/*.json`의 각 파일에 `platform`, `metaAdId`, `orphans` 추가, `creativeId`·`metaAdIds` 제거됨. 이미 마이그레이션된 파일은 스킵.

- [ ] **Step 4: Verify by reading one file**

```bash
ls data/creatives/ | head -1 | xargs -I {} cat "data/creatives/{}"
```

Expected: 출력에 `variantGroupId`, `variantLabel`, `metaAssetLabel` 포함.

- [ ] **Step 5: Commit**

기존 `data/` 내 JSON 파일 변경은 git 추적 대상이 아닐 수 있다 (`.gitignore` 확인). 스크립트와 package.json만 커밋.

```bash
git add scripts/migrate-creatives.ts package.json
git commit -m "feat(migrate): migrate creatives and campaigns to variant-group schema"
```

---

## Task 12: `cli/entries/launch.ts`를 adapter 경유로 변경

기존 `launchCampaign(product, creative)` 호출을 `activePlatforms()` 루프로 교체. 각 Creative를 1-variant VariantGroup로 래핑.

**Files:**
- Modify: `cli/entries/launch.ts`

- [ ] **Step 1: Rewrite the file**

```typescript
// cli/entries/launch.ts
import "dotenv/config";
import { readJson, listJson } from "../../core/storage.js";
import type { Creative, Product } from "../../core/types.js";
import { activePlatforms } from "../../core/platform/registry.js";
import type { VariantGroup } from "../../core/platform/types.js";

const platforms = await activePlatforms();
if (platforms.length === 0) {
  console.error("활성화된 플랫폼이 없습니다. .env의 AD_PLATFORMS 또는 credential을 확인하세요.");
  process.exit(1);
}
console.log(`활성 플랫폼: ${platforms.map((p) => p.name).join(", ")}`);

const creativePaths = await listJson("data/creatives");
for (const p of creativePaths) {
  const creative = await readJson<Creative>(p);
  if (!creative) continue;
  if (creative.status !== "approved" && creative.status !== "edited") continue;

  const product = await readJson<Product>(`data/products/${creative.productId}.json`);
  if (!product) continue;

  const group: VariantGroup = {
    variantGroupId: creative.variantGroupId,
    product,
    creatives: [creative],
    assets: { image: creative.imageLocalPath, video: creative.videoLocalPath },
  };

  for (const platform of platforms) {
    try {
      console.log(`${platform.name} 런칭: ${product.name}`);
      const result = await platform.launch(group);
      console.log(`  ✓ ${platform.name} campaign=${result.externalIds.campaign} ad=${result.externalIds.ad}`);
    } catch (err) {
      console.error(`  ✗ ${platform.name} 실패:`, err);
    }
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep "cli/entries/launch.ts"
```

Expected: no errors for `cli/entries/launch.ts`.

- [ ] **Step 3: Commit**

```bash
git add cli/entries/launch.ts
git commit -m "refactor(cli/launch): route launches through platform adapter registry"
```

---

## Task 13: `core/campaign/monitor.ts`의 `collectDailyReports` multi-platform 재작성

`collectDailyReports`를 `activePlatforms()` 루프로 재작성. 분석 함수(`generateWeeklyAnalysis`, `computeStats`, `buildAnalysisPrompt`)는 유지. 기존 Report 타입은 summary용으로 유지하되, 일별 저장 형식은 `VariantReport[]`로 전환.

**Files:**
- Modify: `core/campaign/monitor.ts`

- [ ] **Step 1: Rewrite `collectDailyReports`**

기존 `fetchInsights` + `collectDailyReports`를 아래로 교체한다. `computeStats`, `buildAnalysisPrompt`, `generateWeeklyAnalysis`는 보존한다 — 단 `generateWeeklyAnalysis`는 VariantReport를 Report로 집계하여 기존 분석 로직을 재사용한다.

```typescript
// core/campaign/monitor.ts (전체 교체)
import Anthropic from "@anthropic-ai/sdk";
import type { Report, Campaign } from "../types.js";
import type { VariantReport } from "../platform/types.js";
import { readJson, writeJson, appendJson, listJson } from "../storage.js";
import { activePlatforms } from "../platform/registry.js";
import { randomUUID } from "crypto";

export interface PerformanceStats {
  top: Report[];
  bottom: Report[];
  totalSpend: number;
  avgCtr: number;
}

export function computeStats(reports: Report[]): PerformanceStats {
  if (reports.length === 0) {
    return { top: [], bottom: [], totalSpend: 0, avgCtr: 0 };
  }
  const sorted = [...reports].sort((a, b) => b.ctr - a.ctr);
  const topCount = Math.min(3, Math.ceil(sorted.length / 2));
  const bottomCount = Math.min(3, sorted.length - topCount);
  return {
    top: sorted.slice(0, topCount),
    bottom: sorted.slice(sorted.length - bottomCount).reverse(),
    totalSpend: reports.reduce((sum, r) => sum + r.spend, 0),
    avgCtr: reports.reduce((sum, r) => sum + r.ctr, 0) / reports.length,
  };
}

export function buildAnalysisPrompt(reports: Report[], stats: PerformanceStats): string {
  return `다음 인스타그램 광고 성과 데이터를 분석하고 개선 제안을 JSON으로 반환해주세요.

## 성과 데이터
${reports.map((r) => `캠페인 ${r.campaignId}: CTR ${r.ctr}%, CPC ₩${r.cpc}, 지출 ₩${r.spend}`).join("\n")}

## 요약
- 상위 CTR: ${stats.top.map((r) => r.ctr).join("%, ")}%
- 하위 CTR: ${stats.bottom.map((r) => r.ctr).join("%, ")}%
- 총 지출: ₩${stats.totalSpend.toLocaleString()}
- 평균 CTR: ${stats.avgCtr.toFixed(2)}%

개선이 필요한 캠페인과 구체적인 제안을 아래 형식으로 반환:
{
  "summary": "전체 요약",
  "improvements": [
    {
      "campaignId": "",
      "issue": "문제점",
      "suggestion": "개선 제안",
      "targetFile": "수정할 파일 경로 (예: core/creative/copy.ts)",
      "changeType": "prompt_update | param_update | bug_fix"
    }
  ]
}`;
}

export async function collectDailyReports(): Promise<VariantReport[]> {
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const platforms = await activePlatforms();
  const campaignPaths = await listJson("data/campaigns");
  const all: VariantReport[] = [];

  for (const p of campaignPaths) {
    const campaign = await readJson<Campaign>(p);
    if (!campaign) continue;
    if (campaign.status === "completed" || campaign.status === "externally_modified" || campaign.status === "launch_failed") {
      continue;
    }
    const platform = platforms.find((pl) => pl.name === campaign.platform);
    if (!platform) continue;

    const reports = await platform.fetchReports(campaign.id, yesterday);
    for (const r of reports) {
      await appendJson(`data/reports/${yesterday}.json`, r);
      all.push(r);
    }
  }

  return all;
}

function variantReportsToReports(vrs: VariantReport[]): Report[] {
  // Group by campaignId, sum impressions/clicks, derive ctr/spend for legacy summary
  const byCampaign = new Map<string, { imp: number; cl: number; date: string; productId: string }>();
  for (const v of vrs) {
    const cur = byCampaign.get(v.campaignId) ?? { imp: 0, cl: 0, date: v.date, productId: v.productId };
    cur.imp += v.impressions;
    cur.cl += v.clicks;
    byCampaign.set(v.campaignId, cur);
  }
  const reports: Report[] = [];
  for (const [campaignId, agg] of byCampaign) {
    reports.push({
      id: randomUUID(),
      campaignId,
      productId: agg.productId,
      date: agg.date,
      impressions: agg.imp,
      clicks: agg.cl,
      ctr: agg.imp === 0 ? 0 : (agg.cl / agg.imp) * 100,
      spend: 0, // Meta DCO에서는 variant-level spend를 제공하지 않음; Plan C에서 ad-level 별도 수집
      cpc: 0,
      reach: 0,
      frequency: 0,
    });
  }
  return reports;
}

export async function generateWeeklyAnalysis(): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const reportPaths = (await listJson("data/reports"))
    .filter((p) => !p.includes("weekly-analysis"));
  const allVariants: VariantReport[] = [];

  for (const p of reportPaths.slice(-7)) {
    const daily = await readJson<VariantReport[]>(p);
    if (daily) allVariants.push(...daily);
  }
  if (allVariants.length === 0) return "성과 데이터 없음";

  const reports = variantReportsToReports(allVariants);
  const stats = computeStats(reports);
  const prompt = buildAnalysisPrompt(reports, stats);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
  await writeJson(
    `data/reports/weekly-analysis-${new Date().toISOString().split("T")[0]}.json`,
    JSON.parse(jsonMatch),
  );
  return text;
}
```

- [ ] **Step 2: Run existing monitor tests**

```bash
npx vitest run core/campaign/monitor.test.ts
```

Expected: PASS — 기존 `computeStats`/`buildAnalysisPrompt` 테스트는 그대로 통과 (Report 타입 사용).

- [ ] **Step 3: Commit**

```bash
git add core/campaign/monitor.ts
git commit -m "refactor(campaign/monitor): use platform adapter for multi-platform daily collection"
```

---

## Task 14: 기존 `core/campaign/launcher.ts` 제거 + import 정리

Meta 런처는 `core/platform/meta/launcher.ts`로 완전 이관되었으므로 기존 파일을 삭제한다.

**Files:**
- Delete: `core/campaign/launcher.ts`
- Delete: `core/campaign/launcher.test.ts`

- [ ] **Step 1: Check for remaining imports**

```bash
grep -rn "core/campaign/launcher" --include="*.ts" .
```

Expected: `cli/entries/launch.ts`는 Task 12에서 이미 제거됨. 남은 참조가 있으면 이 태스크에서 추가로 정리.

- [ ] **Step 2: Delete the files**

```bash
rm core/campaign/launcher.ts core/campaign/launcher.test.ts
```

- [ ] **Step 3: Full type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. 남은 타입 에러가 있으면 해당 파일에서 `launchCampaign` / `Creative.creativeId` / `Campaign.metaAdIds` 같은 잔여 참조를 찾아 수정.

- [ ] **Step 4: Full test run**

```bash
npm test
```

Expected: 모든 테스트 통과.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove legacy core/campaign/launcher (migrated to core/platform/meta)"
```

---

## Task 15: 문서 업데이트 + E2E 체크리스트

CLAUDE.md 규칙 (문서 업데이트 MANDATORY) 준수.

**Files:**
- Modify: `docs/STATUS.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `README.md`
- Create: `docs/superpowers/specs/2026-04-20-winner-db-variant-orchestration-e2e-checklist.md`

- [ ] **Step 1: Update `docs/ARCHITECTURE.md`**

"주요 디렉토리" 표에서 `core/campaign/` 줄을 아래로 교체:

```markdown
| `core/campaign/` | 성과 수집 오케스트레이션 + 주간 분석 (런칭은 `core/platform/`로 이관됨) |
| `core/platform/` | 플랫폼 어댑터: `AdPlatform` interface, `registry`, Meta DCO 어댑터 (`meta/`) |
```

"핵심 설계 결정" 섹션 끝에 새 항목 추가:

```markdown
### N. Platform Adapter 패턴 (2026-04-20)

**Why:** Meta 외 플랫폼 (TikTok, Google Ads 등) 확장 가능성을 준비하되, 현재는 Meta만 구현. 플랫폼별 로직이 `cli/entries/launch.ts`나 `core/campaign/`에 섞여있으면 확장 시 코드 수정 범위가 커진다.

**How:** `core/platform/types.ts`의 `AdPlatform` interface (launch/fetchReports/cleanup). `core/platform/registry.ts`가 `.env`의 `AD_PLATFORMS=meta,tiktok` csv를 파싱해 활성 어댑터 배열을 반환. 각 어댑터는 `core/platform/<name>/` 하위에 자체 logic. 어댑터별 credential env prefix 강제 (`META_*`, 추후 `TIKTOK_*`).

**Trade-off:** 현재는 어댑터 1개라 과도한 추상화처럼 보이지만, Plan B의 multi-variant 런칭과 Plan C의 Winner DB에서 플랫폼 중립 흐름을 요구하므로 지금 도입하는 것이 합리적.
```

- [ ] **Step 2: Update `docs/STATUS.md`**

"최근 변경 이력" 맨 위에 추가:

```markdown
- 2026-04-20: Plan A 완료 — Platform Adapter 패턴 도입, Meta 런칭을 DCO `asset_feed_spec`으로 전환, 기존 Creative/Campaign 마이그레이션 스크립트 추가
```

"완료된 항목" 섹션에 추가:

```markdown
- ✅ Platform Adapter 추상화 (`core/platform/`, `AdPlatform` interface)
- ✅ Meta Advantage+ Creative (DCO) 런칭 경로
- ✅ Rollback + orphans 기록 (`data/orphans.json`)
- ✅ 외부 수정 자동 감지 (`externally_modified` 상태)
```

"마지막 업데이트" 날짜를 `2026-04-20`으로 변경.

- [ ] **Step 3: Update `docs/ROADMAP.md`**

"현재 추천 다음 작업" 섹션을 아래로 변경:

```markdown
## 현재 추천 다음 작업

**Plan B — Variant 생성 파이프라인 시작** — Plan A 완료, 스펙 `docs/superpowers/specs/2026-04-20-winner-db-variant-orchestration-design.md` §Section 6 참조.
```

"Tier 1 — 바로 진행" 섹션에 Plan B 항목 추가 (또는 Plan B 구현 계획 작성 후 링크).

- [ ] **Step 4: Update `README.md`**

환경 변수 설명 섹션에 추가 (기존 `META_ACCESS_TOKEN` 근처):

```markdown
- `AD_PLATFORMS` (default `meta`) — csv 형식의 활성 광고 플랫폼 이름. 예: `meta`, `meta,tiktok`. 각 플랫폼은 자체 credential env를 요구 (Meta: `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_PAGE_ID`).
```

- [ ] **Step 5: Write E2E checklist**

```markdown
<!-- docs/superpowers/specs/2026-04-20-winner-db-variant-orchestration-e2e-checklist.md -->
# Winner DB + Variant Orchestration E2E Checklist

Plan A 완료 후 Meta 샌드박스 계정에서 수행. CI 대상 아님.

## Plan A — Platform Adapter + Meta DCO

- [ ] `.env`에 `AD_PLATFORMS=meta`, `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_PAGE_ID` 설정
- [ ] 테스트용 Product JSON 1개 준비 (`data/products/test-p.json`)
- [ ] 승인 상태 Creative JSON 1개 준비 (`data/creatives/test-c.json`, `status: "approved"`, 이미지·영상 파일 경로 유효)
- [ ] `npm run migrate:creatives` 실행 → Creative에 `variantGroupId`, `variantLabel`, `metaAssetLabel` 추가 확인
- [ ] `npm run launch` 실행 → Meta Ads Manager에서 DCO 광고 1개 생성 확인 (`asset_feed_spec` 적용, `PAUSED` 상태)
- [ ] Meta Ads Manager에서 광고 활성화 → `data/campaigns/<id>.json`의 `status`를 `"active"`로 수동 수정
- [ ] 24시간 후 `npm run monitor -- daily` 실행 → `data/reports/<어제>.json`에 VariantReport 저장 확인
- [ ] VariantReport의 `variantLabel`, `metaAssetLabel`이 올바르게 매핑되었는지 확인
- [ ] Meta Ads Manager에서 광고를 수동 삭제 → 다음 `monitor -- daily` 실행 → campaign JSON의 `status`가 `"externally_modified"`로 변경되는지 확인
- [ ] (rollback 시나리오) Meta credential을 일시적으로 잘못된 값으로 바꿔 `npm run launch` 실행 → campaign 생성은 성공하지만 adset 생성 단계에서 실패 → campaign이 Meta에서 삭제되었는지 확인 (rollback 동작)

## 검토 결과 기록

실행 후 실제 동작과 예상의 차이를 아래에 기록:

- (날짜): (관찰 내용)
```

- [ ] **Step 6: Commit**

```bash
git add docs/ARCHITECTURE.md docs/STATUS.md docs/ROADMAP.md README.md docs/superpowers/specs/2026-04-20-winner-db-variant-orchestration-e2e-checklist.md
git commit -m "docs(plan-a): update architecture, status, roadmap, README, and E2E checklist"
```

---

## 완료 기준

모든 태스크 완료 후:

1. `npm test` 전체 통과
2. `npx tsc --noEmit` 에러 없음
3. `core/platform/` 디렉토리 구조 완성 (types, registry, meta/ 하위 6개 파일)
4. 기존 `core/campaign/launcher.ts` 제거됨
5. `docs/STATUS.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `README.md` 갱신
6. E2E 체크리스트 문서 존재 (실행은 수동·Plan A 종료 후)
7. master 브랜치에 TDD 흐름대로 커밋 15개+ 남음

Plan A 완료 후 Plan B (Variant 생성 파이프라인)로 이어진다.

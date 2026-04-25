# 멀티 플랫폼 어댑터 (TikTok / Google) Scaffold + 인터페이스 정리

**작성일:** 2026-04-25
**스펙 종류:** 설계 (design)
**관련 ROADMAP 항목:** Tier 3 — *"Meta 외 플랫폼 지원 (TikTok ACO, Google Ads PMax, YouTube Shorts)"*

---

## 1. 배경 (Why)

현재 광고 플랫폼 어댑터는 `packages/core/src/platform/meta/` 하나만 구현돼 있다. ROADMAP Tier 3에 *"Meta 외 플랫폼 지원"*이 향후 작업으로 등록돼 있으며, TOML 마이그레이션 완료(2026-04-25 ✅)가 트리거 조건이었다.

이 스펙은 **scaffold 성격의 사전 코드 작업**이다. 사용자 의도는 "어차피 나중에 TikTok/Google/YouTube 통합 작업을 할 텐데, 미리 디렉토리 구조와 인터페이스 정리를 해두면 실 통합 시점에 시간이 절약될 것"이다. 실제 테스트는 Meta로 계속 진행하므로 새 플랫폼의 *실 API 통합*은 이번 작업 범위 밖이다.

또한 작업 결과물은 첫 캠페인 데이터가 쌓이기 *이전*에 인터페이스를 정리한다는 의미가 있다. 현재 `data/creatives/`, `data/campaigns/`, `data/reports/` 모두 0개 파일이고 `data/creatives.db`도 없어 **영속 데이터 마이그레이션 비용 zero**이다. 이 시점이 인터페이스를 못 박아두기 가장 깨끗하다.

---

## 2. 범위

### 2.1 범위 안 (이번 작업에서 한다)

1. **인터페이스 정리** — `AdPlatform` 관련 타입에서 Meta-leaky 필드 정리 (Section 4)
2. **공유 헬퍼** — `packages/core/src/platform/notImplemented.ts` 추가 (Section 5.1)
3. **TikTok scaffold** — `packages/core/src/platform/tiktok/` 디렉토리 + 5개 파일 (Section 5.2)
4. **Google scaffold** — `packages/core/src/platform/google/` 디렉토리 + 5개 파일 (Section 5.3)
5. **Config 스키마 확장** — `[platforms.tiktok]`, `[platforms.google]` Zod 정의 + superRefine + helper (Section 6)
6. **Registry 확장** — `NOT_YET_IMPLEMENTED` 집합 + validate 분기 (Section 6)
7. **`config.example.toml` 업데이트** — TikTok/Google 섹션 예시 (주석 처리) (Section 6.4)
8. **각 어댑터에 README.md** — 실 통합 시 필요한 SDK / OAuth / API / hierarchy 정보 (Section 5.4)

### 2.2 범위 밖 (의도적 deferred)

| 안 하는 것 | 이유 |
|---|---|
| TikTok / Google SDK 패키지 설치 | 미사용 의존성은 (a) `npm audit` 보안 노이즈 누적, (b) lockfile 비대화로 install 시간 증가, (c) 향후 SDK 메이저 버전업 시 사용도 안 하는데 마이그레이션 부담을 만든다. 실 통합 시점에 함께 추가. |
| 실 API 호출 코드 (mock-up 포함) | 검증 불가 코드는 잘못된 신호. SDK README는 어댑터별 README에 링크만. |
| OAuth 흐름 / credential 발급 자동화 | 실 SDK 검증 시점에 함께. |
| YouTube를 별도 어댑터로 분리 | YouTube ads는 Google Ads API의 PMax/Video 캠페인으로 운영 (실 산업 구조). `packages/core/src/platform/google/launcher.ts`가 PMax 캠페인 launch 책임지고, YouTube placement는 launcher 옵션으로 처리. |
| 에러 분류 함수 (`classifyTiktokError` 등) | 실 에러 관찰 후 작성. |
| `breakdown.ts` / `assetFeedSpec.ts` 등 Meta-style 헬퍼 scaffold 디렉토리에 복제 | 각 플랫폼의 asset spec / breakdown reporting 시맨틱이 다르므로 잘못된 형태로 박힐 가능성. 실 통합 시 각 플랫폼 형태로 신설. |
| Plan C qualifier의 platform-aware 일반화 | 두 번째 어댑터가 *실제로 다른 quality signal*을 들고올 때 진짜 형태가 보임. 지금은 `platformMetrics.meta.*` 안에 격리만 한다. |

---

## 3. 결정 사항 (key decisions)

### 3.1 YouTube를 `google/` 디렉토리 안에 통합

YouTube ads는 Google Ads API로 운영되는 실 산업 구조를 그대로 따른다. `PlatformId = z.enum(["meta", "tiktok", "google"])`은 그대로 유지 (YouTube enum 값 추가 안 함). YouTube placement 관련 옵션은 `google/launcher.ts`의 인자로 처리 (실 통합 시 결정).

### 3.2 Scaffold 어댑터는 registry에서 skip

`enabled` 배열에 `tiktok` 또는 `google`이 들어가도 `activePlatforms()`는 warning 후 skip한다. scaffold 어댑터는 type/구조 검증용이지 실행용이 아니므로, 실수로 활성화해도 launch 흐름이 깨지면 안 된다. 실 통합 시 `NOT_YET_IMPLEMENTED` 집합에서 한 줄 제거 + dynamic import 분기 추가로 활성화.

### 3.3 Schema regex 일부러 약화

TikTok `advertiser_id`, Google `customer_id` 등 ID 포맷 regex는 `min(1)`만 강제. 실 SDK가 요구하는 정확한 형태를 모르는 상태에서 regex 박으면 잘못된 형태로 박힐 위험. 실 통합 시 tighten.

### 3.4 적극적 인터페이스 정리 (data 비어있는 시점 활용)

영속 데이터 zero 상태이므로 데이터 마이그레이션 없이 인터페이스를 깨끗하게 정리. Section 4 참조.

---

## 4. 인터페이스 정리

### 4.1 `metaAssetLabel` → `assetLabel` (rename)

`Creative.copy.metaAssetLabel`, `VariantReport.metaAssetLabel` 두 곳 + 사용처 일괄 rename.

```ts
// packages/core/src/types.ts (Creative.copy)
copy: {
  headline: string; body: string; cta: string; hashtags: string[];
  variantLabel: "emotional" | "numerical" | "urgency";
  /** 변형 식별자. Meta DCO에서 `asset_feed_spec.bodies/titles[].adlabels.name`으로 사용되어
   *  per-asset insights breakdown 키가 됨. 다른 플랫폼은 실 통합 시 사용처를 매핑한다. */
  assetLabel: string;
};
```

```ts
// packages/core/src/platform/types.ts (VariantReport)
assetLabel: string;  // was metaAssetLabel
```

**영향 범위 (grep 정확 카운트):**
- 소스 파일: `types.ts`, `platform/types.ts`, `platform/meta/assetFeedSpec.ts`, `platform/meta/breakdown.ts`, `creative/copy.ts`, `cli/pipeline.ts`, `cli/actions.ts`, `cli/entries/generate.ts`
- 테스트 참조: 15건 (8개 테스트 파일)

### 4.2 Meta-specific ranking → `platformMetrics.meta.*`

```ts
// packages/core/src/platform/types.ts (변경 후)
export interface VariantReport {
  id: string; campaignId: string;
  variantGroupId: string; variantLabel: string;
  assetLabel: string;
  productId: string; platform: string; date: string;
  impressions: number; clicks: number; inlineLinkClickCtr: number;
  /**
   * 플랫폼 고유 지표. 키는 platform 식별자.
   * Meta: { qualityRanking, engagementRanking, conversionRanking } (각 string|null)
   * TikTok/Google: 실 통합 시 정의.
   */
  platformMetrics: {
    meta?: {
      qualityRanking: string | null;
      engagementRanking: string | null;
      conversionRanking: string | null;
    };
    tiktok?: Record<string, unknown>;
    google?: Record<string, unknown>;
  };
}
```

**영향 범위:** `rag/qualifier.ts` (~30라인 리팩터), `rag/types.ts`, `platform/meta/breakdown.ts:50-59`, 테스트 23 references (qualifier.test.ts ~10, qualifyJob.test.ts 1, breakdown.test.ts assertion, monitor/metrics.test.ts fixture, 등).

`qualifier.ts` 변경 예시:

```ts
// Before
adQualityRanking: r.adQualityRanking,
// ...
if (agg.adQualityRanking?.startsWith("BELOW_AVERAGE")) return false;

// After
qualityRanking: r.platformMetrics?.meta?.qualityRanking ?? null,
// ...
if (agg.qualityRanking?.startsWith("BELOW_AVERAGE")) return false;
```

`rag/types.ts`의 winner aggregate 타입도 동일 형태로 정리. Meta-aware 흐름 유지하되 데이터 위치만 `platformMetrics.meta` 하위로 이동.

### 4.3 `LaunchResult.externalIds` → `Record<string, string>`

```ts
// packages/core/src/platform/types.ts
export interface LaunchResult {
  campaignId: string;
  platform: string;
  /**
   * 플랫폼이 정의하는 외부 리소스 ID 맵.
   * 약속된 well-known 키: "campaign", "ad" (모든 플랫폼이 채움).
   * 그 외는 플랫폼별:
   *   Meta: "adSet", "creative"
   *   TikTok: "adGroup"
   *   Google: "adGroup", "asset"
   */
  externalIds: Record<string, string>;
}
```

**영향 범위:**
- Meta launcher가 `{ campaign, adSet, ad, creative }` 형태로 반환 → 외부 호출자 동작 동일
- 외부 소비자: `cli/actions.ts:185` (`.campaign` 사용), `cli/entries/launch.ts:55` (`.campaign`, `.ad` 사용) → well-known 키이므로 호환
- 테스트: `actions.test.ts:94` 1건 (mock LaunchResult)

### 4.4 `Campaign.meta*` → `externalIds: Record<string, string>`

```ts
// packages/core/src/types.ts (Campaign)
export interface Campaign {
  id: string;
  variantGroupId: string;
  productId: string;
  platform: string;
  externalIds: Record<string, string>;  // Meta: { campaign, adSet, ad, creative? }
  status: /* unchanged */;
  // ... 나머지 동일
}
```

**영향 범위:**
- `platform/meta/launcher.ts:151-188` (성공/launch_failed 두 군데) — 객체 조립을 `externalIds` 맵으로 변경
- `platform/meta/adapter.ts:31-34` cleanup() — `campaign.externalIds.{campaign,adSet,ad,creative}` 접근으로 변경
- `platform/meta/monitor.ts:43` — `new Ad(campaign.externalIds.ad)`
- 테스트 참조: 5건 (`types.test.ts` Campaign fixture 등)

---

## 5. 디렉토리 / 파일 scaffold

### 5.1 공유 헬퍼

```ts
// packages/core/src/platform/notImplemented.ts (신규)
export function notImplemented(platform: string, method: string): never {
  throw new Error(
    `[${platform}] ${method} — scaffold only, not yet implemented. ` +
    `See packages/core/src/platform/${platform}/README.md for integration plan.`
  );
}
```

함수 형태 (custom Error class 아님). 호출처 한 줄.

### 5.2 TikTok scaffold

```
packages/core/src/platform/tiktok/
├── adapter.ts        # createTiktokAdapter(): AdPlatform
├── launcher.ts       # launchTiktokAco() — NotImplemented stub
├── monitor.ts        # fetchTiktokVariantReports() — NotImplemented stub
├── adapter.test.ts   # 4 케이스 (smoke + launch/fetchReports/cleanup throws)
└── README.md         # 실 통합 시 필요한 정보 (Section 5.4 형식)
```

**`adapter.ts`:**

```ts
import type { AdPlatform, VariantGroup, LaunchResult, VariantReport, CleanupResult, LaunchLog } from "../types.js";
import { launchTiktokAco } from "./launcher.js";
import { fetchTiktokVariantReports } from "./monitor.js";
import { notImplemented } from "../notImplemented.js";

export function createTiktokAdapter(): AdPlatform {
  return {
    name: "tiktok",
    async launch(group: VariantGroup, onLog?: (l: LaunchLog) => void): Promise<LaunchResult> {
      return launchTiktokAco(group, onLog);
    },
    async fetchReports(campaignId: string, date: string): Promise<VariantReport[]> {
      return fetchTiktokVariantReports(campaignId, date);
    },
    async cleanup(_campaignId: string): Promise<CleanupResult> {
      notImplemented("tiktok", "cleanup");
    },
  };
}
```

**`launcher.ts`:**

```ts
import type { VariantGroup, LaunchResult, LaunchLog } from "../types.js";
import { notImplemented } from "../notImplemented.js";

/**
 * TikTok ACO (Automated Creative Optimization) 캠페인 런칭.
 * Meta DCO와 유사하게 multi-variant breakdown reporting 지원.
 * SDK / API 매핑은 README 참조.
 */
export async function launchTiktokAco(
  _group: VariantGroup,
  _onLog?: (log: LaunchLog) => void
): Promise<LaunchResult> {
  notImplemented("tiktok", "launchTiktokAco");
}
```

**`monitor.ts`:**

```ts
import type { VariantReport } from "../types.js";
import { notImplemented } from "../notImplemented.js";

/**
 * TikTok 캠페인의 일별 variant breakdown report 회수.
 * 반환 VariantReport[]는 캠페인 안의 각 variant 1행씩.
 * platformMetrics.tiktok 필드에 TikTok 고유 지표 매핑 (실 통합 시 정의).
 */
export async function fetchTiktokVariantReports(
  _campaignId: string,
  _date: string
): Promise<VariantReport[]> {
  notImplemented("tiktok", "fetchTiktokVariantReports");
}
```

**`adapter.test.ts`:**

```ts
import { describe, it, expect } from "vitest";
import { createTiktokAdapter } from "./adapter.js";

describe("createTiktokAdapter", () => {
  it("returns AdPlatform with name=tiktok", () => {
    const adapter = createTiktokAdapter();
    expect(adapter.name).toBe("tiktok");
    expect(typeof adapter.launch).toBe("function");
    expect(typeof adapter.fetchReports).toBe("function");
    expect(typeof adapter.cleanup).toBe("function");
  });

  it("launch throws NotImplemented", async () => {
    const adapter = createTiktokAdapter();
    await expect(adapter.launch({} as any)).rejects.toThrow(/scaffold only/i);
  });

  it("fetchReports throws NotImplemented", async () => {
    const adapter = createTiktokAdapter();
    await expect(adapter.fetchReports("c", "2026-04-25")).rejects.toThrow(/scaffold only/i);
  });

  it("cleanup throws NotImplemented", async () => {
    const adapter = createTiktokAdapter();
    await expect(adapter.cleanup("c")).rejects.toThrow(/scaffold only/i);
  });
});
```

### 5.3 Google scaffold

구조 동일. 차이점:
- 함수명: `launchGoogleAds()` (PMax + Video 캠페인 통합 진입점), `fetchGoogleVariantReports()`
- `adapter.test.ts`의 `name=google`
- README 본문이 Google Ads API / OAuth / PMax / YouTube placement 다룸

### 5.4 README 구조 (각 플랫폼당)

각 README는 **실 통합 시점에 SDK/API 다시 조사하지 않도록** 다음 7개 섹션 포함:

```markdown
# TikTok Adapter (Scaffold)

## Status
**Scaffold only — runtime calls throw NotImplementedError.**

## Implementation Plan
실 통합 시 이 README를 따라 진행.

## 1. SDK / Dependencies
- npm: `tiktok-business-api-sdk` (또는 raw HTTP client)
- API doc: https://business-api.tiktok.com/portal/docs

## 2. Required Config (`[platforms.tiktok]`)
- `access_token` — long-lived token from TikTok Marketing API
- `advertiser_id` — TikTok Ads Manager advertiser ID (numeric)
- (실 통합 시 OAuth refresh credentials 추가 가능)

## 3. Authentication Flow
[research needed] — TikTok Business API OAuth 2.0 / token refresh 절차

## 4. Resource Hierarchy (vs Meta)
| Meta | TikTok | externalIds 키 |
|---|---|---|
| Campaign | Campaign | `campaign` |
| Ad Set | Ad Group | `adGroup` |
| Ad | Ad | `ad` |
| Ad Creative | [research needed] — TikTok Identity / Creative 분리 여부 확인 필요 | [research needed] |

## 5. ACO (Automated Creative Optimization) 매핑
TikTok ACO는 multi-creative 자동 최적화. Meta DCO `asset_feed_spec` 등가물:
- [research needed] — ACO API endpoint 및 asset upload 형식

## 6. Reporting Breakdown
일별 per-variant insights 회수 방법:
- [research needed] — `/v1.3/report/integrated/get/` 엔드포인트 검토
- VariantReport.platformMetrics.tiktok 매핑 형태 결정

## 7. Implementation Checklist
- [ ] `tiktok-business-api-sdk` 설치 + `package.json` 등록
- [ ] `[platforms.tiktok]` Zod schema 확장 (필요 시 OAuth 필드 추가)
- [ ] `launcher.ts`: `launchTiktokAco()` 본체 — campaign/adGroup/ad 생성 + asset upload
- [ ] `monitor.ts`: `fetchTiktokVariantReports()` — breakdown reporting 매핑
- [ ] `adapter.ts`: `cleanup()` 본체 — TikTok delete API + rollback 패턴
- [ ] `breakdown.ts` 신설 (Meta 참조)
- [ ] 에러 분류 함수 (`classifyTiktokError`) 신설 — Meta `classifyMetaError` 참조
- [ ] `registry.ts`의 `NOT_YET_IMPLEMENTED` 집합에서 "tiktok" 제거 + dynamic import 분기 추가
- [ ] `adapter.test.ts`: NotImplemented 테스트 → 실 동작 테스트로 교체 (Meta launcher.test.ts 참조)
- [ ] schema regex 강화 시 기존 사용자 config 호환성 확인
```

`[research needed]` 표지: 실 SDK 문서를 안 보고 추측한 부분에 명시. 실 통합 시 채워야 할 곳을 명확히 표시.

Google README도 같은 구조. 차이점:
- SDK: `google-ads-api` (또는 official `google-ads-nodejs-client`)
- Hierarchy: Campaign → AdGroup → Ad (PMax는 Asset Group)
- YouTube placement는 별도 항목 — PMax 안의 video assets 또는 Video campaign type

---

## 6. Config schema + Registry + Helper

### 6.1 `config/schema.ts`

```ts
const PlatformId = z.enum(["meta", "tiktok", "google"]);  // 동일 유지

const MetaPlatform = z.object({ /* 동일 */ });

// Scaffold 전용 — 필드는 최소만. 실 통합 시 OAuth 등 schema 확장.
const TiktokPlatform = z.object({
  access_token: z.string().min(1),
  advertiser_id: z.string().min(1),  // numeric 검증은 실 통합 시 강화
});

const GooglePlatform = z.object({
  developer_token: z.string().min(1),
  customer_id: z.string().min(1),    // "123-456-7890" 검증은 실 통합 시 강화
});

const PlatformsSection = z.object({
  enabled: z.array(PlatformId).min(1, "at least one platform must be enabled"),
  meta: MetaPlatform.optional(),
  tiktok: TiktokPlatform.optional(),
  google: GooglePlatform.optional(),
});
```

### 6.2 superRefine 확장

```ts
.superRefine((cfg, ctx) => {
  for (const id of cfg.platforms.enabled) {
    if (id === "meta" && !cfg.platforms.meta) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["platforms", "meta"],
        message: '"meta"가 platforms.enabled에 있지만 [platforms.meta] 섹션이 없습니다',
      });
    }
    if (id === "tiktok" && !cfg.platforms.tiktok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["platforms", "tiktok"],
        message: '"tiktok"가 platforms.enabled에 있지만 [platforms.tiktok] 섹션이 없습니다',
      });
    }
    if (id === "google" && !cfg.platforms.google) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["platforms", "google"],
        message: '"google"가 platforms.enabled에 있지만 [platforms.google] 섹션이 없습니다',
      });
    }
  }
});
```

### 6.3 `config/helpers.ts` 추가

```ts
export function requireTiktok(
  cfg: Config = getConfig()
): NonNullable<Config["platforms"]["tiktok"]> {
  if (!cfg.platforms.tiktok) {
    throw new Error("[platforms.tiktok] is required for this operation");
  }
  return cfg.platforms.tiktok;
}

export function requireGoogle(
  cfg: Config = getConfig()
): NonNullable<Config["platforms"]["google"]> {
  if (!cfg.platforms.google) {
    throw new Error("[platforms.google] is required for this operation");
  }
  return cfg.platforms.google;
}
```

CLAUDE.md "Helper 배치 규칙" 적용 (옵셔널 섹션 require는 helpers.ts 통일).

scaffold 어댑터 본체는 NotImplementedError throw하므로 require 헬퍼를 호출하지 않는다. 헬퍼는 실 통합 시점에 사용. 미리 만들어두는 이유는 다른 도메인 헬퍼와 일관된 구조 + 실 통합 시 추가 작업 없이 import만 하면 되도록.

### 6.4 `platform/registry.ts`

```ts
import type { AdPlatform } from "./types.js";
import { getConfig, type Config } from "../config/index.js";

const NOT_YET_IMPLEMENTED = new Set<string>(["tiktok", "google"]);

export type ValidationResult =
  | { ok: true }
  | { ok: false; missing: string[] };

export function validatePlatform(name: string, cfg: Config = getConfig()): ValidationResult {
  if (name === "meta") {
    const meta = cfg.platforms.meta;
    if (!meta) return { ok: false, missing: ["platforms.meta"] };
    const missing: string[] = [];
    if (!meta.access_token) missing.push("platforms.meta.access_token");
    if (!meta.ad_account_id) missing.push("platforms.meta.ad_account_id");
    if (!meta.page_id) missing.push("platforms.meta.page_id");
    return missing.length === 0 ? { ok: true } : { ok: false, missing };
  }
  if (name === "tiktok") {
    const tiktok = cfg.platforms.tiktok;
    if (!tiktok) return { ok: false, missing: ["platforms.tiktok"] };
    const missing: string[] = [];
    if (!tiktok.access_token) missing.push("platforms.tiktok.access_token");
    if (!tiktok.advertiser_id) missing.push("platforms.tiktok.advertiser_id");
    return missing.length === 0 ? { ok: true } : { ok: false, missing };
  }
  if (name === "google") {
    const google = cfg.platforms.google;
    if (!google) return { ok: false, missing: ["platforms.google"] };
    const missing: string[] = [];
    if (!google.developer_token) missing.push("platforms.google.developer_token");
    if (!google.customer_id) missing.push("platforms.google.customer_id");
    return missing.length === 0 ? { ok: true } : { ok: false, missing };
  }
  return { ok: false, missing: [`platform "${name}" not supported`] };
}

export async function activePlatforms(): Promise<AdPlatform[]> {
  const cfg = getConfig();
  const platforms: AdPlatform[] = [];
  for (const name of cfg.platforms.enabled) {
    const v = validatePlatform(name, cfg);
    if (!v.ok) {
      console.warn(`[platform] skipping "${name}": ${v.missing.join(", ")}`);
      continue;
    }
    if (NOT_YET_IMPLEMENTED.has(name)) {
      console.warn(
        `[platform] "${name}" is enabled and configured, but adapter is scaffold-only. ` +
        `Skipping registration. See packages/core/src/platform/${name}/README.md.`
      );
      continue;
    }
    if (name === "meta") {
      const { createMetaAdapter } = await import("./meta/adapter.js");
      platforms.push(createMetaAdapter());
    }
    // 실 통합 시 NOT_YET_IMPLEMENTED에서 제거 + 분기 추가:
    // else if (name === "tiktok") { ... }
    // else if (name === "google") { ... }
  }
  return platforms;
}
```

### 6.5 `platform/registry.test.ts` 업데이트

`makeTestConfig` 시그니처: `(overrides?: DeepPartial<Config>, omit?: string[]) => Config`. BASE_CONFIG는 `enabled=["meta"]` + `platforms.meta` 채워진 형태이며 `platforms.tiktok`/`platforms.google`은 부재 (옵셔널이므로). 따라서 tiktok/google 테스트는 `makeTestConfig({ platforms: { enabled: [...], tiktok: {...} } })` 형태로 overrides 전달.

```ts
// 추가/교체
it("rejects unconfigured tiktok", () => {
  const r = validatePlatform("tiktok", makeTestConfig());
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.missing).toContain("platforms.tiktok");
});

it("rejects unconfigured google", () => {
  const r = validatePlatform("google", makeTestConfig());
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.missing).toContain("platforms.google");
});

it("rejects fully unknown platform names", () => {
  const r = validatePlatform("snapchat", makeTestConfig());
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.missing[0]).toMatch(/not supported/i);
});

it("accepts tiktok when configured", () => {
  const cfg = makeTestConfig({
    platforms: {
      enabled: ["meta", "tiktok"],
      tiktok: { access_token: "x", advertiser_id: "1" },
    },
  });
  const r = validatePlatform("tiktok", cfg);
  expect(r.ok).toBe(true);
});

it("activePlatforms skips scaffold-only platforms with warning", async () => {
  setConfigForTesting(makeTestConfig({
    platforms: {
      enabled: ["meta", "tiktok"],
      tiktok: { access_token: "x", advertiser_id: "1" },
    },
  }));
  const warns: string[] = [];
  const origWarn = console.warn;
  console.warn = (m: string) => { warns.push(m); };
  try {
    const platforms = await activePlatforms();
    expect(platforms.map((p) => p.name)).toEqual(["meta"]);
    expect(warns.some((w) => w.includes("scaffold-only"))).toBe(true);
  } finally {
    console.warn = origWarn;
  }
});
```

기존 "rejects unknown platforms" 테스트 (`registry.test.ts:18-23`)가 `tiktok`을 unknown으로 가정하므로 위 케이스로 교체.

### 6.6 `config.example.toml` 업데이트

```toml
[platforms]
# 활성화할 광고 플랫폼 목록.
# - "meta": 구현 완료, 즉시 사용 가능
# - "tiktok", "google": scaffold만 존재 (NotImplemented). enabled에 추가해도 registry가 warning 후 skip.
#   실 통합은 packages/core/src/platform/<name>/README.md 참조.
enabled = ["meta"]

[platforms.meta]
# ... 기존 동일

# Scaffold-only — 실 통합 전까지 주석 유지. 활성화하려면:
#   1. enabled 배열에 "tiktok" 추가
#   2. 아래 섹션 주석 해제 후 실제 값 입력
#   3. packages/core/src/platform/tiktok/README.md 참조
# [platforms.tiktok]
# access_token = "..."   # TikTok Marketing API access token
# advertiser_id = "..."  # TikTok Ads Manager advertiser ID

# Scaffold-only — 실 통합 전까지 주석 유지.
# [platforms.google]
# developer_token = "..."   # Google Ads developer token
# customer_id = "..."       # Google Ads CID (123-456-7890 형식)
```

---

## 7. 영속 데이터 마이그레이션

**필요 없음.** `data/creatives/`, `data/campaigns/`, `data/reports/` 모두 0개 파일이고 `data/creatives.db`도 없는 상태에서 이 작업이 수행된다. 인터페이스 변경은 순수 코드/테스트 리팩터로 끝난다.

---

## 8. 테스트 전략

### 8.1 scaffold가 검증할 수 있는 것

1. **타입 안전성**: `createTiktokAdapter()`/`createGoogleAdapter()`가 `AdPlatform` 인터페이스 만족 (TypeScript compile)
2. **NotImplemented 동작**: 모든 stub 메서드가 적절한 메시지 (`scaffold only` + README 경로) 로 throw
3. **Registry 동작**: scaffold 플랫폼이 `enabled`에 있어도 `activePlatforms()`에서 warning 후 skip
4. **Validate 동작**: 각 플랫폼의 config validation이 missing fields를 정확히 보고
5. **Schema 동작**: Zod가 `enabled=["tiktok"]` + `[platforms.tiktok]` 섹션 누락 케이스 reject

### 8.2 scaffold가 검증 불가 (의도적 deferred)

- 실 API 호출 자체
- OAuth flow
- 에러 분류
- 응답 매핑

### 8.3 신규 테스트 (9 케이스)

| 파일 | 케이스 |
|---|---|
| `platform/tiktok/adapter.test.ts` | 4 (smoke + launch/fetchReports/cleanup NotImplemented) |
| `platform/google/adapter.test.ts` | 4 (동일 형태) |
| `platform/notImplemented.test.ts` | 1 (에러 메시지 형식 검증) |

### 8.4 기존 테스트 수정 (정확 카운트, 8 파일)

grep 결과 기준:
- `metaAssetLabel` 참조: **15건**
- `adQualityRanking|adEngagementRanking|adConversionRanking` 참조: **23건**
- `metaCampaignId|metaAdSetId|metaAdId|metaAdCreativeId` 참조: **5건**
- `externalIds: { ... adSet }` 참조: **1건**

영향 테스트 파일: `qualifier.test.ts`, `qualifyJob.test.ts`, `breakdown.test.ts`, `assetFeedSpec.test.ts`, `monitor/metrics.test.ts`, `types.test.ts`, `reviewer/decisions.test.ts`, `launch/groupApproval.test.ts`, `actions.test.ts`, `registry.test.ts`.

추가 신규 케이스: registry.test.ts 5 (Section 6.5) + schema (loader.test.ts 또는 schema.test.ts) 2 = 7.

총 신규 케이스 = §8.3의 9 + §8.4의 7 = **16건**. 기존 fixture 수정 = 8 파일 44 references.

### 8.5 통합 검증

`qualifyJob.test.ts`에 기존 통합 케이스 패턴 (factory가 fakeAggregator/fakeStore 주입) 이 있다. Section 4.2의 `platformMetrics.meta.*` 이동 후 동일 통합 흐름 그린 유지로 Plan C qualifier 회귀 없음 확인. 수동 단계 없이 자동 테스트로 흡수.

---

## 9. Plan C 영향 + 검증 타이밍

**핵심 위험**: Section 4.2 (`adQualityRanking` → `platformMetrics.meta.qualityRanking`) 가 Plan C qualifier에 직접 영향. qualifier는 Plan C 자기학습 루프의 winner 판정 로직.

**완화책 — refactor를 Plan C 실운영 검증 *이전*에 수행**:
- 현재 `data/creatives.db` 없음, `data/` 모두 비어있음 → 사용자는 Plan C 실운영 검증 아직 시작 안 함
- 이 refactor를 먼저 완료 후 Plan C 검증 시작 → 인터페이스 변수와 검증 변수가 동시에 움직이지 않음
- 사용자가 대화에서 *"테스트 자체는 Meta 기본"* 으로 동의

**롤백 전략**:
- Commit 1이 가장 위험 — 단일 큰 변경. 문제 발견 시 `git revert <commit-sha>` 한 줄로 복구
- 영속 데이터 마이그레이션 zero이므로 rollback 비용 zero
- Commit 2-4는 추가 작업이라 revert 안전

---

## 10. 작업 순서 (commit 단위)

각 commit이 그린 빌드 + 그린 테스트 유지하도록 atomic 단위.

### Commit 1 — 인터페이스 정리 (Section 4)

- 변경 4.1-4.4 + 영향받는 Meta 코드 + 테스트 fixture 한 번에
- **분할 불가** — 부분 적용 시 컴파일 깨짐
- **subagent 필수**: `meta-platform-expert` (CLAUDE.md "Subagent 호출 규칙" 트리거 — `platform/meta/launcher.ts/adapter.ts/monitor.ts/breakdown.ts` 다수 수정)
- Critical/Important 발견 시 수정 후 재검토 → 통과 시 commit

### Commit 2 — scaffold 디렉토리 + READMEs (Section 5)

- `platform/notImplemented.ts` + `platform/tiktok/`, `google/` 5개 파일씩 + 9 신규 테스트
- `platform/meta/*` 수정 없음 → meta-platform-expert 불필요

### Commit 3 — Config + Registry (Section 6)

- `config/schema.ts`, `config/helpers.ts`, `platform/registry.ts`/`.test.ts`, `config.example.toml` 동시
- registry 5 + schema 2 케이스 그린
- meta-platform-expert 트리거 안 됨

### Commit 4 — 문서 업데이트 (별도 commit)

- `docs/ARCHITECTURE.md §10`: *"현재는 Meta만 구현"* → *"Meta 구현 + TikTok/Google scaffold (NotImplemented). NOT_YET_IMPLEMENTED 집합에서 제거 시 활성화"*
- `docs/STATUS.md`: 최근 변경 이력 한 줄 + 마지막 업데이트 날짜
- `docs/ROADMAP.md` Tier 3 *"Meta 외 플랫폼 지원"*: *"scaffold ✅ 완료, 실 API 통합 + 검증 필요"* 로 갱신

### Commit별 Subagent 호출

| Commit | meta-platform-expert | marketing-copy-reviewer | code-reviewer |
|---|---|---|---|
| 1 (인터페이스 정리) | ✅ 필수 | ❌ (prompt.ts/카피 결과 변경 없음) | ✅ (Task 완료 검토) |
| 2 (scaffold) | ❌ | ❌ | ✅ |
| 3 (config/registry) | ❌ | ❌ | ✅ |
| 4 (문서) | ❌ | ❌ | ❌ |

---

## 11. 작업 시간 견적

| 단계 | 시간 |
|---|---|
| Commit 1 (인터페이스 정리) | 3.5h (rename + qualifier + Meta launcher/adapter/monitor + 테스트 44 references) |
| Commit 2 (scaffold + READMEs) | 2.5h |
| Commit 3 (config/registry) | 1.5h |
| Commit 4 (문서) | 0.5h |
| meta-platform-expert review + 수정 (Commit 1) | 1h |
| code-reviewer 라운드 | 0.5h |
| 전체 테스트 그린 안정화 | 0.5h |
| **합계** | **~10시간 (1.5일)** |

---

## 12. 다른 영역 영향

Section 4 인터페이스 변경 → TypeScript compile error로 모든 사용처 강제 노출. 누락 없음 (TypeScript가 안전망).

**영향 받음** (수정 필요): TUI/CLI/RAG/improver/launcher/breakdown — grep 18 파일.

**영향 안 받음**:
- Stripe billing (Creative/Campaign 타입 사용 안 함)
- Server admin/auth/license (광고 도메인과 분리)
- Voyage RAG embedding (`Creative.copy.headline/body`만 사용 — `assetLabel` 무관)

---

## 13. Open Questions / 후속 작업

1. **Plan C qualifier의 platform-aware 일반화** — 두 번째 어댑터가 실 동작할 때 다시 검토. 지금은 `platformMetrics.meta.*` 안에 격리만.
2. **`deleteMetaResource` 중복** (STATUS.md 기존 항목) — `platform/meta/launcher.ts:59-65` vs `platform/meta/adapter.ts:8-11`. **이번 작업 범위 밖**. 본 spec은 인터페이스 정리 + scaffold 두 가지로 이미 범위가 크고, `deleteMetaResource` 중복은 별개 cleanup 주제. 별 spec/별 commit으로 처리. STATUS.md "알려진 결함"에 그대로 유지.
3. **Schema regex 강화 시 호환성** — TikTok `advertiser_id`, Google `customer_id` regex를 `min(1)`로 약화. 실 통합 시 tighten하면 기존 사용자 config가 reject될 수 있음. 각 README의 Implementation Checklist에 명시됨.
4. **YouTube placement API 매핑** — Google Ads PMax의 video assets 또는 Video campaign type 중 어느 쪽을 default로 할지는 실 통합 시 결정.

---

## 14. 검토 이력

### 2026-04-25 — 초안 작성 + 섹션 단위 자체 검토

본 스펙은 brainstorming 단계에서 5개 섹션 (범위/인터페이스/scaffold/config/테스트) 으로 나누어 각각 자체 검토를 거쳐 작성됐다. 섹션별 발견 이슈:

**Section 1 (범위) — Important 1건**
- SDK deps 추가 안 하는 근거가 일반론적 ("lockfile 영향")이었음 → 보안 audit 노이즈, install 시간, SDK 메이저 버전업 마이그레이션 부담의 3가지 구체 근거로 강화. 본 스펙 §2.2에 반영.

**Section 2 (인터페이스 정리) — Important 1건**
- 초안에서 "최소 변경" 결론이었으나, 데이터 비어있는 사실 확인 후 "적극적 정리"로 정정. Section 1 발언과 자연스러운 정정 과정. 사용자가 적극적 정리 방향에 동의하여 §4로 채택.

**Section 3 (scaffold 구조) — Minor 1건**
- README의 "Resource Hierarchy" 표에서 TikTok creative 행이 추측 기반이었음 → `[research needed]`로 통일하여 검증 안 됨을 명시. §5.4에 반영.

**Section 4 (config/registry) — Important 1건**
- `makeTestConfig` 시그니처 placeholder로 표현했음 → 직접 `packages/core/src/config/testing.ts` 읽어서 정확한 시그니처(`(overrides?: DeepPartial<Config>, omit?: string[]) => Config`) 확인. §6.5에 정확한 호출 형태로 반영.

**Section 5 (테스트/순서/리스크) — Important 1건**
- 기존 테스트 수정 케이스 수 추정 ("~25-30") → grep으로 정확화: `metaAssetLabel` 15건, `adQualityRanking|...` 23건, `metaCampaignId|...` 5건, `externalIds.adSet` 1건, 총 44 references 8 파일. §8.4에 반영.

### 2026-04-25 — 스펙 작성 후 자체 검토 (5점 점검)

스펙 작성 직후 추가 자체 검토에서 발견된 이슈:

**Important #1**: §8.4의 신규 케이스 합계가 부정확 — 본문이 "~9 신규"라고 적었으나 §8.3의 9 + §8.4의 registry/schema 신규 7 = 실제 16건. 인라인 수정: §8.4 마지막 단락을 "총 신규 케이스 = §8.3의 9 + §8.4의 7 = 16건"으로 정확화.

**Important #2**: §13 Open Questions의 `deleteMetaResource` 중복 정리 항목이 *"Commit 1 작업 중 판단"*이라는 모호한 deferral. 인라인 수정: **"이번 작업 범위 밖"** 으로 명확화. STATUS.md 알려진 결함에 그대로 유지.

**Minor #1**: §5.4 README의 `[research needed]` 표지를 통해 검증 안 된 부분 명시 (이미 본문에 반영됨).

### 종합

- Critical: 0건
- Important: 6건 (Section 1/2/4/5 각 1건 + 스펙 자체 검토 2건). **모두 인라인 수정 완료**
- Minor: 1건 (`[research needed]` 통일 — 본문 반영)

다음 단계: 사용자 검토 → 승인 시 `superpowers:writing-plans` 스킬로 implementation plan 작성.

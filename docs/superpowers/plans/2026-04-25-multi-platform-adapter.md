# Multi-Platform Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TikTok/Google scaffold 어댑터 추가 + AdPlatform 인터페이스에서 Meta-leaky 필드 정리 (data 비어있는 시점 활용한 적극적 정리).

**Architecture:** 4 commit 단위로 분할:
1. 인터페이스 정리 — `metaAssetLabel→assetLabel` rename, ranking 필드를 `platformMetrics.meta.*` 하위로 이동, `externalIds`를 `Record<string,string>` 일반화. Meta 동작 동일.
2. Scaffold 디렉토리 — `tiktok/`, `google/` 5개 파일씩 + `notImplemented.ts` 공유 헬퍼. NotImplementedError throw.
3. Config/Registry — Zod 스키마 + helper + registry 분기 + `NOT_YET_IMPLEMENTED` set + `config.example.toml` 업데이트.
4. 문서 — `ARCHITECTURE.md`, `STATUS.md`, `ROADMAP.md` 갱신.

**Tech Stack:** TypeScript, vitest, Zod, smol-toml. tsx 런타임 (빌드 스텝 없음).

**Spec:** `docs/superpowers/specs/2026-04-25-multi-platform-adapter-design.md` (커밋 `a78c62f`)

**브랜치:** master 직접 커밋 (CLAUDE.md 정책).

---

## Task 0: Pre-flight

### Task 0.1: 환경 확인 (테스트 baseline)

**Files:** 없음 (sanity check만)

- [ ] **Step 1: 작업 트리 상태 확인**

```bash
git status --short
```

Expected: 이전 레거시 정리 변경(README/ARCHITECTURE/STATUS/package.json + 삭제된 migrate 스크립트)만 보일 것.

- [ ] **Step 2: 테스트 환경 복구 (필요 시)**

이전 세션에서 `npm test`가 macOS Gatekeeper로 인한 rollup 네이티브 모듈 코드 서명 거부로 실패했음. 다음 중 하나로 복구:

```bash
xattr -dr com.apple.quarantine node_modules/
```

또는

```bash
rm -rf node_modules package-lock.json && npm install
```

- [ ] **Step 3: 테스트 baseline 확인**

```bash
npm test
```

Expected: 335 tests passing (TOML 마이그레이션 후 기준). 실패 시 본 plan 진행 금지 — 환경 복구 우선.

- [ ] **Step 4: 데이터 디렉토리 비어있음 재확인**

```bash
ls data/creatives/ data/campaigns/ data/reports/ 2>/dev/null; ls -la data/creatives.db 2>/dev/null
```

Expected: 모두 0개 파일, `data/creatives.db` 없음. 영속 데이터 없음 확인.

### Task 0.2: 이전 레거시 정리 commit

이전 세션에서 작업한 레거시 정리(README/ARCHITECTURE/STATUS/package.json 편집 + migrate 스크립트 2개 삭제)가 working tree에 남아있음. Commit 1 시작 전에 별도 commit으로 정리.

**Files:**
- Modified: `README.md`, `docs/ARCHITECTURE.md`, `docs/STATUS.md`, `package.json`
- Deleted: `scripts/migrate.ts`, `scripts/migrate-creatives.ts`

- [ ] **Step 1: 변경 내용 재확인**

```bash
git diff --stat
```

Expected: 4 modified + 2 deleted, 단순 chore 성격.

- [ ] **Step 2: 명시적 add (-A 사용 금지)**

```bash
git add README.md docs/ARCHITECTURE.md docs/STATUS.md package.json scripts/migrate.ts scripts/migrate-creatives.ts
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore: remove legacy migrate scripts + stale data/courses references

이전 SP0 마이그레이션은 이미 완료 상태이고, 옛 server/data.db 잔재도 2026-04-24 리팩터에서 data/licenses.db로 이전됨. README/ARCHITECTURE의 관련 문구도 정리.
EOF
)"
```

- [ ] **Step 4: 상태 확인**

```bash
git status --short
```

Expected: 빈 출력 (또는 `.claude/scheduled_tasks.lock` 같은 untracked만).

---

## Commit 1: 인터페이스 정리 (Section 4 of spec)

전체 commit 범위:
- `Creative.copy.metaAssetLabel` → `assetLabel`
- `VariantReport.metaAssetLabel` → `assetLabel`
- `VariantReport.{adQualityRanking,adEngagementRanking,adConversionRanking}` → `VariantReport.platformMetrics: { meta?: {qualityRanking, engagementRanking, conversionRanking}; tiktok?: ...; google?: ... }`
- `VariantAggregate.{adQualityRanking,...}` → `VariantAggregate.{qualityRanking,...}` (flat, Meta-aware 유지)
- `LaunchResult.externalIds: {campaign,adSet,ad}` → `Record<string,string>`
- `Campaign.{metaCampaignId,metaAdSetId,metaAdId,metaAdCreativeId?}` → `Campaign.externalIds: Record<string,string>`

### Task 1.1: `metaAssetLabel` → `assetLabel` rename

**Files:**
- Modify: `packages/core/src/types.ts` (Creative.copy)
- Modify: `packages/core/src/platform/types.ts` (VariantReport)
- Modify: `packages/core/src/platform/meta/assetFeedSpec.ts:34`
- Modify: `packages/core/src/platform/meta/breakdown.ts:50`
- Modify: `packages/core/src/creative/copy.ts:39`
- Modify: `packages/cli/src/pipeline.ts:87`
- Modify: `packages/cli/src/actions.ts:132`
- Modify: `packages/cli/src/entries/generate.ts:33`
- Test fixtures (별도 step): `types.test.ts`, `reviewer/decisions.test.ts`, `launch/groupApproval.test.ts`, `platform/meta/breakdown.test.ts`, `platform/meta/assetFeedSpec.test.ts`, `rag/qualifyJob.test.ts`, `rag/qualifier.test.ts`, `cli/src/tui/monitor/metrics.test.ts`

- [ ] **Step 1: `Creative.copy` 타입 변경**

`packages/core/src/types.ts` 라인 19-28 — `Creative` 인터페이스의 `copy.metaAssetLabel` 필드를 `assetLabel`로 rename + JSDoc:

```ts
copy: {
  headline: string;
  body: string;
  cta: string;
  hashtags: string[];
  variantLabel: "emotional" | "numerical" | "urgency"; // Plan A 신규 (Plan A는 "emotional" 기본값)
  /** 변형 식별자. Meta DCO에서 `asset_feed_spec.bodies/titles[].adlabels.name`으로 사용되어
   *  per-asset insights breakdown 키가 됨. 다른 플랫폼은 실 통합 시 사용처를 매핑한다. */
  assetLabel: string;
};
```

- [ ] **Step 2: `VariantReport` 타입 변경**

`packages/core/src/platform/types.ts` 라인 30 — `metaAssetLabel: string;` → `assetLabel: string;`:

```ts
export interface VariantReport {
  id: string;
  campaignId: string;
  variantGroupId: string;
  variantLabel: string;
  assetLabel: string;
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
```

(Task 1.2에서 ranking 필드를 `platformMetrics`로 이동. 이번 step은 rename만.)

- [ ] **Step 3: TypeScript 컴파일 에러 확인**

```bash
npm test 2>&1 | head -40
```

Expected: 다수 파일에서 "Property 'metaAssetLabel' does not exist on type" 에러. 다음 step들에서 일괄 수정.

- [ ] **Step 4: `assetFeedSpec.ts` 수정**

`packages/core/src/platform/meta/assetFeedSpec.ts:34`:

```ts
// Before
adlabels: [{ name: c.copy.metaAssetLabel }],

// After
adlabels: [{ name: c.copy.assetLabel }],
```

- [ ] **Step 5: `meta/breakdown.ts` 수정**

`packages/core/src/platform/meta/breakdown.ts:50`:

```ts
// Before
metaAssetLabel: match.copy.metaAssetLabel,

// After
assetLabel: match.copy.assetLabel,
```

- [ ] **Step 6: `creative/copy.ts` 수정**

`packages/core/src/creative/copy.ts:39`:

```ts
// Before
metaAssetLabel: "", // 호출자가 Creative를 조립할 때 채움

// After
assetLabel: "", // 호출자가 Creative를 조립할 때 채움
```

- [ ] **Step 7: CLI 호출처 3개 일괄 수정**

`packages/cli/src/pipeline.ts:87`:

```ts
// Before
metaAssetLabel: `${variantGroupId}::${label}`,

// After
assetLabel: `${variantGroupId}::${label}`,
```

`packages/cli/src/actions.ts:132`:

```ts
// Before
copy: { ...data, variantLabel: label, metaAssetLabel: `${variantGroupId}::${label}` },

// After
copy: { ...data, variantLabel: label, assetLabel: `${variantGroupId}::${label}` },
```

`packages/cli/src/entries/generate.ts:33`:

```ts
// Before
metaAssetLabel: `${variantGroupId}::${label}`,

// After
assetLabel: `${variantGroupId}::${label}`,
```

- [ ] **Step 8: 테스트 fixtures 일괄 수정 (8 파일)**

각 파일에서 `metaAssetLabel` 검색하여 `assetLabel`로 치환:

```bash
grep -rn "metaAssetLabel" packages/ --include="*.test.ts"
```

Expected before: 15건. 각 위치를 확인하며 `metaAssetLabel:` → `assetLabel:`, `.metaAssetLabel` → `.assetLabel`로 치환.

대상 파일:
- `packages/core/src/types.test.ts:38, 49, 58` (Creative.copy fixture + assertion)
- `packages/core/src/reviewer/decisions.test.ts:18` (fixture)
- `packages/core/src/launch/groupApproval.test.ts:24` (mkCreative helper)
- `packages/core/src/platform/meta/breakdown.test.ts:12, 40` (mockCreative + assertion)
- `packages/core/src/platform/meta/assetFeedSpec.test.ts:21, 93, 133` (fixture)
- `packages/core/src/rag/qualifyJob.test.ts:26, 57` (fixture)
- `packages/core/src/rag/qualifier.test.ts:20, 170` (mkReport + mkCreative)
- `packages/cli/src/tui/monitor/metrics.test.ts:6` (fixture)

- [ ] **Step 9: 테스트 실행 — green 확인**

```bash
npm test 2>&1 | tail -20
```

Expected: 335 tests passing (변경 없음 — 동작 동일, 필드 이름만).

### Task 1.2: Ranking 필드를 `platformMetrics.meta.*`로 이동

**Files:**
- Modify: `packages/core/src/platform/types.ts` (VariantReport — add platformMetrics, remove 3 ranking fields)
- Modify: `packages/core/src/rag/types.ts` (VariantAggregate — rename ranking fields)
- Modify: `packages/core/src/platform/meta/breakdown.ts` (parseBodyAssetBreakdown emits platformMetrics)
- Modify: `packages/core/src/rag/qualifier.ts` (aggregator + passesThreshold)
- Modify: `packages/core/src/platform/meta/breakdown.test.ts` (assertions)
- Modify: `packages/core/src/rag/qualifier.test.ts` (~10 fixtures)
- Modify: `packages/core/src/rag/qualifyJob.test.ts` (1 fixture)
- Modify: `packages/cli/src/tui/monitor/metrics.test.ts` (1 fixture)

- [ ] **Step 1: `VariantReport` 타입 — platformMetrics 추가, ranking 3개 제거**

`packages/core/src/platform/types.ts`:

```ts
export interface VariantReport {
  id: string;
  campaignId: string;
  variantGroupId: string;
  variantLabel: string;
  assetLabel: string;
  productId: string;
  platform: string;
  date: string;
  impressions: number;
  clicks: number;
  inlineLinkClickCtr: number;
  /**
   * 플랫폼 고유 지표. 키는 platform 식별자.
   * Meta: { qualityRanking, engagementRanking, conversionRanking } (각 string|null,
   *       e.g., "AVERAGE", "BELOW_AVERAGE_20_30", "ABOVE_AVERAGE", "UNKNOWN")
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

- [ ] **Step 2: `VariantAggregate` 타입 — 필드 이름 정리 (Meta-aware 유지)**

`packages/core/src/rag/types.ts`:

```ts
export interface VariantAggregate {
  campaignId: string;
  variantLabel: string;
  variantGroupId: string;
  productId: string;
  impressions: number;
  clicks: number;
  inlineLinkClickCtr: number;
  /** Meta-specific. 두 번째 어댑터의 quality signal 추가 시 platform-aware 흐름으로 일반화. */
  qualityRanking: string | null;
  engagementRanking: string | null;
  conversionRanking: string | null;
}
```

- [ ] **Step 3: `meta/breakdown.ts` 수정 — platformMetrics 형태로 emit**

`packages/core/src/platform/meta/breakdown.ts`의 `parseBodyAssetBreakdown` 함수 안 (라인 42-62 부근):

```ts
const report: VariantReport = {
  id: `${campaignId}::${match.copy.variantLabel}::${date}`,
  campaignId,
  variantGroupId: match.variantGroupId,
  variantLabel: match.copy.variantLabel,
  assetLabel: match.copy.assetLabel,
  productId,
  platform,
  date,
  impressions: Number(row.impressions ?? 0),
  clicks: Number(row.clicks ?? 0),
  inlineLinkClickCtr: Number(row.inline_link_click_ctr ?? 0),
  platformMetrics: {
    meta: {
      qualityRanking: row.quality_ranking ?? null,
      engagementRanking: row.engagement_rate_ranking ?? null,
      conversionRanking: row.conversion_rate_ranking ?? null,
    },
  },
};
```

- [ ] **Step 4: `rag/qualifier.ts` 수정 — aggregator + passesThreshold**

`packages/core/src/rag/qualifier.ts`의 `aggregateVariantReports` 함수 (라인 6-32):

```ts
export function aggregateVariantReports(reports: VariantReport[]): VariantAggregate[] {
  const byKey = new Map<string, VariantAggregate>();
  for (const r of reports) {
    const key = `${r.campaignId}::${r.variantLabel}`;
    const cur = byKey.get(key);
    if (cur) {
      cur.impressions += r.impressions;
      cur.clicks += r.clicks;
      cur.inlineLinkClickCtr =
        cur.impressions === 0 ? 0 : cur.clicks / cur.impressions;
    } else {
      const meta = r.platformMetrics?.meta;
      byKey.set(key, {
        campaignId: r.campaignId,
        variantLabel: r.variantLabel,
        variantGroupId: r.variantGroupId,
        productId: r.productId,
        impressions: r.impressions,
        clicks: r.clicks,
        inlineLinkClickCtr:
          r.impressions === 0 ? 0 : r.clicks / r.impressions,
        qualityRanking: meta?.qualityRanking ?? null,
        engagementRanking: meta?.engagementRanking ?? null,
        conversionRanking: meta?.conversionRanking ?? null,
      });
    }
  }
  return Array.from(byKey.values());
}
```

`passesThreshold` 함수 (라인 47-53):

```ts
export function passesThreshold(
  agg: VariantAggregate,
  medianCtr: number,
): boolean {
  if (agg.impressions < MIN_IMPRESSIONS) return false;
  if (agg.qualityRanking?.startsWith("BELOW_AVERAGE")) return false;
  if (agg.engagementRanking?.startsWith("BELOW_AVERAGE")) return false;
  if (agg.inlineLinkClickCtr < medianCtr) return false;
  return true;
}
```

- [ ] **Step 5: `breakdown.test.ts` assertion 수정**

`packages/core/src/platform/meta/breakdown.test.ts:43, 107, 108` — 각 `reports[N].adQualityRanking` assertion을 nested 형태로:

```ts
// Before
expect(reports[0].adQualityRanking).toBe("AVERAGE");

// After
expect(reports[0].platformMetrics.meta?.qualityRanking).toBe("AVERAGE");
```

3건 모두 동일 패턴.

- [ ] **Step 6: `qualifier.test.ts` fixture + assertion 수정**

다음 위치 일괄 수정 (mkReport helper + 인라인 fixture + assertion):

`mkReport` helper (라인 14-32):

```ts
function mkReport(overrides: Partial<VariantReport>): VariantReport {
  return {
    id: "r1",
    campaignId: "c1",
    variantGroupId: "g1",
    variantLabel: "emotional",
    assetLabel: "g1::emotional",
    productId: "p1",
    platform: "meta",
    date: "2026-04-20",
    impressions: 100,
    clicks: 2,
    inlineLinkClickCtr: 0.02,
    platformMetrics: {
      meta: {
        qualityRanking: "AVERAGE",
        engagementRanking: "AVERAGE",
        conversionRanking: "AVERAGE",
      },
    },
    ...overrides,
  };
}
```

**중요**: `mkReport`의 `...overrides`가 `platformMetrics`를 통째로 덮어쓰므로, ranking 변경 테스트는 다음 형태로 호출 변경:

```ts
// Before
mkReport({ campaignId: "c1", variantLabel: "emotional", adQualityRanking: "BELOW_AVERAGE_20_30" })

// After
mkReport({
  campaignId: "c1",
  variantLabel: "emotional",
  platformMetrics: { meta: { qualityRanking: "BELOW_AVERAGE_20_30", engagementRanking: "AVERAGE", conversionRanking: "AVERAGE" } }
})
```

다음 위치들에서 `adQualityRanking|adEngagementRanking|adConversionRanking: "..."` 형태의 override가 있으면 모두 위 패턴으로 변경:
- 라인 51, 52 (aggregate 테스트)
- 라인 55 (assertion: `agg[0].adQualityRanking` → `agg[0].qualityRanking`)
- 라인 95-104, 109-114, 121-126, 130-135 (passesThreshold 테스트)
- 라인 337-341 (qualifyWinners 테스트)

`passesThreshold` 직접 입력 fixture (인라인 객체)는 `VariantAggregate` 타입이므로 다른 형태:

```ts
// Before
const agg = {
  campaignId: "c1", variantLabel: "emotional", variantGroupId: "g1", productId: "p1",
  impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04,
  adQualityRanking: "BELOW_AVERAGE_20_30", adEngagementRanking: "AVERAGE", adConversionRanking: "AVERAGE",
};

// After
const agg: VariantAggregate = {
  campaignId: "c1", variantLabel: "emotional", variantGroupId: "g1", productId: "p1",
  impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04,
  qualityRanking: "BELOW_AVERAGE_20_30", engagementRanking: "AVERAGE", conversionRanking: "AVERAGE",
};
```

(`VariantAggregate` import는 파일 상단에 이미 있음.)

- [ ] **Step 7: `qualifyJob.test.ts` fixture 수정**

`packages/core/src/rag/qualifyJob.test.ts:60-67`의 `mkReport` helper:

```ts
function mkReport(overrides: Partial<VariantReport>): VariantReport {
  return {
    id: "r1",
    campaignId: "c1",
    variantGroupId: "g1",
    variantLabel: "emotional",
    assetLabel: "g1::emotional",
    productId: "p1",
    platform: "meta",
    date: "2026-04-20",
    impressions: 1000,
    clicks: 40,
    inlineLinkClickCtr: 0.04,
    platformMetrics: {
      meta: {
        qualityRanking: "AVERAGE",
        engagementRanking: "AVERAGE",
        conversionRanking: "AVERAGE",
      },
    },
    ...overrides,
  };
}
```

- [ ] **Step 8: `monitor/metrics.test.ts` fixture 수정**

`packages/cli/src/tui/monitor/metrics.test.ts:5-10`:

```ts
const r = (id: string, impressions: number, clicks: number, ctr: number): VariantReport => ({
  id, campaignId: "c", variantGroupId: "g", variantLabel: "A", assetLabel: "m",
  productId: "p", platform: "meta", date: "2026-04-20",
  impressions, clicks, inlineLinkClickCtr: ctr,
  platformMetrics: { meta: { qualityRanking: null, engagementRanking: null, conversionRanking: null } },
});
```

- [ ] **Step 9: 테스트 실행 — green 확인**

```bash
npm test 2>&1 | tail -20
```

Expected: 335 tests passing.

만약 qualifier 케이스 일부 실패하면, mkReport의 ranking override 호출 형태(Step 6)가 일부 누락된 것. grep으로 확인:

```bash
grep -n "adQualityRanking\|adEngagementRanking\|adConversionRanking" packages/core/src/rag/qualifier.test.ts
```

Expected: 0건 (모두 변환 완료).

### Task 1.3: `LaunchResult.externalIds` + `Campaign.externalIds` 일반화

**Files:**
- Modify: `packages/core/src/platform/types.ts` (LaunchResult)
- Modify: `packages/core/src/types.ts` (Campaign)
- Modify: `packages/core/src/platform/meta/launcher.ts` (성공 + launch_failed 두 path)
- Modify: `packages/core/src/platform/meta/adapter.ts` (cleanup)
- Modify: `packages/core/src/platform/meta/monitor.ts` (Ad ID 접근)
- Modify: `packages/core/src/types.test.ts` (Campaign fixture)
- Modify: `packages/cli/src/actions.test.ts` (LaunchResult mock)

- [ ] **Step 1: `LaunchResult` 타입 변경**

`packages/core/src/platform/types.ts` 라인 10-18:

```ts
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

- [ ] **Step 2: `Campaign` 타입 변경**

`packages/core/src/types.ts` 라인 33-46 — 4개 meta 필드 제거 + `externalIds` 추가:

```ts
export interface Campaign {
  id: string;
  variantGroupId: string;
  productId: string;
  platform: string;
  /**
   * 플랫폼별 외부 리소스 ID 맵.
   * Meta: { campaign, adSet, ad, creative? }
   * TikTok / Google: 실 통합 시 정의.
   */
  externalIds: Record<string, string>;
  launchedAt: string;
  status: "active" | "paused" | "completed" | "launch_failed" | "externally_modified";
  orphans: { type: "campaign" | "adset" | "ad" | "creative"; id: string }[];
}
```

- [ ] **Step 3: `meta/launcher.ts` 성공 path 수정 (라인 144-160)**

```ts
// Before
const campaignRecord = {
  id: randomUUID(),
  variantGroupId: group.variantGroupId,
  productId: group.product.id,
  platform: "meta" as const,
  metaCampaignId: campaign.id as string,
  metaAdSetId: adSet.id as string,
  metaAdId: ad.id as string,
  metaAdCreativeId: adCreative.id as string,
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

// After
const externalIds: Record<string, string> = {
  campaign: campaign.id as string,
  adSet: adSet.id as string,
  ad: ad.id as string,
  creative: adCreative.id as string,
};
const campaignRecord = {
  id: randomUUID(),
  variantGroupId: group.variantGroupId,
  productId: group.product.id,
  platform: "meta" as const,
  externalIds,
  launchedAt: new Date().toISOString(),
  status: "paused" as const,
  orphans: [],
};
await writeJson(`data/campaigns/${campaignRecord.id}.json`, campaignRecord);

return {
  campaignId: campaignRecord.id,
  platform: "meta",
  externalIds,
};
```

- [ ] **Step 4: `meta/launcher.ts` launch_failed path 수정 (라인 175-189)**

```ts
// Before
const idOf = (t: CreatedResource["type"]): string =>
  created.find((r) => r.type === t)?.id ?? "";
const failedRecord = {
  id: randomUUID(),
  variantGroupId: group.variantGroupId,
  productId: group.product.id,
  platform: "meta" as const,
  metaCampaignId: idOf("campaign"),
  metaAdSetId: idOf("adset"),
  metaAdId: idOf("ad"),
  metaAdCreativeId: idOf("creative"),
  launchedAt: new Date().toISOString(),
  status: "launch_failed" as const,
  orphans: cleanupResult.orphans,
};
await writeJson(`data/campaigns/${failedRecord.id}.json`, failedRecord);

// After
const idOf = (t: CreatedResource["type"]): string =>
  created.find((r) => r.type === t)?.id ?? "";
const failedExternalIds: Record<string, string> = {};
const cId = idOf("campaign"); if (cId) failedExternalIds.campaign = cId;
const asId = idOf("adset"); if (asId) failedExternalIds.adSet = asId;
const aId = idOf("ad"); if (aId) failedExternalIds.ad = aId;
const crId = idOf("creative"); if (crId) failedExternalIds.creative = crId;
const failedRecord = {
  id: randomUUID(),
  variantGroupId: group.variantGroupId,
  productId: group.product.id,
  platform: "meta" as const,
  externalIds: failedExternalIds,
  launchedAt: new Date().toISOString(),
  status: "launch_failed" as const,
  orphans: cleanupResult.orphans,
};
await writeJson(`data/campaigns/${failedRecord.id}.json`, failedRecord);
```

빈 문자열 ID는 externalIds에 포함하지 않음 — rollback이 일부만 성공한 상태에서 빈 ID는 의미 없는 노이즈.

- [ ] **Step 5: `meta/adapter.ts` cleanup 수정 (라인 25-39)**

```ts
async cleanup(campaignId: string): Promise<CleanupResult> {
  (bizSdk as any).FacebookAdsApi.init(requireMeta().access_token);
  const campaign = await readJson<any>(`data/campaigns/${campaignId}.json`);
  if (!campaign) return { deleted: [], orphans: [] };

  const ext: Record<string, string> = campaign.externalIds ?? {};
  const created: { type: "campaign" | "adset" | "ad" | "creative"; id: string }[] = [];
  if (ext.campaign) created.push({ type: "campaign", id: ext.campaign });
  if (ext.adSet) created.push({ type: "adset", id: ext.adSet });
  if (ext.creative) created.push({ type: "creative", id: ext.creative });
  if (ext.ad) created.push({ type: "ad", id: ext.ad });

  const result = await executeRollback({ created, deleter: deleteMetaResource });
  await appendOrphansToDisk(result.orphans, writeJson, readJson);
  return result;
},
```

- [ ] **Step 6: `meta/monitor.ts` 수정 (라인 43)**

```ts
// Before
const ad = new Ad(campaign.metaAdId);

// After
const ad = new Ad(campaign.externalIds?.ad);
```

- [ ] **Step 7: `types.test.ts` Campaign fixture 수정 (라인 65-77)**

```ts
describe("Campaign (Plan A extensions)", () => {
  it("has variantGroupId, platform, externalIds map, orphans", () => {
    const c: Campaign = {
      id: "cam1",
      variantGroupId: "g1",
      productId: "p1",
      platform: "meta",
      externalIds: {
        campaign: "meta-c1",
        adSet: "meta-as1",
        ad: "meta-ad1",
      },
      launchedAt: "2026-04-20T00:00:00.000Z",
      status: "active",
      orphans: [],
    };
    expect(c.platform).toBe("meta");
    expect(c.externalIds.ad).toBe("meta-ad1");
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

- [ ] **Step 8: `actions.test.ts` mock 수정 (라인 94)**

```ts
// Before
return { campaignId: "c1", platform: "meta", externalIds: { campaign: "ext", adSet: "a", ad: "d" } };

// After (변경 없음 — `Record<string, string>`은 위 객체와 호환)
return { campaignId: "c1", platform: "meta", externalIds: { campaign: "ext", adSet: "a", ad: "d" } };
```

(타입 호환성만 확인. 코드 변경 불필요.)

- [ ] **Step 9: 테스트 실행 — green 확인**

```bash
npm test 2>&1 | tail -20
```

Expected: 335 tests passing.

`grep` 으로 잔여 references 없음 확인:

```bash
grep -rn "metaCampaignId\|metaAdSetId\|metaAdId\b\|metaAdCreativeId" packages/ --include="*.ts" | grep -v "\.test\.ts"
```

Expected: 0건. (테스트 파일은 이미 위에서 정리.)

### Task 1.4: meta-platform-expert subagent 검토

CLAUDE.md "Subagent 호출 규칙" — `packages/core/src/platform/meta/*` 파일 4개 (launcher.ts, adapter.ts, monitor.ts, breakdown.ts) 수정 → meta-platform-expert 호출 필수.

- [ ] **Step 1: 변경 diff 확보**

```bash
git diff --stat
git diff packages/core/src/platform/meta/launcher.ts packages/core/src/platform/meta/adapter.ts packages/core/src/platform/meta/monitor.ts packages/core/src/platform/meta/breakdown.ts > /tmp/meta-diff.txt
wc -l /tmp/meta-diff.txt
```

- [ ] **Step 2: Subagent 호출**

`Agent` 도구로 `meta-platform-expert` 호출. 프롬프트에 다음 포함:

- 변경 목적 (interface 일반화 — Section 4 of spec)
- 4개 파일의 diff 전문 (위 diff 출력)
- spec 경로: `docs/superpowers/specs/2026-04-25-multi-platform-adapter-design.md`
- 검토 요청 항목:
  1. `executeRollback`에 전달되는 `created[]` 순서가 기존(campaign → adset → creative → ad)과 동일한지
  2. `launch_failed` path에서 빈 string ID를 externalIds에서 누락시킨 변경이 cleanup 흐름에 안전한지 (빈 ID로 DELETE 호출하면 Meta API가 에러 반환)
  3. `monitor.ts`의 `new Ad(campaign.externalIds?.ad)`에서 undefined 가능성 (externally_modified로 마킹된 외부 수정 캠페인) 처리 검토
  4. `asset_feed_spec.bodies[].adlabels.name` 키가 `assetLabel` 변경 후에도 Meta DCO breakdown에 일관되게 전달되는지

- [ ] **Step 3: 발견 이슈 처리**

- Critical / Important: 해당 step에서 즉시 수정 → `npm test` 그린 재확인 → 재검토 1회
- Minor: `docs/STATUS.md`의 "알려진 결함" 추가 (Commit 4에서 일괄 처리)

### Task 1.5: code-reviewer subagent 검토

- [ ] **Step 1: code-reviewer 호출**

`Agent` 도구로 `superpowers:code-reviewer` 호출:
- 변경 범위: Task 1.1 + 1.2 + 1.3
- 검토 기준: spec `§4` (Section 4 of design)
- 코딩 표준: CLAUDE.md "환경변수 정책", "Helper 배치 규칙"

- [ ] **Step 2: 발견 이슈 처리** (위와 동일)

### Task 1.6: Commit 1

- [ ] **Step 1: 변경 파일 목록 재확인**

```bash
git status --short
```

Expected: ~15 modified files (소스 8 + 테스트 7 또는 8).

- [ ] **Step 2: 명시적 add (-A 사용 금지)**

```bash
git add packages/core/src/types.ts packages/core/src/platform/types.ts \
  packages/core/src/platform/meta/launcher.ts packages/core/src/platform/meta/adapter.ts \
  packages/core/src/platform/meta/monitor.ts packages/core/src/platform/meta/breakdown.ts \
  packages/core/src/platform/meta/assetFeedSpec.ts packages/core/src/creative/copy.ts \
  packages/core/src/rag/types.ts packages/core/src/rag/qualifier.ts \
  packages/cli/src/pipeline.ts packages/cli/src/actions.ts \
  packages/cli/src/entries/generate.ts \
  packages/core/src/types.test.ts packages/core/src/reviewer/decisions.test.ts \
  packages/core/src/launch/groupApproval.test.ts \
  packages/core/src/platform/meta/breakdown.test.ts \
  packages/core/src/platform/meta/assetFeedSpec.test.ts \
  packages/core/src/rag/qualifyJob.test.ts packages/core/src/rag/qualifier.test.ts \
  packages/cli/src/tui/monitor/metrics.test.ts
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(platform): generalize AdPlatform interface for multi-platform support

- Creative.copy.metaAssetLabel → assetLabel (every platform has variant labels)
- VariantReport ranking fields → platformMetrics.meta.{qualityRanking,engagementRanking,conversionRanking}
- VariantAggregate flat ranking 이름 정리 (qualityRanking 등) — Meta-aware 흐름 유지
- LaunchResult.externalIds → Record<string, string> (well-known keys: campaign, ad)
- Campaign.{metaCampaignId,metaAdSetId,metaAdId,metaAdCreativeId} → externalIds: Record<string, string>

data/ 비어있는 시점에 인터페이스 정리. 영속 데이터 마이그레이션 zero. Meta 동작은 외부 관찰자 입장에서 동일.

Spec: docs/superpowers/specs/2026-04-25-multi-platform-adapter-design.md §4
EOF
)"
```

- [ ] **Step 4: 테스트 재확인**

```bash
npm test 2>&1 | tail -5
```

Expected: 335 tests passing.

---

## Commit 2: Scaffold 디렉토리 (Section 5 of spec)

### Task 2.1: 공유 helper `notImplemented.ts` + 테스트

**Files:**
- Create: `packages/core/src/platform/notImplemented.ts`
- Create: `packages/core/src/platform/notImplemented.test.ts`

- [ ] **Step 1: 실패 테스트 먼저 작성**

`packages/core/src/platform/notImplemented.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { notImplemented } from "./notImplemented.js";

describe("notImplemented", () => {
  it("throws Error with platform name and method", () => {
    expect(() => notImplemented("tiktok", "launch")).toThrow(
      /\[tiktok\] launch — scaffold only/i,
    );
  });

  it("includes README pointer in message", () => {
    try {
      notImplemented("google", "fetchReports");
    } catch (e) {
      expect((e as Error).message).toContain(
        "packages/core/src/platform/google/README.md",
      );
    }
  });
});
```

- [ ] **Step 2: 테스트 실행 — fail 확인**

```bash
npx vitest run packages/core/src/platform/notImplemented.test.ts 2>&1 | tail -10
```

Expected: FAIL — `notImplemented.js` 파일 없음.

- [ ] **Step 3: 구현**

`packages/core/src/platform/notImplemented.ts`:

```ts
/**
 * Scaffold 어댑터에서 미구현 메서드를 호출 시 throw하는 표준 헬퍼.
 * 메시지에 platform 이름 + method + README 포인터 포함.
 */
export function notImplemented(platform: string, method: string): never {
  throw new Error(
    `[${platform}] ${method} — scaffold only, not yet implemented. ` +
    `See packages/core/src/platform/${platform}/README.md for integration plan.`,
  );
}
```

- [ ] **Step 4: 테스트 실행 — green 확인**

```bash
npx vitest run packages/core/src/platform/notImplemented.test.ts 2>&1 | tail -10
```

Expected: 2 tests passing.

### Task 2.2: TikTok scaffold 디렉토리

**Files:**
- Create: `packages/core/src/platform/tiktok/adapter.ts`
- Create: `packages/core/src/platform/tiktok/launcher.ts`
- Create: `packages/core/src/platform/tiktok/monitor.ts`
- Create: `packages/core/src/platform/tiktok/adapter.test.ts`
- Create: `packages/core/src/platform/tiktok/README.md`

- [ ] **Step 1: 실패 테스트 작성 (smoke + NotImplemented)**

`packages/core/src/platform/tiktok/adapter.test.ts`:

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
    await expect(adapter.fetchReports("c", "2026-04-25")).rejects.toThrow(
      /scaffold only/i,
    );
  });

  it("cleanup throws NotImplemented", async () => {
    const adapter = createTiktokAdapter();
    await expect(adapter.cleanup("c")).rejects.toThrow(/scaffold only/i);
  });
});
```

- [ ] **Step 2: 테스트 실행 — fail 확인**

```bash
npx vitest run packages/core/src/platform/tiktok/ 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: `launcher.ts` 작성**

`packages/core/src/platform/tiktok/launcher.ts`:

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
  _onLog?: (log: LaunchLog) => void,
): Promise<LaunchResult> {
  notImplemented("tiktok", "launchTiktokAco");
}
```

- [ ] **Step 4: `monitor.ts` 작성**

`packages/core/src/platform/tiktok/monitor.ts`:

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
  _date: string,
): Promise<VariantReport[]> {
  notImplemented("tiktok", "fetchTiktokVariantReports");
}
```

- [ ] **Step 5: `adapter.ts` 작성**

`packages/core/src/platform/tiktok/adapter.ts`:

```ts
import type {
  AdPlatform,
  VariantGroup,
  LaunchResult,
  VariantReport,
  CleanupResult,
  LaunchLog,
} from "../types.js";
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

- [ ] **Step 6: README 작성**

`packages/core/src/platform/tiktok/README.md`:

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

- [ ] **Step 7: 테스트 실행 — green 확인**

```bash
npx vitest run packages/core/src/platform/tiktok/ 2>&1 | tail -10
```

Expected: 4 tests passing.

### Task 2.3: Google scaffold 디렉토리

**Files:**
- Create: `packages/core/src/platform/google/adapter.ts`
- Create: `packages/core/src/platform/google/launcher.ts`
- Create: `packages/core/src/platform/google/monitor.ts`
- Create: `packages/core/src/platform/google/adapter.test.ts`
- Create: `packages/core/src/platform/google/README.md`

- [ ] **Step 1: 실패 테스트 작성**

`packages/core/src/platform/google/adapter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createGoogleAdapter } from "./adapter.js";

describe("createGoogleAdapter", () => {
  it("returns AdPlatform with name=google", () => {
    const adapter = createGoogleAdapter();
    expect(adapter.name).toBe("google");
    expect(typeof adapter.launch).toBe("function");
    expect(typeof adapter.fetchReports).toBe("function");
    expect(typeof adapter.cleanup).toBe("function");
  });

  it("launch throws NotImplemented", async () => {
    const adapter = createGoogleAdapter();
    await expect(adapter.launch({} as any)).rejects.toThrow(/scaffold only/i);
  });

  it("fetchReports throws NotImplemented", async () => {
    const adapter = createGoogleAdapter();
    await expect(adapter.fetchReports("c", "2026-04-25")).rejects.toThrow(
      /scaffold only/i,
    );
  });

  it("cleanup throws NotImplemented", async () => {
    const adapter = createGoogleAdapter();
    await expect(adapter.cleanup("c")).rejects.toThrow(/scaffold only/i);
  });
});
```

- [ ] **Step 2: 테스트 실행 — fail 확인**

```bash
npx vitest run packages/core/src/platform/google/ 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: `launcher.ts` 작성**

`packages/core/src/platform/google/launcher.ts`:

```ts
import type { VariantGroup, LaunchResult, LaunchLog } from "../types.js";
import { notImplemented } from "../notImplemented.js";

/**
 * Google Ads 캠페인 런칭. PMax + Video 캠페인 통합 진입점.
 * YouTube ads는 PMax의 video assets 또는 별도 Video campaign type으로 처리.
 * SDK / API 매핑은 README 참조.
 */
export async function launchGoogleAds(
  _group: VariantGroup,
  _onLog?: (log: LaunchLog) => void,
): Promise<LaunchResult> {
  notImplemented("google", "launchGoogleAds");
}
```

- [ ] **Step 4: `monitor.ts` 작성**

`packages/core/src/platform/google/monitor.ts`:

```ts
import type { VariantReport } from "../types.js";
import { notImplemented } from "../notImplemented.js";

/**
 * Google Ads 캠페인의 일별 asset/variant 단위 report 회수.
 * 반환 VariantReport[]는 캠페인 안의 각 asset/variant 1행씩.
 * platformMetrics.google 필드에 Google 고유 지표 매핑 (실 통합 시 정의).
 */
export async function fetchGoogleVariantReports(
  _campaignId: string,
  _date: string,
): Promise<VariantReport[]> {
  notImplemented("google", "fetchGoogleVariantReports");
}
```

- [ ] **Step 5: `adapter.ts` 작성**

`packages/core/src/platform/google/adapter.ts`:

```ts
import type {
  AdPlatform,
  VariantGroup,
  LaunchResult,
  VariantReport,
  CleanupResult,
  LaunchLog,
} from "../types.js";
import { launchGoogleAds } from "./launcher.js";
import { fetchGoogleVariantReports } from "./monitor.js";
import { notImplemented } from "../notImplemented.js";

export function createGoogleAdapter(): AdPlatform {
  return {
    name: "google",
    async launch(group: VariantGroup, onLog?: (l: LaunchLog) => void): Promise<LaunchResult> {
      return launchGoogleAds(group, onLog);
    },
    async fetchReports(campaignId: string, date: string): Promise<VariantReport[]> {
      return fetchGoogleVariantReports(campaignId, date);
    },
    async cleanup(_campaignId: string): Promise<CleanupResult> {
      notImplemented("google", "cleanup");
    },
  };
}
```

- [ ] **Step 6: README 작성**

`packages/core/src/platform/google/README.md`:

```markdown
# Google Ads Adapter (Scaffold)

## Status
**Scaffold only — runtime calls throw NotImplementedError.**

YouTube ads는 본 어댑터를 통해 처리한다 (Google Ads API의 PMax/Video 캠페인). 별도 `youtube/` 어댑터를 만들지 않는다.

## Implementation Plan
실 통합 시 이 README를 따라 진행.

## 1. SDK / Dependencies
- npm: `google-ads-api` (또는 official `google-ads-nodejs-client`)
- API doc: https://developers.google.com/google-ads/api/docs/start

## 2. Required Config (`[platforms.google]`)
- `developer_token` — Google Ads developer token
- `customer_id` — Google Ads CID (format: 123-456-7890)
- (실 통합 시 OAuth credentials: client_id, client_secret, refresh_token 추가)

## 3. Authentication Flow
[research needed] — Google Ads API OAuth 2.0:
- 옵션 A: User OAuth (refresh_token 기반)
- 옵션 B: Service account (Manager Account 권한 필요)
- 옵션별 setup 절차 비교 후 결정

## 4. Resource Hierarchy (vs Meta)
| Meta | Google Ads (PMax) | externalIds 키 |
|---|---|---|
| Campaign | Campaign | `campaign` |
| Ad Set | Asset Group | `adGroup` (또는 `assetGroup`) |
| Ad | Ad | `ad` |
| Ad Creative | Asset | `asset` |

## 5. PMax Asset Group 매핑
Performance Max 캠페인은 asset_group 단위로 멀티 asset (headlines, descriptions, images, videos) 운영. Meta DCO `asset_feed_spec` 등가물:
- [research needed] — Google Ads API의 `AssetGroupOperation` / `AssetGroupAssetOperation` 사용 형태
- variant breakdown reporting은 asset 단위로 가능한지 확인

## 6. YouTube Placement
PMax 캠페인은 YouTube placement를 자동 포함 (video assets 업로드 시):
- [research needed] — video asset upload 흐름
- 별도 Video campaign type (vs PMax)을 사용할지 결정 필요

## 7. Reporting Breakdown
- [research needed] — `GoogleAdsService.search` 또는 `Stream` 으로 asset-level metrics 회수
- VariantReport.platformMetrics.google 매핑 형태 결정 (Quality Score 등)

## 8. Implementation Checklist
- [ ] `google-ads-api` 설치 + `package.json` 등록
- [ ] `[platforms.google]` Zod schema 확장 (OAuth 필드 추가)
- [ ] `launcher.ts`: `launchGoogleAds()` 본체 — PMax campaign + asset group 생성
- [ ] `monitor.ts`: `fetchGoogleVariantReports()` — asset-level breakdown 매핑
- [ ] `adapter.ts`: `cleanup()` 본체 — Google Ads remove operation + rollback 패턴
- [ ] `breakdown.ts` 신설 (Meta 참조)
- [ ] 에러 분류 함수 (`classifyGoogleAdsError`) 신설
- [ ] `registry.ts`의 `NOT_YET_IMPLEMENTED` 집합에서 "google" 제거 + dynamic import 분기 추가
- [ ] `adapter.test.ts`: NotImplemented 테스트 → 실 동작 테스트로 교체
- [ ] YouTube placement: 별도 launch flag (group.options.youtube?) vs PMax 자동 포함 — 결정 후 문서화
- [ ] schema regex 강화 시 기존 사용자 config 호환성 확인
```

- [ ] **Step 7: 테스트 실행 — green 확인**

```bash
npx vitest run packages/core/src/platform/google/ 2>&1 | tail -10
```

Expected: 4 tests passing.

### Task 2.4: 전체 테스트 + code-reviewer + Commit 2

- [ ] **Step 1: 전체 테스트 실행**

```bash
npm test 2>&1 | tail -10
```

Expected: 335 (Commit 1 후) + 9 (notImplemented 1 + tiktok 4 + google 4) = **344 tests passing**.

- [ ] **Step 2: code-reviewer 호출**

`Agent` 도구로 `superpowers:code-reviewer`:
- 변경 범위: Task 2.1 + 2.2 + 2.3 (신규 디렉토리 + 파일 11개)
- 검토 기준: spec `§5`
- 추가 확인: tiktok/adapter.ts와 google/adapter.ts 구조 대칭성, README의 [research needed] 표지 일관성

- [ ] **Step 3: 발견 이슈 처리**

- [ ] **Step 4: 명시적 add**

```bash
git add packages/core/src/platform/notImplemented.ts \
  packages/core/src/platform/notImplemented.test.ts \
  packages/core/src/platform/tiktok/ \
  packages/core/src/platform/google/
```

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(platform): add TikTok/Google scaffold adapters with NotImplemented stubs

- packages/core/src/platform/notImplemented.ts: 공유 throw helper
- packages/core/src/platform/tiktok/: adapter/launcher/monitor (NotImplemented) + smoke 테스트 4개 + README
- packages/core/src/platform/google/: 동일 구조. YouTube ads는 본 어댑터의 Google Ads PMax 흐름으로 통합 (별도 youtube/ 디렉토리 만들지 않음)

각 어댑터의 README는 실 통합 시 필요한 SDK/OAuth/API/hierarchy 정보를 정리. 미확인 부분은 [research needed] 표지로 명시.

Spec: docs/superpowers/specs/2026-04-25-multi-platform-adapter-design.md §5
EOF
)"
```

- [ ] **Step 6: 테스트 재확인**

```bash
npm test 2>&1 | tail -5
```

Expected: 344 tests passing.

---

## Commit 3: Config + Registry (Section 6 of spec)

### Task 3.1: Schema 확장 (`config/schema.ts`)

**Files:**
- Modify: `packages/core/src/config/schema.ts`
- Modify: `packages/core/src/config/schema.test.ts`

- [ ] **Step 1: 신규 schema 케이스 작성 (실패 먼저)**

`packages/core/src/config/schema.test.ts` 끝에 추가:

```ts
it("rejects when 'tiktok' enabled but [platforms.tiktok] missing", () => {
  const r = ConfigSchema.safeParse({
    platforms: { enabled: ["tiktok"], meta: validBase.platforms.meta },
    ai: { anthropic: { api_key: "k" } },
  });
  expect(r.success).toBe(false);
  if (!r.success) {
    expect(r.error.issues.some((i) => i.path.join(".") === "platforms.tiktok")).toBe(true);
  }
});

it("rejects when 'google' enabled but [platforms.google] missing", () => {
  const r = ConfigSchema.safeParse({
    platforms: { enabled: ["google"], meta: validBase.platforms.meta },
    ai: { anthropic: { api_key: "k" } },
  });
  expect(r.success).toBe(false);
  if (!r.success) {
    expect(r.error.issues.some((i) => i.path.join(".") === "platforms.google")).toBe(true);
  }
});

it("accepts tiktok + meta when both sections present", () => {
  const r = ConfigSchema.safeParse({
    ...validBase,
    platforms: {
      enabled: ["meta", "tiktok"],
      meta: validBase.platforms.meta,
      tiktok: { access_token: "t-tok", advertiser_id: "12345" },
    },
  });
  expect(r.success).toBe(true);
});
```

- [ ] **Step 2: 테스트 실행 — fail 확인**

```bash
npx vitest run packages/core/src/config/schema.test.ts 2>&1 | tail -15
```

Expected: 3 신규 tests fail (현재 schema는 tiktok/google 인식 안 함, 또는 enabled 검증만 통과).

- [ ] **Step 3: schema 수정**

`packages/core/src/config/schema.ts`:

```ts
import { z } from "zod";

const PlatformId = z.enum(["meta", "tiktok", "google"]);

const MetaPlatform = z.object({
  access_token: z.string().min(1),
  ad_account_id: z.string().regex(/^act_\d+$/, 'must be "act_" + digits'),
  page_id: z.string().regex(/^\d+$/),
  instagram_actor_id: z.string().regex(/^\d+$/),
});

// Scaffold 전용 — 필드는 최소만. 실 통합 시 OAuth 등 추가 시 schema 확장.
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

const AiSection = z
  .object({
    anthropic: z.object({ api_key: z.string().min(1) }).optional(),
    google: z.object({ api_key: z.string().min(1) }).optional(),
    voyage: z.object({ api_key: z.string().min(1) }).optional(),
  })
  .default({})
  .superRefine((ai, ctx) => {
    if (!ai.anthropic && !ai.google) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ai"],
        message: "[ai.anthropic] 또는 [ai.google] 중 최소 1개의 api_key가 필요합니다",
      });
    }
  });

const BillingSection = z
  .object({
    stripe: z
      .object({
        secret_key: z.string().min(1),
        webhook_secret: z.string().min(1),
      })
      .optional(),
  })
  .optional();

const ServerSection = z.preprocess(
  (v) => v ?? {},
  z.object({
    base_url: z.string().url().default("http://localhost:3000"),
    port: z.coerce.number().int().positive().default(3000),
  }),
);

const DefaultsSection = z.preprocess(
  (v) => v ?? {},
  z.object({
    daily_budget_krw: z.coerce.number().int().positive().default(10000),
    duration_days: z.coerce.number().int().positive().default(14),
    target_age_min: z.coerce.number().int().min(13).default(20),
    target_age_max: z.coerce.number().int().max(65).default(45),
    ctr_improvement_threshold: z.coerce.number().positive().default(1.5),
  }),
);

export const ConfigSchema = z
  .object({
    platforms: PlatformsSection,
    ai: AiSection,
    billing: BillingSection,
    server: ServerSection,
    defaults: DefaultsSection,
  })
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

export type Config = z.infer<typeof ConfigSchema>;
```

- [ ] **Step 4: 테스트 실행 — green 확인**

```bash
npx vitest run packages/core/src/config/schema.test.ts 2>&1 | tail -10
```

Expected: 모든 케이스 (기존 5 + 신규 3 = 8) passing.

### Task 3.2: Helper 추가 (`config/helpers.ts`)

**Files:**
- Modify: `packages/core/src/config/helpers.ts`
- Modify: `packages/core/src/config/helpers.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`packages/core/src/config/helpers.test.ts` 끝에 추가:

```ts
import { requireTiktok, requireGoogle } from "./helpers.js";

describe("requireTiktok", () => {
  it("returns tiktok config when present", () => {
    const cfg = makeTestConfig({
      platforms: {
        enabled: ["meta", "tiktok"],
        tiktok: { access_token: "t-tok", advertiser_id: "12345" },
      },
    });
    expect(requireTiktok(cfg).access_token).toBe("t-tok");
  });

  it("throws when [platforms.tiktok] missing", () => {
    expect(() => requireTiktok(makeTestConfig())).toThrow(/platforms\.tiktok/);
  });
});

describe("requireGoogle", () => {
  it("returns google config when present", () => {
    const cfg = makeTestConfig({
      platforms: {
        enabled: ["meta", "google"],
        google: { developer_token: "g-tok", customer_id: "123-456-7890" },
      },
    });
    expect(requireGoogle(cfg).developer_token).toBe("g-tok");
  });

  it("throws when [platforms.google] missing", () => {
    expect(() => requireGoogle(makeTestConfig())).toThrow(/platforms\.google/);
  });
});
```

- [ ] **Step 2: 테스트 실행 — fail 확인**

```bash
npx vitest run packages/core/src/config/helpers.test.ts 2>&1 | tail -10
```

Expected: 4 신규 tests fail (`requireTiktok`/`requireGoogle` 미정의).

- [ ] **Step 3: helpers.ts에 추가**

`packages/core/src/config/helpers.ts` 끝에 추가:

```ts
export function requireTiktok(
  cfg: Config = getConfig(),
): NonNullable<Config["platforms"]["tiktok"]> {
  if (!cfg.platforms.tiktok) {
    throw new Error("[platforms.tiktok] is required for this operation");
  }
  return cfg.platforms.tiktok;
}

export function requireGoogle(
  cfg: Config = getConfig(),
): NonNullable<Config["platforms"]["google"]> {
  if (!cfg.platforms.google) {
    throw new Error("[platforms.google] is required for this operation");
  }
  return cfg.platforms.google;
}
```

- [ ] **Step 4: 테스트 실행 — green 확인**

```bash
npx vitest run packages/core/src/config/helpers.test.ts 2>&1 | tail -10
```

Expected: 모든 helpers 테스트 passing.

### Task 3.3: Registry 업데이트 (`platform/registry.ts`)

**Files:**
- Modify: `packages/core/src/platform/registry.ts`
- Modify: `packages/core/src/platform/registry.test.ts`

- [ ] **Step 1: 기존 "rejects unknown platforms" 테스트 교체 + 신규 5 케이스 작성**

`packages/core/src/platform/registry.test.ts` 전체를 다음으로 교체:

```ts
import { describe, it, expect } from "vitest";
import { validatePlatform, activePlatforms } from "./registry.js";
import { setConfigForTesting } from "../config/index.js";
import { makeTestConfig } from "../config/testing.js";

describe("validatePlatform", () => {
  it("returns ok=true when all meta fields present", () => {
    const r = validatePlatform("meta", makeTestConfig());
    expect(r.ok).toBe(true);
  });

  it("returns ok=false with TOML path when meta section missing", () => {
    const r = validatePlatform("meta", makeTestConfig({}, ["platforms.meta"]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("platforms.meta");
  });

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

  it("accepts google when configured", () => {
    const cfg = makeTestConfig({
      platforms: {
        enabled: ["meta", "google"],
        google: { developer_token: "x", customer_id: "123-456-7890" },
      },
    });
    const r = validatePlatform("google", cfg);
    expect(r.ok).toBe(true);
  });

  it("uses getConfig() when cfg arg omitted", () => {
    setConfigForTesting(makeTestConfig());
    const r = validatePlatform("meta");
    expect(r.ok).toBe(true);
  });
});

describe("activePlatforms", () => {
  it("returns only meta when only meta enabled", async () => {
    setConfigForTesting(makeTestConfig());
    const platforms = await activePlatforms();
    expect(platforms.map((p) => p.name)).toEqual(["meta"]);
  });

  it("skips scaffold-only platforms with warning", async () => {
    setConfigForTesting(
      makeTestConfig({
        platforms: {
          enabled: ["meta", "tiktok"],
          tiktok: { access_token: "x", advertiser_id: "1" },
        },
      }),
    );
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (m: string) => {
      warns.push(m);
    };
    try {
      const platforms = await activePlatforms();
      expect(platforms.map((p) => p.name)).toEqual(["meta"]);
      expect(warns.some((w) => w.includes("scaffold-only"))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });
});
```

- [ ] **Step 2: 테스트 실행 — fail 확인**

```bash
npx vitest run packages/core/src/platform/registry.test.ts 2>&1 | tail -15
```

Expected: 다수 tests fail — 현재 registry.ts는 `tiktok`/`google` 인식 안 하고 `activePlatforms` export도 미공개일 가능성.

- [ ] **Step 3: `registry.ts` 본체 교체**

`packages/core/src/platform/registry.ts` 전체를 다음으로 교체:

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
          `Skipping registration. See packages/core/src/platform/${name}/README.md.`,
      );
      continue;
    }
    if (name === "meta") {
      const { createMetaAdapter } = await import("./meta/adapter.js");
      platforms.push(createMetaAdapter());
    }
    // 실 통합 시 NOT_YET_IMPLEMENTED에서 제거 + 분기 추가:
    // else if (name === "tiktok") {
    //   const { createTiktokAdapter } = await import("./tiktok/adapter.js");
    //   platforms.push(createTiktokAdapter());
    // }
    // else if (name === "google") {
    //   const { createGoogleAdapter } = await import("./google/adapter.js");
    //   platforms.push(createGoogleAdapter());
    // }
  }
  return platforms;
}
```

- [ ] **Step 4: 테스트 실행 — green 확인**

```bash
npx vitest run packages/core/src/platform/registry.test.ts 2>&1 | tail -15
```

Expected: 11 tests passing (validatePlatform 8 + activePlatforms 2 + getConfig fallback 1).

### Task 3.4: `config.example.toml` 업데이트

**Files:**
- Modify: `config.example.toml`

- [ ] **Step 1: `[platforms]` 섹션 주석 보강 + tiktok/google 예시 추가**

`config.example.toml` 라인 5-15 교체:

```toml
[platforms]
# 활성화할 광고 플랫폼 목록.
# - "meta": 구현 완료, 즉시 사용 가능
# - "tiktok", "google": scaffold만 존재 (NotImplemented). enabled에 추가해도 registry가 warning 후 skip.
#   실 통합은 packages/core/src/platform/<name>/README.md 참조.
enabled = ["meta"]

[platforms.meta]
# Meta Marketing API access token (System User token 권장)
# 발급 가이드: docs/STATUS.md 또는 README의 Setup 섹션
access_token = "EAA..."
ad_account_id = "act_1234567890"  # "act_" 접두사 포함
page_id = "1234567890"
instagram_actor_id = "1234567890"

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

- [ ] **Step 2: 사용자 config.toml에 영향 없음 확인**

```bash
ls -la config.toml 2>/dev/null
```

Expected: 없음 (또는 사용자 로컬 설정 — gitignored). 이번 변경은 example 파일만 수정.

### Task 3.5: 전체 테스트 + code-reviewer + Commit 3

- [ ] **Step 1: 전체 테스트 실행**

```bash
npm test 2>&1 | tail -10
```

Expected: 344 (Commit 2 후) + schema 3 + helpers 4 + registry 신규 7 (-기존 4 교체) = **약 354 tests passing**.

- [ ] **Step 2: code-reviewer 호출**

`Agent` 도구로 `superpowers:code-reviewer`:
- 변경 범위: Task 3.1-3.4
- 검토 기준: spec `§6` + CLAUDE.md "환경변수 정책", "Helper 배치 규칙"

- [ ] **Step 3: 발견 이슈 처리**

- [ ] **Step 4: 명시적 add**

```bash
git add packages/core/src/config/schema.ts packages/core/src/config/schema.test.ts \
  packages/core/src/config/helpers.ts packages/core/src/config/helpers.test.ts \
  packages/core/src/platform/registry.ts packages/core/src/platform/registry.test.ts \
  config.example.toml
```

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(config): add TikTok/Google platform schema + registry validation

- config/schema.ts: TiktokPlatform, GooglePlatform Zod 스키마 + PlatformsSection 옵셔널 필드 + superRefine 분기 (enabled에 있는 platform 섹션 누락 검증)
- config/helpers.ts: requireTiktok, requireGoogle (Meta 패턴 동일)
- platform/registry.ts: validatePlatform이 tiktok/google 인식 (config 검증), activePlatforms는 NOT_YET_IMPLEMENTED 집합으로 scaffold 어댑터 skip + warning
- config.example.toml: tiktok/google 섹션 예시 (주석 처리)

Schema regex는 일부러 약화 (min(1)) — 실 SDK 검증 후 tighten.

Spec: docs/superpowers/specs/2026-04-25-multi-platform-adapter-design.md §6
EOF
)"
```

- [ ] **Step 6: 테스트 재확인**

```bash
npm test 2>&1 | tail -5
```

Expected: ~354 tests passing.

---

## Commit 4: 문서 업데이트 (Section 11 of spec)

### Task 4.1: `docs/ARCHITECTURE.md` §10 갱신

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: §10 Platform Adapter 패턴 섹션 수정**

`docs/ARCHITECTURE.md` 라인 ~245-260 부근의 `### 10. Platform Adapter 패턴 (2026-04-20)` 섹션:

```bash
grep -n "### 10\. Platform Adapter" docs/ARCHITECTURE.md
```

해당 위치에서 "Why" 단락 다음 줄을 다음으로 교체:

```markdown
**Why:** Meta 외 플랫폼 (TikTok, Google Ads 등) 확장 가능성을 준비하되, 현재는 Meta만 실 구현. TikTok/Google scaffold (NotImplementedError throw) 가 2026-04-25에 추가되어 실 통합 시 디렉토리/Config/Registry 작업이 미리 잡혀있다. 플랫폼별 로직이 `cli/entries/launch.ts`나 `core/campaign/`에 섞여있으면 확장 시 코드 수정 범위가 커진다.

**How:** `packages/core/src/platform/types.ts`의 `AdPlatform` interface (launch/fetchReports/cleanup). `packages/core/src/platform/registry.ts`가 `config.toml`의 `[platforms] enabled = ["meta"]` 배열을 읽어 활성 어댑터 배열을 반환. 각 어댑터는 `packages/core/src/platform/<name>/` 하위에 자체 logic. 어댑터별 credential은 `[platforms.<name>]` 섹션에 분리 (`[platforms.meta]`, `[platforms.tiktok]`, `[platforms.google]`). Scaffold 어댑터는 registry의 `NOT_YET_IMPLEMENTED` 집합에 의해 skip (실 통합 시 한 줄 제거 + dynamic import 분기 추가로 활성화).

**Trade-off:** 현재는 Meta + 2 scaffold 구조라 인터페이스 일반화의 비용 일부를 미리 지불한 셈. `VariantReport.platformMetrics` (Meta-specific ranking 격리) + `LaunchResult.externalIds: Record<string,string>` (well-known keys: campaign, ad) 로 추상화. 두 번째 어댑터의 실 quality signal이 보일 때 qualifier를 platform-aware로 일반화 (Open Question, spec §13).
```

### Task 4.2: `docs/STATUS.md` 갱신

**Files:**
- Modify: `docs/STATUS.md`

- [ ] **Step 1: "마지막 업데이트" 날짜**

라인 3:

```markdown
마지막 업데이트: 2026-04-25
```

(이미 2026-04-25면 변경 불필요.)

- [ ] **Step 2: "최근 변경 이력" 맨 위에 한 줄 추가**

라인 ~62 (`## 최근 변경 이력` 다음):

```markdown
- 2026-04-25 feat(platform): 멀티플랫폼 어댑터 scaffold 추가 — `packages/core/src/platform/tiktok/`, `google/` 5개 파일씩 + 공유 `notImplemented.ts` 헬퍼. NotImplementedError throw 본체 + 실 통합용 README (SDK/OAuth/hierarchy/checklist). AdPlatform 인터페이스 정리: `Creative.copy.metaAssetLabel→assetLabel`, `VariantReport`의 Meta ranking 3종을 `platformMetrics.meta.*`로 격리, `LaunchResult.externalIds`/`Campaign.externalIds`를 `Record<string,string>`으로 일반화. Config 스키마 `[platforms.tiktok]`/`[platforms.google]` + `requireTiktok`/`requireGoogle` 헬퍼 + registry `NOT_YET_IMPLEMENTED` set으로 scaffold 어댑터 활성화 가드. `data/` 비어있는 시점에 인터페이스 못 박음 — 영속 데이터 마이그레이션 zero. ~354 tests 통과. 실 API 통합은 ROADMAP Tier 3 후속 (각 플랫폼당 별 spec).
```

### Task 4.3: `docs/ROADMAP.md` Tier 3 갱신

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: 마지막 업데이트 날짜**

라인 3:

```markdown
마지막 업데이트: 2026-04-25
```

- [ ] **Step 2: Tier 3의 "Meta 외 플랫폼 지원" 항목 갱신**

`docs/ROADMAP.md` 라인 37 부근:

```markdown
- Meta 외 플랫폼 지원 (TikTok ACO, Google Ads PMax, YouTube Shorts) — Scaffold ✅ 완료 (2026-04-25, `packages/core/src/platform/tiktok/`, `google/` + Config 스키마 + Registry 가드). 실 API 통합은 미진행. 트리거: 사용자가 특정 플랫폼 실 운영 결정 시. 작업: NOT_YET_IMPLEMENTED 집합에서 제거 + dynamic import 분기 추가 + launcher/monitor/cleanup 본체 + breakdown.ts + 에러 분류 함수. 각 어댑터의 README.md에 SDK/OAuth/hierarchy/Implementation Checklist 정리됨.
```

(YouTube는 Google 어댑터 안의 PMax/Video 캠페인 옵션으로 통합 — 별도 어댑터 만들지 않음. 이 사실을 본 항목에 명시.)

### Task 4.4: Commit 4

- [ ] **Step 1: 변경 확인**

```bash
git status --short
```

Expected: 3 files modified (`docs/ARCHITECTURE.md`, `docs/STATUS.md`, `docs/ROADMAP.md`).

- [ ] **Step 2: 명시적 add**

```bash
git add docs/ARCHITECTURE.md docs/STATUS.md docs/ROADMAP.md
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs: reflect multi-platform scaffold completion across STATUS/ROADMAP/ARCHITECTURE

- ARCHITECTURE §10: Platform Adapter 패턴에 TikTok/Google scaffold 추가 사실 반영, NOT_YET_IMPLEMENTED 활성화 절차 명시
- STATUS 최근 변경 이력: 2026-04-25 멀티플랫폼 scaffold 항목 추가
- ROADMAP Tier 3: "Meta 외 플랫폼 지원"을 "Scaffold 완료, 실 API 통합 필요" 형태로 갱신, 트리거 + 작업 단계 + README 위치 명시

Spec: docs/superpowers/specs/2026-04-25-multi-platform-adapter-design.md
EOF
)"
```

- [ ] **Step 4: 최종 git log 확인**

```bash
git log --oneline -7
```

Expected (예시):
```
<sha7> docs: reflect multi-platform scaffold completion ...
<sha6> feat(config): add TikTok/Google platform schema + registry validation
<sha5> feat(platform): add TikTok/Google scaffold adapters with NotImplemented stubs
<sha4> refactor(platform): generalize AdPlatform interface for multi-platform support
<sha3> chore: remove legacy migrate scripts + stale data/courses references
a78c62f docs(specs): add multi-platform adapter scaffold design spec
f6abbdb docs(harness): record module-scope const ban + helper-placement rule
```

- [ ] **Step 5: 최종 테스트 + 린트 확인**

```bash
npm test 2>&1 | tail -5
```

Expected: 모든 테스트 passing (~354).

---

## 완료 조건 (Definition of Done)

모든 항목 ✅ 시 완료:

- [ ] 5개 commit (chore cleanup, refactor, feat scaffold, feat config, docs)
- [ ] `npm test` green (~354 tests)
- [ ] `data/` 디렉토리 빈 상태 유지
- [ ] meta-platform-expert subagent 검토 통과 (Commit 1)
- [ ] code-reviewer subagent 검토 통과 (모든 commit)
- [ ] `grep -rn "metaAssetLabel\|metaCampaignId\|metaAdSetId\|metaAdId\b\|metaAdCreativeId\|adQualityRanking\|adEngagementRanking\|adConversionRanking" packages/ --include="*.ts"` → 0건
- [ ] `grep -rn "tiktok\|google" packages/core/src/platform/registry.ts` → tiktok/google validation 분기 + NOT_YET_IMPLEMENTED 발견
- [ ] 각 scaffold 어댑터 README.md에 [research needed] 표지 명시
- [ ] STATUS.md 마지막 업데이트 = 2026-04-25
- [ ] ROADMAP Tier 3의 "Meta 외 플랫폼 지원" 항목이 "Scaffold ✅" 상태로 갱신

---

## 작업 순서 + 시간 견적 (Spec §11 동일)

| Commit | 작업 | 시간 |
|---|---|---|
| 0 (pre-flight) | 환경 확인 + 레거시 정리 commit | 0.3h |
| 1 | 인터페이스 정리 (Task 1.1-1.6) | 3.5h |
| 1 review | meta-platform-expert + code-reviewer | 1.5h |
| 2 | Scaffold 디렉토리 (Task 2.1-2.4) | 2.5h |
| 3 | Config + Registry (Task 3.1-3.5) | 1.5h |
| 4 | 문서 (Task 4.1-4.4) | 0.5h |
| 안정화 | 전체 테스트 그린 + 작은 수정 | 0.5h |
| **합계** | | **~10.5시간 (1.5일)** |

---

## Self-Review

본 plan을 spec과 비교하여 점검:

### Spec coverage
- §1 배경 → Plan 헤더 Goal/Architecture에 반영 ✅
- §2 범위 → Pre-flight + Commit 1-4 모두 범위 안만 다룸 ✅
- §3 결정 사항 → §3.1 (YouTube google 통합) §3.2 (registry skip) §3.3 (regex 약화) §3.4 (적극적 정리) — 모두 Task 2/3/3/1에 반영 ✅
- §4 인터페이스 정리 → Task 1.1-1.3에서 모든 변경 다룸 ✅
- §5 디렉토리/scaffold → Task 2.1-2.3 ✅
- §6 Config/Registry → Task 3.1-3.4 ✅
- §7 데이터 마이그레이션 (필요 없음) → Task 0.1 Step 4에서 재확인 ✅
- §8 테스트 전략 → Task 1/2/3 각 Step의 테스트 작성/실행 ✅
- §9 Plan C 영향 → Pre-flight Task 0.1 Step 4 (data 비어있음 재확인) + Task 1.4 (meta-platform-expert에 qualifier 회귀 검토 요청) ✅
- §10 작업 순서 → Plan의 Commit 1/2/3/4 구조 그대로 ✅
- §11 시간 견적 → Plan 끝 시간 견적표 동일 ✅
- §12 다른 영역 영향 → Task 1 Step 7-8 (CLI 호출처 + 테스트 fixture) 일괄 수정 명시 ✅
- §13 Open Questions → Plan 본문에 별도 섹션 없음, 그러나 Task 1.4 (meta-platform-expert)에서 처리 + Task 4.1 (ARCHITECTURE 갱신) 에서 platform-aware qualifier 일반화는 Open Question으로 명시 ✅
- §14 검토 이력 → Plan에서는 별도 처리 안 함 (spec 자체에 있음) ✅

### Placeholder scan
plan 전문 grep:

- "TBD", "TODO": Task 4.1의 ARCHITECTURE 본문에 "(Open Question, spec §13)" — Open Question은 의도적 deferred reference, placeholder 아님 ✅
- "implement later", "fill in details": 0건 ✅
- "Add appropriate error handling": 0건 ✅
- "Similar to Task N": 0건 (모든 Task에 코드 본체 명시) ✅
- "[research needed]": README 본문에 의도적 표지로 사용 — placeholder 아님, scaffold 의도 ✅

### Type consistency
- `Creative.copy.assetLabel` (Task 1.1) — Task 1.2의 fixture에서도 일관 사용 ✅
- `VariantReport.platformMetrics.meta.qualityRanking` (Task 1.2) — Task 1.2 Step 4 qualifier에서 동일 경로 접근 ✅
- `VariantAggregate.qualityRanking` (Task 1.2) — passesThreshold + 인라인 fixture 모두 동일 이름 ✅
- `Campaign.externalIds: Record<string, string>` (Task 1.3) — adapter cleanup + monitor 모두 동일 접근 ✅
- `LaunchResult.externalIds` (Task 1.3) — Meta launcher 반환 + actions.ts launch 호출 모두 동일 ✅
- `notImplemented(platform, method)` 시그니처 (Task 2.1) — tiktok/google adapter/launcher/monitor 모두 동일 사용 ✅
- `validatePlatform`/`activePlatforms` API (Task 3.3) — registry.test.ts와 시그니처 일치 ✅

이슈 없음.

### 커밋 단위 확인
- Commit 1 (refactor)는 atomic — 부분 적용 시 빌드 깨짐 (Task 1.1+1.2+1.3 한 커밋)
- Commit 2/3/4는 독립 추가 — 각자 revert 가능
- 모든 commit이 그린 빌드 + 그린 테스트 유지

이슈 없음.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-25-multi-platform-adapter.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - 각 Task마다 fresh subagent dispatch + 두 단계 리뷰 (스펙 + 코드 퀄리티). Commit 1은 meta-platform-expert도 추가. 빠른 iteration.

**2. Inline Execution** - 현재 세션에서 executing-plans 스킬로 batch 실행 + checkpoint 검토.

**Which approach?**

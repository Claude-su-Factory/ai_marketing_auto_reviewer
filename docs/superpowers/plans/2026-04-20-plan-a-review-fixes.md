# Plan A Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan A 완료 직후 리뷰에서 식별된 Critical 3건(C1·C2·C3) + Important 2건(I1·I2)을 수정하여 프로덕션 동작을 정상화한다.

**Architecture:** 기존 파일 소수를 최소 변경으로 패치한다. 새 모듈·새 추상화는 도입하지 않는다. Strategy B 매칭 로직과 Platform Adapter interface는 그대로 유지한다. TDD 루프(실패 테스트 → 구현 → 통과)로 각 이슈를 독립 커밋으로 고친다.

**Tech Stack:** TypeScript, vitest, facebook-nodejs-business-sdk (변경 없음).

**Related code review:** 2026-04-20 Plan A 전체 리뷰 (Git range `835e647^..5a222c7`, 16커밋).

**Branch policy:** 프로젝트 CLAUDE.md 규칙에 따라 master에 직접 커밋.

---

## 이슈 요약

- **C1** `core/platform/meta/monitor.ts:11-18` — `classifyMetaError`가 SDK `FacebookRequestError`의 실제 shape(`err.status` top-level, `err.response.code`)가 아닌 axios-shape를 읽어 항상 `transient`로 분류. `externally_modified` 분기가 프로덕션에서 unreachable.
- **C2** `cli/actions.ts:213-222,240-246`, `core/scheduler/improvementCycle.ts:7-17` — 일별 리포트 파일 포맷이 `VariantReport[]`로 바뀌었는데 이 세 소비자는 여전히 `Report[]`로 읽음. `shouldTriggerImprovement`의 `r.ctr < 1.5` 조건이 항상 false가 되어 자율 개선 루프가 조용히 노옵이 됨.
- **C3** `core/platform/meta/launcher.ts:111-118` — `createAdCreative()` 이후 생성된 AdCreative를 `created[]`에 push하지 않음. `createAd()` 실패 시 AdCreative가 rollback·orphans 어디에도 기록되지 않고 Meta에 영구 orphan.
- **I1** `core/types.ts:43` — `Campaign.status` 유니온에 `"launch_failed"`가 있지만 이를 설정하는 코드가 없음. rollback 경로가 실패 기록을 남기지 않고 re-throw만 함.
- **I2** `core/platform/meta/breakdown.ts:65-80` — `findMatchingCreative`가 `creatives.find`로 첫 번째 매칭 반환. 같은 group 내 body text가 중복되면 두 번째 이후 variant의 성과가 첫 번째로 silent attribution. Plan B(variant 2-3개 생성)에서 critical 문제로 커질 수 있어 Plan A에서 defensive validation 추가.

---

## 파일 구조

**수정 파일:**
- `core/platform/meta/monitor.ts` — C1 fix
- `core/platform/meta/monitor.test.ts` — C1 테스트 SDK shape 커버 추가
- `core/campaign/monitor.ts` — C2 helper export
- `cli/actions.ts` — C2 consumer 2곳 수정
- `core/scheduler/improvementCycle.ts` — C2 consumer 수정
- `core/types.ts` — `Campaign.orphans` 타입에 `"creative"` 추가 (C3)
- `core/platform/types.ts` — `CleanupResult.orphans` 타입에 `"creative"` 추가 (C3)
- `core/platform/meta/rollback.ts` — `MetaResourceType`에 `"creative"` 추가 (C3)
- `core/platform/meta/rollback.test.ts` — `"creative"` 타입 테스트 케이스 추가 (C3)
- `core/platform/meta/launcher.ts` — AdCreative를 `created[]`에 push + 실패 시 `launch_failed` Campaign 기록 (C3 + I1)
- `core/platform/meta/adapter.ts` — cleanup의 `created[]`에 creative 포함 (C3)
- `core/platform/meta/assetFeedSpec.ts` — 동일 body text 검출 throw (I2)
- `core/platform/meta/assetFeedSpec.test.ts` — I2 테스트 추가
- `docs/superpowers/specs/2026-04-20-winner-db-variant-orchestration-e2e-checklist.md` — AdCreative rollback 검증 절차 추가 (C3)

**범위 제외 (별도 이슈로 기록만, 이번 플랜에서 건드리지 않음):**
- Minor I3~M8 (빈 `metaAdId` 방어, `deleteMetaResource` 중복, `ad_formats` 명시, README 경고 문구 등)
- Plan B/C 범위에 속하는 구조 변경

---

## Task 1: C1 — `classifyMetaError` SDK shape 정정

`FacebookRequestError`(node_modules/facebook-nodejs-business-sdk/src/exceptions.js:26-48)는 HTTP status를 top-level `err.status`에, 추출된 API body를 `err.response`(= `{code, message, ...}`)에 담는다. 현재 코드는 axios shape만 읽어 SDK 예외를 모두 `transient`로 분류한다. Top/nested 두 경로를 모두 읽는다.

**Files:**
- Modify: `core/platform/meta/monitor.ts:11-18`
- Test: `core/platform/meta/monitor.test.ts`

- [ ] **Step 1: Write the failing test**

기존 테스트 파일 끝(`describe` block 내)에 SDK shape 테스트 2개를 추가한다. 전체 파일을 아래로 교체:

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
  it("identifies SDK FacebookRequestError with top-level status 404", () => {
    // facebook-nodejs-business-sdk flattens HTTP status to err.status, extracts body into err.response.
    const err = { status: 404, response: { code: 100, message: "(#100) Object does not exist" } };
    expect(classifyMetaError(err)).toBe("externally_modified");
  });
  it("identifies SDK FacebookRequestError with top-level status 403", () => {
    const err = { status: 403, response: { code: 200, message: "forbidden" } };
    expect(classifyMetaError(err)).toBe("externally_modified");
  });
  it("identifies SDK FacebookRequestError with response.code 803", () => {
    const err = { status: 400, response: { code: 803, message: "Some of the aliases you requested do not exist" } };
    expect(classifyMetaError(err)).toBe("externally_modified");
  });
  it("returns 'transient' for anything else", () => {
    expect(classifyMetaError(new Error("network fail"))).toBe("transient");
    expect(classifyMetaError({ response: { status: 500 } })).toBe("transient");
    expect(classifyMetaError({ status: 500, response: { code: 1, message: "internal" } })).toBe("transient");
  });
});
```

- [ ] **Step 2: Run test to verify the new cases fail**

```bash
npx vitest run core/platform/meta/monitor.test.ts
```

Expected: 3개 실패 — "top-level status 404", "top-level status 403", "response.code 803" 모두 `transient`를 반환하여 assertion 실패.

- [ ] **Step 3: Fix the implementation**

`core/platform/meta/monitor.ts`의 `classifyMetaError`만 교체:

```typescript
export function classifyMetaError(err: unknown): MetaErrorClass {
  const anyErr = err as any;
  // SDK FacebookRequestError: status at top-level, already-extracted body at err.response.
  // Axios-style (defensive fallback): response.status / response.data.error.code.
  const status = anyErr?.status ?? anyErr?.response?.status;
  const code = anyErr?.response?.code ?? anyErr?.response?.data?.error?.code;
  if (status === 404 || status === 403) return "externally_modified";
  if (code === 100 || code === 803) return "externally_modified";
  return "transient";
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run core/platform/meta/monitor.test.ts
```

Expected: 7 tests passed.

- [ ] **Step 5: Commit**

```bash
git add core/platform/meta/monitor.ts core/platform/meta/monitor.test.ts
git commit -m "fix(platform/meta): classifyMetaError reads SDK FacebookRequestError shape"
```

---

## Task 2: C2a — `variantReportsToReports` export + 헬퍼 이름 확정

`core/campaign/monitor.ts:86`의 `variantReportsToReports`는 현재 private 함수. 세 소비자(weekly monitor, runImprove, scheduler)가 동일 로직을 필요로 하므로 export한다. 기존 `generateWeeklyAnalysis` 내부 호출 방식은 변경 없음.

**Files:**
- Modify: `core/campaign/monitor.ts:86`

- [ ] **Step 1: Export the function**

`core/campaign/monitor.ts:86`의 선언을 `function` → `export function`으로 한 단어 추가:

```typescript
export function variantReportsToReports(vrs: VariantReport[]): Report[] {
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
      spend: 0,
      cpc: 0,
      reach: 0,
      frequency: 0,
    });
  }
  return reports;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add core/campaign/monitor.ts
git commit -m "refactor(campaign/monitor): export variantReportsToReports for cross-module use"
```

---

## Task 3: C2b — `cli/actions.ts` 두 소비자 수정

`runMonitor`의 weekly 분기와 `runImprove` 둘 다 `data/reports/<date>.json`을 `Report[]`로 로드한다. `VariantReport[]`로 로드한 뒤 `variantReportsToReports`로 집계해 downstream에 넘긴다. `shouldTriggerImprovement`는 `Report`를 받으므로 집계 결과를 사용해야 한다.

**Files:**
- Modify: `cli/actions.ts:200-273`

- [ ] **Step 1: Update imports**

파일 상단의 `core/campaign/monitor.js` import를 확인. 이미 `collectDailyReports`·`generateWeeklyAnalysis`를 import 중이라면 `variantReportsToReports`를 추가. Import 라인 예시 (실제 파일의 기존 import 스타일에 맞춤):

```typescript
import {
  collectDailyReports,
  generateWeeklyAnalysis,
  variantReportsToReports,
} from "../core/campaign/monitor.js";
import type { VariantReport } from "../core/platform/types.js";
```

(기존 import가 이미 다른 형태면 — 예: 단일 import — 스타일을 따라서 `variantReportsToReports`와 `VariantReport` 타입만 추가한다.)

- [ ] **Step 2: Fix `runMonitor` weekly branch**

`cli/actions.ts:211-232`의 else 블록을 아래로 교체:

```typescript
    } else {
      onProgress({ message: "주간 분석 중... (Claude 분석 포함)" });
      const reportPaths = (await listJson("data/reports")).filter(f => !f.includes("weekly-analysis"));
      const allVariants: VariantReport[] = [];
      for (const p of reportPaths.slice(-7)) {
        const daily = await readJson<VariantReport[]>(p);
        if (daily) allVariants.push(...daily);
      }
      if (allVariants.length === 0) {
        return { success: true, message: "Monitor (weekly) 완료", logs: ["성과 데이터 없음"] };
      }
      const aggregated = variantReportsToReports(allVariants);
      const analysis = await proxy.analyzePerformance(aggregated);
      await writeJson(
        `data/reports/weekly-analysis-${new Date().toISOString().split("T")[0]}.json`,
        JSON.parse(analysis.match(/\{[\s\S]*\}/)?.[0] ?? "{}")
      );
      return {
        success: true,
        message: "Monitor (weekly) 완료",
        logs: [analysis.slice(0, 200)],
      };
    }
```

- [ ] **Step 3: Fix `runImprove`**

`cli/actions.ts:238-273`의 try 블록을 아래로 교체:

```typescript
export async function runImprove(proxy: AiProxy, onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    const reportPaths = await listJson("data/reports");
    const allVariants: VariantReport[] = [];

    for (const p of reportPaths.filter((f) => !f.includes("weekly-analysis")).slice(-3)) {
      const daily = await readJson<VariantReport[]>(p);
      if (daily) allVariants.push(...daily);
    }

    const weeklyPaths = reportPaths.filter((p) => p.includes("weekly-analysis"));
    const weeklyPath = weeklyPaths[weeklyPaths.length - 1];

    if (!weeklyPath) {
      return {
        success: false,
        message: "Improve 실패",
        logs: ["주간 분석 없음. Monitor weekly를 먼저 실행하세요."],
      };
    }

    const analysis = await readJson<object>(weeklyPath);
    const aggregated = variantReportsToReports(allVariants);
    const weakReports = aggregated.filter(shouldTriggerImprovement);

    onProgress({ message: `개선 대상 ${weakReports.length}개 캠페인 분석 중...` });
    await runImprovementCycle(weakReports, JSON.stringify(analysis));

    return {
      success: true,
      message: "Improve 완료",
      logs: [`${weakReports.length}개 캠페인 기반 개선 적용`],
    };
  } catch (e) {
    return { success: false, message: "Improve 실패", logs: [String(e)] };
  }
}
```

- [ ] **Step 4: Confirm `Report` import no longer needed (or still used elsewhere)**

`cli/actions.ts` 상단에서 `import type { Report }` 등을 찾아 다른 용도로 여전히 쓰는지 확인. 쓰지 않으면 제거. 다른 코드에서 쓰면 그대로 유지.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: 177+개 모두 통과. 이 파일은 기존 테스트가 없지만 다른 모듈 테스트가 regression을 보이지 않아야 한다.

- [ ] **Step 7: Commit**

```bash
git add cli/actions.ts
git commit -m "fix(cli/actions): load daily reports as VariantReport[] and aggregate before analysis"
```

---

## Task 4: C2c — `core/scheduler/improvementCycle.ts` 수정

`core/scheduler/improvementCycle.ts:1-19`는 launchd 데몬이 호출하는 스케줄러 경로. 현재 `Report[]`로 잘못 읽음 → 자율 개선 루프가 production에서 silent no-op.

**Files:**
- Modify: `core/scheduler/improvementCycle.ts` (전체 파일 교체)

- [ ] **Step 1: Rewrite file**

`core/scheduler/improvementCycle.ts` 전체를 아래로 교체:

```typescript
import { readJson, listJson } from "../storage.js";
import { runImprovementCycle as runCycle } from "../improver/runner.js";
import { shouldTriggerImprovement } from "../improver/index.js";
import { variantReportsToReports } from "../campaign/monitor.js";
import type { VariantReport } from "../platform/types.js";

export async function runScheduledImprovementCycle(): Promise<void> {
  const reportPaths = await listJson("data/reports");
  const allVariants: VariantReport[] = [];
  for (const p of reportPaths.filter((f) => !f.includes("weekly-analysis")).slice(-3)) {
    const daily = await readJson<VariantReport[]>(p);
    if (daily) allVariants.push(...daily);
  }
  const weeklyPaths = reportPaths.filter((p) => p.includes("weekly-analysis"));
  const latest = weeklyPaths[weeklyPaths.length - 1];
  if (!latest) return;
  const analysis = await readJson<object>(latest);
  const aggregated = variantReportsToReports(allVariants);
  const weak = aggregated.filter(shouldTriggerImprovement);
  await runCycle(weak, JSON.stringify(analysis));
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add core/scheduler/improvementCycle.ts
git commit -m "fix(scheduler): aggregate VariantReport[] before threshold check"
```

---

## Task 5: C3a — Resource-type 유니온에 `"creative"` 추가

AdCreative도 Meta에서 독립 리소스이므로 rollback·orphans 타입이 이를 인식해야 한다. 3곳(`rollback.ts`, `core/platform/types.ts`, `core/types.ts`)의 유니온을 확장하고 rollback 테스트에 creative 케이스 추가.

**Files:**
- Modify: `core/platform/meta/rollback.ts:3`
- Modify: `core/platform/types.ts:22`
- Modify: `core/types.ts:44`
- Test: `core/platform/meta/rollback.test.ts`

- [ ] **Step 1: Update rollback type union**

`core/platform/meta/rollback.ts:3`을 변경:

```typescript
export type MetaResourceType = "campaign" | "adset" | "ad" | "creative";
```

- [ ] **Step 2: Update CleanupResult.orphans**

`core/platform/types.ts:20-23`의 `CleanupResult`를 변경:

```typescript
export interface CleanupResult {
  deleted: string[];
  orphans: { type: "campaign" | "adset" | "ad" | "creative"; id: string }[];
}
```

- [ ] **Step 3: Update Campaign.orphans**

`core/types.ts:44`의 `Campaign.orphans`를 변경:

```typescript
  orphans: { type: "campaign" | "adset" | "ad" | "creative"; id: string }[];
```

- [ ] **Step 4: Write failing test for creative rollback order**

`core/platform/meta/rollback.test.ts`의 첫 번째 테스트 ("deletes in reverse order")를 교체하여 creative 포함. 전체 파일을 아래로 교체:

```typescript
import { describe, it, expect, vi } from "vitest";
import { executeRollback } from "./rollback.js";

describe("executeRollback", () => {
  it("deletes in reverse order including creative and returns all deleted on success", async () => {
    const calls: string[] = [];
    const deleter = vi.fn(async (type: string, id: string) => {
      calls.push(`${type}:${id}`);
    });

    const result = await executeRollback({
      created: [
        { type: "campaign", id: "c1" },
        { type: "adset", id: "as1" },
        { type: "creative", id: "cr1" },
        { type: "ad", id: "ad1" },
      ],
      deleter,
    });

    expect(calls).toEqual(["ad:ad1", "creative:cr1", "adset:as1", "campaign:c1"]);
    expect(result.deleted).toEqual(["ad1", "cr1", "as1", "c1"]);
    expect(result.orphans).toEqual([]);
  });

  it("collects creative as orphan when its delete throws", async () => {
    const deleter = vi.fn(async (type: string, _id: string) => {
      if (type === "creative") throw new Error("meta API failed");
    });

    const result = await executeRollback({
      created: [
        { type: "campaign", id: "c1" },
        { type: "adset", id: "as1" },
        { type: "creative", id: "cr1" },
        { type: "ad", id: "ad1" },
      ],
      deleter,
    });

    expect(result.deleted).toEqual(["ad1", "as1", "c1"]);
    expect(result.orphans).toEqual([{ type: "creative", id: "cr1" }]);
  });

  it("collects orphans when a delete throws and continues", async () => {
    const deleter = vi.fn(async (type: string, _id: string) => {
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

- [ ] **Step 5: Run tests**

```bash
npx vitest run core/platform/meta/rollback.test.ts
```

Expected: 4 tests passed. `executeRollback`의 로직은 이미 type-agnostic이라 구현 변경 없이 통과한다.

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add core/platform/meta/rollback.ts core/platform/types.ts core/types.ts core/platform/meta/rollback.test.ts
git commit -m "feat(platform/meta): extend resource-type union to include creative"
```

---

## Task 6: C3b + I1 — Launcher에서 AdCreative 추적 + 실패 시 `launch_failed` Campaign 기록

`core/platform/meta/launcher.ts`의 try 블록에서 `createAdCreative` 직후 `created[]`에 creative를 push한다. catch 블록에서는 rollback을 실행하되 실패 기록을 위해 Campaign JSON(`status: "launch_failed"`)을 쓰고 orphans를 그 안에 저장한 뒤 re-throw한다.

**Files:**
- Modify: `core/platform/meta/launcher.ts:67-162`

- [ ] **Step 1: Update the try-catch body**

`core/platform/meta/launcher.ts`의 `launchMetaDco` 함수 전체를 아래로 교체 (나머지 helper들은 그대로 유지):

```typescript
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

    // 3. Upload assets
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
    created.push({ type: "creative", id: adCreative.id });

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

    // Persist a launch_failed Campaign record so operators can audit orphans.
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
      launchedAt: new Date().toISOString(),
      status: "launch_failed" as const,
      orphans: cleanupResult.orphans,
    };
    await writeJson(`data/campaigns/${failedRecord.id}.json`, failedRecord);

    await appendOrphansToDisk(cleanupResult.orphans, writeJson, readJson);
    throw err;
  }
}
```

- [ ] **Step 2: Update `deleteMetaResource` signature**

같은 파일 `core/platform/meta/launcher.ts:59-65`의 `deleteMetaResource` 타입 시그니처를 확장:

```typescript
async function deleteMetaResource(
  type: "campaign" | "adset" | "ad" | "creative",
  id: string,
): Promise<void> {
  const api = (bizSdk as any).FacebookAdsApi.getDefaultApi();
  await api.call("DELETE", [id]);
}
```

(실행 로직은 변경 없음 — Graph API DELETE는 ID만으로 리소스를 삭제하므로 type 확장 안전.)

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run existing launcher tests**

```bash
npx vitest run core/platform/meta/launcher.test.ts
```

Expected: 3 pure-helper tests pass (런처의 try/catch 본체는 테스트 대상 아님; E2E 체크리스트로 검증).

- [ ] **Step 5: Commit**

```bash
git add core/platform/meta/launcher.ts
git commit -m "fix(platform/meta): track AdCreative in rollback and persist launch_failed campaign record"
```

---

## Task 7: C3c — Adapter cleanup에 creative 포함

기존 `core/platform/meta/adapter.ts:27-31`의 `created[]`는 `campaign`/`adset`/`ad` 3개만 포함. 런칭 성공 경로에서는 `campaignRecord`에 AdCreative ID가 저장되지 않으므로, cleanup은 AdSet이 가진 ads의 creative를 역조회하지 않고 ad만 삭제한다. Meta Graph API는 Ad를 삭제해도 AdCreative를 자동 삭제하지 않아 orphan이 될 수 있다. 이 문제를 완전 해결하려면 Campaign record에 `metaAdCreativeId`를 저장해야 하지만, 그건 Plan B 범위. 여기서는 **Plan A 범위 안에서의 안전장치**로 Campaign JSON에 `metaAdCreativeId`(optional) 필드를 추가하고 launcher가 저장·cleanup이 읽도록 한다.

**Files:**
- Modify: `core/types.ts:34-45` — `Campaign`에 optional `metaAdCreativeId` 추가
- Modify: `core/platform/meta/launcher.ts` — 성공 경로의 `campaignRecord`와 실패 경로의 `failedRecord`에 `metaAdCreativeId` 저장
- Modify: `core/platform/meta/adapter.ts:22-35` — cleanup에 creative 포함
- Modify: `scripts/migrate-creatives.ts` — 기존 Campaign에 `metaAdCreativeId: ""` 추가

- [ ] **Step 1: Add optional field to Campaign type**

`core/types.ts:34-45`의 `Campaign` interface에 한 줄 추가:

```typescript
export interface Campaign {
  id: string;
  variantGroupId: string;
  productId: string;
  platform: string;
  metaCampaignId: string;
  metaAdSetId: string;
  metaAdId: string;
  metaAdCreativeId?: string;                // Plan A review fix — for cleanup rollback
  launchedAt: string;
  status: "active" | "paused" | "completed" | "launch_failed" | "externally_modified";
  orphans: { type: "campaign" | "adset" | "ad" | "creative"; id: string }[];
}
```

- [ ] **Step 2: Save metaAdCreativeId in launcher success path**

`core/platform/meta/launcher.ts`의 성공 경로 `campaignRecord` 객체에 필드 추가 (Task 6의 Step 1에서 교체한 동일 함수 내 success block):

```typescript
    const campaignRecord = {
      id: randomUUID(),
      variantGroupId: group.variantGroupId,
      productId: group.product.id,
      platform: "meta" as const,
      metaCampaignId: campaign.id as string,
      metaAdSetId: adSet.id as string,
      metaAdId: ad.id as string,
      metaAdCreativeId: adCreative.id as string,     // NEW
      launchedAt: new Date().toISOString(),
      status: "paused" as const,
      orphans: [],
    };
```

그리고 실패 경로의 `failedRecord`에도 추가:

```typescript
    const failedRecord = {
      id: randomUUID(),
      variantGroupId: group.variantGroupId,
      productId: group.product.id,
      platform: "meta" as const,
      metaCampaignId: idOf("campaign"),
      metaAdSetId: idOf("adset"),
      metaAdId: idOf("ad"),
      metaAdCreativeId: idOf("creative"),            // NEW
      launchedAt: new Date().toISOString(),
      status: "launch_failed" as const,
      orphans: cleanupResult.orphans,
    };
```

- [ ] **Step 3: Update adapter cleanup**

`core/platform/meta/adapter.ts:22-35`의 `cleanup` 전체를 아래로 교체:

```typescript
    async cleanup(campaignId: string): Promise<CleanupResult> {
      (bizSdk as any).FacebookAdsApi.init(process.env.META_ACCESS_TOKEN!);
      const campaign = await readJson<any>(`data/campaigns/${campaignId}.json`);
      if (!campaign) return { deleted: [], orphans: [] };

      const created: { type: "campaign" | "adset" | "ad" | "creative"; id: string }[] = [];
      if (campaign.metaCampaignId) created.push({ type: "campaign", id: campaign.metaCampaignId });
      if (campaign.metaAdSetId) created.push({ type: "adset", id: campaign.metaAdSetId });
      if (campaign.metaAdCreativeId) created.push({ type: "creative", id: campaign.metaAdCreativeId });
      if (campaign.metaAdId) created.push({ type: "ad", id: campaign.metaAdId });

      const result = await executeRollback({ created, deleter: deleteMetaResource });
      await appendOrphansToDisk(result.orphans, writeJson, readJson);
      return result;
    },
```

(빈 ID 방어 + creative 포함 두 가지를 동시에 처리. 순서는 executeRollback이 reverse 처리하므로 ad → creative → adset → campaign 으로 삭제됨 — 올바른 Meta dependency 순서.)

- [ ] **Step 4: Update `deleteMetaResource` in adapter.ts signature**

`core/platform/meta/adapter.ts:8`의 signature 확장:

```typescript
async function deleteMetaResource(
  type: "campaign" | "adset" | "ad" | "creative",
  id: string,
): Promise<void> {
  const api = (bizSdk as any).FacebookAdsApi.getDefaultApi();
  await api.call("DELETE", [id]);
}
```

- [ ] **Step 5: Update migration script for existing campaigns**

`scripts/migrate-creatives.ts`의 `migrateCampaigns` 함수에서 `updated` 객체에 `metaAdCreativeId: ""` 추가. 기존 파일을 읽고 해당 blockk만 교체:

```typescript
    const updated = {
      id: old.id,
      variantGroupId,
      productId: old.productId,
      platform: "meta",
      metaCampaignId: old.metaCampaignId,
      metaAdSetId: old.metaAdSetId,
      metaAdId,
      metaAdCreativeId: "",
      launchedAt: old.launchedAt,
      status: old.status,
      orphans: [],
    };
```

또한 "이미 마이그레이션됨" 판별 조건에 `metaAdCreativeId` 존재 여부도 포함하도록 변경:

```typescript
    if ("variantGroupId" in old && "platform" in old && "metaAdId" in old && "metaAdCreativeId" in old) {
      console.log(`✓ ${file} (이미 마이그레이션됨)`);
      continue;
    }
```

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Run full test suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add core/types.ts core/platform/meta/launcher.ts core/platform/meta/adapter.ts scripts/migrate-creatives.ts
git commit -m "fix(platform/meta): persist metaAdCreativeId on Campaign and include in cleanup"
```

---

## Task 8: I2 — `assembleAssetFeedSpec` 중복 body text 검증

같은 variant group 내에서 normalized body text가 중복되면 `parseBodyAssetBreakdown`의 `findMatchingCreative`가 첫 번째 variant로 silent attribution. Launch 시점에 validation throw로 차단.

**Files:**
- Modify: `core/platform/meta/assetFeedSpec.ts:19-45`
- Test: `core/platform/meta/assetFeedSpec.test.ts`

- [ ] **Step 1: Write the failing test**

`core/platform/meta/assetFeedSpec.test.ts`에 테스트 2개 추가 (기존 파일 내용 뒤에 append). 파일의 기존 구조를 유지하기 위해, 먼저 기존 파일을 읽은 뒤 아래 테스트 블록을 describe 내부에 append:

```typescript
  it("throws when two creatives produce identical normalized body text", () => {
    const product: Product = {
      id: "p1",
      name: "Test Product",
      description: "d",
      currency: "KRW",
      targetUrl: "https://example.com",
      tags: [],
      inputMethod: "manual",
      createdAt: "2026-04-20T00:00:00Z",
    };
    const mkCreative = (id: string, body: string, hashtags: string[]): Creative => ({
      id,
      productId: "p1",
      variantGroupId: "g1",
      copy: {
        headline: "h",
        body,
        cta: "SHOP_NOW",
        hashtags,
        variantLabel: "emotional",
        metaAssetLabel: `variant-${id}`,
      },
      imageLocalPath: "/tmp/a.jpg",
      videoLocalPath: "/tmp/a.mp4",
      status: "approved",
      createdAt: "2026-04-20T00:00:00Z",
    });

    // same body and same hashtags → same submitted text → collision
    const creatives = [
      mkCreative("c1", "Same body", ["tag"]),
      mkCreative("c2", "Same body", ["tag"]),
    ];

    expect(() =>
      assembleAssetFeedSpec({ product, creatives, imageHash: "h", videoId: "v" }),
    ).toThrow(/duplicate body text/i);
  });

  it("throws when CRLF/whitespace normalization collapses distinct raw bodies", () => {
    const product: Product = {
      id: "p1",
      name: "Test Product",
      description: "d",
      currency: "KRW",
      targetUrl: "https://example.com",
      tags: [],
      inputMethod: "manual",
      createdAt: "2026-04-20T00:00:00Z",
    };
    const mkCreative = (id: string, body: string): Creative => ({
      id,
      productId: "p1",
      variantGroupId: "g1",
      copy: {
        headline: "h",
        body,
        cta: "SHOP_NOW",
        hashtags: [],
        variantLabel: "emotional",
        metaAssetLabel: `variant-${id}`,
      },
      imageLocalPath: "/tmp/a.jpg",
      videoLocalPath: "/tmp/a.mp4",
      status: "approved",
      createdAt: "2026-04-20T00:00:00Z",
    });

    const creatives = [
      mkCreative("c1", "Body  "),       // trailing whitespace
      mkCreative("c2", "Body"),         // clean
    ];

    expect(() =>
      assembleAssetFeedSpec({ product, creatives, imageHash: "h", videoId: "v" }),
    ).toThrow(/duplicate body text/i);
  });
```

필요한 import도 테스트 파일 상단에 추가:

```typescript
import type { Product, Creative } from "../../types.js";
```

(이미 import 되어 있다면 중복 추가하지 말 것.)

- [ ] **Step 2: Run test to verify they fail**

```bash
npx vitest run core/platform/meta/assetFeedSpec.test.ts
```

Expected: 2 new tests fail (no throw occurs).

- [ ] **Step 3: Add validation to implementation**

`core/platform/meta/assetFeedSpec.ts`의 `assembleAssetFeedSpec` 함수 본문을 아래로 교체 (나머지 파일 내용은 유지):

```typescript
export function assembleAssetFeedSpec(input: AssetFeedSpecInput): AssetFeedSpec {
  const { product, creatives, imageHash, videoId } = input;
  if (creatives.length === 0) {
    throw new Error("assembleAssetFeedSpec requires at least one creative");
  }

  const sharedHeadline = creatives[0].copy.headline;
  const sharedCta = creatives[0].copy.cta;

  const normalize = (t: string) => t.replace(/\r\n/g, "\n").trim();
  const bodies = creatives.map((c) => {
    const hashtags = c.copy.hashtags.map((t) => `#${t}`).join(" ");
    const text = hashtags ? `${c.copy.body}\n\n${hashtags}` : c.copy.body;
    return {
      text,
      adlabels: [{ name: c.copy.metaAssetLabel }],
    };
  });

  // Validate: after CRLF/trim normalization, every body.text must be unique.
  // Otherwise parseBodyAssetBreakdown will silently attribute performance to
  // the first matching creative (Strategy B collision).
  const seen = new Map<string, string>();
  for (let i = 0; i < bodies.length; i++) {
    const key = normalize(bodies[i].text);
    if (seen.has(key)) {
      throw new Error(
        `assembleAssetFeedSpec: duplicate body text in variant group. ` +
          `Creative[${seen.get(key)}] and Creative[${i}] produce the same normalized text. ` +
          `Regenerate one of the copies.`,
      );
    }
    seen.set(key, String(i));
  }

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

Expected: all tests pass (기존 테스트 + 새 테스트 2개).

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add core/platform/meta/assetFeedSpec.ts core/platform/meta/assetFeedSpec.test.ts
git commit -m "feat(platform/meta): throw on duplicate body text to prevent silent variant collapse"
```

---

## Task 9: E2E 체크리스트 갱신 + 최종 검증

AdCreative rollback 검증 스텝을 E2E 체크리스트에 추가하고 전체 tsc/test가 clean인지 확인.

**Files:**
- Modify: `docs/superpowers/specs/2026-04-20-winner-db-variant-orchestration-e2e-checklist.md`

- [ ] **Step 1: Update E2E checklist**

파일을 읽고 "Plan A" 섹션의 rollback 시나리오 항목 아래에 추가 (기존 "(rollback 시나리오)" 라인 직후):

```markdown
- [ ] (AdCreative rollback 검증) `createAd` 단계에서 일부러 실패 유발 (예: `adset_id`를 잘못된 값으로 패치) → `data/campaigns/<id>.json`에 `status: "launch_failed"` 레코드가 생성되고, Meta Ads Manager에서 생성되었던 AdCreative가 삭제되었는지 확인. 삭제 실패 시 `data/orphans.json`에 `{type: "creative", id: "..."}`가 기록됨.
- [ ] (자율 개선 루프 검증) 낮은 CTR의 VariantReport를 `data/reports/<어제>.json`에 수동 주입 → `npm run improve` 실행 → 개선 대상 캠페인이 0이 아니라 weakReports에 집계됨을 console log로 확인 (C2 fix 회귀 방지).
- [ ] (외부 수정 감지 검증) Meta Ads Manager에서 광고를 수동 삭제 후 `npm run monitor -- daily` → campaign JSON의 status가 `"externally_modified"`로 변경됨. 로그에 `FacebookRequestError` 404/code 100이 캡처되고 `transient`가 아닌 `externally_modified`로 분류되었는지 console.warn 확인 (C1 fix 회귀 방지).
```

- [ ] **Step 2: Full tsc**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Full test run**

```bash
npm test
```

Expected: all tests pass. 이전 Plan A 완료 시점 177개 + 추가된 신규 테스트 (Task 1에서 +3, Task 5에서 +1, Task 8에서 +2) = 183개 통과 예상.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-04-20-winner-db-variant-orchestration-e2e-checklist.md
git commit -m "docs(plan-a): add E2E checks for creative rollback, improvement loop, external modification"
```

---

## 완료 기준

모든 태스크 완료 후:

1. `npm test` 전체 통과 (183+개)
2. `npx tsc --noEmit` 에러 없음
3. `classifyMetaError` 가 `FacebookRequestError` top-level `status` / nested `response.code`를 정상 인식
4. `data/reports/<date>.json`이 `VariantReport[]`로 저장·소비되며 자율 개선 루프에서 `shouldTriggerImprovement`가 의미있는 판정을 수행
5. AdCreative가 `created[]`·`cleanup.created[]`·`Campaign.metaAdCreativeId` 세 경로에서 모두 추적
6. 런칭 실패 시 `status: "launch_failed"` Campaign JSON이 `data/campaigns/`에 기록되고 orphans가 함께 저장됨
7. `assembleAssetFeedSpec`이 동일 normalized body text 2개 이상을 받으면 throw
8. E2E 체크리스트에 3개 회귀 방지 절차가 문서화됨

완료 후 STATUS.md의 "알려진 결함" 섹션(있다면)에 Minor 이슈(I3, M1-M8)를 정리하고 Plan B 계획 작성으로 이어진다.

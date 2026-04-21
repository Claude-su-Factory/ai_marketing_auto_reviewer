# Plan C Qualify Wire-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `qualifyWinners` 단계를 Owner worker / Server scheduler의 실제 cron tick에 연결하여 자기 학습 루프(성과 → winner 선발 → embedding 저장 → 다음 제품 생성 시 few-shot 주입)를 완성한다.

**Architecture:** (1) `qualifier.ts`에 순수 helper `pickBestPerVariantGroup` 추가. (2) `qualifyWinners` 시그니처를 리팩터링해 `creativeIdResolver` opts 제거하고 `loadCreative` → `findCreativeByVariant`로 교체 + "filter 먼저, group 나중" 순서 적용. (3) 새 파일 `core/rag/qualifyJob.ts`에 factory `createQualifyJob`을 두어 Voyage client / `creatives.db` lifecycle / JSON scan deps를 캡쳐. (4) Owner worker와 Server scheduler에서 `createQualifyJob()` 호출하고 반환 함수를 `runScheduledImprovementCycle({ qualify })`에 주입. (5) 수동 smoke, 코드 리뷰, 문서 업데이트 순서로 완결.

**Tech Stack:** TypeScript, Vitest, better-sqlite3 (WAL), node-cron, Voyage AI voyage-3-lite.

**Spec:** `docs/superpowers/specs/2026-04-21-plan-c-qualify-wire-up-design.md`

---

## File Structure

**신규 생성:**
- `core/rag/qualifyJob.ts` — `createQualifyJob` factory + `QualifyJob` type + `QualifyJobOverrides` type. tick마다 DB 열고 닫는 closure 반환.
- `core/rag/qualifyJob.test.ts` — factory end-to-end + lifecycle 테스트 (J1–J3).

**수정:**
- `core/rag/types.ts` — `QualifyDeps`의 `loadCreative` 제거, `findCreativeByVariant` 추가.
- `core/rag/qualifier.ts` — `pickBestPerVariantGroup` 추가, `qualifyWinners`에서 `QualifyOptions` 제거 + filter-then-group 순서 적용 + `findCreativeByVariant` 호출.
- `core/rag/qualifier.test.ts` — 기존 4개 qualifyWinners 테스트 새 시그니처로 전환, `pickBestPerVariantGroup` describe 블록 (P1–P4), threshold-then-group 통합 테스트 Q1–Q2 추가.
- `cli/entries/worker.ts` — `createQualifyJob()` 호출, `deps.runImprovementCycle`를 qualify 바인딩 버전으로 교체, TODO 주석 제거.
- `server/scheduler.ts` — 동일 wire-up.
- `docs/STATUS.md` — Plan C 상태 🟡 → ✅, "최근 변경 이력" 맨 위 한 줄, "마지막 업데이트" 날짜 갱신.
- `docs/ROADMAP.md` — "현재 추천 다음 작업"을 "Plan C 실운영 검증"으로 승격.

---

## Task 1: `pickBestPerVariantGroup` 순수 helper 추가

**Files:**
- Modify: `core/rag/qualifier.ts` (`pickBestPerVariantGroup` 함수 추가)
- Modify: `core/rag/qualifier.test.ts` (새 describe 블록 추가)

- [ ] **Step 1: Write 4 failing tests**

Append to `core/rag/qualifier.test.ts` **at the end of file** (after the last `describe("qualifyWinners", ...)` block):

```ts
import { pickBestPerVariantGroup } from "./qualifier.js";
import type { VariantAggregate } from "./types.js";

function mkAgg(overrides: Partial<VariantAggregate>): VariantAggregate {
  return {
    campaignId: "c1",
    variantLabel: "emotional",
    variantGroupId: "g1",
    productId: "p1",
    impressions: 1000,
    clicks: 50,
    inlineLinkClickCtr: 0.05,
    adQualityRanking: "AVERAGE",
    adEngagementRanking: "AVERAGE",
    adConversionRanking: "AVERAGE",
    ...overrides,
  };
}

describe("pickBestPerVariantGroup", () => {
  it("P1: returns [] for empty input", () => {
    expect(pickBestPerVariantGroup([])).toEqual([]);
  });

  it("P2: picks best CTR per variantGroupId", () => {
    const aggs = [
      mkAgg({ variantGroupId: "g1", variantLabel: "emotional", inlineLinkClickCtr: 0.03 }),
      mkAgg({ variantGroupId: "g1", variantLabel: "numerical", inlineLinkClickCtr: 0.05 }),
      mkAgg({ variantGroupId: "g2", variantLabel: "urgency", inlineLinkClickCtr: 0.04 }),
    ];
    const result = pickBestPerVariantGroup(aggs);
    expect(result).toHaveLength(2);
    const g1 = result.find((a) => a.variantGroupId === "g1")!;
    const g2 = result.find((a) => a.variantGroupId === "g2")!;
    expect(g1.variantLabel).toBe("numerical");
    expect(g2.variantLabel).toBe("urgency");
  });

  it("P3: tie-break — ctr tie resolved by impressions desc", () => {
    const aggs = [
      mkAgg({ variantGroupId: "g1", variantLabel: "emotional", inlineLinkClickCtr: 0.05, impressions: 100 }),
      mkAgg({ variantGroupId: "g1", variantLabel: "numerical", inlineLinkClickCtr: 0.05, impressions: 200 }),
    ];
    const result = pickBestPerVariantGroup(aggs);
    expect(result).toHaveLength(1);
    expect(result[0].variantLabel).toBe("numerical");
  });

  it("P4: tie-break — ctr and impressions tie resolved by variantLabel lex asc", () => {
    const aggs = [
      mkAgg({ variantGroupId: "g1", variantLabel: "numerical", inlineLinkClickCtr: 0.05, impressions: 100 }),
      mkAgg({ variantGroupId: "g1", variantLabel: "emotional", inlineLinkClickCtr: 0.05, impressions: 100 }),
    ];
    const result = pickBestPerVariantGroup(aggs);
    expect(result).toHaveLength(1);
    expect(result[0].variantLabel).toBe("emotional");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run core/rag/qualifier.test.ts -t "pickBestPerVariantGroup"`
Expected: FAIL with "pickBestPerVariantGroup is not a function" or import error.

- [ ] **Step 3: Implement `pickBestPerVariantGroup`**

Append to `core/rag/qualifier.ts` (at end of file, after `qualifyWinners`):

```ts
export function pickBestPerVariantGroup(aggs: VariantAggregate[]): VariantAggregate[] {
  const byGroup = new Map<string, VariantAggregate[]>();
  for (const a of aggs) {
    const cur = byGroup.get(a.variantGroupId);
    if (cur) cur.push(a);
    else byGroup.set(a.variantGroupId, [a]);
  }
  const picked: VariantAggregate[] = [];
  for (const group of byGroup.values()) {
    const sorted = [...group].sort((a, b) => {
      if (b.inlineLinkClickCtr !== a.inlineLinkClickCtr) {
        return b.inlineLinkClickCtr - a.inlineLinkClickCtr;
      }
      if (b.impressions !== a.impressions) return b.impressions - a.impressions;
      return a.variantLabel.localeCompare(b.variantLabel);
    });
    picked.push(sorted[0]);
  }
  return picked;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run core/rag/qualifier.test.ts -t "pickBestPerVariantGroup"`
Expected: PASS (4 tests).

- [ ] **Step 5: Run full qualifier test file to check no regression**

Run: `npx vitest run core/rag/qualifier.test.ts`
Expected: All existing tests + 4 new tests PASS.

- [ ] **Step 6: Commit**

```bash
git add core/rag/qualifier.ts core/rag/qualifier.test.ts
git commit -m "feat(rag): add pickBestPerVariantGroup pure helper with tie-break rules"
```

---

## Task 2: `qualifyWinners` 시그니처 리팩터 + 새 순서 적용

**착수 전 확인:** `core/rag/types.ts`의 `QualifyDeps`와 `core/rag/retriever.ts`의 `RetrieveDeps`가 서로 다른 파일에 있는지 확인한다.

Run: `grep -l "RetrieveDeps\|QualifyDeps" core/rag/*.ts`
Expected output includes both `core/rag/retriever.ts` (RetrieveDeps) and `core/rag/types.ts` (QualifyDeps).

**Files:**
- Modify: `core/rag/types.ts` (QualifyDeps 필드 교체)
- Modify: `core/rag/qualifier.ts` (opts 제거 + 순서 재조정)
- Modify: `core/rag/qualifier.test.ts` (기존 4 테스트 전환 + Q1, Q2 추가)

- [ ] **Step 1: Update `QualifyDeps` interface**

Modify `core/rag/types.ts` lines 34–43:

Replace:
```ts
export interface QualifyDeps {
  loadCreative: (creativeId: string) => Promise<Creative | null>;
  loadProduct: (productId: string) => Promise<Product | null>;
  embed: (texts: string[]) => Promise<number[][]>;
  store: {
    hasCreative: (creativeId: string) => boolean;
    loadAll: () => WinnerCreative[];
    insert: (winner: WinnerCreative) => void;
  };
}
```

With:
```ts
export interface QualifyDeps {
  findCreativeByVariant: (
    variantGroupId: string,
    variantLabel: string,
  ) => Promise<Creative | null>;
  loadProduct: (productId: string) => Promise<Product | null>;
  embed: (texts: string[]) => Promise<number[][]>;
  store: {
    hasCreative: (creativeId: string) => boolean;
    loadAll: () => WinnerCreative[];
    insert: (winner: WinnerCreative) => void;
  };
}
```

- [ ] **Step 2: Rewrite `qualifyWinners` in `core/rag/qualifier.ts`**

Replace the current `QualifyOptions` export and `qualifyWinners` function (lines 69–122) with:

```ts
export async function qualifyWinners(
  reports: VariantReport[],
  deps: QualifyDeps,
): Promise<{ inserted: number; skipped: number }> {
  const medianCtr = getMedianCtr(reports);
  const aggregates = aggregateVariantReports(reports);

  const passing = aggregates.filter((a) => passesThreshold(a, medianCtr));
  const failed = aggregates.length - passing.length;
  const bests = pickBestPerVariantGroup(passing);
  const droppedSiblings = passing.length - bests.length;

  let inserted = 0;
  let skipped = failed + droppedSiblings;

  for (const agg of bests) {
    const creative = await deps.findCreativeByVariant(agg.variantGroupId, agg.variantLabel);
    if (!creative) { skipped++; continue; }
    if (deps.store.hasCreative(creative.id)) { skipped++; continue; }

    const product = await deps.loadProduct(agg.productId);
    if (!product) { skipped++; continue; }

    const [embedProduct, embedCopy] = await deps.embed([
      product.description,
      `${creative.copy.headline} ${creative.copy.body}`,
    ]);

    const existing = deps.store.loadAll();
    if (shouldSkipInsert(embedProduct, existing)) { skipped++; continue; }

    const winner: WinnerCreative = {
      id: randomUUID(),
      creativeId: creative.id,
      productCategory: product.category ?? null,
      productTags: product.tags,
      productDescription: product.description,
      headline: creative.copy.headline,
      body: creative.copy.body,
      cta: creative.copy.cta,
      variantLabel: creative.copy.variantLabel,
      embeddingProduct: embedProduct,
      embeddingCopy: embedCopy,
      qualifiedAt: new Date().toISOString(),
      impressions: agg.impressions,
      inlineLinkClickCtr: agg.inlineLinkClickCtr,
    };
    deps.store.insert(winner);
    inserted++;
  }

  return { inserted, skipped };
}
```

Also remove the now-unused `QualifyOptions` interface export.

- [ ] **Step 3: Update existing 4 qualifyWinners tests to new signature**

Modify `core/rag/qualifier.test.ts` inside the `describe("qualifyWinners", ...)` block. Replace each test in turn:

**Test: "inserts threshold-passing variants into store with both embeddings"** — replace body:

```ts
it("inserts threshold-passing variants into store with both embeddings", async () => {
  const reports = [
    mkReport({ variantGroupId: "g1", campaignId: "c1", variantLabel: "emotional", impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04 }),
    mkReport({ variantGroupId: "g2", campaignId: "c2", variantLabel: "numerical", impressions: 1000, clicks: 5, inlineLinkClickCtr: 0.005 }),
  ];
  const inserted: WinnerCreative[] = [];
  const deps: QualifyDeps = {
    findCreativeByVariant: async (gid, label) => {
      if (gid === "g1" && label === "emotional") return mkCreative("cr-g1-emo", "g1", "emotional");
      if (gid === "g2" && label === "numerical") return mkCreative("cr-g2-num", "g2", "numerical");
      return null;
    },
    loadProduct: async () => mkProd(),
    embed: async (texts) => texts.map((_, i) => Array.from({ length: 512 }, () => (i + 1) * 0.01)),
    store: {
      hasCreative: () => false,
      loadAll: () => [],
      insert: (w) => inserted.push(w),
    },
  };

  const res = await qualifyWinners(reports, deps);
  expect(res.inserted).toBe(1);
  expect(res.skipped).toBe(1);
  expect(inserted[0].variantLabel).toBe("emotional");
  expect(inserted[0].embeddingProduct).toHaveLength(512);
  expect(inserted[0].embeddingCopy).toHaveLength(512);
});
```

**Test: "skips variants that already exist in store"** — replace body:

```ts
it("skips variants that already exist in store", async () => {
  const reports = [
    mkReport({ variantGroupId: "g1", campaignId: "c1", variantLabel: "emotional", impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04 }),
  ];
  const inserted: WinnerCreative[] = [];
  const deps: QualifyDeps = {
    findCreativeByVariant: async () => mkCreative("cr-g1-emo", "g1", "emotional"),
    loadProduct: async () => mkProd(),
    embed: async (texts) => texts.map(() => Array.from({ length: 512 }, () => 0.5)),
    store: {
      hasCreative: () => true,
      loadAll: () => [],
      insert: (w) => inserted.push(w),
    },
  };
  const res = await qualifyWinners(reports, deps);
  expect(res.skipped).toBe(1);
  expect(inserted).toHaveLength(0);
});
```

**Test: "skips variants whose embedding is near-duplicate of existing"** — replace body:

```ts
it("skips variants whose embedding is near-duplicate of existing", async () => {
  const existing: WinnerCreative[] = [{
    id: "w0", creativeId: "old", productCategory: "course", productTags: [],
    productDescription: "x", headline: "h", body: "b", cta: "c", variantLabel: "emotional",
    embeddingProduct: Array.from({ length: 512 }, () => 1),
    embeddingCopy: Array.from({ length: 512 }, () => 1),
    qualifiedAt: "2026-04-20T00:00:00Z", impressions: 1000, inlineLinkClickCtr: 0.04,
  }];
  const reports = [
    mkReport({ variantGroupId: "g1", campaignId: "c1", variantLabel: "emotional", impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04 }),
  ];
  const deps: QualifyDeps = {
    findCreativeByVariant: async () => mkCreative("cr-g1-emo", "g1", "emotional"),
    loadProduct: async () => mkProd(),
    embed: async (texts) => texts.map(() => Array.from({ length: 512 }, () => 1.0001)),
    store: {
      hasCreative: () => false,
      loadAll: () => existing,
      insert: () => { throw new Error("should not be called"); },
    },
  };
  const res = await qualifyWinners(reports, deps);
  expect(res.skipped).toBe(1);
  expect(res.inserted).toBe(0);
});
```

**Test: "skips variants when loadCreative returns null"** — rename and replace:

```ts
it("skips variants when findCreativeByVariant returns null", async () => {
  const reports = [
    mkReport({ variantGroupId: "g1", campaignId: "c1", variantLabel: "emotional", impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04 }),
  ];
  const inserted: WinnerCreative[] = [];
  const deps: QualifyDeps = {
    findCreativeByVariant: async () => null,
    loadProduct: async () => mkProd(),
    embed: async (texts) => texts.map(() => Array.from({ length: 512 }, () => 0.5)),
    store: {
      hasCreative: () => false,
      loadAll: () => [],
      insert: (w) => inserted.push(w),
    },
  };
  const res = await qualifyWinners(reports, deps);
  expect(res.skipped).toBe(1);
  expect(res.inserted).toBe(0);
  expect(inserted).toHaveLength(0);
});
```

- [ ] **Step 4: Add Q1 and Q2 tests**

Inside the same `describe("qualifyWinners", ...)` block (after the 4 modified tests), add:

```ts
it("Q1: filters below-threshold aggs before grouping", async () => {
  const reports = [
    // A: imp 300 < 500 (fails), CTR 4.8%
    mkReport({ variantGroupId: "g1", campaignId: "c1", variantLabel: "emotional", impressions: 300, clicks: 14, inlineLinkClickCtr: 0.048 }),
    // B: imp 800 (passes), CTR 4.3%
    mkReport({ variantGroupId: "g1", campaignId: "c2", variantLabel: "numerical", impressions: 800, clicks: 34, inlineLinkClickCtr: 0.043 }),
    // C: imp 900 (passes), CTR 4.0%
    mkReport({ variantGroupId: "g1", campaignId: "c3", variantLabel: "urgency", impressions: 900, clicks: 36, inlineLinkClickCtr: 0.04 }),
  ];
  const inserted: WinnerCreative[] = [];
  const deps: QualifyDeps = {
    findCreativeByVariant: async (_gid, label) => mkCreative(`cr-${label}`, "g1", label as Creative["copy"]["variantLabel"]),
    loadProduct: async () => mkProd(),
    embed: async (texts) => texts.map((_, i) => Array.from({ length: 512 }, () => (i + 1) * 0.01)),
    store: {
      hasCreative: () => false,
      loadAll: () => [],
      insert: (w) => inserted.push(w),
    },
  };
  const res = await qualifyWinners(reports, deps);
  expect(res.inserted).toBe(1);
  expect(inserted[0].variantLabel).toBe("numerical");
});

it("Q2: sibling chosen when best CTR variant fails threshold", async () => {
  const reports = [
    // A: imp 300 < 500 (fails), CTR 5% (best)
    mkReport({ variantGroupId: "g1", campaignId: "c1", variantLabel: "emotional", impressions: 300, clicks: 15, inlineLinkClickCtr: 0.05 }),
    // B: imp 800 (passes), CTR 3%
    mkReport({ variantGroupId: "g1", campaignId: "c2", variantLabel: "numerical", impressions: 800, clicks: 24, inlineLinkClickCtr: 0.03 }),
  ];
  const inserted: WinnerCreative[] = [];
  const deps: QualifyDeps = {
    findCreativeByVariant: async (_gid, label) => mkCreative(`cr-${label}`, "g1", label as Creative["copy"]["variantLabel"]),
    loadProduct: async () => mkProd(),
    embed: async (texts) => texts.map((_, i) => Array.from({ length: 512 }, () => (i + 1) * 0.01)),
    store: {
      hasCreative: () => false,
      loadAll: () => [],
      insert: (w) => inserted.push(w),
    },
  };
  const res = await qualifyWinners(reports, deps);
  expect(res.inserted).toBe(1);
  expect(inserted[0].variantLabel).toBe("numerical");
});
```

- [ ] **Step 5: Run all qualifier tests**

Run: `npx vitest run core/rag/qualifier.test.ts`
Expected: All tests PASS (existing aggregateVariantReports/getMedianCtr/passesThreshold/shouldSkipInsert + 4 pickBestPerVariantGroup + 4 modified qualifyWinners + 2 new Q1/Q2).

- [ ] **Step 6: Run whole test suite to check no regression elsewhere**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add core/rag/types.ts core/rag/qualifier.ts core/rag/qualifier.test.ts
git commit -m "refactor(rag): swap qualifyWinners to findCreativeByVariant + filter-then-group order"
```

---

## Task 3: `core/rag/qualifyJob.ts` factory 신설

**Files:**
- Create: `core/rag/qualifyJob.ts`
- Create: `core/rag/qualifyJob.test.ts`

- [ ] **Step 1: Write J1, J2, J3 failing tests**

Create `core/rag/qualifyJob.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import path from "path";
import os from "os";
import { createQualifyJob } from "./qualifyJob.js";
import type { VoyageClient } from "./voyage.js";
import type { VariantReport } from "../platform/types.js";
import type { Creative, Product } from "../types.js";

let tmpRoot: string;
let creativesDir: string;
let productsDir: string;
let dbPath: string;

async function writeCreative(id: string, variantGroupId: string, variantLabel: Creative["copy"]["variantLabel"]): Promise<void> {
  const creative: Creative = {
    id,
    productId: "p1",
    variantGroupId,
    copy: {
      headline: `h-${id}`,
      body: `b-${id}`,
      cta: "SHOP_NOW",
      hashtags: ["tag"],
      variantLabel,
      metaAssetLabel: `${variantGroupId}::${variantLabel}`,
    },
    imageLocalPath: "/tmp/a.jpg",
    videoLocalPath: "/tmp/a.mp4",
    status: "approved",
    createdAt: "2026-04-20T00:00:00Z",
  };
  await writeFile(path.join(creativesDir, `${id}.json`), JSON.stringify(creative), "utf-8");
}

async function writeProduct(id: string): Promise<void> {
  const product: Product = {
    id,
    name: "Test Product",
    description: "This is a product description used for embedding",
    currency: "KRW",
    targetUrl: "https://example.com",
    tags: ["tag"],
    inputMethod: "manual",
    createdAt: "2026-04-20T00:00:00Z",
    category: "course",
  };
  await writeFile(path.join(productsDir, `${id}.json`), JSON.stringify(product), "utf-8");
}

function mkReport(overrides: Partial<VariantReport>): VariantReport {
  return {
    id: "r1",
    campaignId: "c1",
    variantGroupId: "g1",
    variantLabel: "emotional",
    metaAssetLabel: "g1::emotional",
    productId: "p1",
    platform: "meta",
    date: "2026-04-20",
    impressions: 1000,
    clicks: 40,
    inlineLinkClickCtr: 0.04,
    adQualityRanking: "AVERAGE",
    adEngagementRanking: "AVERAGE",
    adConversionRanking: "AVERAGE",
    ...overrides,
  };
}

const fakeVoyage: VoyageClient = {
  async embed(texts) {
    return texts.map((_, i) => {
      const v = new Array(512).fill(0);
      v[i % 512] = 1;
      return v;
    });
  },
};

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "qualifyjob-"));
  creativesDir = path.join(tmpRoot, "creatives");
  productsDir = path.join(tmpRoot, "products");
  await mkdir(creativesDir, { recursive: true });
  await mkdir(productsDir, { recursive: true });
  dbPath = path.join(tmpRoot, "creatives.db");
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("createQualifyJob", () => {
  it("J1: end-to-end — fixtures to DB insert", async () => {
    await writeProduct("p1");
    await writeProduct("p2");
    await writeCreative("cr1e", "g1", "emotional");
    await writeCreative("cr1n", "g1", "numerical");
    await writeCreative("cr1u", "g1", "urgency");
    await writeCreative("cr2e", "g2", "emotional");
    await writeCreative("cr2n", "g2", "numerical");
    await writeCreative("cr2u", "g2", "urgency");

    const reports: VariantReport[] = [
      mkReport({ variantGroupId: "g1", variantLabel: "emotional", productId: "p1", impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04 }),
      mkReport({ variantGroupId: "g2", variantLabel: "numerical", productId: "p2", impressions: 300, clicks: 10, inlineLinkClickCtr: 0.033 }),
    ];

    const job = createQualifyJob({
      voyage: fakeVoyage,
      creativesDbPath: dbPath,
      creativesDir,
      productsDir,
    });
    const result = await job(reports);
    expect(result.inserted).toBe(1);
  });

  it("J2: findCreativeByVariant matches (variantGroupId, variantLabel)", async () => {
    await writeProduct("p1");
    await writeCreative("cr1e", "g1", "emotional");
    await writeCreative("cr1n", "g1", "numerical");
    await writeCreative("cr1u", "g1", "urgency");

    // All 3 variants pass threshold and share the same group → exactly 1 winner
    // is selected (pickBestPerVariantGroup). The ctr/imp make "urgency" win.
    const reports: VariantReport[] = [
      mkReport({ variantGroupId: "g1", variantLabel: "emotional", impressions: 1000, clicks: 30, inlineLinkClickCtr: 0.03 }),
      mkReport({ variantGroupId: "g1", variantLabel: "numerical", impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04 }),
      mkReport({ variantGroupId: "g1", variantLabel: "urgency", impressions: 1000, clicks: 50, inlineLinkClickCtr: 0.05 }),
    ];

    const job = createQualifyJob({
      voyage: fakeVoyage,
      creativesDbPath: dbPath,
      creativesDir,
      productsDir,
    });
    const result = await job(reports);
    expect(result.inserted).toBe(1);
  });

  it("J3: DB lifecycle — close via finally, second invocation succeeds", async () => {
    await writeProduct("p1");
    await writeProduct("p2");
    await writeCreative("cr1e", "g1", "emotional");
    await writeCreative("cr2e", "g2", "emotional");

    const reports1: VariantReport[] = [
      mkReport({ variantGroupId: "g1", variantLabel: "emotional", productId: "p1", impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04 }),
    ];
    const reports2: VariantReport[] = [
      mkReport({ variantGroupId: "g2", variantLabel: "emotional", productId: "p2", impressions: 1000, clicks: 50, inlineLinkClickCtr: 0.05 }),
    ];

    const job = createQualifyJob({
      voyage: fakeVoyage,
      creativesDbPath: dbPath,
      creativesDir,
      productsDir,
    });
    const r1 = await job(reports1);
    const r2 = await job(reports2);
    expect(r1.inserted).toBe(1);
    expect(r2.inserted).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run core/rag/qualifyJob.test.ts`
Expected: FAIL with module-not-found for `./qualifyJob.js`.

- [ ] **Step 3: Implement `core/rag/qualifyJob.ts`**

Create file:

```ts
import { readdir, readFile } from "fs/promises";
import path from "path";
import { createVoyageClient, type VoyageClient } from "./voyage.js";
import { createCreativesDb } from "./db.js";
import { WinnerStore } from "./store.js";
import { qualifyWinners } from "./qualifier.js";
import type { VariantReport } from "../platform/types.js";
import type { Creative, Product } from "../types.js";
import type { QualifyDeps } from "./types.js";

export interface QualifyJobOverrides {
  voyage?: VoyageClient;
  creativesDbPath?: string;
  creativesDir?: string;
  productsDir?: string;
}

export type QualifyJob = (
  reports: VariantReport[],
) => Promise<{ inserted: number; skipped: number }>;

export function createQualifyJob(overrides: QualifyJobOverrides = {}): QualifyJob {
  const voyage = overrides.voyage ?? createVoyageClient();
  const dbPath = overrides.creativesDbPath ?? "data/creatives.db";
  const creativesDir = overrides.creativesDir ?? "data/creatives";
  const productsDir = overrides.productsDir ?? "data/products";

  return async function qualify(reports: VariantReport[]) {
    const creativeIndex = await buildCreativeIndex(creativesDir);

    const db = createCreativesDb(dbPath);
    try {
      const store = new WinnerStore(db);
      const deps: QualifyDeps = {
        findCreativeByVariant: async (variantGroupId, variantLabel) => {
          const key = `${variantGroupId}::${variantLabel}`;
          return creativeIndex.get(key) ?? null;
        },
        loadProduct: async (productId) => {
          const filePath = path.join(productsDir, `${productId}.json`);
          try {
            const content = await readFile(filePath, "utf-8");
            return JSON.parse(content) as Product;
          } catch {
            return null;
          }
        },
        embed: (texts) => voyage.embed(texts),
        store: {
          hasCreative: (id) => store.hasCreative(id),
          loadAll: () => store.loadAll(),
          insert: (w) => store.insert(w),
        },
      };
      return await qualifyWinners(reports, deps);
    } finally {
      db.close();
    }
  };
}

async function buildCreativeIndex(dir: string): Promise<Map<string, Creative>> {
  const index = new Map<string, Creative>();
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return index;
  }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const content = await readFile(path.join(dir, f), "utf-8");
      const creative = JSON.parse(content) as Creative;
      const key = `${creative.variantGroupId}::${creative.copy.variantLabel}`;
      index.set(key, creative);
    } catch {
      // Skip malformed entries silently.
    }
  }
  return index;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run core/rag/qualifyJob.test.ts`
Expected: All 3 tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add core/rag/qualifyJob.ts core/rag/qualifyJob.test.ts
git commit -m "feat(rag): add createQualifyJob factory with DB lifecycle and JSON scan deps"
```

---

## Task 4: Scheduler wire-up (worker.ts + scheduler.ts)

**Files:**
- Modify: `cli/entries/worker.ts`
- Modify: `server/scheduler.ts`

- [ ] **Step 1: Wire qualify in `cli/entries/worker.ts`**

Replace the current file content:

```ts
import "dotenv/config";
import cron from "node-cron";
import { registerJobs } from "../../core/scheduler/index.js";
import { OWNER_CADENCE } from "../../core/scheduler/cadence.js";
import {
  runCatchupIfNeeded,
  updateStateField,
} from "../../core/scheduler/state.js";
import { createMutex } from "../../core/scheduler/mutex.js";
import {
  collectDailyReports,
  generateWeeklyAnalysis,
} from "../../core/campaign/monitor.js";
import { runScheduledImprovementCycle } from "../../core/scheduler/improvementCycle.js";
import { createQualifyJob } from "../../core/rag/qualifyJob.js";

const required = ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID", "ANTHROPIC_API_KEY"];
for (const key of required) {
  const v = process.env[key];
  if (!v || v === "__INJECT__") {
    console.error(`[worker] ${key} is missing or still set to placeholder "__INJECT__". Refusing to start.`);
    process.exit(2);
  }
}

const mutex = createMutex();
const qualifyJob = createQualifyJob();
const deps = {
  collectDailyReports,
  generateWeeklyAnalysis,
  runImprovementCycle: () => runScheduledImprovementCycle({ qualify: qualifyJob }),
};

registerJobs(cron, deps, OWNER_CADENCE, mutex, updateStateField);
console.log("[worker] scheduler registered (Owner cadence), awaiting cron fires");

void mutex(async () => {
  await runCatchupIfNeeded(deps, OWNER_CADENCE);
}).catch((err) => {
  console.error("[worker] catchup failed:", err);
});

process.stdin.resume();
```

- [ ] **Step 2: Wire qualify in `server/scheduler.ts`**

Replace the current file content:

```ts
import cron from "node-cron";
import { registerJobs } from "../core/scheduler/index.js";
import { SERVER_CADENCE } from "../core/scheduler/cadence.js";
import {
  runCatchupIfNeeded,
  updateStateField,
} from "../core/scheduler/state.js";
import { createMutex } from "../core/scheduler/mutex.js";
import {
  collectDailyReports,
  generateWeeklyAnalysis,
} from "../core/campaign/monitor.js";
import { runScheduledImprovementCycle } from "../core/scheduler/improvementCycle.js";
import { createQualifyJob } from "../core/rag/qualifyJob.js";

export async function startScheduler(): Promise<void> {
  const mutex = createMutex();
  const qualifyJob = createQualifyJob();
  const deps = {
    collectDailyReports,
    generateWeeklyAnalysis,
    runImprovementCycle: () => runScheduledImprovementCycle({ qualify: qualifyJob }),
  };
  registerJobs(cron, deps, SERVER_CADENCE, mutex, updateStateField);
  console.log("[scheduler] registered (Server cadence)");
  void mutex(async () => {
    await runCatchupIfNeeded(deps, SERVER_CADENCE);
  }).catch((err) => {
    console.error("[scheduler] catchup failed:", err);
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS (existing scheduler tests cover registerJobs shape; no new test needed).

- [ ] **Step 5: Commit**

```bash
git add cli/entries/worker.ts server/scheduler.ts
git commit -m "feat(scheduler): wire createQualifyJob into Owner worker and Server scheduler"
```

---

## Task 5: Manual smoke verification

This task has no code changes — it verifies the wired system end-to-end. Do not skip.

- [ ] **Step 1: Check environment**

Confirm `.env` has `VOYAGE_API_KEY`, `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `ANTHROPIC_API_KEY` set to real values (not `__INJECT__`).

Run: `grep -E '^(VOYAGE_API_KEY|META_ACCESS_TOKEN|META_AD_ACCOUNT_ID|ANTHROPIC_API_KEY)=' .env | grep -v __INJECT__`
Expected: 4 lines of real key values.

- [ ] **Step 2: Check fixtures exist**

Run: `ls data/creatives/ | head -5 && ls data/products/ | head -5`
Expected: at least one `.json` file in each directory. If empty, run `npm run pipeline` with at least one product URL to populate, or skip to Step 3 if no real data is available and use the `npx vitest run core/rag/qualifyJob.test.ts` pass as surrogate verification.

- [ ] **Step 3: Check creatives.db state**

Run: `ls -la data/creatives.db 2>/dev/null && sqlite3 data/creatives.db "SELECT COUNT(*) FROM winners;" 2>/dev/null`
Expected: file exists (may be 0 rows). If file missing, it'll be created on first tick.

- [ ] **Step 4: Force a catch-up tick**

Run: `rm -f data/worker-state.json` (forces catch-up)
Run: `node --import tsx/esm cli/entries/worker.ts` — let it run until `[worker] scheduler registered` appears, then observe the catchup phase.

Expected stdout contains either:
- `[improvementCycle] qualify: inserted=N skipped=M` (success)
- `[improvementCycle] qualify stage failed, continuing:` (isolated failure — still acceptable; check the error)

Kill with Ctrl-C after observing the qualify log line (or ~2 minutes).

- [ ] **Step 5: Verify winners table populated**

Run: `sqlite3 data/creatives.db "SELECT COUNT(*) FROM winners;"`
Expected: integer ≥ 0. If 0, this means reports did not pass threshold (not a bug) — acceptable for smoke test.

- [ ] **Step 6: No commit (verification only)**

This task produces no code changes.

---

## Task 6: Final code review via `superpowers:code-reviewer`

- [ ] **Step 1: Get git SHAs for the implementation span**

Run: `BASE_SHA=$(git log --oneline | grep -m1 "qualify wire-up\|Plan C" | tail -1 | awk '{print $1}') && HEAD_SHA=$(git rev-parse HEAD) && echo "BASE=$BASE_SHA HEAD=$HEAD_SHA"`

If that pattern doesn't match, use: `BASE_SHA=$(git rev-parse HEAD~4) && HEAD_SHA=$(git rev-parse HEAD)` (Tasks 1–4 = 4 commits).

- [ ] **Step 2: Dispatch code-reviewer**

Use superpowers:requesting-code-review skill. Fill template:
- `WHAT_WAS_IMPLEMENTED`: Plan C qualify production wire-up — adds pickBestPerVariantGroup helper, refactors qualifyWinners to use findCreativeByVariant, introduces createQualifyJob factory, wires it into Owner worker and Server scheduler.
- `PLAN_OR_REQUIREMENTS`: `docs/superpowers/specs/2026-04-21-plan-c-qualify-wire-up-design.md` + this plan.
- `BASE_SHA` / `HEAD_SHA` from Step 1.
- `DESCRIPTION`: 4 commits spanning qualifier helper, signature refactor, factory, and scheduler wire-up.

- [ ] **Step 3: Act on feedback**

- Critical issues → fix immediately in a new commit (`fix(rag): ...`), then re-review.
- Important issues → fix before moving to Task 7.
- Minor issues → record in `docs/STATUS.md` "알려진 결함" in Task 7.

---

## Task 7: Documentation update

**Files:**
- Modify: `docs/STATUS.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/ARCHITECTURE.md` (only if architecture changed — likely no change for this task)

- [ ] **Step 1: Update `docs/STATUS.md`**

Changes:
1. Line 4 `마지막 업데이트: 2026-04-21` → today's date (if different, otherwise leave).
2. In "Phase 요약" section, change the 🟡 Plan C line to:
   ```
   - [x] Plan C — Winner DB + Voyage RAG 완결 (Qualify 스케줄러 wire-up 포함)
   ```
   Remove the old 🟡 bullet.
3. In "서비스 컴포넌트 상태" table, change Winner DB row status:
   - Before: `🟡 코어 모듈 완료 / qualify 프로덕션 wire-up 유예`
   - After: `✅ 운영`
4. In "최근 변경 이력" at the top, add:
   ```
   - 2026-04-21 feat: Plan C qualify 프로덕션 wire-up 완료 — `createQualifyJob` factory 신설, `qualifyWinners` 시그니처를 `findCreativeByVariant`로 전환하고 filter-then-group 순서 적용, Owner/Server 스케줄러에 주입. 자기 학습 루프가 매 tick마다 winner 후보를 `data/creatives.db`에 적재.
   ```
   Trim the bottom of the list to keep 10 entries.

- [ ] **Step 2: Update `docs/ROADMAP.md`**

Changes:
1. Line 3 `마지막 업데이트: 2026-04-21` → today's date if different.
2. Replace the "현재 추천 다음 작업" section (from the header to the first `---`) with:
   ```
   ## 현재 추천 다음 작업

   **Plan C 실운영 검증** — qualify wire-up이 완료되었으므로(2026-04-21), 실제 `VOYAGE_API_KEY` + 실 런칭 variant report로 (1) qualifyWinners가 MIN_IMPRESSIONS=500 임계 통과 variant만 winner로 남기는지, (2) voyage-3-lite embedding이 `data/creatives.db`에 정상 저장되는지, (3) 새 제품 생성 시 retrieveFewShotForProduct가 유사 winner를 top-K=3으로 회수해 `generateCopy`에 주입하는지 실 데이터로 확인. Owner worker는 6h 주기로 자동 실행되므로 하루 이상 관찰 후 winners 테이블 내용을 검증한다.
   ```
3. In "Tier 1 — 바로 진행", remove the first bullet that references "위 post-chore 완료 후" (Plan C 실운영 검증이 Current가 되었으므로 Tier 1에서는 제거).

- [ ] **Step 3: Decide on `docs/ARCHITECTURE.md`**

This task introduces no new architectural component — `qualifyJob.ts` is a factory within existing `core/rag/` module. Skip unless reviewing ARCHITECTURE.md reveals a stale reference.

Run: `grep -n "qualify\|Winner DB\|Plan C" docs/ARCHITECTURE.md`
Expected: may show mentions. If any text says "qualify는 유예" or similar, update to reflect completion. Otherwise no change.

- [ ] **Step 4: Commit**

```bash
git add docs/STATUS.md docs/ROADMAP.md
# Only include ARCHITECTURE.md if it was modified:
git status docs/ARCHITECTURE.md
git commit -m "docs: record Plan C qualify wire-up completion and shift next-up to production verification"
```

---

## Self-Review Checklist

1. **Spec coverage** — confirmed:
   - §1 (pipeline) → Task 1 (pickBestPerVariantGroup) + Task 2 (filter-then-group order in qualifyWinners).
   - §2 (createQualifyJob interface) → Task 3.
   - §3 (data flow + error) → inherited from `improvementCycle.ts` (no code change needed; Tasks 1–4 preserve the 3-stage try/catch).
   - §4 (tests) → Tasks 1, 2, 3 cover all P, Q, J tests.
   - §5 (rollout) → Tasks 4, 5, 6, 7 follow the reordered sequence.

2. **Placeholder scan** — no TBD/TODO/"implement later"; every code change has full code; every command has expected output.

3. **Type consistency** — `QualifyDeps.findCreativeByVariant` signature identical in Task 2 (types.ts), Task 2 tests, and Task 3 factory. `QualifyJob` and `QualifyJobOverrides` match between Task 3 source and tests. `pickBestPerVariantGroup` signature consistent across Task 1 and Task 2 callsite.

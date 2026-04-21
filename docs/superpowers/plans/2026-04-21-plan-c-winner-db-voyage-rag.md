# Plan C — Winner DB + Voyage RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 광고 variant 성과를 수집·자격 평가해 Voyage embedding과 함께 SQLite(Winner DB)에 저장하고, 새 제품 생성 시 유사 Winner를 RAG로 retrieve해 few-shot으로 Claude에 주입한다.

**Architecture:** 순수 함수 중심으로 qualifier(성과 필터)·retriever(RAG)·voyage(embedding 클라이언트)·store(SQLite 영속화)를 `core/rag/` 하위에 분리. `core/scheduler/improvementCycle.ts`를 3단계(aggregate → qualify → runCycle)로 리팩터링하여 자격 평가를 스케줄러에 통합하고, `cli/pipeline.ts`의 `generateCopy` 호출 직전에 retriever를 삽입해 few-shot을 주입한다.

**Tech Stack:** TypeScript · better-sqlite3 (BLOB 저장) · Voyage AI `voyage-3-lite` (512-dim, fetch 기반 클라이언트) · vitest · 기존 `SchedulerDeps` 팩토리 주입 패턴 준수.

**Spec reference:** `docs/superpowers/specs/2026-04-20-winner-db-variant-orchestration-design.md` Section 6 (Plan C).

---

## File Structure

새로 생성할 파일:

| 경로 | 책임 |
|------|------|
| `core/rag/types.ts` | `WinnerCreative` 인터페이스, `QualifyDeps` 타입 |
| `core/rag/qualifier.ts` | `aggregateVariantReports`, `getMedianCtr`, `passesThreshold`, `shouldSkipInsert`, `qualifyWinners` (orchestrator) |
| `core/rag/retriever.ts` | `cosineSimilarity`, `filterByCategory`, `retrieveTopK`, `dedupByCosine`, `lexicalFallback`, `selectFewShotWinners` (orchestrator) |
| `core/rag/voyage.ts` | `createVoyageClient`, `VoyageClient` 인터페이스, `embed()` |
| `core/rag/db.ts` | `createCreativesDb(path)`, SQLite 스키마, safeAlter |
| `core/rag/store.ts` | `WinnerStore` 클래스 (insert/loadAll/hasCreative) + BLOB 직렬화 helpers |
| `core/rag/qualifier.test.ts`, `retriever.test.ts`, `voyage.test.ts`, `db.test.ts`, `store.test.ts` | vitest 테스트 |

수정할 파일:

| 경로 | 변경 내용 |
|------|---------|
| `.env.example` | `VOYAGE_API_KEY` placeholder 추가 |
| `core/scheduler/improvementCycle.ts` | 3단계 구조로 리팩터 (aggregate / qualify / runCycle) |
| `cli/pipeline.ts` | `generateCopy` 호출 전에 `selectFewShotWinners` 결과를 fewShot 인자로 전달 |
| `core/creative/prompt.ts` | `FewShotExample` 인터페이스는 기존대로 유지 (변경 없음 — 이미 Plan C용으로 설계됨) |
| `docs/STATUS.md`, `docs/ROADMAP.md` | Plan C 완료 기록 |

---

## Task 0: Pre-flight — deps, env, Voyage API 확인

**목적:** 구현 전에 외부 의존성과 API 계약을 확정. 비현실적 가정 제거.

**Files (read-only):**
- `package.json` (better-sqlite3 ^12.9.0 존재 확인)
- `.env.example`

- [ ] **Step 1: better-sqlite3 dep 확인**

```bash
grep -E '"better-sqlite3"' /Users/yuhojin/Desktop/ad_ai/package.json
```

Expected output: `"better-sqlite3": "^12.9.0",` — 이미 존재하면 추가 설치 불필요.

- [ ] **Step 2: Voyage API 계약 검증**

`voyage-3-lite` 모델의 dimension과 엔드포인트 최신 상태 확인. WebFetch로 `https://docs.voyageai.com/docs/embeddings` 또는 `https://docs.voyageai.com/reference/embeddings-api`에서 다음을 확인:

- Endpoint: `POST https://api.voyageai.com/v1/embeddings`
- Request body: `{ "input": string[] | string, "model": "voyage-3-lite" }`
- Response shape: `{ data: [{ embedding: number[], index: number }], model, usage }`
- Dimension: 512 (spec 가정과 일치)

확인 결과를 Task 0 하단에 HTML 주석으로 기록 (`<!-- Voyage verified: endpoint=..., dimension=512, model=voyage-3-lite (2026-04-21) -->`). 스펙 가정과 불일치 발견 시 플랜 수정 후 재시작.

<!-- Voyage verified: endpoint=https://api.voyageai.com/v1/embeddings, dimension=512, model=voyage-3-lite (2026-04-21) -->

- [ ] **Step 3: .env.example에 VOYAGE_API_KEY 추가**

Edit `/Users/yuhojin/Desktop/ad_ai/.env.example`, `# Google AI Studio` 블록 바로 아래에 삽입:

```
# Voyage AI — https://dash.voyageai.com/api-keys
VOYAGE_API_KEY=your-voyage-api-key-here
```

- [ ] **Step 4: Commit pre-flight 결과**

```bash
git add .env.example docs/superpowers/plans/2026-04-21-plan-c-winner-db-voyage-rag.md
git commit -m "chore(plan-c): add VOYAGE_API_KEY env placeholder and record API verification"
```

---

## Task 1: `core/rag/types.ts` — WinnerCreative 인터페이스

**Files:**
- Create: `/Users/yuhojin/Desktop/ad_ai/core/rag/types.ts`

- [ ] **Step 1: 타입 파일 생성**

Write `/Users/yuhojin/Desktop/ad_ai/core/rag/types.ts`:

```ts
import type { VariantReport } from "../platform/types.js";
import type { Product, Creative } from "../types.js";

export interface WinnerCreative {
  id: string;
  creativeId: string;
  productCategory: string | null;
  productTags: string[];
  productDescription: string;
  headline: string;
  body: string;
  cta: string;
  variantLabel: "emotional" | "numerical" | "urgency";
  embeddingProduct: number[];
  embeddingCopy: number[];
  qualifiedAt: string;
  impressions: number;
  inlineLinkClickCtr: number;
}

export interface VariantAggregate {
  campaignId: string;
  variantLabel: string;
  variantGroupId: string;
  productId: string;
  impressions: number;
  clicks: number;
  inlineLinkClickCtr: number;
  adQualityRanking: string | null;
  adEngagementRanking: string | null;
  adConversionRanking: string | null;
}

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

export type { VariantReport };
```

- [ ] **Step 2: Commit**

```bash
git add core/rag/types.ts
git commit -m "feat(rag): add WinnerCreative, VariantAggregate, QualifyDeps types"
```

---

## Task 2: `qualifier.ts` — aggregate + getMedianCtr + passesThreshold

**Files:**
- Create: `/Users/yuhojin/Desktop/ad_ai/core/rag/qualifier.ts`
- Create: `/Users/yuhojin/Desktop/ad_ai/core/rag/qualifier.test.ts`

- [ ] **Step 1: aggregateVariantReports 실패 테스트 작성**

Write `/Users/yuhojin/Desktop/ad_ai/core/rag/qualifier.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  aggregateVariantReports,
  getMedianCtr,
  passesThreshold,
} from "./qualifier.js";
import type { VariantReport } from "../platform/types.js";

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
    impressions: 100,
    clicks: 2,
    inlineLinkClickCtr: 0.02,
    adQualityRanking: "AVERAGE",
    adEngagementRanking: "AVERAGE",
    adConversionRanking: "AVERAGE",
    ...overrides,
  };
}

describe("aggregateVariantReports", () => {
  it("groups rows by campaignId::variantLabel and sums impressions/clicks", () => {
    const reports = [
      mkReport({ campaignId: "c1", variantLabel: "emotional", impressions: 100, clicks: 2 }),
      mkReport({ campaignId: "c1", variantLabel: "emotional", impressions: 200, clicks: 5, date: "2026-04-21" }),
      mkReport({ campaignId: "c1", variantLabel: "numerical", impressions: 300, clicks: 4 }),
    ];
    const agg = aggregateVariantReports(reports);
    expect(agg).toHaveLength(2);
    const emo = agg.find((a) => a.variantLabel === "emotional")!;
    expect(emo.impressions).toBe(300);
    expect(emo.clicks).toBe(7);
    expect(emo.inlineLinkClickCtr).toBeCloseTo(7 / 300, 5);
  });

  it("copies ad-level ranking from the first row in each group", () => {
    const reports = [
      mkReport({ campaignId: "c1", variantLabel: "emotional", adQualityRanking: "BELOW_AVERAGE_20_30" }),
      mkReport({ campaignId: "c1", variantLabel: "emotional", adQualityRanking: "AVERAGE", date: "2026-04-21" }),
    ];
    const agg = aggregateVariantReports(reports);
    expect(agg[0].adQualityRanking).toBe("BELOW_AVERAGE_20_30");
  });

  it("returns [] for empty input", () => {
    expect(aggregateVariantReports([])).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd /Users/yuhojin/Desktop/ad_ai && npx vitest run core/rag/qualifier.test.ts
```

Expected: FAIL with "Cannot find module './qualifier.js'" or similar.

- [ ] **Step 3: aggregateVariantReports 구현**

Write `/Users/yuhojin/Desktop/ad_ai/core/rag/qualifier.ts` (initial):

```ts
import type { VariantReport } from "../platform/types.js";
import type { VariantAggregate } from "./types.js";

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
      byKey.set(key, {
        campaignId: r.campaignId,
        variantLabel: r.variantLabel,
        variantGroupId: r.variantGroupId,
        productId: r.productId,
        impressions: r.impressions,
        clicks: r.clicks,
        inlineLinkClickCtr:
          r.impressions === 0 ? 0 : r.clicks / r.impressions,
        adQualityRanking: r.adQualityRanking,
        adEngagementRanking: r.adEngagementRanking,
        adConversionRanking: r.adConversionRanking,
      });
    }
  }
  return Array.from(byKey.values());
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run core/rag/qualifier.test.ts
```

Expected: 3/3 PASS.

- [ ] **Step 5: getMedianCtr 실패 테스트 추가**

Append to `qualifier.test.ts`:

```ts
describe("getMedianCtr", () => {
  it("returns 0.015 fallback when sample count < 10", () => {
    const reports = Array.from({ length: 5 }, () =>
      mkReport({ inlineLinkClickCtr: 0.05 }),
    );
    expect(getMedianCtr(reports)).toBe(0.015);
  });

  it("returns median for odd sample", () => {
    const ctrs = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.10, 0.11];
    const reports = ctrs.map((c) => mkReport({ inlineLinkClickCtr: c }));
    expect(getMedianCtr(reports)).toBeCloseTo(0.06, 5);
  });

  it("returns average of two middles for even sample", () => {
    const ctrs = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.10];
    const reports = ctrs.map((c) => mkReport({ inlineLinkClickCtr: c }));
    expect(getMedianCtr(reports)).toBeCloseTo((0.05 + 0.06) / 2, 5);
  });

  it("returns 0.015 fallback for empty array", () => {
    expect(getMedianCtr([])).toBe(0.015);
  });
});
```

- [ ] **Step 6: getMedianCtr 구현**

Append to `qualifier.ts`:

```ts
const CTR_FALLBACK = 0.015;
const MIN_SAMPLE = 10;

export function getMedianCtr(reports: VariantReport[]): number {
  if (reports.length < MIN_SAMPLE) return CTR_FALLBACK;
  const sorted = reports.map((r) => r.inlineLinkClickCtr).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
```

- [ ] **Step 7: 테스트 통과 확인**

```bash
npx vitest run core/rag/qualifier.test.ts
```

Expected: 7/7 PASS.

- [ ] **Step 8: passesThreshold 실패 테스트 추가**

Append to `qualifier.test.ts`:

```ts
describe("passesThreshold", () => {
  const medianCtr = 0.02;

  it("rejects impressions < 500", () => {
    const agg = {
      campaignId: "c1", variantLabel: "emotional", variantGroupId: "g1", productId: "p1",
      impressions: 499, clicks: 20, inlineLinkClickCtr: 0.04,
      adQualityRanking: "AVERAGE", adEngagementRanking: "AVERAGE", adConversionRanking: "AVERAGE",
    };
    expect(passesThreshold(agg, medianCtr)).toBe(false);
  });

  it("rejects when adQualityRanking is BELOW_AVERAGE_*", () => {
    const agg = {
      campaignId: "c1", variantLabel: "emotional", variantGroupId: "g1", productId: "p1",
      impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04,
      adQualityRanking: "BELOW_AVERAGE_20_30", adEngagementRanking: "AVERAGE", adConversionRanking: "AVERAGE",
    };
    expect(passesThreshold(agg, medianCtr)).toBe(false);
  });

  it("rejects when adEngagementRanking is BELOW_AVERAGE_*", () => {
    const agg = {
      campaignId: "c1", variantLabel: "emotional", variantGroupId: "g1", productId: "p1",
      impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04,
      adQualityRanking: "AVERAGE", adEngagementRanking: "BELOW_AVERAGE_35_50", adConversionRanking: "AVERAGE",
    };
    expect(passesThreshold(agg, medianCtr)).toBe(false);
  });

  it("rejects when CTR < median", () => {
    const agg = {
      campaignId: "c1", variantLabel: "emotional", variantGroupId: "g1", productId: "p1",
      impressions: 1000, clicks: 10, inlineLinkClickCtr: 0.01,
      adQualityRanking: "AVERAGE", adEngagementRanking: "AVERAGE", adConversionRanking: "AVERAGE",
    };
    expect(passesThreshold(agg, medianCtr)).toBe(false);
  });

  it("passes at boundary impressions=500 and CTR=median", () => {
    const agg = {
      campaignId: "c1", variantLabel: "emotional", variantGroupId: "g1", productId: "p1",
      impressions: 500, clicks: 10, inlineLinkClickCtr: 0.02,
      adQualityRanking: "AVERAGE", adEngagementRanking: "AVERAGE", adConversionRanking: "AVERAGE",
    };
    expect(passesThreshold(agg, medianCtr)).toBe(true);
  });
});
```

- [ ] **Step 9: passesThreshold 구현**

Append to `qualifier.ts`:

```ts
import type { VariantAggregate } from "./types.js";

const MIN_IMPRESSIONS = 500;

export function passesThreshold(
  agg: VariantAggregate,
  medianCtr: number,
): boolean {
  if (agg.impressions < MIN_IMPRESSIONS) return false;
  if (agg.adQualityRanking?.startsWith("BELOW_AVERAGE")) return false;
  if (agg.adEngagementRanking?.startsWith("BELOW_AVERAGE")) return false;
  if (agg.inlineLinkClickCtr < medianCtr) return false;
  return true;
}
```

(Note: import for `VariantAggregate` 이미 Step 3에서 추가됨. 중복되면 TypeScript가 에러 — 파일 상단의 기존 import에 이미 포함된 상태로 병합할 것.)

- [ ] **Step 10: 전체 테스트 통과 확인**

```bash
npx vitest run core/rag/qualifier.test.ts
```

Expected: 12/12 PASS.

- [ ] **Step 11: Commit**

```bash
git add core/rag/qualifier.ts core/rag/qualifier.test.ts
git commit -m "feat(rag): add qualifier pure functions (aggregate, median, threshold)"
```

---

## Task 3: `retriever.ts` — cosineSimilarity + dedupByCosine

**Files:**
- Create: `/Users/yuhojin/Desktop/ad_ai/core/rag/retriever.ts`
- Create: `/Users/yuhojin/Desktop/ad_ai/core/rag/retriever.test.ts`

- [ ] **Step 1: cosineSimilarity 실패 테스트**

Write `/Users/yuhojin/Desktop/ad_ai/core/rag/retriever.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cosineSimilarity, dedupByCosine } from "./retriever.js";
import type { WinnerCreative } from "./types.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });

  it("throws on length mismatch", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/length/i);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run core/rag/retriever.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: cosineSimilarity 구현**

Write `/Users/yuhojin/Desktop/ad_ai/core/rag/retriever.ts`:

```ts
import type { WinnerCreative } from "./types.js";
import type { Product } from "../types.js";

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: length mismatch ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
```

- [ ] **Step 4: cosineSimilarity 테스트 통과 확인**

```bash
npx vitest run core/rag/retriever.test.ts
```

Expected: 4/4 PASS.

- [ ] **Step 5: dedupByCosine 실패 테스트 추가**

Append to `retriever.test.ts`:

```ts
function mkWinner(id: string, embedding: number[]): WinnerCreative {
  return {
    id,
    creativeId: `creative-${id}`,
    productCategory: "course",
    productTags: [],
    productDescription: "desc",
    headline: "h",
    body: "b",
    cta: "c",
    variantLabel: "emotional",
    embeddingProduct: embedding,
    embeddingCopy: embedding,
    qualifiedAt: "2026-04-20T00:00:00Z",
    impressions: 1000,
    inlineLinkClickCtr: 0.03,
  };
}

describe("dedupByCosine", () => {
  it("removes near-duplicate pairs above threshold, preserves order", () => {
    const candidates = [
      mkWinner("a", [1, 0, 0]),
      mkWinner("b", [0.98, 0.01, 0]), // very similar to a
      mkWinner("c", [0, 1, 0]),
    ];
    const result = dedupByCosine(candidates, 0.95, "embeddingProduct");
    expect(result.map((w) => w.id)).toEqual(["a", "c"]);
  });

  it("keeps all when all are distinct below threshold", () => {
    const candidates = [
      mkWinner("a", [1, 0, 0]),
      mkWinner("b", [0, 1, 0]),
      mkWinner("c", [0, 0, 1]),
    ];
    const result = dedupByCosine(candidates, 0.95, "embeddingProduct");
    expect(result).toHaveLength(3);
  });

  it("returns empty for empty input", () => {
    expect(dedupByCosine([], 0.95, "embeddingProduct")).toEqual([]);
  });
});
```

- [ ] **Step 6: dedupByCosine 구현**

Append to `retriever.ts`:

```ts
export function dedupByCosine(
  candidates: WinnerCreative[],
  threshold: number,
  field: "embeddingProduct" | "embeddingCopy",
): WinnerCreative[] {
  const kept: WinnerCreative[] = [];
  for (const c of candidates) {
    const isDup = kept.some(
      (k) => cosineSimilarity(c[field], k[field]) > threshold,
    );
    if (!isDup) kept.push(c);
  }
  return kept;
}
```

- [ ] **Step 7: 테스트 전체 통과 확인**

```bash
npx vitest run core/rag/retriever.test.ts
```

Expected: 7/7 PASS.

- [ ] **Step 8: Commit**

```bash
git add core/rag/retriever.ts core/rag/retriever.test.ts
git commit -m "feat(rag): add cosineSimilarity and dedupByCosine"
```

---

## Task 4: `retriever.ts` — filterByCategory + retrieveTopK + lexicalFallback

**Files:**
- Modify: `/Users/yuhojin/Desktop/ad_ai/core/rag/retriever.ts`
- Modify: `/Users/yuhojin/Desktop/ad_ai/core/rag/retriever.test.ts`

- [ ] **Step 1: filterByCategory 실패 테스트**

Append to `retriever.test.ts`:

```ts
import { filterByCategory, retrieveTopK, lexicalFallback } from "./retriever.js";

describe("filterByCategory", () => {
  it("returns only winners with matching category", () => {
    const winners = [
      { ...mkWinner("a", [1, 0, 0]), productCategory: "course" },
      { ...mkWinner("b", [0, 1, 0]), productCategory: "ecommerce" },
      { ...mkWinner("c", [0, 0, 1]), productCategory: "course" },
    ];
    const result = filterByCategory(winners, "course");
    expect(result.map((w) => w.id)).toEqual(["a", "c"]);
  });

  it("returns [] when category is null and no winner has null category", () => {
    const winners = [{ ...mkWinner("a", [1, 0, 0]), productCategory: "course" }];
    expect(filterByCategory(winners, null)).toEqual([]);
  });

  it("returns matching null-category winners when target is null", () => {
    const winners = [
      { ...mkWinner("a", [1, 0, 0]), productCategory: null },
      { ...mkWinner("b", [0, 1, 0]), productCategory: "course" },
    ];
    const result = filterByCategory(winners, null);
    expect(result.map((w) => w.id)).toEqual(["a"]);
  });

  it("returns [] for empty corpus", () => {
    expect(filterByCategory([], "course")).toEqual([]);
  });
});
```

- [ ] **Step 2: filterByCategory 구현**

Append to `retriever.ts`:

```ts
export function filterByCategory(
  corpus: WinnerCreative[],
  category: string | null,
): WinnerCreative[] {
  return corpus.filter((w) => w.productCategory === category);
}
```

- [ ] **Step 3: retrieveTopK 실패 테스트 추가**

Append to `retriever.test.ts`:

```ts
describe("retrieveTopK", () => {
  it("returns top-k by cosine similarity above minCosine", () => {
    const query = [1, 0, 0];
    const corpus = [
      mkWinner("a", [0.9, 0.1, 0]),   // high sim
      mkWinner("b", [0, 1, 0]),        // orthogonal — below 0.6
      mkWinner("c", [0.7, 0.3, 0]),    // medium sim
      mkWinner("d", [0.95, 0.05, 0]),  // highest sim
    ];
    const result = retrieveTopK(query, corpus, 3, 0.6);
    expect(result.map((w) => w.id)).toEqual(["d", "a", "c"]);
  });

  it("returns fewer than k when not enough pass minCosine", () => {
    const query = [1, 0, 0];
    const corpus = [
      mkWinner("a", [0.9, 0.1, 0]),
      mkWinner("b", [0, 1, 0]),
    ];
    const result = retrieveTopK(query, corpus, 3, 0.6);
    expect(result.map((w) => w.id)).toEqual(["a"]);
  });

  it("returns [] for empty corpus", () => {
    expect(retrieveTopK([1, 0], [], 3, 0.6)).toEqual([]);
  });
});
```

- [ ] **Step 4: retrieveTopK 구현**

Append to `retriever.ts`:

```ts
export function retrieveTopK(
  queryEmbed: number[],
  corpus: WinnerCreative[],
  k: number,
  minCosine: number,
): WinnerCreative[] {
  const scored = corpus
    .map((w) => ({ w, score: cosineSimilarity(queryEmbed, w.embeddingProduct) }))
    .filter((s) => s.score >= minCosine)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return scored.map((s) => s.w);
}
```

- [ ] **Step 5: lexicalFallback 실패 테스트 추가**

Append to `retriever.test.ts`:

```ts
describe("lexicalFallback", () => {
  it("ranks by Jaccard tag overlap", () => {
    const productTags = ["react", "frontend", "hooks"];
    const corpus = [
      { ...mkWinner("a", [0, 0, 0]), productTags: ["react", "hooks"] },          // J=2/3
      { ...mkWinner("b", [0, 0, 0]), productTags: ["vue", "backend"] },           // J=0
      { ...mkWinner("c", [0, 0, 0]), productTags: ["react", "frontend", "hooks"] }, // J=3/3
    ];
    const result = lexicalFallback(productTags, corpus, 2);
    expect(result.map((w) => w.id)).toEqual(["c", "a"]);
  });

  it("returns [] for empty corpus", () => {
    expect(lexicalFallback(["tag"], [], 3)).toEqual([]);
  });

  it("returns [] when no tags overlap", () => {
    const corpus = [{ ...mkWinner("a", [0, 0, 0]), productTags: ["unrelated"] }];
    expect(lexicalFallback(["react"], corpus, 3)).toEqual([]);
  });
});
```

- [ ] **Step 6: lexicalFallback 구현**

Append to `retriever.ts`:

```ts
function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function lexicalFallback(
  productTags: string[],
  corpus: WinnerCreative[],
  k: number,
): WinnerCreative[] {
  const scored = corpus
    .map((w) => ({ w, score: jaccard(productTags, w.productTags) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return scored.map((s) => s.w);
}
```

- [ ] **Step 7: 전체 테스트 통과 확인**

```bash
npx vitest run core/rag/retriever.test.ts
```

Expected: 15/15 PASS (7 from Task 3 + 8 new).

- [ ] **Step 8: Commit**

```bash
git add core/rag/retriever.ts core/rag/retriever.test.ts
git commit -m "feat(rag): add filterByCategory, retrieveTopK, lexicalFallback"
```

---

## Task 5: Orchestrators — `selectFewShotWinners` + `shouldSkipInsert`

**Files:**
- Modify: `/Users/yuhojin/Desktop/ad_ai/core/rag/retriever.ts`
- Modify: `/Users/yuhojin/Desktop/ad_ai/core/rag/retriever.test.ts`
- Modify: `/Users/yuhojin/Desktop/ad_ai/core/rag/qualifier.ts`
- Modify: `/Users/yuhojin/Desktop/ad_ai/core/rag/qualifier.test.ts`

- [ ] **Step 1: selectFewShotWinners 실패 테스트**

Append to `retriever.test.ts`:

```ts
import { selectFewShotWinners } from "./retriever.js";
import type { Product } from "../types.js";

function mkProduct(overrides: Partial<Product>): Product {
  return {
    id: "p1",
    name: "Test",
    description: "desc",
    currency: "KRW",
    targetUrl: "https://example.com",
    tags: [],
    inputMethod: "manual",
    createdAt: "2026-04-20T00:00:00Z",
    ...overrides,
  };
}

describe("selectFewShotWinners", () => {
  const queryEmbed = [1, 0, 0];

  it("returns category-matched top-3 when enough available", () => {
    const allWinners = [
      { ...mkWinner("a", [0.9, 0.1, 0]), productCategory: "course" },
      { ...mkWinner("b", [0.85, 0.1, 0]), productCategory: "course" },
      { ...mkWinner("c", [0.8, 0.1, 0]), productCategory: "course" },
      { ...mkWinner("d", [0.95, 0.05, 0]), productCategory: "ecommerce" },
    ];
    const product = mkProduct({ category: "course", tags: [] });
    const result = selectFewShotWinners(queryEmbed, allWinners, product);
    expect(result.map((w) => w.id)).toEqual(["a", "b", "c"]);
  });

  it("fills from global pool when category yields fewer than 3", () => {
    const allWinners = [
      { ...mkWinner("a", [0.9, 0.1, 0]), productCategory: "course" },
      { ...mkWinner("b", [0.95, 0.05, 0]), productCategory: "ecommerce" },
      { ...mkWinner("c", [0.8, 0.1, 0]), productCategory: "service" },
    ];
    const product = mkProduct({ category: "course", tags: [] });
    const result = selectFewShotWinners(queryEmbed, allWinners, product);
    expect(result.map((w) => w.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("falls back to lexical when cosine results still < 3", () => {
    const allWinners = [
      { ...mkWinner("a", [0.9, 0.1, 0]), productCategory: "course", productTags: ["react"] },
      { ...mkWinner("b", [0, 1, 0]), productCategory: "course", productTags: ["react", "hooks"] }, // cosine below 0.6
      { ...mkWinner("c", [0, 0, 1]), productCategory: "course", productTags: ["react"] }, // cosine below 0.6
    ];
    const product = mkProduct({ category: "course", tags: ["react", "hooks"] });
    const result = selectFewShotWinners(queryEmbed, allWinners, product);
    expect(result.map((w) => w.id)).toContain("a");
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("dedupes near-duplicates by embeddingProduct cosine > 0.95", () => {
    const allWinners = [
      { ...mkWinner("a", [0.9, 0.1, 0]), productCategory: "course" },
      { ...mkWinner("b", [0.91, 0.09, 0]), productCategory: "course" }, // near-duplicate of a
      { ...mkWinner("c", [0.7, 0.3, 0]), productCategory: "course" },
    ];
    const product = mkProduct({ category: "course", tags: [] });
    const result = selectFewShotWinners(queryEmbed, allWinners, product);
    const ids = result.map((w) => w.id);
    expect(ids).not.toContain("b");
  });

  it("returns [] when Winner DB is empty", () => {
    const product = mkProduct({ category: "course", tags: [] });
    expect(selectFewShotWinners(queryEmbed, [], product)).toEqual([]);
  });
});
```

- [ ] **Step 2: selectFewShotWinners 구현**

Append to `retriever.ts`:

```ts
const MIN_COSINE = 0.6;
const DEDUP_COSINE = 0.95;
const TOP_K = 3;

export function selectFewShotWinners(
  queryEmbed: number[],
  allWinners: WinnerCreative[],
  product: Product,
): WinnerCreative[] {
  if (allWinners.length === 0) return [];

  const categoryMatched = filterByCategory(allWinners, product.category ?? null);
  let ranked = retrieveTopK(queryEmbed, categoryMatched, TOP_K, MIN_COSINE);

  if (ranked.length < TOP_K) {
    const remaining = allWinners.filter((w) => !ranked.includes(w));
    const global = retrieveTopK(queryEmbed, remaining, TOP_K - ranked.length, MIN_COSINE);
    ranked = [...ranked, ...global];
  }

  if (ranked.length < TOP_K) {
    const remaining = allWinners.filter((w) => !ranked.includes(w));
    const lex = lexicalFallback(product.tags, remaining, TOP_K - ranked.length);
    ranked = [...ranked, ...lex];
  }

  return dedupByCosine(ranked, DEDUP_COSINE, "embeddingProduct");
}
```

- [ ] **Step 3: selectFewShotWinners 테스트 통과 확인**

```bash
npx vitest run core/rag/retriever.test.ts
```

Expected: 20/20 PASS.

- [ ] **Step 4: shouldSkipInsert 실패 테스트**

Append to `qualifier.test.ts`:

```ts
import { shouldSkipInsert } from "./qualifier.js";
import type { WinnerCreative } from "./types.js";

function mkWinner(id: string, embedding: number[]): WinnerCreative {
  return {
    id, creativeId: `c-${id}`, productCategory: "course", productTags: [],
    productDescription: "d", headline: "h", body: "b", cta: "c",
    variantLabel: "emotional",
    embeddingProduct: embedding, embeddingCopy: embedding,
    qualifiedAt: "2026-04-20T00:00:00Z", impressions: 1000, inlineLinkClickCtr: 0.03,
  };
}

describe("shouldSkipInsert", () => {
  it("returns true when similar winner exists (cosine > 0.95)", () => {
    const existing = [mkWinner("a", [1, 0, 0])];
    const candidate = [0.99, 0.01, 0];
    expect(shouldSkipInsert(candidate, existing)).toBe(true);
  });

  it("returns false when all existing winners are dissimilar", () => {
    const existing = [mkWinner("a", [0, 1, 0]), mkWinner("b", [0, 0, 1])];
    const candidate = [1, 0, 0];
    expect(shouldSkipInsert(candidate, existing)).toBe(false);
  });

  it("returns false for empty existing list", () => {
    expect(shouldSkipInsert([1, 0, 0], [])).toBe(false);
  });
});
```

- [ ] **Step 5: shouldSkipInsert 구현**

Append to `qualifier.ts`:

```ts
import { cosineSimilarity } from "./retriever.js";
import type { WinnerCreative } from "./types.js";

const SKIP_SIMILARITY = 0.95;

export function shouldSkipInsert(
  candidateEmbed: number[],
  existingWinners: WinnerCreative[],
): boolean {
  return existingWinners.some(
    (w) => cosineSimilarity(candidateEmbed, w.embeddingProduct) > SKIP_SIMILARITY,
  );
}
```

- [ ] **Step 6: 전체 테스트 통과 확인**

```bash
npx vitest run core/rag/
```

Expected: 23/23 PASS.

- [ ] **Step 7: Commit**

```bash
git add core/rag/retriever.ts core/rag/retriever.test.ts core/rag/qualifier.ts core/rag/qualifier.test.ts
git commit -m "feat(rag): add selectFewShotWinners and shouldSkipInsert orchestrators"
```

---

## Task 6: `voyage.ts` — Voyage embedding 클라이언트

**Files:**
- Create: `/Users/yuhojin/Desktop/ad_ai/core/rag/voyage.ts`
- Create: `/Users/yuhojin/Desktop/ad_ai/core/rag/voyage.test.ts`

- [ ] **Step 1: 실패 테스트**

Write `/Users/yuhojin/Desktop/ad_ai/core/rag/voyage.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createVoyageClient } from "./voyage.js";

describe("createVoyageClient", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.VOYAGE_API_KEY = "test-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("POSTs to voyage embeddings endpoint with api key header", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }] }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const client = createVoyageClient();
    const result = await client.embed(["hello"]);

    expect(result).toEqual([[0.1, 0.2, 0.3]]);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.voyageai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Authorization": "Bearer test-key",
          "Content-Type": "application/json",
        }),
      }),
    );
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ input: ["hello"], model: "voyage-3-lite" });
  });

  it("throws when response is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    }) as unknown as typeof fetch;

    const client = createVoyageClient();
    await expect(client.embed(["x"])).rejects.toThrow(/401/);
  });

  it("preserves order of returned embeddings by index", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { embedding: [2], index: 1 },
          { embedding: [1], index: 0 },
        ],
      }),
    }) as unknown as typeof fetch;

    const client = createVoyageClient();
    const result = await client.embed(["a", "b"]);
    expect(result).toEqual([[1], [2]]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run core/rag/voyage.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: 구현**

Write `/Users/yuhojin/Desktop/ad_ai/core/rag/voyage.ts`:

```ts
export interface VoyageClient {
  embed(texts: string[]): Promise<number[][]>;
}

interface VoyageResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

export function createVoyageClient(): VoyageClient {
  return {
    async embed(texts: string[]): Promise<number[][]> {
      const apiKey = process.env.VOYAGE_API_KEY;
      if (!apiKey) throw new Error("VOYAGE_API_KEY not set");

      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: texts, model: "voyage-3-lite" }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Voyage API ${res.status}: ${text}`);
      }
      const data = (await res.json()) as VoyageResponse;
      const sorted = [...data.data].sort((a, b) => a.index - b.index);
      return sorted.map((d) => d.embedding);
    },
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run core/rag/voyage.test.ts
```

Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add core/rag/voyage.ts core/rag/voyage.test.ts
git commit -m "feat(rag): add Voyage embedding client (fetch-based)"
```

---

## Task 7: `db.ts` — SQLite 스키마 + createCreativesDb

**Files:**
- Create: `/Users/yuhojin/Desktop/ad_ai/core/rag/db.ts`
- Create: `/Users/yuhojin/Desktop/ad_ai/core/rag/db.test.ts`

- [ ] **Step 1: 실패 테스트**

Write `/Users/yuhojin/Desktop/ad_ai/core/rag/db.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { createCreativesDb } from "./db.js";
import { unlinkSync, existsSync } from "fs";

const TEST_DB = "/tmp/ad-ai-test-creatives.db";

describe("createCreativesDb", () => {
  afterEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    if (existsSync(`${TEST_DB}-wal`)) unlinkSync(`${TEST_DB}-wal`);
    if (existsSync(`${TEST_DB}-shm`)) unlinkSync(`${TEST_DB}-shm`);
  });

  it("creates winners table with required columns", () => {
    const db = createCreativesDb(TEST_DB);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='winners'")
      .get();
    expect(row).toBeTruthy();
    const cols = db.prepare("PRAGMA table_info(winners)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        "id", "creative_id", "product_category", "product_tags", "product_description",
        "headline", "body", "cta", "variant_label",
        "embedding_product", "embedding_copy",
        "qualified_at", "impressions", "inline_link_click_ctr",
      ].sort(),
    );
    db.close();
  });

  it("creates indexes on category and creative_id", () => {
    const db = createCreativesDb(TEST_DB);
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='winners'")
      .all() as Array<{ name: string }>;
    const idxNames = idx.map((r) => r.name);
    expect(idxNames).toContain("idx_winners_category");
    expect(idxNames).toContain("idx_winners_creative");
    db.close();
  });

  it("is idempotent (can be called twice on same file)", () => {
    const db1 = createCreativesDb(TEST_DB);
    db1.close();
    const db2 = createCreativesDb(TEST_DB);
    expect(
      db2.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='winners'").get(),
    ).toBeTruthy();
    db2.close();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run core/rag/db.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: 구현**

Write `/Users/yuhojin/Desktop/ad_ai/core/rag/db.ts`:

```ts
import Database from "better-sqlite3";

export type CreativesDb = Database.Database;

export function createCreativesDb(path = "data/creatives.db"): CreativesDb {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS winners (
      id TEXT PRIMARY KEY,
      creative_id TEXT NOT NULL,
      product_category TEXT,
      product_tags TEXT NOT NULL,
      product_description TEXT NOT NULL,
      headline TEXT NOT NULL,
      body TEXT NOT NULL,
      cta TEXT NOT NULL,
      variant_label TEXT NOT NULL,
      embedding_product BLOB NOT NULL,
      embedding_copy BLOB NOT NULL,
      qualified_at TEXT NOT NULL,
      impressions INTEGER NOT NULL,
      inline_link_click_ctr REAL NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_winners_category ON winners(product_category);
    CREATE INDEX IF NOT EXISTS idx_winners_creative ON winners(creative_id);
  `);

  const safeAlter = (sql: string) => { try { db.exec(sql); } catch {} };
  // Future schema migrations go here using safeAlter.

  return db;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run core/rag/db.test.ts
```

Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add core/rag/db.ts core/rag/db.test.ts
git commit -m "feat(rag): add creatives.db schema and createCreativesDb"
```

---

## Task 8: `store.ts` — WinnerStore (insert/loadAll/hasCreative)

**Files:**
- Create: `/Users/yuhojin/Desktop/ad_ai/core/rag/store.ts`
- Create: `/Users/yuhojin/Desktop/ad_ai/core/rag/store.test.ts`

- [ ] **Step 1: 실패 테스트**

Write `/Users/yuhojin/Desktop/ad_ai/core/rag/store.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { createCreativesDb } from "./db.js";
import { WinnerStore } from "./store.js";
import type { WinnerCreative } from "./types.js";
import { unlinkSync, existsSync } from "fs";

const TEST_DB = "/tmp/ad-ai-test-store.db";

function cleanup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = `${TEST_DB}${suffix}`;
    if (existsSync(p)) unlinkSync(p);
  }
}

function mkWinner(overrides: Partial<WinnerCreative> = {}): WinnerCreative {
  return {
    id: "w1",
    creativeId: "creative-1",
    productCategory: "course",
    productTags: ["react", "hooks"],
    productDescription: "React hooks tutorial",
    headline: "Learn React Hooks",
    body: "Master modern React in 2 weeks.",
    cta: "SIGN_UP",
    variantLabel: "emotional",
    embeddingProduct: Array.from({ length: 512 }, (_, i) => Math.sin(i)),
    embeddingCopy: Array.from({ length: 512 }, (_, i) => Math.cos(i)),
    qualifiedAt: "2026-04-20T00:00:00Z",
    impressions: 1500,
    inlineLinkClickCtr: 0.04,
    ...overrides,
  };
}

describe("WinnerStore", () => {
  afterEach(cleanup);

  it("insert + loadAll roundtrips all fields including 512-dim embeddings", () => {
    const db = createCreativesDb(TEST_DB);
    const store = new WinnerStore(db);
    const winner = mkWinner();
    store.insert(winner);
    const all = store.loadAll();
    expect(all).toHaveLength(1);
    const loaded = all[0];
    expect(loaded.id).toBe(winner.id);
    expect(loaded.creativeId).toBe(winner.creativeId);
    expect(loaded.productTags).toEqual(winner.productTags);
    expect(loaded.embeddingProduct).toHaveLength(512);
    expect(loaded.embeddingProduct[0]).toBeCloseTo(winner.embeddingProduct[0], 5);
    expect(loaded.embeddingCopy).toHaveLength(512);
    db.close();
  });

  it("hasCreative returns true after insert, false otherwise", () => {
    const db = createCreativesDb(TEST_DB);
    const store = new WinnerStore(db);
    expect(store.hasCreative("creative-1")).toBe(false);
    store.insert(mkWinner({ creativeId: "creative-1" }));
    expect(store.hasCreative("creative-1")).toBe(true);
    expect(store.hasCreative("creative-99")).toBe(false);
    db.close();
  });

  it("loadAll returns empty array for fresh DB", () => {
    const db = createCreativesDb(TEST_DB);
    const store = new WinnerStore(db);
    expect(store.loadAll()).toEqual([]);
    db.close();
  });

  it("insert handles null productCategory", () => {
    const db = createCreativesDb(TEST_DB);
    const store = new WinnerStore(db);
    store.insert(mkWinner({ productCategory: null }));
    const all = store.loadAll();
    expect(all[0].productCategory).toBeNull();
    db.close();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run core/rag/store.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: 구현**

Write `/Users/yuhojin/Desktop/ad_ai/core/rag/store.ts`:

```ts
import type { CreativesDb } from "./db.js";
import type { WinnerCreative } from "./types.js";

function encodeEmbedding(vec: number[]): Buffer {
  const arr = new Float32Array(vec);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

function decodeEmbedding(buf: Buffer): number[] {
  const f = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(f);
}

interface WinnerRow {
  id: string;
  creative_id: string;
  product_category: string | null;
  product_tags: string;
  product_description: string;
  headline: string;
  body: string;
  cta: string;
  variant_label: string;
  embedding_product: Buffer;
  embedding_copy: Buffer;
  qualified_at: string;
  impressions: number;
  inline_link_click_ctr: number;
}

function rowToWinner(row: WinnerRow): WinnerCreative {
  return {
    id: row.id,
    creativeId: row.creative_id,
    productCategory: row.product_category,
    productTags: JSON.parse(row.product_tags),
    productDescription: row.product_description,
    headline: row.headline,
    body: row.body,
    cta: row.cta,
    variantLabel: row.variant_label as WinnerCreative["variantLabel"],
    embeddingProduct: decodeEmbedding(row.embedding_product),
    embeddingCopy: decodeEmbedding(row.embedding_copy),
    qualifiedAt: row.qualified_at,
    impressions: row.impressions,
    inlineLinkClickCtr: row.inline_link_click_ctr,
  };
}

export class WinnerStore {
  constructor(private db: CreativesDb) {}

  insert(w: WinnerCreative): void {
    this.db
      .prepare(
        `INSERT INTO winners (
          id, creative_id, product_category, product_tags, product_description,
          headline, body, cta, variant_label,
          embedding_product, embedding_copy,
          qualified_at, impressions, inline_link_click_ctr
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        w.id,
        w.creativeId,
        w.productCategory,
        JSON.stringify(w.productTags),
        w.productDescription,
        w.headline,
        w.body,
        w.cta,
        w.variantLabel,
        encodeEmbedding(w.embeddingProduct),
        encodeEmbedding(w.embeddingCopy),
        w.qualifiedAt,
        w.impressions,
        w.inlineLinkClickCtr,
      );
  }

  loadAll(): WinnerCreative[] {
    const rows = this.db.prepare("SELECT * FROM winners").all() as WinnerRow[];
    return rows.map(rowToWinner);
  }

  hasCreative(creativeId: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM winners WHERE creative_id = ? LIMIT 1")
      .get(creativeId);
    return row !== undefined;
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run core/rag/store.test.ts
```

Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add core/rag/store.ts core/rag/store.test.ts
git commit -m "feat(rag): add WinnerStore (insert/loadAll/hasCreative) with BLOB encoding"
```

---

## Task 9: `qualifyWinners` orchestrator (qualification 전체 흐름)

**Files:**
- Modify: `/Users/yuhojin/Desktop/ad_ai/core/rag/qualifier.ts`
- Modify: `/Users/yuhojin/Desktop/ad_ai/core/rag/qualifier.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Append to `qualifier.test.ts`:

```ts
import { qualifyWinners } from "./qualifier.js";
import type { Creative, Product } from "../types.js";
import type { QualifyDeps } from "./types.js";

function mkCreative(id: string, variantGroupId = "g1", variantLabel: Creative["copy"]["variantLabel"] = "emotional"): Creative {
  return {
    id, productId: "p1", variantGroupId,
    copy: {
      headline: `h-${id}`, body: `b-${id}`, cta: "SHOP_NOW",
      hashtags: ["tag"], variantLabel, metaAssetLabel: `${variantGroupId}::${variantLabel}`,
    },
    imageLocalPath: "/tmp/a.jpg", videoLocalPath: "/tmp/a.mp4",
    status: "approved", createdAt: "2026-04-20T00:00:00Z",
  };
}

function mkProd(id = "p1"): Product {
  return {
    id, name: "Test", description: "product description here",
    currency: "KRW", targetUrl: "https://example.com",
    tags: ["tag"], inputMethod: "manual", createdAt: "2026-04-20T00:00:00Z",
    category: "course",
  };
}

describe("qualifyWinners", () => {
  it("inserts threshold-passing variants into store with both embeddings", async () => {
    const reports = [
      mkReport({ variantGroupId: "g1", campaignId: "c1", variantLabel: "emotional", impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04 }),
      mkReport({ variantGroupId: "g1", campaignId: "c1", variantLabel: "numerical", impressions: 1000, clicks: 5, inlineLinkClickCtr: 0.005 }),
    ];
    const inserted: WinnerCreative[] = [];
    const deps: QualifyDeps = {
      loadCreative: async (id) => {
        if (id === "c1::emotional" || id === "c1::numerical") return mkCreative(id, "g1", id.endsWith("emotional") ? "emotional" : "numerical");
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

    const res = await qualifyWinners(reports, deps, { creativeIdResolver: (agg) => `${agg.campaignId}::${agg.variantLabel}` });
    expect(res.inserted).toBe(1);
    expect(inserted[0].variantLabel).toBe("emotional");
    expect(inserted[0].embeddingProduct).toHaveLength(512);
    expect(inserted[0].embeddingCopy).toHaveLength(512);
  });

  it("skips variants that already exist in store", async () => {
    const reports = [
      mkReport({ variantGroupId: "g1", campaignId: "c1", variantLabel: "emotional", impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04 }),
    ];
    const inserted: WinnerCreative[] = [];
    const deps: QualifyDeps = {
      loadCreative: async () => mkCreative("c1::emotional"),
      loadProduct: async () => mkProd(),
      embed: async (texts) => texts.map(() => Array.from({ length: 512 }, () => 0.5)),
      store: {
        hasCreative: () => true, // already in DB
        loadAll: () => [],
        insert: (w) => inserted.push(w),
      },
    };
    const res = await qualifyWinners(reports, deps, { creativeIdResolver: (agg) => `${agg.campaignId}::${agg.variantLabel}` });
    expect(res.skipped).toBe(1);
    expect(inserted).toHaveLength(0);
  });

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
      loadCreative: async () => mkCreative("c1::emotional"),
      loadProduct: async () => mkProd(),
      embed: async (texts) => texts.map(() => Array.from({ length: 512 }, () => 1.0001)), // basically same
      store: {
        hasCreative: () => false,
        loadAll: () => existing,
        insert: () => { throw new Error("should not be called"); },
      },
    };
    const res = await qualifyWinners(reports, deps, { creativeIdResolver: (agg) => `${agg.campaignId}::${agg.variantLabel}` });
    expect(res.skipped).toBe(1);
    expect(res.inserted).toBe(0);
  });
});
```

- [ ] **Step 2: 구현**

Append to `qualifier.ts`:

```ts
import { randomUUID } from "crypto";
import type { VariantAggregate } from "./types.js";

export interface QualifyOptions {
  creativeIdResolver: (agg: VariantAggregate) => string;
}

export async function qualifyWinners(
  reports: VariantReport[],
  deps: QualifyDeps,
  opts: QualifyOptions,
): Promise<{ inserted: number; skipped: number }> {
  const medianCtr = getMedianCtr(reports);
  const aggregates = aggregateVariantReports(reports);
  let inserted = 0;
  let skipped = 0;

  for (const agg of aggregates) {
    if (!passesThreshold(agg, medianCtr)) { skipped++; continue; }

    const creativeId = opts.creativeIdResolver(agg);
    if (deps.store.hasCreative(creativeId)) { skipped++; continue; }

    const creative = await deps.loadCreative(creativeId);
    const product = await deps.loadProduct(agg.productId);
    if (!creative || !product) { skipped++; continue; }

    const [embedProduct, embedCopy] = await deps.embed([
      product.description,
      `${creative.copy.headline} ${creative.copy.body}`,
    ]);

    const existing = deps.store.loadAll();
    if (shouldSkipInsert(embedProduct, existing)) { skipped++; continue; }

    const winner: WinnerCreative = {
      id: randomUUID(),
      creativeId,
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

- [ ] **Step 3: 테스트 통과 확인**

```bash
npx vitest run core/rag/qualifier.test.ts
```

Expected: 15/15 PASS.

- [ ] **Step 4: Commit**

```bash
git add core/rag/qualifier.ts core/rag/qualifier.test.ts
git commit -m "feat(rag): add qualifyWinners orchestrator (aggregate → threshold → embed → insert)"
```

---

## Task 10: `improvementCycle.ts` 3단계 리팩터

**Files:**
- Modify: `/Users/yuhojin/Desktop/ad_ai/core/scheduler/improvementCycle.ts`
- Modify: `/Users/yuhojin/Desktop/ad_ai/core/scheduler/improvementCycle.test.ts`

**Context (읽어야 할 파일):**
- `core/scheduler/improvementCycle.ts` (현재 단일 함수, aggregate/improver 로직 뒤섞여 있음)
- `core/scheduler/improvementCycle.test.ts` (기존 테스트 패턴)

- [ ] **Step 1: 기존 테스트 실행 — baseline 확인**

```bash
npx vitest run core/scheduler/improvementCycle.test.ts
```

기존 테스트가 몇 개 PASS인지 기록 (예: "3/3 PASS — baseline").

- [ ] **Step 2: 3단계 분리 테스트 추가**

Append to `core/scheduler/improvementCycle.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runScheduledImprovementCycle } from "./improvementCycle.js";

describe("runScheduledImprovementCycle — 3-stage separation", () => {
  it("runs all three stages when no stage throws", async () => {
    const aggregate = vi.fn().mockResolvedValue({ variantReports: [], weeklyAnalysis: null });
    const qualify = vi.fn().mockResolvedValue({ inserted: 0, skipped: 0 });
    const runCycle = vi.fn().mockResolvedValue(undefined);
    await runScheduledImprovementCycle({ aggregate, qualify, runCycle });
    expect(aggregate).toHaveBeenCalledOnce();
    expect(qualify).toHaveBeenCalledOnce();
    expect(runCycle).toHaveBeenCalledOnce();
  });

  it("skips remaining stages when aggregate throws, logs error", async () => {
    const aggregate = vi.fn().mockRejectedValue(new Error("read fail"));
    const qualify = vi.fn();
    const runCycle = vi.fn();
    await runScheduledImprovementCycle({ aggregate, qualify, runCycle });
    expect(qualify).not.toHaveBeenCalled();
    expect(runCycle).not.toHaveBeenCalled();
  });

  it("still runs runCycle when qualify throws", async () => {
    const aggregate = vi.fn().mockResolvedValue({ variantReports: [], weeklyAnalysis: { x: 1 } });
    const qualify = vi.fn().mockRejectedValue(new Error("voyage fail"));
    const runCycle = vi.fn().mockResolvedValue(undefined);
    await runScheduledImprovementCycle({ aggregate, qualify, runCycle });
    expect(runCycle).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: 3단계 구조로 재작성**

Rewrite `/Users/yuhojin/Desktop/ad_ai/core/scheduler/improvementCycle.ts`:

```ts
import { readJson, listJson } from "../storage.js";
import { runImprovementCycle as defaultRunCycle } from "../improver/runner.js";
import { shouldTriggerImprovement } from "../improver/index.js";
import { variantReportsToReports } from "../campaign/monitor.js";
import type { VariantReport } from "../platform/types.js";

export interface AggregateResult {
  variantReports: VariantReport[];
  weeklyAnalysis: object | null;
}

export interface ImprovementCycleDeps {
  aggregate: () => Promise<AggregateResult>;
  qualify: (reports: VariantReport[]) => Promise<{ inserted: number; skipped: number }>;
  runCycle: (analysis: object | null, reports: VariantReport[]) => Promise<void>;
}

export async function defaultAggregate(): Promise<AggregateResult> {
  const reportPaths = await listJson("data/reports");
  const allVariants: VariantReport[] = [];
  for (const p of reportPaths.filter((f) => !f.includes("weekly-analysis")).slice(-3)) {
    const daily = await readJson<VariantReport[]>(p);
    if (daily) allVariants.push(...daily);
  }
  const weeklyPaths = reportPaths.filter((p) => p.includes("weekly-analysis"));
  const latest = weeklyPaths[weeklyPaths.length - 1];
  const analysis = latest ? await readJson<object>(latest) : null;
  return { variantReports: allVariants, weeklyAnalysis: analysis };
}

export async function defaultRunCycleAdapter(
  analysis: object | null,
  reports: VariantReport[],
): Promise<void> {
  if (!analysis) return;
  const aggregated = variantReportsToReports(reports);
  const weak = aggregated.filter(shouldTriggerImprovement);
  await defaultRunCycle(weak, JSON.stringify(analysis));
}

export async function runScheduledImprovementCycle(
  deps?: Partial<ImprovementCycleDeps>,
): Promise<void> {
  const d: ImprovementCycleDeps = {
    aggregate: deps?.aggregate ?? defaultAggregate,
    qualify: deps?.qualify ?? (async () => ({ inserted: 0, skipped: 0 })),
    runCycle: deps?.runCycle ?? defaultRunCycleAdapter,
  };

  let aggregateResult: AggregateResult;
  try {
    aggregateResult = await d.aggregate();
  } catch (e) {
    console.error("[improvementCycle] aggregate stage failed:", e);
    return;
  }

  try {
    const qualifyResult = await d.qualify(aggregateResult.variantReports);
    console.log(
      `[improvementCycle] qualify: inserted=${qualifyResult.inserted} skipped=${qualifyResult.skipped}`,
    );
  } catch (e) {
    console.error("[improvementCycle] qualify stage failed, continuing:", e);
  }

  try {
    await d.runCycle(aggregateResult.weeklyAnalysis, aggregateResult.variantReports);
  } catch (e) {
    console.error("[improvementCycle] runCycle stage failed:", e);
  }
}
```

Default qualify는 빈 함수 — 실제 wire-up은 Task 11에서. runCycle 기본값도 주입 가능하게.

- [ ] **Step 4: 테스트 실행**

```bash
npx vitest run core/scheduler/improvementCycle.test.ts
```

Expected: 기존 테스트 + 신규 3개 PASS. 기존 시그니처 breaking이 있다면 기존 테스트를 새 API로 갱신 (deps 인자 주입 형태).

- [ ] **Step 5: Commit**

```bash
git add core/scheduler/improvementCycle.ts core/scheduler/improvementCycle.test.ts
git commit -m "refactor(scheduler): split improvementCycle into aggregate/qualify/runCycle stages"
```

---

## Task 11: `cli/pipeline.ts` — RAG 통합 (Voyage + WinnerStore + selectFewShotWinners)

**Files:**
- Modify: `/Users/yuhojin/Desktop/ad_ai/cli/pipeline.ts`
- Create: `/Users/yuhojin/Desktop/ad_ai/cli/pipeline.test.ts` (없다면)

**Context:**
- `cli/pipeline.ts:82-101` — 현재 `generateCopy(client, product, [], label)`로 빈 fewShot 사용
- Plan C에서는 이 호출 직전에 `selectFewShotWinners` 결과를 FewShotExample[]로 변환해 전달

- [ ] **Step 1: 기존 pipeline.test.ts 확인 (있으면 패턴 재사용)**

```bash
ls /Users/yuhojin/Desktop/ad_ai/cli/pipeline.test.ts 2>/dev/null || echo "no existing test — skipping unit test for pipeline"
```

Pipeline 자체는 E2E 성격이라 현재 unit 테스트가 없을 가능성 높음. 그 경우 Task 11은 구현 위주로 진행 (통합 동작은 수동 체크리스트에서 검증).

- [ ] **Step 2: retrieveFewShotForProduct helper 신규 작성**

Append to `/Users/yuhojin/Desktop/ad_ai/core/rag/retriever.ts`:

```ts
import type { FewShotExample } from "../creative/prompt.js";

export interface RetrieveDeps {
  embed: (texts: string[]) => Promise<number[][]>;
  loadAllWinners: () => WinnerCreative[];
}

export async function retrieveFewShotForProduct(
  product: Product,
  deps: RetrieveDeps,
): Promise<FewShotExample[]> {
  const allWinners = deps.loadAllWinners();
  if (allWinners.length === 0) return [];

  try {
    const [queryEmbed] = await deps.embed([product.description]);
    const selected = selectFewShotWinners(queryEmbed, allWinners, product);
    return selected.map((w) => ({
      headline: w.headline,
      body: w.body,
      cta: w.cta,
    }));
  } catch (e) {
    console.warn("[retriever] Voyage embed failed, falling back to empty fewShot:", e);
    return [];
  }
}
```

- [ ] **Step 3: retrieveFewShotForProduct 테스트 추가**

Append to `core/rag/retriever.test.ts`:

```ts
import { retrieveFewShotForProduct } from "./retriever.js";

describe("retrieveFewShotForProduct", () => {
  it("returns FewShotExample[] from selected winners", async () => {
    const winners = [
      { ...mkWinner("a", [0.9, 0.1, 0]), productCategory: "course", headline: "H-A", body: "B-A", cta: "C-A" },
      { ...mkWinner("b", [0.85, 0.1, 0]), productCategory: "course", headline: "H-B", body: "B-B", cta: "C-B" },
    ];
    const product = mkProduct({ category: "course", tags: [] });
    const result = await retrieveFewShotForProduct(product, {
      embed: async () => [[1, 0, 0]],
      loadAllWinners: () => winners,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("headline");
    expect(result[0]).toHaveProperty("body");
    expect(result[0]).toHaveProperty("cta");
  });

  it("returns [] when Winner DB is empty (no embed call)", async () => {
    const embedSpy = vi.fn();
    const result = await retrieveFewShotForProduct(mkProduct({}), {
      embed: embedSpy,
      loadAllWinners: () => [],
    });
    expect(result).toEqual([]);
    expect(embedSpy).not.toHaveBeenCalled();
  });

  it("returns [] and warns when embed throws (graceful degradation)", async () => {
    const result = await retrieveFewShotForProduct(mkProduct({}), {
      embed: async () => { throw new Error("voyage down"); },
      loadAllWinners: () => [mkWinner("a", [1, 0, 0])],
    });
    expect(result).toEqual([]);
  });
});
```

Need `import { vi } from "vitest"` 맨 위에 — 이미 있는지 확인하고 없으면 추가.

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run core/rag/retriever.test.ts
```

Expected: 23/23 PASS.

- [ ] **Step 5: pipeline.ts 수정 — retrieveFewShotForProduct 호출 삽입**

Edit `/Users/yuhojin/Desktop/ad_ai/cli/pipeline.ts`:

파일 상단에 import 추가:

```ts
import { retrieveFewShotForProduct } from "../core/rag/retriever.js";
import { createVoyageClient } from "../core/rag/voyage.js";
import { createCreativesDb } from "../core/rag/db.js";
import { WinnerStore } from "../core/rag/store.js";
```

함수 본문에서 `for (const label of VARIANT_LABELS)` 루프 진입 전에 fewShot 계산을 제품 루프 안에 배치:

현재 (line 82 주변):
```ts
    const variantGroupId = randomUUID();

    for (const label of VARIANT_LABELS) {
      update("generate", "running", `카피 생성 중 (${label})...`, product.name, i + 1);
      const copy = await generateCopy(client, product, [], label);
```

변경:
```ts
    const variantGroupId = randomUUID();

    // Plan C RAG — retrieve once per product (shared across variants)
    const voyage = createVoyageClient();
    const creativesDb = createCreativesDb();
    const winnerStore = new WinnerStore(creativesDb);
    const fewShot = await retrieveFewShotForProduct(product, {
      embed: (texts) => voyage.embed(texts),
      loadAllWinners: () => winnerStore.loadAll(),
    });
    creativesDb.close();

    for (const label of VARIANT_LABELS) {
      update("generate", "running", `카피 생성 중 (${label})...`, product.name, i + 1);
      const copy = await generateCopy(client, product, fewShot, label);
```

- [ ] **Step 6: 수동 확인 — 파이프라인 구조가 빌드되는지 확인**

```bash
cd /Users/yuhojin/Desktop/ad_ai && npx tsc --noEmit
```

Expected: 에러 없음. 에러 발생 시 import 경로·시그니처 정정.

- [ ] **Step 7: 전체 테스트 실행**

```bash
npx vitest run
```

Expected: 기존 테스트 PASS + 신규 rag/* 테스트 모두 PASS.

- [ ] **Step 8: Commit**

```bash
git add core/rag/retriever.ts core/rag/retriever.test.ts cli/pipeline.ts
git commit -m "feat(pipeline): wire Voyage RAG into generateCopy with WinnerStore few-shot"
```

---

## Task 12: 문서 업데이트

**Files:**
- Modify: `/Users/yuhojin/Desktop/ad_ai/docs/STATUS.md`
- Modify: `/Users/yuhojin/Desktop/ad_ai/docs/ROADMAP.md`

- [ ] **Step 1: STATUS.md — 마지막 업데이트 날짜**

Edit `/Users/yuhojin/Desktop/ad_ai/docs/STATUS.md`: `마지막 업데이트: 2026-04-21` → 오늘 날짜 (Task 12 실행 시점).

- [ ] **Step 2: STATUS.md — Phase 요약에 Plan C 추가**

Phase 요약 목록의 마지막(`- ✅ Plan B ...` 바로 아래)에 추가:

```
- ✅ Plan C — Winner DB + Voyage RAG (SQLite `data/creatives.db` + `voyage-3-lite` few-shot 주입)
```

- [ ] **Step 3: STATUS.md — 서비스 컴포넌트 상태 table에 RAG 추가**

`Dev-time Subagent 팀` 행 위에 추가:

```
| Winner DB (Voyage RAG) | ✅ 구현 완료 | `core/rag/`, `data/creatives.db` |
```

- [ ] **Step 4: STATUS.md — 최근 변경 이력 최상단 추가**

```
- 2026-04-21 feat: Plan C 완료 — Voyage `voyage-3-lite` embedding 기반 Winner DB(`data/creatives.db`) 구축. 자격 통과 variant를 SQLite에 BLOB embedding과 함께 저장하고, `generateCopy` 호출 직전에 `selectFewShotWinners`로 유사 winner를 retrieve해 few-shot 주입. `runScheduledImprovementCycle`을 aggregate/qualify/runCycle 3단계로 리팩터
```

- [ ] **Step 5: ROADMAP.md — "현재 추천 다음 작업" 업데이트**

`현재 추천 다음 작업` 섹션 교체. Plan C 완료 후 다음 우선순위는 사용자 확정 필요:

```markdown
## 현재 추천 다음 작업

**선택 대기** — Plan C 완료. 다음 작업은 Tier 1/2에서 사용자 확정 필요.

추천 후보:
- Tier 1 (신규): Plan C 실운영 검증 — Winner DB에 14일 이상 데이터 축적 후 RAG 적용 전/후 CTR 비교
- Tier 2: 프로덕션 배포 파이프라인 또는 Dev-time Agent Team Phase 1b (Performance Analyst — Winner DB가 생겼으므로 진행 가능)
```

- [ ] **Step 6: ROADMAP.md — 마지막 업데이트 날짜**

`마지막 업데이트: 2026-04-21` 유지 (같은 날이면) 또는 갱신.

- [ ] **Step 7: Commit**

```bash
git add docs/STATUS.md docs/ROADMAP.md
git commit -m "docs: record Plan C (Winner DB + Voyage RAG) completion"
```

- [ ] **Step 8: 최종 테스트 전체 실행**

```bash
cd /Users/yuhojin/Desktop/ad_ai && npx vitest run
```

Expected: 전체 PASS. 실패 테스트가 있으면 Task 11 Step 7로 돌아가 정정.

---

## 완료 기준 (전체 Plan C)

- [ ] `core/rag/` 하위 7개 파일 생성 완료 (types, qualifier, retriever, voyage, db, store + 테스트)
- [ ] `npx vitest run` 전체 PASS
- [ ] `npx tsc --noEmit` 에러 없음
- [ ] `.env.example`에 `VOYAGE_API_KEY` placeholder 존재
- [ ] `cli/pipeline.ts`에서 `generateCopy` 호출 시 `fewShot` 인자가 `retrieveFewShotForProduct` 결과로 채워짐
- [ ] `core/scheduler/improvementCycle.ts`가 `aggregate/qualify/runCycle` 3단계로 분리됨
- [ ] `docs/STATUS.md`, `docs/ROADMAP.md` 업데이트 완료
- [ ] 모든 Task별 commit 존재

---

## 비범위 (Out of scope for this plan)

- Voyage 모델 교체 마이그레이션 (voyage-3-lite → voyage-3)
- sqlite-vec extension 도입 (Winner DB가 >> 1000 될 때)
- RAG 적용 전/후 CTR 비교 분석 (이건 실운영 데이터 필요 — Plan C 완료 후 별도 실험으로)
- `qualifier.qualifyWinners`를 `runScheduledImprovementCycle`의 기본 `qualify` deps로 wire-up (deps 생성 시 DB/Voyage 의존성 필요 — 현재는 cli/entries/worker.ts에서 조립하는 게 자연스러움. Plan C 완료 후 후속 작업으로 남김)
- `cli/entries/worker.ts` 조립 — `runScheduledImprovementCycle({ qualify: realQualifyDeps })` 연결은 Plan C 완료 후 별도 chore로 처리

---

## Self-Review (작성 직후 자체 점검)

**1. Spec coverage 점검** (스펙 §6 Plan C 산출물 기준):

| 스펙 산출물 | 플랜 위치 | 커버됨? |
|---|---|---|
| `data/creatives.db` + `core/rag/db.ts` (migration, safeAlter) | Task 7 | ✅ |
| `core/rag/voyage.ts` — 클라이언트 (factory 주입) | Task 6 | ✅ |
| `core/rag/store.ts` — insert/loadAll/hasCreative (BLOB) | Task 8 | ✅ |
| `core/rag/retriever.ts` — filterByCategory + retrieveTopK + lexicalFallback + dedupByCosine (순수 함수) | Tasks 3, 4 | ✅ |
| `core/rag/qualifier.ts` — passesThreshold + getMedianCtr + aggregateVariantReports + shouldSkipInsert | Tasks 2, 5 | ✅ |
| `runScheduledImprovementCycle` 3단계 분리 | Task 10 | ✅ |
| Plan B pipeline에 retriever 연결 | Task 11 | ✅ |

스펙 §5.1에 나온 unit 테스트 대상 모두 커버:
- passesThreshold, getMedianCtr, cosineSimilarity, filterByCategory, retrieveTopK, shouldSkipInsert, dedupByCosine, lexicalFallback, aggregateVariantReports → ✅

스펙 §5.2 통합 테스트 대상:
- `WinnerStore.insert/loadAll/hasCreative` (Task 8) ✅
- Qualification 전체 흐름 (Task 9 qualifyWinners test) ✅
- Migration fresh DB (Task 7) ✅

**Gap 분석:**
- `WinnerStore` integration test에서 "중복 insert skip" 케이스가 불분명 — 현재 `hasCreative`가 단순 boolean 반환하므로 dup 처리는 orchestrator(qualifier)에서 함. Task 8의 test 중 `hasCreative` after insert 케이스로 커버됨. ✅
- 스펙 §5.2의 `I9 rollback` / `I10 external modification` 테스트는 Plan A/B 범위이므로 이 플랜에서 다시 쓰지 않음. ✅

**2. Placeholder scan:** 플랜 전체에서 "TBD", "나중에", "implement later" 없음. 모든 Task는 실제 코드 블록 포함. ✅

**3. Type consistency 점검:**
- `WinnerCreative`: Task 1에서 정의 → Task 8 store, Task 5 retriever, Task 9 qualifier 모두 동일 필드명 사용 ✅
- `VariantAggregate`: Task 1에서 정의 → Task 2 aggregate 반환, Task 2 passesThreshold 인자, Task 9 qualifier 내부 사용 ✅
- `QualifyDeps`: Task 1에서 정의 → Task 9에서 사용, `loadCreative`/`loadProduct`/`embed`/`store.{hasCreative,loadAll,insert}` 시그니처 일치 ✅
- `retrieveFewShotForProduct`의 `RetrieveDeps`는 QualifyDeps와 별개 (retrieval 경로는 embed + loadAllWinners만 필요) — 의도된 설계 ✅
- `selectFewShotWinners`의 `field` parameter `"embeddingProduct"|"embeddingCopy"` 리터럴 유니온 — Task 3 dedup과 Task 5 selectFewShot에서 동일 ✅

**4. 검토 이력:**

- 2026-04-21 — 자체 검토 1차 (작성 직후)
  - Critical: 없음
  - Important: 없음 — 스펙 §6 산출물·§5 테스트 대상 모두 Task에 매핑됨
  - Minor:
    - (M1) Task 11 Step 5에서 `creativesDb`를 제품마다 open/close. 성능상 루프 밖으로 hoisting 가능하지만 YAGNI (제품 개수는 보통 < 10). 구현 시 단순성 유지, 필요 시 후속 리팩터. → 플랜에 반영된 대로 진행.
    - (M2) Task 10의 `defaultQualify`가 빈 함수(no-op) — 실제 wire-up은 비범위로 명시. Plan C 완료 후 chore 작업으로 분리. → 비범위 섹션에 명시됨.

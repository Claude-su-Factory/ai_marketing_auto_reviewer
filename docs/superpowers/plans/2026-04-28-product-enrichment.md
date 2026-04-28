# Product 데이터 풍부화 Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Product 타입에 광고 카피 효과 큰 3 필드 (`learningOutcomes`, `differentiators`, `originalPrice`) 추가 + parser/copy prompt/RAG 임베딩 통합 + 신규 banned-pattern 가드 (`result-guarantee`, `discount-superlative`).

**Architecture:** 2 atomic commits. Commit 1 = data layer (type + parser + manual entry + 8 fixture) + copy prompt 풍부화 (buildCopyPrompt 헬퍼 + DEFAULT_PROMPTS userTemplate/systemPrompt) + improver banned-pattern 확장 — type-level consistency 위해 atomic 필요. Commit 2 = RAG 임베딩 입력 풍부화 (`buildProductEmbedText` 헬퍼 + qualifier + retriever).

**Tech Stack:** TypeScript, vitest, Anthropic SDK (parser + copy + improver). tsx 런타임.

**Spec:** `docs/superpowers/specs/2026-04-28-product-enrichment-design.md` (커밋 `687e138`)

**브랜치:** master 직접 commit (CLAUDE.md 정책).

**견적:** ~7.7h (1일).

**Subagent 호출:**
- Commit 1 → `marketing-copy-reviewer` 강 트리거 (DEFAULT_PROMPTS systemPrompt + userTemplate + buildCopyPrompt 본체 변경) + `superpowers:code-reviewer`
- Commit 2 → `superpowers:code-reviewer` (RAG 로직만, copy 직접 영향 없음)

**Spec 정정 (plan 작성 시 발견):** spec §5.3 의 8 위치/7 파일 → 8 위치/**6 파일**. types.test.ts:25 는 type-level only 라 fixture 업데이트 불필요. 본 plan 은 6 파일만 처리.

---

## Task 0: Pre-flight

### Task 0.1: 환경 확인

- [ ] **Step 1: 작업 트리 깨끗**
```bash
git status --short
```
Expected: 빈 출력 또는 `.claude/scheduled_tasks.lock` 만.

- [ ] **Step 2: HEAD = spec commit**
```bash
git log --oneline -3
```
Expected 최상단: `687e138 docs(specs): add Product 데이터 풍부화 Phase 1 design spec`

- [ ] **Step 3: Test baseline**
```bash
npm test 2>&1 | tail -5
```
Expected: **414 tests passing** + 1 useReports 알려진 flake.

- [ ] **Step 4: TypeScript clean**
```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
npx tsc --noEmit -p packages/cli/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
npx tsc --noEmit -p packages/server/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
```
Expected: 0 errors after filter.

---

## Commit 1: data + parser + 8 fixture + copy prompt + DEFAULT_PROMPTS + improver banned-pattern

### Task 1.1: `types.ts` Product 타입 확장

**Files:**
- Modify: `packages/core/src/types.ts:1-13`

- [ ] **Step 1: Product 인터페이스 변경**

`packages/core/src/types.ts:1-13` 을 다음으로 교체:

```ts
export interface Product {
  id: string;
  name: string;
  description: string;
  price?: number;
  originalPrice?: number;
  currency: string;
  imageUrl?: string;
  targetUrl: string;
  category?: string;
  tags: string[];
  learningOutcomes: string[];
  differentiators: string[];
  inputMethod: "scraped" | "manual";
  createdAt: string;
}
```

- [ ] **Step 2: TypeScript check (이 시점은 fail 예상 — 모든 호출처가 신규 required 필드 안 채움)**

```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head -20
```

Expected: `learningOutcomes`/`differentiators` 누락 에러 다수 — Tasks 1.2/1.4/1.5 에서 차례로 fix.

### Task 1.2: `parser.ts` system prompt + return 변경

**Files:**
- Modify: `packages/core/src/product/parser.ts`

- [ ] **Step 1: system prompt 교체 (line 14-23)**

`PARSER_SYSTEM_PROMPT` const 전체 교체:

```ts
const PARSER_SYSTEM_PROMPT = `당신은 제품/서비스 페이지 HTML 에서 정보를 추출하는 파서입니다.

규칙:
- 반드시 JSON 형식으로만 응답. 다른 텍스트 절대 포함 금지.
- 불확실한 필드는 빈 문자열, 0, null, 또는 빈 배열 반환.
- price 는 숫자만 (KRW 가정, 통화 기호/콤마 제거).
- originalPrice 는 페이지에 "할인 전 가격" 명시된 경우만 숫자로 반환, 없으면 null.
- tags 는 핵심 키워드 3-5개.
- learningOutcomes: 페이지에 명시된 "학습 결과/사용 후 변화" 3-5개. 동사형 ("~할 수 있다", "~를 구현"). 검증 가능한 사실만.
- differentiators: 페이지에 명시된 "차별점/USP" 1-3개. 사실 기반 ("현직 시니어 강의", "실 프로젝트 사례"). superlative ("유일한", "1위") 추출 금지 — 검증 불가능.

응답 형식:
{"name":"","description":"","price":0,"originalPrice":null,"tags":[],"imageUrl":"","learningOutcomes":[],"differentiators":[]}`;
```

- [ ] **Step 2: return 객체 교체 (line 30-42)**

```ts
return {
  id: randomUUID(),
  name: parsed.name ?? "",
  description: parsed.description ?? "",
  imageUrl: parsed.imageUrl ?? "",
  targetUrl: url,
  category: detectCategory(url),
  price: parsed.price ?? 0,
  originalPrice: parsed.originalPrice ?? undefined,
  currency: "KRW",
  tags: parsed.tags ?? [],
  learningOutcomes: parsed.learningOutcomes ?? [],
  differentiators: parsed.differentiators ?? [],
  inputMethod: "scraped",
  createdAt: new Date().toISOString(),
};
```

### Task 1.3: `parser.test.ts` +3 신규 케이스

**Files:**
- Modify: `packages/core/src/product/parser.test.ts`

- [ ] **Step 1: 신규 3 케이스 + 기존 모델 검증 케이스 갱신**

`describe("parseProductWithClaude")` 블록 안에 다음 3 케이스 추가 (기존 마지막 케이스 다음):

```ts
it("extracts learningOutcomes / differentiators arrays", async () => {
  const client = mockClient(JSON.stringify({
    name: "Redis 강의",
    description: "d",
    price: 99000,
    tags: [],
    learningOutcomes: ["동시 접속 1000명 처리", "Redis Cluster 운영 노하우"],
    differentiators: ["현직 카카오 시니어", "실 면접관 경험"],
  }));
  const product = await parseProductWithClaude(
    client as any,
    "https://www.inflearn.com/course/redis",
    "<html>",
  );
  expect(product.learningOutcomes).toEqual(["동시 접속 1000명 처리", "Redis Cluster 운영 노하우"]);
  expect(product.differentiators).toEqual(["현직 카카오 시니어", "실 면접관 경험"]);
});

it("falls back to empty arrays for learningOutcomes/differentiators when missing", async () => {
  const client = mockClient(JSON.stringify({
    name: "x",
    description: "y",
    price: 0,
    tags: [],
  }));
  const product = await parseProductWithClaude(
    client as any,
    "https://example.com",
    "<html>",
  );
  expect(product.learningOutcomes).toEqual([]);
  expect(product.differentiators).toEqual([]);
});

it("converts originalPrice null → undefined; preserves number when present", async () => {
  const client1 = mockClient(JSON.stringify({ name: "x", description: "y", price: 99000, originalPrice: 198000, tags: [], learningOutcomes: [], differentiators: [] }));
  const product1 = await parseProductWithClaude(client1 as any, "https://example.com", "<html>");
  expect(product1.originalPrice).toBe(198000);

  const client2 = mockClient(JSON.stringify({ name: "x", description: "y", price: 99000, originalPrice: null, tags: [], learningOutcomes: [], differentiators: [] }));
  const product2 = await parseProductWithClaude(client2 as any, "https://example.com", "<html>");
  expect(product2.originalPrice).toBeUndefined();
});
```

추가로 기존 `it("uses claude-sonnet-4-6 model with system prompt + ephemeral cache", ...)` 의 system text assertion 보강 — 신규 키워드 검증:

```ts
// 기존
expect(callArgs.system[0].text).toContain("JSON");
// 추가
expect(callArgs.system[0].text).toContain("learningOutcomes");
expect(callArgs.system[0].text).toContain("differentiators");
expect(callArgs.system[0].text).toContain("originalPrice");
```

- [ ] **Step 2: 테스트 실행**

```bash
npx vitest run packages/core/src/product/parser.test.ts 2>&1 | tail -10
```

Expected: **9 cases passing** (기존 6 + 신규 3).

### Task 1.4: `App.tsx` manual entry 기본값 추가

**Files:**
- Modify: `packages/cli/src/tui/App.tsx:152-164`

- [ ] **Step 1: Product literal 신규 필드 추가**

`packages/cli/src/tui/App.tsx:152-164` 의 `const product: Product = {...}` 를 다음으로 교체:

```ts
const product: Product = {
  id: randomUUID(),
  name: newFormData.name ?? "",
  description: newFormData.description ?? "",
  targetUrl: newFormData.targetUrl ?? "",
  price: newFormData.price,
  originalPrice: undefined,
  currency: "KRW",
  imageUrl: undefined,
  category: undefined,
  tags: [],
  learningOutcomes: [],
  differentiators: [],
  inputMethod: "manual",
  createdAt: new Date().toISOString(),
};
```

### Task 1.5: 8 fixture 갱신 (6 파일)

**Files (6):**
- Modify: `packages/core/src/platform/meta/assetFeedSpec.test.ts` (3 위치)
- Modify: `packages/core/src/rag/retriever.test.ts:149-160` (mkProduct helper)
- Modify: `packages/core/src/rag/qualifyJob.test.ts` (line ~40-49)
- Modify: `packages/core/src/rag/qualifier.test.ts:188-198` (mkProd helper)
- Modify: `packages/cli/src/tui/screens/ReviewScreen.test.tsx:17` (inline literal)
- (`prompt.test.ts:5-16` 의 baseProduct 는 Task 1.7 에서 처리)

- [ ] **Step 1: assetFeedSpec.test.ts:5-9 mockProduct**

```ts
// Before
const mockProduct: Product = {
  id: "p1", name: "Test", description: "desc", targetUrl: "https://example.com",
  currency: "KRW", category: "course", tags: ["x"], inputMethod: "manual",
  createdAt: "2026-04-20T00:00:00.000Z",
};

// After
const mockProduct: Product = {
  id: "p1", name: "Test", description: "desc", targetUrl: "https://example.com",
  currency: "KRW", category: "course", tags: ["x"], inputMethod: "manual",
  learningOutcomes: [], differentiators: [],
  createdAt: "2026-04-20T00:00:00.000Z",
};
```

- [ ] **Step 2: assetFeedSpec.test.ts:75-83 inline literal**

해당 inline Product 안 필드 추가:
```ts
// Before
{
  name: "Test Product",
  description: "d",
  currency: "KRW",
  targetUrl: "https://example.com",
  tags: [],
  inputMethod: "manual",
  createdAt: "2026-04-20T00:00:00Z",
};

// After
{
  name: "Test Product",
  description: "d",
  currency: "KRW",
  targetUrl: "https://example.com",
  tags: [],
  inputMethod: "manual",
  learningOutcomes: [],
  differentiators: [],
  createdAt: "2026-04-20T00:00:00Z",
};
```

- [ ] **Step 3: assetFeedSpec.test.ts:115-124 inline literal**

위와 동일 패턴 — `learningOutcomes: []`, `differentiators: []` 추가.

- [ ] **Step 4: retriever.test.ts:149-160 mkProduct helper**

```ts
// Before
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

// After
function mkProduct(overrides: Partial<Product>): Product {
  return {
    id: "p1",
    name: "Test",
    description: "desc",
    currency: "KRW",
    targetUrl: "https://example.com",
    tags: [],
    learningOutcomes: [],
    differentiators: [],
    inputMethod: "manual",
    createdAt: "2026-04-20T00:00:00Z",
    ...overrides,
  };
}
```

- [ ] **Step 5: qualifyJob.test.ts inline product**

`packages/core/src/rag/qualifyJob.test.ts` 의 `description: "This is a product description used for embedding"` 가 있는 product literal 안에 추가:

```ts
{
  // ... existing
  tags: ["tag"],
  learningOutcomes: [],
  differentiators: [],
  inputMethod: "manual",
  // ... rest
}
```

- [ ] **Step 6: qualifier.test.ts:188-198 mkProd helper**

```ts
// Before
function mkProd(id = "p1"): Product {
  return {
    id, name: "Test", description: "product description here",
    currency: "KRW", targetUrl: "https://example.com",
    tags: ["tag"], inputMethod: "manual", createdAt: "2026-04-20T00:00:00Z",
    category: "course",
  };
}

// After
function mkProd(id = "p1"): Product {
  return {
    id, name: "Test", description: "product description here",
    currency: "KRW", targetUrl: "https://example.com",
    tags: ["tag"], learningOutcomes: [], differentiators: [],
    inputMethod: "manual", createdAt: "2026-04-20T00:00:00Z",
    category: "course",
  };
}
```

- [ ] **Step 7: ReviewScreen.test.tsx:17 inline literal**

```ts
// Before
product: { id: "p1", name: "AI 부트캠프", description: "", targetUrl: "", currency: "KRW", tags: [], inputMethod: "manual" as const, createdAt: "" },

// After
product: { id: "p1", name: "AI 부트캠프", description: "", targetUrl: "", currency: "KRW", tags: [], learningOutcomes: [], differentiators: [], inputMethod: "manual" as const, createdAt: "" },
```

- [ ] **Step 8: TypeScript check (대부분 fix 완료, prompt.ts 호출 시점 fix 는 Task 1.6 에서)**

```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head -10
```

Expected: parser.ts/App.tsx 관련 fix 됨, 남은 에러는 prompt.ts buildCopyPrompt 호출 (Task 1.6 에서 처리) 또는 prompt.test.ts (Task 1.7).

### Task 1.6: `prompt.ts` 헬퍼 추가 + buildCopyPrompt 변경

**Files:**
- Modify: `packages/core/src/creative/prompt.ts`

- [ ] **Step 1: 헬퍼 함수 3개 추가 (export 안 함, 모듈 내부)**

`packages/core/src/creative/prompt.ts` 의 `import` 직후 (line 17 정도) 추가:

```ts
function buildPriceText(product: Product): string {
  if (!product.price) return "가격 미정";
  const base = `${product.currency} ${product.price.toLocaleString()}`;
  if (product.originalPrice && product.originalPrice > product.price) {
    const discount = Math.round(
      ((product.originalPrice - product.price) / product.originalPrice) * 100
    );
    return `${base} (정가 ${product.currency} ${product.originalPrice.toLocaleString()} 에서 ${discount}% 할인)`;
  }
  return base;
}

function buildLearningOutcomesBlock(items: string[]): string {
  if (items.length === 0) return "";
  return `\n학습 결과:\n${items.map((s) => `- ${s}`).join("\n")}`;
}

function buildDifferentiatorsBlock(items: string[]): string {
  if (items.length === 0) return "";
  return `\n차별점:\n${items.map((s) => `- ${s}`).join("\n")}`;
}
```

- [ ] **Step 2: buildCopyPrompt body 교체**

기존 `priceText` 인라인 const 제거하고 substitutePlaceholders 호출 객체 변경:

```ts
// Before (lines 19-49 전체 교체)
export async function buildCopyPrompt(
  product: Product,
  fewShot: FewShotExample[],
  variantLabel: VariantLabel,
): Promise<string> {
  const prompts = await loadPrompts();
  const priceText = product.price
    ? `${product.currency} ${product.price.toLocaleString()}`
    : "가격 미정";

  const fewShotBlock =
    fewShot.length > 0
      ? `\n\n참고 예시:\n${fewShot
          .map(
            (ex, i) =>
              `[${i + 1}] 헤드라인: ${ex.headline} / 본문: ${ex.body} / CTA: ${ex.cta}`,
          )
          .join("\n")}\n`
      : "";

  return substitutePlaceholders(prompts.copy.userTemplate, {
    name: product.name,
    description: product.description,
    priceText,
    category: product.category ?? "기타",
    tags: product.tags.join(", "),
    targetUrl: product.targetUrl,
    angleHint: prompts.copy.angleHints[variantLabel],
    fewShotBlock,
  });
}

// After
export async function buildCopyPrompt(
  product: Product,
  fewShot: FewShotExample[],
  variantLabel: VariantLabel,
): Promise<string> {
  const prompts = await loadPrompts();

  const fewShotBlock =
    fewShot.length > 0
      ? `\n\n참고 예시:\n${fewShot
          .map(
            (ex, i) =>
              `[${i + 1}] 헤드라인: ${ex.headline} / 본문: ${ex.body} / CTA: ${ex.cta}`,
          )
          .join("\n")}\n`
      : "";

  return substitutePlaceholders(prompts.copy.userTemplate, {
    name: product.name,
    description: product.description,
    priceText: buildPriceText(product),
    category: product.category ?? "기타",
    tags: product.tags.join(", "),
    targetUrl: product.targetUrl,
    angleHint: prompts.copy.angleHints[variantLabel],
    fewShotBlock,
    learningOutcomesBlock: buildLearningOutcomesBlock(product.learningOutcomes),
    differentiatorsBlock: buildDifferentiatorsBlock(product.differentiators),
  });
}
```

### Task 1.7: `prompt.test.ts` baseProduct fixture + +7 신규 케이스

**Files:**
- Modify: `packages/core/src/creative/prompt.test.ts`

- [ ] **Step 1: baseProduct fixture 갱신 (line 5-16)**

```ts
// Before
const baseProduct: Product = {
  id: "p1",
  name: "React 완전정복",
  description: "React를 처음부터 배웁니다",
  targetUrl: "https://inflearn.com/course/react",
  currency: "KRW",
  price: 55000,
  category: "course",
  tags: ["react", "frontend"],
  inputMethod: "scraped",
  createdAt: "2026-04-20T00:00:00.000Z",
};

// After
const baseProduct: Product = {
  id: "p1",
  name: "React 완전정복",
  description: "React를 처음부터 배웁니다",
  targetUrl: "https://inflearn.com/course/react",
  currency: "KRW",
  price: 55000,
  category: "course",
  tags: ["react", "frontend"],
  learningOutcomes: [],
  differentiators: [],
  inputMethod: "scraped",
  createdAt: "2026-04-20T00:00:00.000Z",
};
```

- [ ] **Step 2: 신규 7 케이스 추가**

`describe("buildCopyPrompt")` 블록 끝부분에 추가 (기존 마지막 `it("substitutes all required placeholders...")` 다음):

```ts
it("buildPriceText: shows discount when originalPrice > price", async () => {
  const product = { ...baseProduct, price: 99000, originalPrice: 198000 };
  const prompt = await buildCopyPrompt(product, [], "emotional");
  expect(prompt).toContain("99,000");
  expect(prompt).toContain("정가 KRW 198,000");
  expect(prompt).toContain("50% 할인");
});

it("buildPriceText: skips discount when originalPrice <= price (graceful for bad data)", async () => {
  const product = { ...baseProduct, price: 99000, originalPrice: 99000 };
  const prompt = await buildCopyPrompt(product, [], "emotional");
  expect(prompt).toContain("99,000");
  expect(prompt).not.toContain("할인");
});

it("buildPriceText: shows base price only when originalPrice undefined", async () => {
  const product = { ...baseProduct, price: 99000, originalPrice: undefined };
  const prompt = await buildCopyPrompt(product, [], "emotional");
  expect(prompt).toContain("99,000");
  expect(prompt).not.toContain("정가");
  expect(prompt).not.toContain("할인");
});

it("buildLearningOutcomesBlock: omits block when empty", async () => {
  const prompt = await buildCopyPrompt(baseProduct, [], "emotional");
  expect(prompt).not.toContain("학습 결과:");
});

it("buildLearningOutcomesBlock: renders header + dash bullets when populated", async () => {
  const product = { ...baseProduct, learningOutcomes: ["실시간 채팅 시스템 구현", "동시 접속 1000명 처리"] };
  const prompt = await buildCopyPrompt(product, [], "emotional");
  expect(prompt).toContain("학습 결과:");
  expect(prompt).toContain("- 실시간 채팅 시스템 구현");
  expect(prompt).toContain("- 동시 접속 1000명 처리");
});

it("buildDifferentiatorsBlock: omits block when empty", async () => {
  const prompt = await buildCopyPrompt(baseProduct, [], "emotional");
  expect(prompt).not.toContain("차별점:");
});

it("buildDifferentiatorsBlock: renders header + dash bullets when populated", async () => {
  const product = { ...baseProduct, differentiators: ["현직 카카오 시니어", "실 프로젝트 사례"] };
  const prompt = await buildCopyPrompt(product, [], "emotional");
  expect(prompt).toContain("차별점:");
  expect(prompt).toContain("- 현직 카카오 시니어");
  expect(prompt).toContain("- 실 프로젝트 사례");
});
```

- [ ] **Step 3: 기존 placeholder check 갱신 (line 64)**

```ts
// Before
expect(prompt).not.toMatch(/\{\{(name|description|angleHint|priceText|category|tags|targetUrl|fewShotBlock)\}\}/);

// After
expect(prompt).not.toMatch(/\{\{(name|description|angleHint|priceText|category|tags|targetUrl|fewShotBlock|learningOutcomesBlock|differentiatorsBlock)\}\}/);
```

- [ ] **Step 4: 테스트 실행**

```bash
npx vitest run packages/core/src/creative/prompt.test.ts 2>&1 | tail -10
```

Expected: 신규 7 + 기존 9 = **16 cases passing**.

### Task 1.8: `learning/prompts.ts` userTemplate + systemPrompt 갱신

**Files:**
- Modify: `packages/core/src/learning/prompts.ts:39-70`

- [ ] **Step 1: DEFAULT_PROMPTS 의 userTemplate 변경 (line 54-63)**

```ts
// Before
    userTemplate: `다음 제품/서비스에 대한 Instagram 광고 카피를 작성해주세요.

제품명: {{name}}
설명: {{description}}
가격: {{priceText}}
카테고리: {{category}}
태그: {{tags}}
링크: {{targetUrl}}

이 variant의 톤 가이드: {{angleHint}}{{fewShotBlock}}`,

// After
    userTemplate: `다음 제품/서비스에 대한 Instagram 광고 카피를 작성해주세요.

제품명: {{name}}
설명: {{description}}
가격: {{priceText}}{{learningOutcomesBlock}}{{differentiatorsBlock}}
카테고리: {{category}}
태그: {{tags}}
링크: {{targetUrl}}

이 variant의 톤 가이드: {{angleHint}}{{fewShotBlock}}`,
```

- [ ] **Step 2: DEFAULT_PROMPTS 의 systemPrompt 신규 정책 2 항목 추가 (line 49-50 다음)**

```ts
// Before
- 광범위 노출 정책: "당신만을 위한", "회원님께", "~님" 같은 1:1 개인화 표현 절대 금지. 모든 광고는 광범위 익명 노출 가정.
- 과장/규제 정책: "100% 효과", "1위", "최고", "유일한" 같은 검증 안 된 과장/superlative 절대 금지. 한국 표시광고법 + Meta 광고 정책 준수.

반드시 JSON 형식으로만 응답하세요:

// After
- 광범위 노출 정책: "당신만을 위한", "회원님께", "~님" 같은 1:1 개인화 표현 절대 금지. 모든 광고는 광범위 익명 노출 가정.
- 과장/규제 정책: "100% 효과", "1위", "최고", "유일한" 같은 검증 안 된 과장/superlative 절대 금지. 한국 표시광고법 + Meta 광고 정책 준수.
- 학습 결과 표현 정책: learningOutcomes 데이터 활용 시 "100% 마스터", "완벽 정복", "~을 보장합니다" 같은 효과 보장 표현 절대 금지. 동사형 결과만 (예: "실시간 채팅 시스템을 구현").
- 할인율 표현 정책: priceText 의 정확한 % 만 인용 ("50% 할인"). "역대 최저가", "최대 할인", "유례 없는" 같은 superlative 절대 금지.

반드시 JSON 형식으로만 응답하세요:
```

- [ ] **Step 3: 테스트 실행 (creative/copy.test.ts 가 systemPrompt 와 비교, prompt.test.ts 도 영향)**

```bash
npx vitest run packages/core/src/learning/prompts.test.ts packages/core/src/creative/copy.test.ts packages/core/src/creative/prompt.test.ts 2>&1 | tail -10
```

Expected: 모두 passing. `copy.test.ts:84` 의 `expect(call.system[0].text).toBe(DEFAULT_PROMPTS.copy.systemPrompt)` 는 동적 비교라 자동 통과. `learning/prompts.test.ts` 가 systemPrompt 길이 / userTemplate 길이 검증 시 신규 default 가 schema min 통과해야.

### Task 1.9: `improver/index.ts` model-facing prompt 안내 갱신

**Files:**
- Modify: `packages/core/src/improver/index.ts:75`

- [ ] **Step 1: line 75 의 절대 금지 표현 안내 교체**

```ts
// Before (single line at 75)
- 절대 금지 표현: "당신만을 위한", "회원님께", "~님" (개인화), "100%", "1위", "최고" 등 검증 안 된 과장 표현. newValue 에 이런 표현이 포함되면 거부됩니다.

// After (multi-line block)
- 절대 금지 표현:
  · 개인화: "당신만을 위한", "회원님께", "~님"
  · 과장/superlative: "100% 효과", "1위", "최고", "유일한"
  · 효과 보장: "100% 마스터", "완벽 정복", "보장합니다"
  · 할인율 superlative: "역대 최저", "최대 할인", "유례 없는"
  newValue 에 이런 표현이 포함되면 거부됩니다.
```

### Task 1.10: `improver/index.test.ts` toMatch ×2 추가

**Files:**
- Modify: `packages/core/src/improver/index.test.ts:103-104`

- [ ] **Step 1: 기존 2 줄 다음에 신규 2 줄 추가**

```ts
// Before
expect(prompt).toMatch(/당신만을 위한|회원님|~님/);
expect(prompt).toMatch(/100%|1위|최고|과장/);

// After
expect(prompt).toMatch(/당신만을 위한|회원님|~님/);
expect(prompt).toMatch(/100%|1위|최고|과장/);
expect(prompt).toMatch(/100%\s*마스터|완벽\s*정복|보장/);
expect(prompt).toMatch(/역대\s*최저|최대\s*할인|유례\s*없는/);
```

- [ ] **Step 2: 테스트 실행**

```bash
npx vitest run packages/core/src/improver/index.test.ts 2>&1 | tail -5
```

Expected: 기존 5 케이스 모두 passing (신규 2 toMatch 가 한 케이스 안에 들어가 카운트 동일).

### Task 1.11: `improver/runner.ts` BANNED_PATTERNS 확장

**Files:**
- Modify: `packages/core/src/improver/runner.ts:57-60`

- [ ] **Step 1: BANNED_PATTERNS 배열에 2 줄 추가**

```ts
// Before
const BANNED_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /당신만을 위한|회원[님사]|[가-힣A-Za-z]+님(?:께|에게|을(?!\s*뜻하|\s*의미)|이\s|만(?:\s|$|의))/u, label: "personalization" },
  { pattern: /100%\s*효과|1위(?!,)|최고의?\s|유일한\s/u, label: "unverified-hyperbole" },
];

// After
const BANNED_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /당신만을 위한|회원[님사]|[가-힣A-Za-z]+님(?:께|에게|을(?!\s*뜻하|\s*의미)|이\s|만(?:\s|$|의))/u, label: "personalization" },
  { pattern: /100%\s*효과|1위(?!,)|최고의?\s|유일한\s/u, label: "unverified-hyperbole" },
  { pattern: /100%\s*마스터|완벽\s*정복|보장(합니다|하는|된)/u, label: "result-guarantee" },
  { pattern: /역대\s*최저|최대\s*할인|유례\s*없는/u, label: "discount-superlative" },
];
```

### Task 1.12: `improver/runner.test.ts` +4 신규 reject 케이스

**Files:**
- Modify: `packages/core/src/improver/runner.test.ts`

- [ ] **Step 1: 기존 hyperbole 케이스 다음에 신규 4 케이스 추가**

`it("rejects newValue with '최고의 X' superlative (Gate 4 regression)", ...)` 다음 (line ~316) 에 다음 4 케이스 추가:

```ts
it("rejects newValue with '보장합니다' result-guarantee pattern (Gate 4)", async () => {
  mockClaudeResponse = JSON.stringify({
    promptKey: "copy.angleHints.numerical",
    newValue: "이 강의는 실력 향상을 보장합니다. 수치 강조 가이드 — 충분히 긴 길이로 유지.",
    reason: "test",
  });
  const analysis: AnalysisResult = {
    improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.angleHints.numerical" }],
  };
  await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });

  const dateKey = new Date().toISOString().split("T")[0];
  const rejectedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`);
  const raw = await readFile(rejectedPath, "utf-8");
  const rec = JSON.parse(raw);
  expect(rec[0].rejected[0].reason).toMatch(/banned pattern.*result-guarantee/);
});

it("rejects newValue with '100% 마스터' result-guarantee pattern (Gate 4)", async () => {
  mockClaudeResponse = JSON.stringify({
    promptKey: "copy.angleHints.emotional",
    newValue: "이 강의로 100% 마스터 가능. 감정 호소 가이드 — 충분히 긴 길이로 유지.",
    reason: "test",
  });
  const analysis: AnalysisResult = {
    improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.angleHints.emotional" }],
  };
  await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });

  const dateKey = new Date().toISOString().split("T")[0];
  const rejectedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`);
  const raw = await readFile(rejectedPath, "utf-8");
  const rec = JSON.parse(raw);
  expect(rec[0].rejected[0].reason).toMatch(/banned pattern.*result-guarantee/);
});

it("rejects newValue with '역대 최저' discount-superlative pattern (Gate 4)", async () => {
  mockClaudeResponse = JSON.stringify({
    promptKey: "copy.angleHints.urgency",
    newValue: "역대 최저가 할인 진행 중. 긴급성 강조 가이드 — 충분히 긴 길이로 유지.",
    reason: "test",
  });
  const analysis: AnalysisResult = {
    improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.angleHints.urgency" }],
  };
  await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });

  const dateKey = new Date().toISOString().split("T")[0];
  const rejectedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`);
  const raw = await readFile(rejectedPath, "utf-8");
  const rec = JSON.parse(raw);
  expect(rec[0].rejected[0].reason).toMatch(/banned pattern.*discount-superlative/);
});

it("rejects newValue with '최대 할인' discount-superlative pattern (Gate 4)", async () => {
  mockClaudeResponse = JSON.stringify({
    promptKey: "copy.angleHints.urgency",
    newValue: "최대 할인 혜택 진행 중. 긴급성 강조 가이드 — 충분히 긴 길이로 유지.",
    reason: "test",
  });
  const analysis: AnalysisResult = {
    improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.angleHints.urgency" }],
  };
  await runImprovementCycle([mkWeak("c1", 0.5)], analysis, { promptsPath: PROMPTS_PATH, improvementsDir: IMPROVEMENTS_DIR });

  const dateKey = new Date().toISOString().split("T")[0];
  const rejectedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`);
  const raw = await readFile(rejectedPath, "utf-8");
  const rec = JSON.parse(raw);
  expect(rec[0].rejected[0].reason).toMatch(/banned pattern.*discount-superlative/);
});
```

- [ ] **Step 2: 테스트 실행**

```bash
npx vitest run packages/core/src/improver/runner.test.ts 2>&1 | tail -10
```

Expected: 기존 14 + 신규 4 = **18 cases passing**.

### Task 1.13: 전체 테스트 + grep + STATUS.md + commit

- [ ] **Step 1: 전체 테스트**

```bash
npm test 2>&1 | tail -5
```

Expected: 기존 414 + parser +3 + prompt +7 + runner +4 = **428 passing** + 1 useReports 알려진 flake.

(Spec §5.4 의 "+17 신규" 는 embeddingText 3 케이스 포함 — 그건 Commit 2.)

- [ ] **Step 2: TypeScript clean**

```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
npx tsc --noEmit -p packages/cli/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
npx tsc --noEmit -p packages/server/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
```

Expected: 0 errors after filter.

- [ ] **Step 3: grep 검증**

```bash
grep -rn "learningOutcomes\|differentiators" packages/ --include="*.ts" --include="*.tsx" | wc -l
```

Expected: 30+ hits.

```bash
grep -rn "originalPrice" packages/ --include="*.ts" --include="*.tsx" | wc -l
```

Expected: 5+ hits.

- [ ] **Step 4: STATUS.md 갱신**

`docs/STATUS.md` line 3 의 "마지막 업데이트" 를 `2026-04-28` 로 갱신.

`## 알려진 결함 / 미구현 이슈` 섹션의 R-E 그룹 다음에 R-F 신규 그룹 추가:

```markdown
- **Product 데이터 풍부화 review-deferred items** (2026-04-28, Phase 1 commit `<TBD>`): 3 필드 추가 (learningOutcomes/differentiators/originalPrice) + parser/copy prompt/RAG 임베딩 통합 + 신규 banned-pattern 가드. review 사이클의 deferred 항목.
  - **R-F1** banned-pattern false positive monitoring — 신규 `result-guarantee` (`보장(합니다|하는|된)`) 와 `discount-superlative` (`최대\s*할인`) 패턴이 정당한 사용 ("기능을 보장하는", "최대 할인 50%" 처럼 사실 표시) 도 매칭 가능. 운영 1주 후 reject 빈도 확인. false positive 발견 시 컨텍스트 (효과/결과/성과 등) 추가하여 좁히기.
```

`## 최근 변경 이력` 섹션 맨 위에 신규 entry 추가:

```markdown
- 2026-04-28 feat(product): 데이터 풍부화 Phase 1 — Product 타입에 learningOutcomes/differentiators (required, default []) + originalPrice (옵셔널) 추가. parser system prompt 가 3 필드 추출, buildCopyPrompt 가 priceText 할인율 표시 + learningOutcomesBlock + differentiatorsBlock 헬퍼로 prompt 풍부화. DEFAULT_PROMPTS userTemplate 에 신규 placeholder 2개, systemPrompt 에 학습 결과 표현 정책 + 할인율 표현 정책 추가. improver banned-pattern 에 `result-guarantee` + `discount-superlative` 라벨 추가. 8 fixture 위치 갱신 (6 파일). +14 신규 테스트 케이스. 사용자가 기존 product JSON 삭제 + re-scrape 권장.
```

- [ ] **Step 5: 명시적 add (NEVER -A)**

```bash
git add packages/core/src/types.ts \
  packages/core/src/product/parser.ts \
  packages/core/src/product/parser.test.ts \
  packages/cli/src/tui/App.tsx \
  packages/core/src/platform/meta/assetFeedSpec.test.ts \
  packages/core/src/rag/retriever.test.ts \
  packages/core/src/rag/qualifyJob.test.ts \
  packages/core/src/rag/qualifier.test.ts \
  packages/cli/src/tui/screens/ReviewScreen.test.tsx \
  packages/core/src/creative/prompt.ts \
  packages/core/src/creative/prompt.test.ts \
  packages/core/src/learning/prompts.ts \
  packages/core/src/improver/index.ts \
  packages/core/src/improver/index.test.ts \
  packages/core/src/improver/runner.ts \
  packages/core/src/improver/runner.test.ts \
  docs/STATUS.md
```

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(product): Phase 1 데이터 풍부화 — learningOutcomes/differentiators/originalPrice + 신규 banned-pattern

신규 3 필드:
- Product.learningOutcomes: string[] (required, default [])
- Product.differentiators: string[] (required, default [])
- Product.originalPrice?: number (옵셔널)

parser (parser.ts): system prompt 가 3 필드 추출 규칙 명시 (동사형 학습 결과, 사실 기반 차별점, 할인 전 가격 만 추출), JSON schema 확장.

copy prompt (creative/prompt.ts): buildPriceText (할인율 % 표시), buildLearningOutcomesBlock, buildDifferentiatorsBlock 헬퍼 분리. 빈 값일 때 prompt 줄 자동 사라짐.

DEFAULT_PROMPTS (learning/prompts.ts):
- userTemplate 에 {{learningOutcomesBlock}} + {{differentiatorsBlock}} placeholder 추가
- systemPrompt 에 신규 정책 2개 (학습 결과 표현, 할인율 표현) — 효과 보장 + superlative 표현 차단

improver banned-pattern (runner.ts): BANNED_PATTERNS 에 `result-guarantee` (100% 마스터/완벽 정복/보장합니다) + `discount-superlative` (역대 최저/최대 할인/유례 없는) 2 라벨 추가. improver/index.ts 의 model-facing 안내도 동기.

호출처 갱신:
- App.tsx:152-164 manual entry default
- 8 fixture 위치 (6 파일): assetFeedSpec.test.ts ×3, retriever.test.ts mkProduct, qualifyJob.test.ts, qualifier.test.ts mkProd, ReviewScreen.test.tsx, prompt.test.ts baseProduct

테스트: parser.test.ts +3, prompt.test.ts +7 (신규 헬퍼 검증), improver/index.test.ts toMatch ×2, runner.test.ts +4 (신규 라벨 reject) = 14 신규 케이스.

마이그레이션: 사용자가 기존 product JSON 삭제 + re-scrape 권장. winners 테이블 (RAG) 은 Plan C 미운영 → 비어있음, 영향 zero.

Spec: docs/superpowers/specs/2026-04-28-product-enrichment-design.md §4-§5
RAG 임베딩 풍부화는 Commit 2 에서 별 처리.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Final verification + STATUS.md SHA 채우기**

```bash
git log --oneline -5
```

새 commit SHA 확인 후 STATUS.md R-F 그룹의 `commit \`<TBD>\`` 를 실제 SHA 로 교체 → amend 금지, 별 fixup commit 으로 처리:

```bash
git add docs/STATUS.md
git commit -m "docs(status): record Commit 1 SHA in R-F deferred items"
```

(또는 R-F SHA 를 비워두고 다음 fixup 사이클에 합쳐도 OK — 현재 정책상 amend 금지.)

### Task 1.14: marketing-copy-reviewer 검토

- [ ] **Step 1: marketing-copy-reviewer 호출**

`Agent` 도구로 `marketing-copy-reviewer` 호출. 컨텍스트:

```
Commit 1 of Product 데이터 풍부화 Phase 1 변경 검토 요청.

변경된 prompt 자산 (CLAUDE.md "Subagent 호출 규칙" 트리거):
- packages/core/src/learning/prompts.ts: DEFAULT_PROMPTS.copy.userTemplate (placeholders 2개 추가) + DEFAULT_PROMPTS.copy.systemPrompt (정책 2개 추가)
- packages/core/src/creative/prompt.ts: buildCopyPrompt 본체 + 헬퍼 3개 (buildPriceText, buildLearningOutcomesBlock, buildDifferentiatorsBlock)

검증 포인트:
1. 신규 정책 2개 (학습 결과 표현, 할인율 표현) 의 한국어 표현이 명확하고 한국 표시광고법 + Meta 광고 정책 정신에 부합하는가
2. priceText 의 "정가 X 에서 N% 할인" 한국어 표현이 표시광고법 위반 risk 없는가
3. learningOutcomesBlock / differentiatorsBlock 형식 (header + dash bullets) 이 모델이 prompt 인지하기에 충분히 명확한가
4. banned-pattern guard (`result-guarantee` + `discount-superlative`) 의 regex 가 false positive 위험을 받아들일 만큼 중요 violation 을 차단하는가
5. variant 별 (emotional/numerical/urgency) 활용도 — angleHints 갱신 안 했지만 신규 데이터로 자연스러운 톤 차별화 가능한가

variant tone label match (emotional / numerical / urgency) 은 angleHints 무변경 — 신규 데이터 (learningOutcomes/differentiators/originalPrice) 가 모든 variant prompt 에 동일 노출되며, 톤 차별화는 angleHints 가 담당.

BASE_SHA: <Task 1.13 commit 직전 SHA>
HEAD_SHA: <Task 1.13 commit SHA>
```

- [ ] **Step 2: 발견 이슈 처리**

Critical/Important: 즉시 수정 후 재검토 (별 fixup commit). Minor: STATUS.md R-F 에 추가 또는 수용.

### Task 1.15: code-reviewer 검토 (Commit 1)

- [ ] **Step 1: superpowers:code-reviewer 호출**

`Agent` 도구로 `superpowers:code-reviewer`. 컨텍스트:

```
WHAT_WAS_IMPLEMENTED: spec §4 + §5 변경 (Commit 1 = data + parser + manual entry + 8 fixture + buildCopyPrompt + DEFAULT_PROMPTS + improver banned-pattern + tests)
PLAN_OR_REQUIREMENTS: 본 plan Tasks 1.1-1.13
BASE_SHA: <Task 1.13 commit 직전 SHA>
HEAD_SHA: <Task 1.13 commit SHA>

검증 포인트:
- types.ts Product 신규 3 필드 정확
- parser.ts system prompt + return 동기 (응답 형식 line 의 키 == return 사용 키)
- App.tsx manual entry default 가 모든 신규 필드 채움
- 8 fixture 위치 모두 갱신 (assetFeedSpec.test.ts ×3 + retriever/qualifyJob/qualifier/ReviewScreen/prompt baseProduct)
- buildPriceText/learningOutcomesBlock/differentiatorsBlock 헬퍼의 빈 값 처리 (`""` 반환) 일관성
- DEFAULT_PROMPTS userTemplate placeholder 2개 추가 위치 + systemPrompt 정책 2개 위치 spec 과 일치
- BANNED_PATTERNS 신규 라벨 2개 regex 가 conservative (false positive 회피) — `보장(합니다|하는|된)` / `역대\s*최저|최대\s*할인|유례\s*없는` 형식
- 모든 테스트 신규 케이스 +14 통과
- TypeScript 0 errors after filter
- STATUS.md R-F1 등록
```

- [ ] **Step 2: 발견 이슈 처리**

Critical/Important: 즉시 수정 후 재검토. Minor: STATUS.md R-F 에 추가.

---

## Commit 2: RAG 임베딩 풍부화

### Task 2.1: `embeddingText.ts` 신규 helper

**Files:**
- Create: `packages/core/src/rag/embeddingText.ts`

- [ ] **Step 1: 신규 파일 작성**

```ts
import type { Product } from "../types.js";

export function buildProductEmbedText(product: Product): string {
  const parts: string[] = [product.description];
  if (product.learningOutcomes.length > 0) {
    parts.push(`학습 결과: ${product.learningOutcomes.join(", ")}`);
  }
  if (product.differentiators.length > 0) {
    parts.push(`차별점: ${product.differentiators.join(", ")}`);
  }
  return parts.join("\n");
}
```

`originalPrice` 미포함 — 숫자라 의미 임베딩에 효과 없음.

### Task 2.2: `embeddingText.test.ts` 신규 (3 케이스)

**Files:**
- Create: `packages/core/src/rag/embeddingText.test.ts`

- [ ] **Step 1: 3 케이스 작성**

```ts
import { describe, it, expect } from "vitest";
import { buildProductEmbedText } from "./embeddingText.js";
import type { Product } from "../types.js";

const baseProduct: Product = {
  id: "p1",
  name: "Test",
  description: "기본 설명",
  targetUrl: "https://example.com",
  currency: "KRW",
  tags: [],
  learningOutcomes: [],
  differentiators: [],
  inputMethod: "manual",
  createdAt: "2026-04-28T00:00:00Z",
};

describe("buildProductEmbedText", () => {
  it("returns just description when both arrays empty", () => {
    const text = buildProductEmbedText(baseProduct);
    expect(text).toBe("기본 설명");
  });

  it("appends 학습 결과 line when learningOutcomes populated", () => {
    const product = { ...baseProduct, learningOutcomes: ["A", "B"] };
    const text = buildProductEmbedText(product);
    expect(text).toBe("기본 설명\n학습 결과: A, B");
  });

  it("appends both lines when both populated, in order outcomes then differentiators", () => {
    const product = {
      ...baseProduct,
      learningOutcomes: ["O1", "O2"],
      differentiators: ["D1", "D2"],
    };
    const text = buildProductEmbedText(product);
    expect(text).toBe("기본 설명\n학습 결과: O1, O2\n차별점: D1, D2");
  });
});
```

- [ ] **Step 2: 테스트 실행**

```bash
npx vitest run packages/core/src/rag/embeddingText.test.ts 2>&1 | tail -5
```

Expected: 3 passing.

### Task 2.3: `qualifier.ts` embed 입력 변경

**Files:**
- Modify: `packages/core/src/rag/qualifier.ts`

- [ ] **Step 1: import 추가 (line 4 근처)**

```ts
// 기존 import 그룹 끝부분
import { buildProductEmbedText } from "./embeddingText.js";
```

- [ ] **Step 2: embed 호출 변경 (line 93-96)**

```ts
// Before
const [embedProduct, embedCopy] = await deps.embed([
  product.description,
  `${creative.copy.headline} ${creative.copy.body}`,
]);

// After
const [embedProduct, embedCopy] = await deps.embed([
  buildProductEmbedText(product),
  `${creative.copy.headline} ${creative.copy.body}`,
]);
```

- [ ] **Step 3: 테스트 실행**

```bash
npx vitest run packages/core/src/rag/qualifier.test.ts 2>&1 | tail -5
```

Expected: 기존 케이스 모두 passing (mock embed 가 input-agnostic 또는 length 만 사용 — spec §5.6 Important #2 검증 결과).

### Task 2.4: `retriever.ts` embed 입력 변경

**Files:**
- Modify: `packages/core/src/rag/retriever.ts`

- [ ] **Step 1: import 추가 (line 4 근처)**

```ts
import { buildProductEmbedText } from "./embeddingText.js";
```

- [ ] **Step 2: embed 호출 변경 (line 121)**

```ts
// Before
const [queryEmbed] = await deps.embed([product.description]);

// After
const [queryEmbed] = await deps.embed([buildProductEmbedText(product)]);
```

- [ ] **Step 3: 테스트 실행**

```bash
npx vitest run packages/core/src/rag/retriever.test.ts 2>&1 | tail -5
```

Expected: 기존 케이스 모두 passing.

### Task 2.5: 전체 테스트 + grep + commit

- [ ] **Step 1: 전체 테스트**

```bash
npm test 2>&1 | tail -5
```

Expected: Commit 1 후 428 + embeddingText 3 = **431 passing** + 1 useReports 알려진 flake.

- [ ] **Step 2: TypeScript clean**

```bash
npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | grep -v "facebook-nodejs\|TS7016" | head
```

Expected: 0 errors.

- [ ] **Step 3: grep 검증**

```bash
grep -rn "buildProductEmbedText" packages/ --include="*.ts"
```

Expected: 5 hits — embeddingText.ts (정의) + embeddingText.test.ts (import + 3 used) + qualifier.ts (import + 1 use) + retriever.ts (import + 1 use). 총 5 lines.

- [ ] **Step 4: 명시적 add**

```bash
git add packages/core/src/rag/embeddingText.ts \
  packages/core/src/rag/embeddingText.test.ts \
  packages/core/src/rag/qualifier.ts \
  packages/core/src/rag/retriever.ts
```

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(rag): enrich product embedding text with learningOutcomes + differentiators

신규 packages/core/src/rag/embeddingText.ts:
- buildProductEmbedText(product): description + (학습 결과: ...) + (차별점: ...) 라인 결합. 빈 배열일 때 자동 skip. originalPrice 미포함 (숫자라 의미 임베딩 효과 없음).

호출처:
- packages/core/src/rag/qualifier.ts:95 — winner 저장 시 임베딩 입력
- packages/core/src/rag/retriever.ts:121 — 신규 product 쿼리 임베딩 입력

양측 동일 함수 사용 → cosine similarity 의미 보존. winners 테이블 schema 무변경 (`product_description` 컬럼은 원본 description, `embedding_product` BLOB 은 enriched text 기반).

마이그레이션: winners 테이블 비어있음 (Plan C 미운영) → fresh state, 영향 zero. 미래 stale embedding 누적 시 별 spec 으로 re-embedding migration.

테스트: embeddingText.test.ts 신규 3 케이스 (empty / outcomes only / both populated).

Spec: docs/superpowers/specs/2026-04-28-product-enrichment-design.md §4.6-§4.8

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Final verification**

```bash
git log --oneline -7
```

Expected: HEAD = Commit 2, 직전 = Commit 1 (또는 Commit 1 + STATUS fixup), 더 이전 = `687e138 docs(specs)`.

### Task 2.6: code-reviewer 검토 (Commit 2)

- [ ] **Step 1: superpowers:code-reviewer 호출**

`Agent` 도구로 `superpowers:code-reviewer`. 컨텍스트:

```
WHAT_WAS_IMPLEMENTED: spec §4.6-§4.8 (Commit 2 = RAG 임베딩 풍부화)
PLAN_OR_REQUIREMENTS: 본 plan Tasks 2.1-2.5
BASE_SHA: <Commit 1 SHA>
HEAD_SHA: <Commit 2 SHA>

검증 포인트:
- buildProductEmbedText 의 빈 배열 skip 로직 정확 (`if (length > 0) push(...)`)
- originalPrice 미포함 의도 spec 일치
- qualifier.ts/retriever.ts 가 동일 buildProductEmbedText 사용 (양측 일관)
- import 경로 일관 (./embeddingText.js)
- 기존 qualifier/retriever 테스트 회귀 없음 (mock embed input-agnostic)
- embeddingText.test.ts 3 케이스 의미 있는 assertion
```

- [ ] **Step 2: 발견 이슈 처리**

---

## 완료 조건 (Definition of Done)

- [ ] 2 commits — Commit 1 (Tasks 1.1-1.13), Commit 2 (Tasks 2.1-2.5). 각 commit 후 fixup 가능.
- [ ] `npm test` ~431 (414 + 14 + 3) + 1 useReports 알려진 flake
- [ ] grep 검증:
  - `grep -rn "learningOutcomes\|differentiators" packages/ --include="*.ts" --include="*.tsx" | wc -l` → 30+ hits
  - `grep -rn "originalPrice" packages/ --include="*.ts" --include="*.tsx" | wc -l` → 5+ hits
  - `grep -rn "buildProductEmbedText" packages/ --include="*.ts"` → 5 lines
- [ ] 수동 검증 (사용자 직접):
  - 기존 `data/products/*.json` 삭제
  - inflearn URL re-scrape → JSON 에 신규 3 필드 채워짐 확인
  - `runGenerate` → 카피 결과에 풍부화 데이터 반영 확인
- [ ] `marketing-copy-reviewer` 검토 통과 (Commit 1)
- [ ] `code-reviewer` 검토 통과 (Commit 1, 2)
- [ ] STATUS.md R-F1 (false positive monitor) 등록 + 마지막 업데이트 = 2026-04-28

---

## 작업 시간 견적

| 단계 | 시간 |
|---|---|
| Task 0 (pre-flight) | 0.1h |
| Tasks 1.1-1.13 (Commit 1 코드 + 8 fixture + 14 신규 테스트 + commit) | 3.0h |
| Tasks 1.14-1.15 (marketing-copy-reviewer + code-reviewer + 수정) | 2.0h |
| Tasks 2.1-2.5 (Commit 2 코드 + 3 신규 테스트 + commit) | 0.7h |
| Task 2.6 (code-reviewer Commit 2) | 0.4h |
| 수동 검증 (re-scrape + runGenerate) | 0.5h |
| 안정화 | 0.3h |
| **합계** | **~7.0h** |

---

## Self-Review

### Spec coverage 매핑

| Spec section | Plan task | 검증 |
|---|---|---|
| §1 배경 | Plan header | ✅ |
| §2.1 범위 안 (Q1-Q5) | Task 0 + Tasks 1.x + 2.x | ✅ |
| §2.2 범위 밖 | Plan 본문 미포함 (의도) | ✅ |
| §3.1 신규 필드 타입 | Task 1.1 | ✅ |
| §3.2 manual entry | Task 1.4 | ✅ |
| §3.3 buildCopyPrompt 헬퍼 | Task 1.6 + 1.7 | ✅ |
| §3.4 RAG 임베딩 | Task 2.1-2.4 | ✅ |
| §3.5 banned-pattern | Task 1.9-1.12 | ✅ |
| §3.6 commit 분할 | Plan Commit 1, 2 구조 | ✅ |
| §4.1 Product type | Task 1.1 | ✅ |
| §4.2 parser.ts | Task 1.2 | ✅ |
| §4.3 App.tsx | Task 1.4 | ✅ |
| §4.4 buildCopyPrompt | Task 1.6 | ✅ |
| §4.5 learning/prompts.ts | Task 1.8 | ✅ |
| §4.6 embeddingText.ts | Task 2.1 | ✅ |
| §4.7 qualifier.ts | Task 2.3 | ✅ |
| §4.8 retriever.ts | Task 2.4 | ✅ |
| §4.9 BANNED_PATTERNS | Task 1.11 | ✅ |
| §4.10 improver/index.ts | Task 1.9 | ✅ |
| §5.1 신규 테스트 파일 | Task 2.2 | ✅ |
| §5.2 기존 파일 신규 케이스 | Task 1.3, 1.7, 1.10, 1.12 | ✅ |
| §5.3 fixture 갱신 (8 위치) | Task 1.5 (5 위치) + Task 1.7 baseProduct (1) — 합 6 파일 / 8 위치. spec types.test.ts:25 정정. | ✅ (정정 명시) |
| §5.4 +17 신규 케이스 | Task 1.3 (3) + 1.7 (7) + 1.12 (4) + 2.2 (3) = 17 ✅ |
| §5.5 통합 검증 (수동) | DoD 의 "수동 검증" 항목 | ✅ |
| §5.6 회귀 위험 | Task 1.5 fixture 갱신 + spec 작성 시 Important 해소 + R-F1 STATUS | ✅ |
| §6 영속 데이터 | Plan 본문 (사용자 직접 삭제) | ✅ |
| §7 리스크/롤백 | Plan 본문 미포함 (spec 위임) | ✅ |
| §8 작업 순서 | Plan Commit 1, 2 | ✅ |
| §9 시간 견적 | Plan 본문 | ✅ |
| §10 DoD | Plan DoD 섹션 | ✅ |
| §11 Open Questions | Plan 본문 미포함 (spec 위임) | ✅ |

### Placeholder scan

- "TBD", "TODO", "implement later": Task 1.13 Step 4 의 `commit \`<TBD>\`` 1건 — STATUS.md R-F 에 commit SHA 가 commit 후 채워지는 의도적 자리 표시자. Step 7 에서 fixup commit 으로 채움. 정당한 자리 표시자 — placeholder 위반 아님.
- "Add appropriate error handling" / "Similar to Task N": 0건 ✅
- 모든 step 코드 본체 명시 ✅

### Type consistency

- `buildPriceText(product: Product): string` / `buildLearningOutcomesBlock(items: string[]): string` / `buildDifferentiatorsBlock(items: string[]): string` — Task 1.6 정의, Task 1.7 사용 모두 일치 ✅
- `buildProductEmbedText(product: Product): string` — Task 2.1 정의, Task 2.2 테스트, Task 2.3/2.4 사용 모두 일치 ✅
- `Product.learningOutcomes: string[]` / `Product.differentiators: string[]` (required) / `Product.originalPrice?: number` (옵셔널) — Task 1.1 정의, Task 1.4 manual entry, 8 fixture, parser.ts return, prompt.ts 헬퍼 모두 일치 ✅
- BANNED_PATTERNS 신규 라벨 (`result-guarantee`, `discount-superlative`) — Task 1.11 정의, Task 1.12 테스트 모두 일치 ✅

이슈 없음.

### Spec 정정 사항

본 plan 작성 시 발견:
- spec §5.3 "8 위치/7 파일" → 실제 "8 위치/6 파일". types.test.ts:25 는 type-level only (`expectTypeOf<Product["inputMethod"]>...`) — runtime fixture 아님, 추가 작업 불필요. plan 의 Task 1.5 는 6 파일만 처리 (assetFeedSpec.test.ts ×3 / retriever / qualifyJob / qualifier / ReviewScreen). prompt.test.ts baseProduct 는 Task 1.7 에서 별도 처리.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-28-product-enrichment.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Commit 1 (Tasks 1.1-1.13) implementer + marketing-copy-reviewer + code-reviewer, Commit 2 (Tasks 2.1-2.5) implementer + code-reviewer.

**2. Inline Execution** — CLAUDE.md 가 Inline 사용 금지 — *해당 없음*.

CLAUDE.md 정책상 **Subagent-Driven 만 허용**. 진행 시 `superpowers:subagent-driven-development` 스킬 호출.

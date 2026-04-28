# Product 데이터 풍부화 Phase 1 — `learningOutcomes`, `differentiators`, `originalPrice`

**작성일:** 2026-04-28
**스펙 종류:** 데이터 모델 확장 + AI prompt 통합 + 정책 가드 강화
**관련:** `packages/core/src/types.ts`, `packages/core/src/product/parser.ts`, `packages/core/src/creative/prompt.ts`, `packages/core/src/learning/prompts.ts`, `packages/core/src/rag/{qualifier,retriever}.ts`, `packages/core/src/improver/{index,runner}.ts`

---

## 1. 배경 (Why)

### 1.1 동기

`packages/core/src/types.ts` 의 `Product` 타입은 현재 `name`/`description`/`price`/`tags`/`imageUrl`/`category` 6개 정보 필드만 보유. 광고 카피 생성에 가용한 정보가 얕음 → 카피 다양성 / 변별력 / 한국 광고 시장 적합도 떨어짐.

특히 강의 페이지 같은 정보-풍부 페이지를 scrape 했음에도 정작 광고 효과 큰 다음 정보들이 카피 생성 prompt 에 들어가지 않음:

- "이 강의 마치면 무엇을 할 수 있는가" (학습 결과)
- "다른 강의와 무엇이 다른가" (차별점)
- "정가 대비 할인 폭" (할인율)

### 1.2 본 spec 의 목표

`Product` 타입에 광고 카피 효과 큰 3 필드 추가:

- `learningOutcomes: string[]` — 학습/사용 후 결과 (예: "동시 접속 1000명 처리")
- `differentiators: string[]` — 차별점/USP (예: "현직 시니어 강의")
- `originalPrice?: number` — 할인 전 가격 (옵셔널)

부수 효과:

- parser system prompt 가 페이지에서 위 3 정보를 추출하도록 확장
- copy prompt (`buildCopyPrompt` + DEFAULT_PROMPTS.userTemplate) 가 신규 필드 활용
- RAG 임베딩 입력 풍부화 (`buildProductEmbedText` 헬퍼)
- 신규 필드 도입에 따른 한국 표시광고법 + Meta 광고 정책 위반 risk 영역 (할인율 superlative, 효과 보장) 의 banned-pattern 가드 강화

### 1.3 `gemini-to-claude-parser-design.md` §11.1 의 후보 5 필드 중 3 개만 채택

별 spec 으로 분리:
- `targetAudience` — 개인화 표현 ("당신은 ~") 빠지기 쉬워 banned-pattern 가드와 충돌 risk
- `socialProof` — rating/studentCount/review 추출이 페이지 구조에 따라 다양 (parser 정확도 낮음)

→ 본 spec scope-out, 운영 데이터로 정말 필요한지 판단 후 별 spec.

---

## 2. 범위

### 2.1 범위 안

| 결정 | 채택 (질문 → 답) |
|---|---|
| Q1 범위 | 3 필드만 (Phase 1) |
| Q2 manual entry | AddProductScreen 무변경 (4 step), 신규 필드는 parser 전용, 수동 제품은 빈 배열로 저장 |
| Q3 prompt 통합 | userTemplate 에 placeholder 추가 + buildCopyPrompt 가 빈 값일 때 해당 줄 제외 (헬퍼 함수 분리) |
| Q4 RAG schema | winners 테이블 schema 무변경, 임베딩 입력만 풍부화 (`buildProductEmbedText` 헬퍼, qualifier/retriever 양측 일관) |
| Q5 banned-pattern | systemPrompt 에 신규 가드 추가 (할인율 superlative + 효과 보장 표현), improver banned-pattern regex 도 확장 |

### 2.2 범위 밖 (deferred)

| 안 하는 것 | 이유 |
|---|---|
| `targetAudience` 추가 | 개인화 패턴 충돌 risk, 별 spec |
| `socialProof` 추가 | parser 정확도 낮음, 별 spec |
| Winner DB schema 확장 (신규 컬럼) | YAGNI, 회수 시 headline/body/cta 만 사용. 미래 UI 표시 / 필터링 필요 시 별 spec |
| 기존 winner re-embedding migration | Plan C 실 운영 미진행 → 데이터 없음, fresh state |
| AddProductScreen 신규 필드 폼 추가 | YAGNI, 수동 입력은 빠른 테스트용 경로 |
| Parser prompt 자기학습 | prompt-as-data 메타 부트스트랩 회피 |
| 기존 product JSON 마이그레이션 | 사용자가 직접 삭제 |

---

## 3. 핵심 결정

### 3.1 신규 필드 타입 — 2 required + 1 optional

- `learningOutcomes: string[]` — required, parser 가 못 찾으면 `[]`
- `differentiators: string[]` — required, 빈 배열 가능
- `originalPrice?: number` — optional (할인 없는 제품 다수)

required vs optional 결정 근거: array 필드는 default `[]` 가 자연스러움 + 모든 호출처 명시적 채움 가능. `originalPrice` 는 "값 없음" 상태가 의미 있으므로 옵셔널.

### 3.2 manual entry 무변경 + parser 가 메인 풍부화 경로

- AddProductScreen 폼 4 step 그대로
- 수동 제품은 `learningOutcomes:[]`, `differentiators:[]`, `originalPrice:undefined` 로 저장
- 카피 풍부화 효과는 parser 가 채운 제품에서만 발현 (수동 제품은 fallback 으로 기존 description+tags 만 사용)

### 3.3 buildCopyPrompt — 빈 값 처리는 헬퍼 함수 분리

`buildPriceText`/`buildLearningOutcomesBlock`/`buildDifferentiatorsBlock` 헬퍼 함수가 각각 빈 값 처리 → userTemplate 의 placeholder 가 빈 문자열로 치환되어 prompt 줄 자체가 사라짐.

기존 `priceText`/`fewShotBlock` 패턴과 일관:
- 데이터 있을 때: 한 블록 (앞에 `\n` 포함하여 그 줄에서 시작)
- 빈 값일 때: `""` 반환

### 3.4 RAG 임베딩 입력 풍부화

`buildProductEmbedText(product)` 단일 함수 → qualifier (winner 저장 시) + retriever (쿼리 시) 양측에서 동일 입력 사용 → cosine similarity 의미 보존.

```
[product.description]
[+ "학습 결과: " + learningOutcomes.join(", ")]  // 있을 때
[+ "차별점: " + differentiators.join(", ")]      // 있을 때
```

`originalPrice` 는 임베딩 미포함 (숫자라 의미 유사도 향상 효과 없음).

### 3.5 banned-pattern 가드 신규 2 개

신규 필드가 한국 표시광고법 위반 risk 카테고리를 늘림 — 기존 personalization + unverified-hyperbole 외에:

- `result-guarantee` — "100% 마스터", "완벽 정복", "보장합니다" (학습 결과 보장 표현)
- `discount-superlative` — "역대 최저", "최대 할인", "유례 없는" (할인율 superlative)

regex 는 conservative — 좁은 phrase 만 매칭. 운영 후 false positive 발견 시 refine.

### 3.6 commit 분할 (2 commits)

**Commit 1 = data layer + copy prompt + 가드** — atomic 필요 (type 변경 + 8 fixture + manual entry + prompt 변경 + 가드 모두 type-level 의존)

**Commit 2 = RAG 임베딩 풍부화** — Commit 1 의 신규 필드를 임베딩 입력에 사용. RAG retrieval 정확도 향상.

분할 효과:
- Commit 1 단독: 신규 필드 + 카피 풍부화 동작 — 즉시 가치
- Commit 2: fewShot 회수 정확도 추가 향상

---

## 4. 코드 상세

### 4.1 `packages/core/src/types.ts` Product 타입

```ts
export interface Product {
  id: string;
  name: string;
  description: string;
  price?: number;
  originalPrice?: number;       // NEW
  currency: string;
  imageUrl?: string;
  targetUrl: string;
  category?: string;
  tags: string[];
  learningOutcomes: string[];   // NEW (required, default [])
  differentiators: string[];    // NEW (required, default [])
  inputMethod: "scraped" | "manual";
  createdAt: string;
}
```

### 4.2 `packages/core/src/product/parser.ts`

system prompt 확장:

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

return 변경:

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

### 4.3 `packages/cli/src/tui/App.tsx:152-164` manual entry

신규 필드 default 추가:

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

### 4.4 `packages/core/src/creative/prompt.ts`

신규 헬퍼 + buildCopyPrompt 변경:

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

### 4.5 `packages/core/src/learning/prompts.ts`

DEFAULT_PROMPTS.copy.userTemplate 갱신:

```
다음 제품/서비스에 대한 Instagram 광고 카피를 작성해주세요.

제품명: {{name}}
설명: {{description}}
가격: {{priceText}}{{learningOutcomesBlock}}{{differentiatorsBlock}}
카테고리: {{category}}
태그: {{tags}}
링크: {{targetUrl}}

이 variant의 톤 가이드: {{angleHint}}{{fewShotBlock}}
```

DEFAULT_PROMPTS.copy.systemPrompt 의 정책 절 확장 (총 4개):

```
- 광범위 노출 정책: "당신만을 위한", "회원님께", "~님" 같은 1:1 개인화 표현 절대 금지. 모든 광고는 광범위 익명 노출 가정.
- 과장/규제 정책: "100% 효과", "1위", "최고", "유일한" 같은 검증 안 된 과장/superlative 절대 금지. 한국 표시광고법 + Meta 광고 정책 준수.
- 학습 결과 표현 정책: learningOutcomes 데이터 활용 시 "100% 마스터", "완벽 정복", "~을 보장합니다" 같은 효과 보장 표현 절대 금지. 동사형 결과만 (예: "실시간 채팅 시스템을 구현").
- 할인율 표현 정책: priceText 의 정확한 % 만 인용 ("50% 할인"). "역대 최저가", "최대 할인", "유례 없는" 같은 superlative 절대 금지.
```

REQUIRED_PLACEHOLDERS 무변경 (기존 `{{name}}`, `{{description}}`, `{{angleHint}}` 만 강제, 신규 placeholder 는 user-customized prompt 에서 optional).

PromptsSchema `userTemplate.min(100)` / `systemPrompt.min(50)` 변경 없음 — 신규 default 가 모두 통과.

### 4.6 `packages/core/src/rag/embeddingText.ts` (신규)

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

### 4.7 `packages/core/src/rag/qualifier.ts:93-96` 변경

```ts
import { buildProductEmbedText } from "./embeddingText.js";
// ...
const [embedProduct, embedCopy] = await deps.embed([
  buildProductEmbedText(product),
  `${creative.copy.headline} ${creative.copy.body}`,
]);
```

### 4.8 `packages/core/src/rag/retriever.ts:121` 변경

```ts
import { buildProductEmbedText } from "./embeddingText.js";
// ...
const [queryEmbed] = await deps.embed([buildProductEmbedText(product)]);
```

### 4.9 `packages/core/src/improver/runner.ts:57-60` BANNED_PATTERNS 확장

```ts
const BANNED_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /당신만을 위한|회원[님사]|[가-힣A-Za-z]+님(?:께|에게|을(?!\s*뜻하|\s*의미)|이\s|만(?:\s|$|의))/u, label: "personalization" },
  { pattern: /100%\s*효과|1위(?!,)|최고의?\s|유일한\s/u, label: "unverified-hyperbole" },
  { pattern: /100%\s*마스터|완벽\s*정복|보장(합니다|하는|된)/u, label: "result-guarantee" },
  { pattern: /역대\s*최저|최대\s*할인|유례\s*없는/u, label: "discount-superlative" },
];
```

### 4.10 `packages/core/src/improver/index.ts:75` model-facing prompt 안내

```
- 절대 금지 표현:
  · 개인화: "당신만을 위한", "회원님께", "~님"
  · 과장/superlative: "100% 효과", "1위", "최고", "유일한"
  · 효과 보장: "100% 마스터", "완벽 정복", "보장합니다"
  · 할인율 superlative: "역대 최저", "최대 할인", "유례 없는"
  newValue 에 이런 표현이 포함되면 거부됩니다.
```

---

## 5. 테스트 전략

### 5.1 신규 테스트 파일

| 파일 | 케이스 | 검증 대상 |
|---|---|---|
| `packages/core/src/rag/embeddingText.test.ts` | 3 | `buildProductEmbedText` — empty / outcomes only / both populated |

### 5.2 기존 파일 신규 케이스 추가

| 파일 | +케이스 | 검증 대상 |
|---|---|---|
| `packages/core/src/product/parser.test.ts` (현 6) | +3 | 신규 3 필드 추출 + JSON schema 검증 갱신 |
| `packages/core/src/creative/prompt.test.ts` (현 9) | +7 | `buildPriceText` 할인 표시 (×3) + `buildLearningOutcomesBlock` (×2) + `buildDifferentiatorsBlock` (×2) |
| `packages/core/src/improver/runner.test.ts` (현 14) | +4 | `result-guarantee` reject (×2), `discount-superlative` reject (×2) |
| `packages/core/src/improver/index.test.ts` (현 ~5) | 갱신 line 103-104 | 신규 4 패턴 toMatch 추가 |

### 5.3 기존 fixture 갱신 (8 위치, 7 파일)

`Product` literal 에 `learningOutcomes: [], differentiators: []` 추가:

| 파일 | line |
|---|---|
| `packages/core/src/types.test.ts` | :25 |
| `packages/core/src/platform/meta/assetFeedSpec.test.ts` | :7, :80, :120 |
| `packages/core/src/rag/retriever.test.ts` | :157 |
| `packages/core/src/rag/qualifyJob.test.ts` | :44 |
| `packages/core/src/rag/qualifier.test.ts` | :194 |
| `packages/cli/src/tui/screens/ReviewScreen.test.tsx` | :17 |
| `packages/core/src/creative/prompt.test.ts` | :5-16 baseProduct (신규 케이스에 자동 포함) |

### 5.4 테스트 수 delta

신규 케이스: 3 + 3 + 7 + 4 = **+17 신규**. 갱신 1 (improver/index.test.ts toMatch). 8 fixture 갱신은 mechanical (테스트 카운트 동일).

기존 414 → ~431.

### 5.5 통합 검증 (수동)

1. 사용자가 기존 `data/products/*.json` 삭제
2. inflearn URL re-scrape → JSON 에 `learningOutcomes`/`differentiators`/`originalPrice` 필드 채워짐 확인
3. `runGenerate` → 카피 결과에 풍부화 데이터 반영 (예: 할인율 인용, 학습 결과 동사형 표현, 차별점 언급)
4. winners DB 비어있는 fresh state → fewShot=[] 정상 fallback

### 5.6 회귀 위험

#### Critical
**없음** — Product 타입 신규 required 필드 추가 → TypeScript compile-time 안전망. 모든 호출처 (manual entry App.tsx + 8 fixture) 본 spec 에 명시.

#### Important

**Important #1**: `priceText` 변경이 다른 호출처 영향 — spec 작성 시 grep 검증 완료. `creative/prompt.ts` 본체 + `prompt.test.ts` placeholder 검사 + `learning/prompts.ts` userTemplate placeholder + `improver/index.ts:74` model-facing 안내 (placeholder 이름만 언급) 가 전부. `campaign/monitor.ts:46` / `cli/tui/format.ts` / `MonitorScreen.tsx` 의 `toLocaleString` 은 spend/CTR 포맷팅 — unrelated. ✅ closed.

**Important #2**: `qualifier.test.ts` / `retriever.test.ts` mock embed input pattern 확인 — `retriever.test.ts` 는 모두 input-agnostic (`async () => [[1,0,0]]`), `qualifier.test.ts` 는 `(texts) => texts.map(...)` 형태로 length/index 만 사용 (input text 직접 검증 없음). spec 의 enriched text 변경이 mock 깨뜨릴 risk 낮음. ✅ closed.

**Important #3**: `creative/copy.test.ts` — `expect(call.system[0].text).toBe(DEFAULT_PROMPTS.copy.systemPrompt)` 형태로 DEFAULT_PROMPTS 의 *현재 값* 과 비교 (정적 문자열 아님) → spec 의 systemPrompt 변경 반영됨. line 62-75 의 substring check ("40", "125", "3", "온라인 강의") 는 본 spec 변경과 무관. ✅ closed.

**Important #4**: 신규 banned-pattern false positive 위험. STATUS.md R-F1 으로 등록 + 운영 1주 후 reject 빈도 확인.

#### Minor
- 8 fixture 갱신 mechanical
- 자기학습 루프가 sysetmPrompt 진화 시 신규 가드 안내 부분 보존 안 할 수 있음 → improver Gate 4 가 fail-safe (실 가드 검증)

---

## 6. 영속 데이터 마이그레이션

**필요 없음 (사용자 직접 처리).**

- 기존 1개 product JSON `data/products/11333548-86ea-464a-a414-d788b9164b4d.json` 사용자 삭제 예정
- winners 테이블 (`data/creatives.db`) 비어있음 — Plan C wire-up 됐으나 실 운영 미진행
- DEFAULT_PROMPTS 변경 + `data/learned/prompts.json` 부재 → 첫 호출 시 신규 default 사용 (loader 가 file-missing → DEFAULT_PROMPTS fallback)

만약 사용자가 이미 `data/learned/prompts.json` 을 customize 한 상태면 schema 통과 시 그대로 유지 (신규 placeholder 자동 활용 안 됨, 그러나 fail-safe). 이 경우 사용자가 prompts.json 삭제 → 자동 재생성 가능.

---

## 7. 리스크 + 롤백

### 7.1 회귀 위험

§5.6 참조. Critical 0, Important 4건 (모두 plan 단계 grep 검증 + 운영 monitor 로 처리).

### 7.2 롤백

`git revert <sha>` 단순 복구. Commit 1, 2 각각 독립 revert 가능 — Commit 2 가 Commit 1 의 신규 필드 사용하지만 Commit 2 만 revert 시 RAG 가 description 만 사용 (이전 동작) → 안전.

Commit 1 revert 는 신규 필드 호출처 8 fixture 도 함께 revert 됨 — 정상 자동.

### 7.3 중간 상태 안전성

Commit 1 만 land 후:
- 신규 product JSON 신규 3 필드 채워짐
- 카피 prompt 풍부화 동작
- RAG 임베딩은 description 만 (정확도 향상 없음)

이 상태 안전 — 시스템 정상 동작.

---

## 8. 작업 순서 (2 commits)

### Commit 1 — data + copy prompt + 가드

**Files (~13):**
- `packages/core/src/types.ts`
- `packages/core/src/product/parser.ts` + `parser.test.ts`
- `packages/cli/src/tui/App.tsx` (manual entry default)
- 8 fixture (types/assetFeedSpec×3/retriever/qualifyJob/qualifier/ReviewScreen)
- `packages/core/src/creative/prompt.ts` + `prompt.test.ts`
- `packages/core/src/learning/prompts.ts`
- `packages/core/src/improver/index.ts` + `index.test.ts`
- `packages/core/src/improver/runner.ts` + `runner.test.ts`
- `docs/STATUS.md`

**Subagent 트리거:**
- `marketing-copy-reviewer` — CLAUDE.md "Copy 생성 로직/결과 변경" 강 트리거 (DEFAULT_PROMPTS systemPrompt + userTemplate + buildCopyPrompt 본체 모두 변경)
- `superpowers:code-reviewer`

### Commit 2 — RAG 임베딩 풍부화

**Files (4):**
- `packages/core/src/rag/embeddingText.ts` (신규)
- `packages/core/src/rag/embeddingText.test.ts` (신규)
- `packages/core/src/rag/qualifier.ts`
- `packages/core/src/rag/retriever.ts`

**Subagent 트리거:**
- `superpowers:code-reviewer`

---

## 9. 작업 시간 견적

| 단계 | 시간 |
|---|---|
| Spec 작성 + 자체 검토 | 0.7h |
| Plan 작성 | 0.5h |
| Commit 1 코드 + 8 fixture + 14 신규 테스트 | 3.0h |
| Commit 2 코드 + 3 신규 테스트 | 0.7h |
| marketing-copy-reviewer + code-reviewer × 2 + 수정 | 2.0h |
| 수동 검증 (re-scrape + runGenerate) | 0.5h |
| 안정화 | 0.3h |
| **합계** | **~7.7h (1일)** |

---

## 10. Definition of Done

- [ ] 2 commits land
- [ ] `npm test` ~431 passing (414 + 17 신규) + 1 useReports 알려진 flake
- [ ] TypeScript clean (filter facebook-nodejs TS7016)
- [ ] grep 검증:
  - `grep -rn "learningOutcomes\|differentiators" packages/ --include="*.ts" | wc -l` → 30+ hits
  - `grep -rn "originalPrice" packages/ --include="*.ts" | wc -l` → 10+ hits
  - `grep -rn "buildProductEmbedText" packages/ --include="*.ts"` → 5 hits
- [ ] 수동 검증:
  - 기존 product JSON 삭제 후 inflearn re-scrape → 신규 3 필드 채워짐
  - `runGenerate` 카피 결과에 풍부화 반영 확인
- [ ] `marketing-copy-reviewer` 검토 통과 (Commit 1)
- [ ] `code-reviewer` 검토 통과 (Commit 1, 2)
- [ ] STATUS.md R-F1 (false positive monitor) 등록

---

## 11. Open Questions / 후속 작업

### 11.1 `targetAudience` / `socialProof` — 별 spec

운영 후 정말 필요한지 판단. `targetAudience` 는 personalization 가드 우회 패턴 설계 필요.

### 11.2 false positive monitoring (R-F1)

운영 1주 후 신규 banned-pattern reject 빈도 확인. false positive 발견 시 regex refine.

### 11.3 winners 테이블 schema 확장 (필요 시)

미래에 풍부화 데이터로 winner 회수 필터링 (예: 유사 할인율) 가 필요해지면 별 spec 으로 컬럼 추가 + safeAlter migration.

### 11.4 angleHints 풍부화

현재 angleHints 는 추상적 ("감정 호소 중심", "수치/통계 전면", "긴급성 강조"). 신규 필드와 연결 — emotional → differentiators emphasize, numerical → learningOutcomes/할인율 emphasize, urgency → 할인율 emphasize. 자기학습 루프가 진화시킬 수 있어 hardcode 보다 운영 데이터로 자동 진화 우선.

---

## 12. 검토 이력

### 2026-04-28 — 초안 작성 + 섹션 단위 자체 검토

7 섹션 (범위 / Product type + parser / buildCopyPrompt / RAG 임베딩 / banned-pattern / 테스트 / commit + DoD) 각각 5점 점검 적용:

- Section 1: Critical 0 / Important 0 / Minor 0
- Section 2: Critical 0 / Important 1 (parser 가 빈 배열 반환 graceful 처리 — §3 에서 처리됨), Minor 1 (originalPrice null→undefined 변환 일관성)
- Section 3: Critical 0 / Important 2 (priceText 호출처 grep 필요, PromptsSchema min 통과 확인), Minor 1 (정가/할인 표현 표시광고법 적합)
- Section 4: Critical 0 / Important 2 (qualifier/retriever mock embed pattern 확인, buildProductEmbedText 자체 테스트 필요)
- Section 5: Critical 0 / Important 2 (false positive monitoring R-F1, PromptsSchema systemPrompt min 통과)
- Section 6: Critical 0 / Important 1 (creative/copy.test.ts 영향 grep 필요)
- Section 7: Critical 0 / Important 2 (Commit 1 변경 폭 큼, marketing-copy-reviewer 호출 시 false positive 시나리오 명시)

### 종합

- Critical: 0건
- Important: 10건 (이 중 §5.6 Important #1/#2/#3 = spec 작성 시 grep 검증 closed, 나머지 7건은 plan 단계 grep 또는 운영 monitor 로 처리)
- Minor: 2건 (한국어 표현 적합성)

### 2026-04-28 — spec 저장 후 5점 점검 1회 추가 적용

추가 검증:
- `priceText` / mock embed pattern / `copy.test.ts` 영향 — grep 으로 직접 확인, 모두 closed (§5.6 Important #1/#2/#3 갱신)
- 비-테스트 production 코드의 Product literal 생성 위치 — grep 결과 `parser.ts:55` + `App.tsx:162` 2곳만, 모두 spec 본문 §4.2/§4.3 에 명시. 누락 없음.

다음 단계: 사용자 검토 → 승인 시 `superpowers:writing-plans` 스킬로 plan 작성.

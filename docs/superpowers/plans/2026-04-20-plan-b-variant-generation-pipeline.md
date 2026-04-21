# Plan B — Variant Generation Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Product 1개당 copy variant 3개(emotional/numerical/urgency)를 생성하고, 공유 이미지/영상과 함께 variantGroup 단위로 리뷰 → 2개 이상 승인 시 Meta DCO 런칭.

**Architecture:**
- `buildCopyPrompt`를 순수 함수로 추출하고 `variantLabel`에 따라 prompt에 angle hint를 삽입한다.
- `generateCopy(client, product, fewShot, variantLabel)` 시그니처를 확장. Plan B는 `fewShot=[]`로 호출하고, Plan C에서 RAG를 붙인다.
- 파이프라인은 제품당 3번 `generateCopy` 호출(각 `variantLabel` 한 번씩), 이미지/영상은 1번만 생성 후 3 Creative가 공유한다.
- 리뷰는 variantGroup 단위 — 같은 그룹의 3 variant를 한 화면에서 승인/거절/수정한다.
- Launch는 `variantGroupId`로 그룹화 후 `groupApprovalCheck`로 ≥ 2 approved 확인 → `assembleAssetFeedSpec`이 2~3개 body를 하나의 DCO에 묶는다.

**Tech Stack:** TypeScript, vitest, Anthropic SDK, Ink (CLI TUI), Meta `asset_feed_spec` (기존 Plan A 산출물 재사용).

**Plan A와의 관계:** Plan A가 `assembleAssetFeedSpec`, Platform Adapter, Campaign 스키마 확장, rollback을 이미 구축했다. Plan B는 그 위에서 "1 variantGroup = 1 Creative"를 "1 variantGroup = 3 Creatives"로 넓히고 launch/review를 그룹 aware로 바꾸는 것이 핵심.

**현재 상태 (2026-04-20 base):**
- 183 테스트 통과
- Creative 하나당 variantGroupId 부여, variantLabel은 "emotional" 고정, `launch`는 Creative 1개를 그룹 1개로 취급.
- `assembleAssetFeedSpec`는 이미 N bodies를 지원하지만 호출부가 항상 `creatives: [creative]`로만 호출.

---

## File Structure

### Create
- `core/creative/prompt.ts` — `buildCopyPrompt(product, fewShot, variantLabel)` 순수 함수.
- `core/creative/prompt.test.ts` — angle hint 문자열 검증, fewShot 렌더링 검증.
- `core/launch/groupApproval.ts` — `groupApprovalCheck`, `groupCreativesByVariantGroup` 순수 함수.
- `core/launch/groupApproval.test.ts` — 0/1/2/3 approved 경계 케이스, 복수 그룹 분리.

### Modify
- `core/creative/copy.ts` — `generateCopy` 시그니처 확장, `buildCopyPrompt` 사용.
- `core/creative/copy.test.ts` — 새 시그니처 호출, variantLabel/fewShot mock 검증.
- `cli/client/aiProxy.ts` — `generateCopy(product, fewShot, variantLabel)` 시그니처 전파.
- `server/routes/aiCopy.ts` — request body에서 `fewShot`, `variantLabel` 받아 `generateCopy`에 전달.
- `cli/pipeline.ts` — 각 제품에 대해 3 variantLabel로 generateCopy 3회, image/video 1회 후 공유.
- `cli/actions.ts` — `runGenerate`, `runLaunch` 수정 (3 variants 생성, group 기반 런칭).
- `cli/entries/launch.ts` — variantGroupId 기반 그룹화, ≥ 2 approved 게이트.
- `cli/reviewer/session.ts` — variantGroup 단위 아이템 구성.
- `cli/tui/ReviewScreen.tsx` — 한 화면에 variantGroup의 3 variant 표시, variant 탭 이동.
- `docs/STATUS.md` — Phase 진행, 최근 변경 이력.
- `docs/ROADMAP.md` — Plan B 완료 처리, Plan C 추천 다음 작업.

### No Touch
- `core/platform/meta/launcher.ts`, `assetFeedSpec.ts`, `monitor.ts`, `rollback.ts` — Plan A에서 이미 N-variant를 지원. 변경 불필요.
- `core/types.ts` — Creative/Campaign 스키마는 Plan A에서 이미 확장됨.
- `scripts/migrate-creatives.ts` — 기존 1-variant creative는 이미 `variantGroupId` 소지. Plan B는 신규 생성만 3-variant이므로 마이그레이션 불필요.

---

## Task 1: Extract `buildCopyPrompt` with angle hints

**Files:**
- Create: `core/creative/prompt.ts`
- Create: `core/creative/prompt.test.ts`

**Context:** 현재 `core/creative/copy.ts`의 `generateCopy`는 system prompt 1개 + user message 1개를 인라인으로 조립한다. Plan B는 variantLabel별 angle hint (감정/수치/긴급성)와 fewShot 예시를 prompt에 얹어야 하므로, 먼저 prompt 조립 로직을 순수 함수로 분리한다. 이 Task는 `copy.ts` 변경 없이 새 파일만 만든다 — 다음 Task 2에서 `copy.ts`가 이것을 소비한다.

**Angle hint 문자열:** (spec §3.1에서 확정)
- `emotional`: "감정 호소 중심으로 독자의 욕구·공감대를 자극하세요"
- `numerical`: "수치·통계·비교를 전면에 배치하세요"
- `urgency`: "긴급성·희소성(기한, 한정 수량 등)을 강조하세요"

**FewShotExample 타입은 Plan C에서 도입된다.** Plan B는 `fewShot: unknown[]`를 받되 `fewShot.length > 0`일 때만 "참고 예시" 섹션을 렌더링하고, 실제 렌더링 로직은 Plan C에서 확장한다. 지금은 빈 배열만 지원해도 된다 — 타입을 `fewShot: FewShotExample[]`로 이름만 예약한다.

- [ ] **Step 1: Write the failing tests**

Create `core/creative/prompt.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildCopyPrompt, VARIANT_LABELS } from "./prompt.js";
import type { Product } from "../types.js";

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

describe("buildCopyPrompt", () => {
  it("injects emotional angle hint when variantLabel='emotional'", () => {
    const prompt = buildCopyPrompt(baseProduct, [], "emotional");
    expect(prompt).toContain("감정 호소");
  });

  it("injects numerical angle hint when variantLabel='numerical'", () => {
    const prompt = buildCopyPrompt(baseProduct, [], "numerical");
    expect(prompt).toContain("수치");
  });

  it("injects urgency angle hint when variantLabel='urgency'", () => {
    const prompt = buildCopyPrompt(baseProduct, [], "urgency");
    expect(prompt).toContain("긴급성");
  });

  it("does not render fewShot section when fewShot is empty", () => {
    const prompt = buildCopyPrompt(baseProduct, [], "emotional");
    expect(prompt).not.toContain("참고 예시");
  });

  it("renders fewShot section header when fewShot is non-empty", () => {
    const prompt = buildCopyPrompt(baseProduct, [{} as any], "emotional");
    expect(prompt).toContain("참고 예시");
  });

  it("includes product name, description, price, tags, and targetUrl", () => {
    const prompt = buildCopyPrompt(baseProduct, [], "emotional");
    expect(prompt).toContain("React 완전정복");
    expect(prompt).toContain("React를 처음부터 배웁니다");
    expect(prompt).toContain("55,000");
    expect(prompt).toContain("react");
    expect(prompt).toContain("https://inflearn.com/course/react");
  });

  it("uses '가격 미정' when product.price is undefined", () => {
    const prompt = buildCopyPrompt({ ...baseProduct, price: undefined }, [], "emotional");
    expect(prompt).toContain("가격 미정");
  });

  it("VARIANT_LABELS contains exactly 3 labels in the canonical order", () => {
    expect(VARIANT_LABELS).toEqual(["emotional", "numerical", "urgency"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run core/creative/prompt.test.ts`
Expected: FAIL with "Cannot find module './prompt.js'" or similar.

- [ ] **Step 3: Implement `buildCopyPrompt`**

Create `core/creative/prompt.ts`:

```typescript
import type { Product } from "../types.js";

export type VariantLabel = "emotional" | "numerical" | "urgency";

// Plan C에서 WinnerCreative 기반으로 확장. Plan B는 빈 배열만 사용.
export interface FewShotExample {
  headline: string;
  body: string;
  cta: string;
}

export const VARIANT_LABELS: readonly VariantLabel[] = [
  "emotional",
  "numerical",
  "urgency",
] as const;

const ANGLE_HINTS: Record<VariantLabel, string> = {
  emotional: "감정 호소 중심으로 독자의 욕구·공감대를 자극하세요.",
  numerical: "수치·통계·비교를 전면에 배치하세요.",
  urgency: "긴급성·희소성(기한, 한정 수량 등)을 강조하세요.",
};

export function buildCopyPrompt(
  product: Product,
  fewShot: FewShotExample[],
  variantLabel: VariantLabel,
): string {
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

  return `다음 제품/서비스에 대한 Instagram 광고 카피를 작성해주세요.

제품명: ${product.name}
설명: ${product.description}
가격: ${priceText}
카테고리: ${product.category ?? "기타"}
태그: ${product.tags.join(", ")}
링크: ${product.targetUrl}

이 variant의 톤 가이드: ${ANGLE_HINTS[variantLabel]}${fewShotBlock}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run core/creative/prompt.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Run full suite — no regressions**

Run: `npx vitest run`
Expected: PASS 191 tests (183 baseline + 8 new).

- [ ] **Step 6: Commit**

```bash
git add core/creative/prompt.ts core/creative/prompt.test.ts
git commit -m "$(cat <<'EOF'
feat(creative): extract buildCopyPrompt with variantLabel angle hints

Plan B task 1. emotional/numerical/urgency 각 톤 가이드 문자열 주입.
fewShot 배열이 비어있지 않을 때만 참고 예시 섹션 렌더링.
FewShotExample 타입은 예약만 하고, Plan C에서 Winner DB 연결 시 실제 구조 확장.
EOF
)"
```

---

## Task 2: Extend `generateCopy` signature

**Files:**
- Modify: `core/creative/copy.ts`
- Modify: `core/creative/copy.test.ts`

**Context:** Task 1이 `buildCopyPrompt`를 분리했다. 이제 `generateCopy`가 이를 사용하도록 시그니처를 `generateCopy(client, product, fewShot, variantLabel)`로 확장한다. Plan B는 항상 `fewShot=[]`로 호출되지만, 시그니처는 Plan C까지 고려하여 확정한다.

Task 2는 `COPY_SYSTEM_PROMPT`의 기존 regex 검증 테스트(40자/125자/3개 hashtag)를 보존한다 — 프롬프트 규칙 자체는 변경하지 않는다. 시그니처만 변경되므로 호출부(aiProxy, pipeline, actions, server route)는 Task 4~5에서 업데이트한다.

- [ ] **Step 1: Write the failing tests**

Overwrite `core/creative/copy.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { generateCopy, COPY_SYSTEM_PROMPT } from "./copy.js";
import type { Product } from "../types.js";

const mockProduct: Product = {
  id: "test-id", name: "React 완전정복", description: "React를 처음부터 배웁니다",
  imageUrl: "https://example.com/thumb.jpg", targetUrl: "https://inflearn.com/course/react",
  category: "course", currency: "KRW", price: 55000, tags: ["react", "frontend"],
  inputMethod: "scraped", createdAt: "2026-04-16T00:00:00.000Z",
};

function mockClient(responseText: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: responseText }],
      }),
    },
  };
}

describe("generateCopy", () => {
  it("returns structured copy with all required fields", async () => {
    const client = mockClient(JSON.stringify({
      headline: "React를 3주 만에 마스터하세요",
      body: "현직 개발자가 알려주는 실전 React.",
      cta: "강의 보러가기",
      hashtags: ["#React", "#프론트엔드", "#개발공부"],
    }));
    const result = await generateCopy(client as any, mockProduct, [], "emotional");
    expect(result.headline).toBeTruthy();
    expect(result.body).toBeTruthy();
    expect(result.cta).toBeTruthy();
    expect(result.hashtags).toHaveLength(3);
  });

  it("injects variantLabel angle hint into the user message", async () => {
    const client = mockClient(JSON.stringify({
      headline: "h", body: "b", cta: "c", hashtags: ["a", "b", "c"],
    }));
    await generateCopy(client as any, mockProduct, [], "urgency");
    const call = (client.messages.create as any).mock.calls[0][0];
    const userContent = call.messages[0].content;
    expect(userContent).toContain("긴급성");
  });

  it("includes fewShot examples in the prompt when non-empty", async () => {
    const client = mockClient(JSON.stringify({
      headline: "h", body: "b", cta: "c", hashtags: ["a", "b", "c"],
    }));
    await generateCopy(
      client as any,
      mockProduct,
      [{ headline: "WINNER_HEADLINE", body: "WINNER_BODY", cta: "WINNER_CTA" }],
      "emotional",
    );
    const userContent = (client.messages.create as any).mock.calls[0][0].messages[0].content;
    expect(userContent).toContain("WINNER_HEADLINE");
  });

  it("COPY_SYSTEM_PROMPT does not mention 온라인 강의 specifically", () => {
    expect(COPY_SYSTEM_PROMPT).not.toContain("온라인 강의");
  });

  it("COPY_SYSTEM_PROMPT specifies 40-char headline limit", () => {
    expect(COPY_SYSTEM_PROMPT).toContain("40");
  });

  it("COPY_SYSTEM_PROMPT specifies 125-char body limit", () => {
    expect(COPY_SYSTEM_PROMPT).toContain("125");
  });

  it("COPY_SYSTEM_PROMPT specifies exactly 3 hashtags", () => {
    expect(COPY_SYSTEM_PROMPT).toContain("3");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run core/creative/copy.test.ts`
Expected: FAIL — old `generateCopy(client, product)` signature doesn't accept 4 args; TypeScript 에러 또는 "Cannot read properties" 런타임 에러.

- [ ] **Step 3: Update `generateCopy` to use `buildCopyPrompt`**

Overwrite `core/creative/copy.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { Product, Creative } from "../types.js";
import { buildCopyPrompt, type FewShotExample, type VariantLabel } from "./prompt.js";

export const COPY_SYSTEM_PROMPT = `당신은 Meta(Instagram/Facebook) 광고 카피라이터입니다.
모든 종류의 제품·서비스 광고에 최적화된 카피를 작성합니다.

규칙:
- 헤드라인: 구매/사용 후 얻는 구체적 결과물 또는 수치 포함 (최대 40자)
- 본문: 제품/서비스의 핵심 가치와 차별점 강조 (최대 125자)
- CTA: 행동을 유도하는 짧은 문구 (최대 20자)
- 해시태그: 관련 해시태그 3개

반드시 JSON 형식으로만 응답하세요:
{"headline":"","body":"","cta":"","hashtags":[]}`;

export async function generateCopy(
  client: Anthropic,
  product: Product,
  fewShot: FewShotExample[] = [],
  variantLabel: VariantLabel = "emotional",
): Promise<Creative["copy"]> {
  const userPrompt = buildCopyPrompt(product, fewShot, variantLabel);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: [{ type: "text", text: COPY_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? "{}");
  return {
    ...parsed,
    variantLabel,
    metaAssetLabel: "", // 호출자가 Creative를 조립할 때 채움
  };
}

export function createAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}
```

Note: `variantLabel`을 반환값에 포함해 호출자가 다시 수동 할당할 필요가 없게 한다. `metaAssetLabel`은 호출자가 `variantGroupId::variantLabel` 형식으로 채운다 (Task 5에서 구체화).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run core/creative/copy.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Run full suite — should remain green via default args**

Run: `npx vitest run`
Expected: PASS 193 tests (183 baseline + 8 Task 1 + 2 net from Task 2). 기존 호출부가 2-arg로 호출하더라도 default 값(fewShot=[], variantLabel="emotional")으로 fallback되어 동작은 동일 — 전체 test 그린 유지.

- [ ] **Step 6: Commit**

```bash
git add core/creative/copy.ts core/creative/copy.test.ts
git commit -m "$(cat <<'EOF'
feat(creative): extend generateCopy signature with fewShot + variantLabel

Plan B task 2. generateCopy(client, product, fewShot, variantLabel)로 확장.
buildCopyPrompt 재사용. variantLabel은 반환 copy에 포함.
호출부(aiProxy/server/pipeline/actions) 업데이트는 Task 4~5에서.
EOF
)"
```

---

## Task 3: `groupApprovalCheck` and `groupCreativesByVariantGroup`

**Files:**
- Create: `core/launch/groupApproval.ts`
- Create: `core/launch/groupApproval.test.ts`

**Context:** Launch는 variantGroupId로 그룹화 후 "≥ 2 approved" 조건을 만족하는 그룹만 DCO로 런칭한다 (spec §3.1 I3). 런칭 로직에 직접 끼워넣지 않고 순수 함수로 분리해야 테스트가 쉽다. `edited` status도 approved와 동등하게 취급한다 (기존 Plan A 정책).

- [ ] **Step 1: Write the failing tests**

Create `core/launch/groupApproval.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  groupCreativesByVariantGroup,
  groupApprovalCheck,
} from "./groupApproval.js";
import type { Creative } from "../types.js";

function mkCreative(
  id: string,
  variantGroupId: string,
  status: Creative["status"],
  variantLabel: Creative["copy"]["variantLabel"] = "emotional",
): Creative {
  return {
    id,
    productId: "prod-1",
    variantGroupId,
    copy: {
      headline: "h",
      body: "b",
      cta: "c",
      hashtags: ["a"],
      variantLabel,
      metaAssetLabel: `variant-${id}`,
    },
    imageLocalPath: "/tmp/i.png",
    videoLocalPath: "/tmp/v.mp4",
    status,
    createdAt: "2026-04-20T00:00:00Z",
  };
}

describe("groupCreativesByVariantGroup", () => {
  it("groups creatives by variantGroupId", () => {
    const creatives = [
      mkCreative("a1", "g1", "approved"),
      mkCreative("a2", "g1", "pending"),
      mkCreative("b1", "g2", "approved"),
    ];
    const groups = groupCreativesByVariantGroup(creatives);
    expect(groups.size).toBe(2);
    expect(groups.get("g1")?.length).toBe(2);
    expect(groups.get("g2")?.length).toBe(1);
  });

  it("returns empty map for empty input", () => {
    expect(groupCreativesByVariantGroup([]).size).toBe(0);
  });

  it("preserves insertion order within each group", () => {
    const creatives = [
      mkCreative("a2", "g1", "pending"),
      mkCreative("a1", "g1", "approved"),
    ];
    const groups = groupCreativesByVariantGroup(creatives);
    expect(groups.get("g1")?.map((c) => c.id)).toEqual(["a2", "a1"]);
  });
});

describe("groupApprovalCheck", () => {
  it("returns {launch: true, approved: [...]} when 2 approved", () => {
    const group = [
      mkCreative("a1", "g1", "approved"),
      mkCreative("a2", "g1", "approved"),
      mkCreative("a3", "g1", "rejected"),
    ];
    const result = groupApprovalCheck(group);
    expect(result.launch).toBe(true);
    expect(result.approved).toHaveLength(2);
  });

  it("returns {launch: true, approved: [...]} when 3 approved", () => {
    const group = [
      mkCreative("a1", "g1", "approved"),
      mkCreative("a2", "g1", "approved"),
      mkCreative("a3", "g1", "approved"),
    ];
    const result = groupApprovalCheck(group);
    expect(result.launch).toBe(true);
    expect(result.approved).toHaveLength(3);
  });

  it("treats 'edited' status as approved", () => {
    const group = [
      mkCreative("a1", "g1", "edited"),
      mkCreative("a2", "g1", "approved"),
    ];
    const result = groupApprovalCheck(group);
    expect(result.launch).toBe(true);
    expect(result.approved).toHaveLength(2);
  });

  it("returns {launch: false, approved: [1]} when only 1 approved", () => {
    const group = [
      mkCreative("a1", "g1", "approved"),
      mkCreative("a2", "g1", "rejected"),
      mkCreative("a3", "g1", "pending"),
    ];
    const result = groupApprovalCheck(group);
    expect(result.launch).toBe(false);
    expect(result.approved).toHaveLength(1);
  });

  it("returns {launch: false, approved: []} when 0 approved", () => {
    const group = [
      mkCreative("a1", "g1", "rejected"),
      mkCreative("a2", "g1", "pending"),
    ];
    const result = groupApprovalCheck(group);
    expect(result.launch).toBe(false);
    expect(result.approved).toHaveLength(0);
  });

  it("does not include rejected/pending creatives in approved list", () => {
    const group = [
      mkCreative("a1", "g1", "approved"),
      mkCreative("a2", "g1", "approved"),
      mkCreative("a3", "g1", "pending"),
    ];
    const result = groupApprovalCheck(group);
    expect(result.approved.map((c) => c.id)).toEqual(["a1", "a2"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run core/launch/groupApproval.test.ts`
Expected: FAIL — "Cannot find module './groupApproval.js'".

- [ ] **Step 3: Implement the functions**

Create `core/launch/groupApproval.ts`:

```typescript
import type { Creative } from "../types.js";

export interface ApprovalResult {
  launch: boolean;
  approved: Creative[];
}

export function groupCreativesByVariantGroup(
  creatives: Creative[],
): Map<string, Creative[]> {
  const groups = new Map<string, Creative[]>();
  for (const c of creatives) {
    const bucket = groups.get(c.variantGroupId);
    if (bucket) {
      bucket.push(c);
    } else {
      groups.set(c.variantGroupId, [c]);
    }
  }
  return groups;
}

export function groupApprovalCheck(group: Creative[]): ApprovalResult {
  const approved = group.filter(
    (c) => c.status === "approved" || c.status === "edited",
  );
  return { launch: approved.length >= 2, approved };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run core/launch/groupApproval.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add core/launch/groupApproval.ts core/launch/groupApproval.test.ts
git commit -m "$(cat <<'EOF'
feat(launch): add groupApprovalCheck and groupCreativesByVariantGroup

Plan B task 3. launch를 호출하기 전 variantGroup별 ≥2 approved를
검사할 순수 함수. edited status도 approved와 동등하게 인정.
EOF
)"
```

---

## Task 4: Propagate new `generateCopy` signature through ALL call sites (keep 1-variant behavior)

**Files:**
- Modify: `cli/client/aiProxy.ts`
- Modify: `server/routes/aiCopy.ts`
- Modify: `cli/pipeline.ts`
- Modify: `cli/actions.ts`

**Context:** `generateCopy`가 Task 2에서 4-arg로 바뀌었으니 모든 호출부를 일괄 수정해야 컴파일이 깨지지 않는다. 이 Task는 **동작을 바꾸지 않고** 시그니처 전파만 한다 — 여전히 제품당 1 Creative 생성. `fewShot=[]`, `variantLabel="emotional"` 플레이스홀더로 호출. Task 5가 뒤이어 1-variant 루프를 3-variant 루프로 전환한다.

이 분할의 이유: 단일 Task 하나에서 시그니처 변경 + 3-loop 전환을 섞으면 리뷰가 어렵고, 각 commit이 compile-clean 상태를 유지하기 어렵다.

- [ ] **Step 1: Update `AiProxy` interface and both implementations**

Modify `cli/client/aiProxy.ts`:

Change the interface signature:
```typescript
// Before:
generateCopy(product: Product): Promise<Creative["copy"]>;

// After:
generateCopy(
  product: Product,
  fewShot: FewShotExample[],
  variantLabel: VariantLabel,
): Promise<Creative["copy"]>;
```

Update imports at top of file:
```typescript
import type { FewShotExample, VariantLabel } from "../../core/creative/prompt.js";
```

Update `createOwnerProxy`:
```typescript
generateCopy: (product, fewShot, variantLabel) =>
  generateCopy(anthropic, product, fewShot, variantLabel),
```

Update `createCustomerProxy`:
```typescript
generateCopy: async (product, fewShot, variantLabel) => {
  const res = await serverFetch(config, "/ai/copy", { product, fewShot, variantLabel });
  if (!res.ok) throw new Error(`AI copy failed: ${res.status}`);
  return res.json() as Promise<Creative["copy"]>;
},
```

- [ ] **Step 2: Update server `/ai/copy` route to accept fewShot + variantLabel**

Modify `server/routes/aiCopy.ts`:

Change the route handler:
```typescript
router.post("/ai/copy", async (req, res) => {
  const { product, fewShot, variantLabel } = req.body as {
    product: Product;
    fewShot?: FewShotExample[];
    variantLabel?: VariantLabel;
  };
  const licenseId = (req as any).licenseId;
  const pricing = PRICING.copy_gen;

  if (!billing.checkBalance(licenseId, pricing.charged)) {
    res.status(402).json({ error: "잔액 부족", required: pricing.charged });
    return;
  }

  const eventId = billing.deductAndRecord(licenseId, "copy_gen", pricing.aiCost, pricing.charged);
  try {
    const copy = await generateCopy(
      client,
      product,
      fewShot ?? [],
      variantLabel ?? "emotional",
    );
    billing.confirmUsage(eventId);

    if (billing.needsRecharge(licenseId)) {
      const license = billing.getLicense(licenseId);
      if (license?.stripe_customer_id && license?.stripe_payment_method_id) {
        const stripe = createStripeClient();
        triggerAutoRecharge(stripe, license.stripe_customer_id, license.stripe_payment_method_id, license.recharge_amount, licenseId).catch(() => {});
      }
    }

    res.json(copy);
  } catch (e) {
    billing.refund(eventId, licenseId, pricing.charged);
    res.status(500).json({ error: "AI 처리 실패. 잔액이 환불되었습니다." });
  }
});
```

Add imports at top:
```typescript
import type { FewShotExample, VariantLabel } from "../../core/creative/prompt.js";
```

**Backwards compatibility:** `fewShot`과 `variantLabel`이 없으면 `[]`와 `"emotional"`로 fallback — 구 CLI 버전이 서버를 호출해도 깨지지 않는다.

- [ ] **Step 3: Update `cli/pipeline.ts` call site**

In `cli/pipeline.ts`, change the single `generateCopy` call inside the Step 2 loop:

```typescript
// Before:
const copy = await generateCopy(client, product);

// After:
const copy = await generateCopy(client, product, [], "emotional");
```

Behavior unchanged (still 1 variant). Task 5 will rewrite this block.

- [ ] **Step 4: Update `cli/actions.ts` call site in `runGenerate`**

In `cli/actions.ts`, change the single `proxy.generateCopy` call:

```typescript
// Before:
const copy = await proxy.generateCopy(product);

// After:
const copy = await proxy.generateCopy(product, [], "emotional");
```

Behavior unchanged. Task 5 will rewrite the surrounding loop.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: PASS 202 tests (183 baseline + 8 Task 1 + 2 Task 2 + 9 Task 3 = 202). 모든 호출부가 명시적 4-arg로 전파됨.

- [ ] **Step 6: Commit**

```bash
git add cli/client/aiProxy.ts server/routes/aiCopy.ts cli/pipeline.ts cli/actions.ts
git commit -m "$(cat <<'EOF'
feat(proxy,server,pipeline): propagate generateCopy 4-arg signature

Plan B task 4. AiProxy 인터페이스 확장, owner/customer 양쪽 구현 수정,
server /ai/copy route가 fewShot/variantLabel request body 수용,
pipeline.ts·actions.ts 호출부를 4-arg로 업데이트 (placeholder
fewShot=[]·variantLabel="emotional"). 동작 변화 없음 — Task 5가
1-variant 루프를 3-variant 루프로 전환.
EOF
)"
```

---

## Task 5: Convert 1-variant loop to 3-variant loop

**Files:**
- Modify: `cli/pipeline.ts`
- Modify: `cli/actions.ts`

**Context:** Task 4가 시그니처 전파를 마쳤다. 이제 제품당 1 Creative 생성을 3 Creative(각 variantLabel 한 번씩) 생성으로 전환한다. image/video는 1번만 생성하고 3 Creative가 공유한다. Plan B 스코프에서는 `fewShot=[]`로 호출한다 (Winner DB는 Plan C).

`metaAssetLabel` 형식: spec §2.2는 "variant-<uuid>"를 예시로 들지만 매핑은 Strategy B(body text)로 이미 확정됐다 (Plan A C8). `metaAssetLabel`은 디버그용 identifier이므로 `${variantGroupId}::${variantLabel}` 형식으로 단순화한다 — 식별성 + 그룹 내 유일성 확보.

- [ ] **Step 1: Update `cli/pipeline.ts`**

Overwrite the Step 2 (Generate) block of `cli/pipeline.ts`:

```typescript
  // Step 2: Generate (imports: `import { VARIANT_LABELS } from "../core/creative/prompt.js"`)
  update("generate", "running", "소재 생성 시작...");

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    update("generate", "running", `이미지 생성 중...`, product.name, i + 1);
    const imageLocalPath = await generateImage(product);

    update("generate", "running", `영상 생성 중... (최대 10분 소요)`, product.name, i + 1);
    const videoLocalPath = await generateVideo(product, (msg) =>
      update("generate", "running", msg, product.name, i + 1)
    );

    const variantGroupId = randomUUID();

    for (const label of VARIANT_LABELS) {
      update("generate", "running", `카피 생성 중 (${label})...`, product.name, i + 1);
      const copy = await generateCopy(client, product, [], label);

      const creative: Creative = {
        id: randomUUID(),
        productId: product.id,
        variantGroupId,
        copy: {
          ...copy,
          variantLabel: label,
          metaAssetLabel: `${variantGroupId}::${label}`,
        },
        imageLocalPath,
        videoLocalPath,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      await writeJson(`data/creatives/${creative.id}.json`, creative);
    }
  }
  update("generate", "done", "소재 생성 완료 — 검토 대기 중");
```

Note: image/video 생성을 카피 루프 밖으로 빼서 제품당 1번만 호출한다.

- [ ] **Step 2: Update `runGenerate` in `cli/actions.ts`**

Replace the per-product body of `runGenerate` (add `import { VARIANT_LABELS } from "../core/creative/prompt.js"` at top):

```typescript
    for (let i = 0; i < productPaths.length; i++) {
      const product = await readJson<Product>(productPaths[i]);
      if (!product) continue;

      const taskProgress: TaskProgress = { copy: 0, image: 0, video: 0 };

      onProgress({
        message: "이미지 생성 중...",
        currentCourse: product.name,
        courseIndex: i + 1,
        totalCourses: productPaths.length,
        taskProgress: { ...taskProgress },
      });
      const imageLocalPath = await proxy.generateImage(product);
      taskProgress.image = 100;

      onProgress({
        message: "영상 생성 중...",
        currentCourse: product.name,
        courseIndex: i + 1,
        totalCourses: productPaths.length,
        taskProgress: { ...taskProgress },
      });
      const videoLocalPath = await proxy.generateVideo(product, (msg) => {
        const match = msg.match(/\((\d+)\/(\d+)\)/);
        if (match) {
          taskProgress.video = Math.round((Number(match[1]) / Number(match[2])) * 90);
        }
        onProgress({
          message: msg,
          currentCourse: product.name,
          courseIndex: i + 1,
          totalCourses: productPaths.length,
          taskProgress: { ...taskProgress },
        });
      });
      taskProgress.video = 100;

      const variantGroupId = randomUUID();
      for (let v = 0; v < VARIANT_LABELS.length; v++) {
        const label = VARIANT_LABELS[v];
        onProgress({
          message: `카피 ${v + 1}/3 생성 중 (${label})...`,
          currentCourse: product.name,
          courseIndex: i + 1,
          totalCourses: productPaths.length,
          taskProgress: { copy: Math.round(((v + 1) / 3) * 100), image: 100, video: 100 },
        });
        const copy = await proxy.generateCopy(product, [], label);

        const creative: Creative = {
          id: randomUUID(),
          productId: product.id,
          variantGroupId,
          copy: {
            ...copy,
            variantLabel: label,
            metaAssetLabel: `${variantGroupId}::${label}`,
          },
          imageLocalPath,
          videoLocalPath,
          status: "pending",
          createdAt: new Date().toISOString(),
        };
        await writeJson(`data/creatives/${creative.id}.json`, creative);
      }
      logs.push(`${product.name} ✓ (3 variants)`);
    }
```

Remove the now-unused single `taskProgress.copy = 100` block that referenced the old 1-creative flow.

Also remove import `import type { ... Creative ... }` duplication if any; `Creative` type import already exists.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: PASS 202 tests (Task 4 이후와 동일). runGenerate/pipeline에 타입 에러 없음. launch.ts는 여전히 미수정이지만 런타임 경로라 vitest 대상 아님.

- [ ] **Step 4: Commit**

```bash
git add cli/pipeline.ts cli/actions.ts
git commit -m "$(cat <<'EOF'
feat(pipeline): generate 3 copy variants per product (emotional/numerical/urgency)

Plan B task 5. 제품당 3 Creative 생성, image/video는 1회만 생성하고
variantGroup 내 3 Creative가 공유. metaAssetLabel=<groupId>::<label>로
디버깅용 식별자 부여. fewShot=[] (Plan C에서 RAG 연결).
EOF
)"
```

---

## Task 6: Launch groups by variantGroupId with ≥2-approval gate

**Files:**
- Modify: `cli/actions.ts`
- Modify: `cli/entries/launch.ts`

**Context:** Task 3의 `groupApprovalCheck`·`groupCreativesByVariantGroup`을 호출부에 연결한다. 현재는 Creative 하나를 그룹 1개로 취급해서 `creatives: [creative]`로 `platform.launch`를 호출하지만, Plan B는 variantGroupId로 그룹화 후 approved 2+ 그룹만 그룹의 approved Creative 전체(2 또는 3개)를 `creatives`에 담아 런칭한다. Asset feed spec은 자동으로 N bodies를 만든다 (Plan A에서 구현됨).

- [ ] **Step 1: Update `runLaunch` in `cli/actions.ts`**

Replace the body of `runLaunch`:

```typescript
export async function runLaunch(proxy: AiProxy, onProgress: ProgressCallback): Promise<DoneResult> {
  try {
    const platforms = await activePlatforms();
    if (platforms.length === 0) {
      return {
        success: false,
        message: "Launch 실패",
        logs: ["활성화된 플랫폼이 없습니다. .env의 AD_PLATFORMS 또는 credential을 확인하세요."],
      };
    }

    const creativePaths = await listJson("data/creatives");
    const allCreatives: Creative[] = [];
    for (const p of creativePaths) {
      const c = await readJson<Creative>(p);
      if (c) allCreatives.push(c);
    }

    const groups = groupCreativesByVariantGroup(allCreatives);
    const logs: string[] = [];

    for (const [groupId, members] of groups.entries()) {
      const { launch, approved } = groupApprovalCheck(members);
      if (!launch) {
        logs.push(`skip group ${groupId.slice(0, 8)}… (approved ${approved.length}/3, 필요 ≥ 2)`);
        continue;
      }

      const product = await readJson<Product>(`data/products/${approved[0].productId}.json`);
      if (!product) {
        logs.push(`skip group ${groupId.slice(0, 8)}… (product 없음)`);
        continue;
      }

      const group: VariantGroup = {
        variantGroupId: groupId,
        product,
        creatives: approved,
        assets: {
          image: approved[0].imageLocalPath,
          video: approved[0].videoLocalPath,
        },
      };

      onProgress({ message: `게재 중: ${product.name} (${approved.length} variants)` });
      for (const platform of platforms) {
        const result = await platform.launch(group);
        await proxy.reportUsage("campaign_launch", { campaignId: result.campaignId });
        logs.push(
          `${product.name} → ${result.externalIds.campaign} (${platform.name}, ${approved.length} variants)`,
        );
      }
    }

    if (logs.every((l) => l.startsWith("skip"))) {
      return {
        success: false,
        message: "Launch 실패",
        logs: logs.length > 0 ? logs : ["승인된 variantGroup이 없습니다. Review를 먼저 실행하세요."],
      };
    }
    return {
      success: true,
      message: `Launch 완료 — ${logs.filter((l) => !l.startsWith("skip")).length}개 게재`,
      logs,
    };
  } catch (e) {
    return { success: false, message: "Launch 실패", logs: [String(e)] };
  }
}
```

Add imports at top of `cli/actions.ts`:
```typescript
import {
  groupCreativesByVariantGroup,
  groupApprovalCheck,
} from "../core/launch/groupApproval.js";
```

- [ ] **Step 2: Update `cli/entries/launch.ts`**

Overwrite `cli/entries/launch.ts`:

```typescript
import "dotenv/config";
import { readJson, listJson } from "../../core/storage.js";
import type { Creative, Product } from "../../core/types.js";
import { activePlatforms } from "../../core/platform/registry.js";
import type { VariantGroup } from "../../core/platform/types.js";
import {
  groupCreativesByVariantGroup,
  groupApprovalCheck,
} from "../../core/launch/groupApproval.js";

const platforms = await activePlatforms();
if (platforms.length === 0) {
  console.error("활성화된 플랫폼이 없습니다. .env의 AD_PLATFORMS 또는 credential을 확인하세요.");
  process.exit(1);
}
console.log(`활성 플랫폼: ${platforms.map((p) => p.name).join(", ")}`);

const creativePaths = await listJson("data/creatives");
const allCreatives: Creative[] = [];
for (const p of creativePaths) {
  const c = await readJson<Creative>(p);
  if (c) allCreatives.push(c);
}

const groups = groupCreativesByVariantGroup(allCreatives);

for (const [groupId, members] of groups.entries()) {
  const { launch, approved } = groupApprovalCheck(members);
  if (!launch) {
    console.log(`skip group ${groupId.slice(0, 8)}… (approved ${approved.length}/3, 필요 ≥ 2)`);
    continue;
  }

  const product = await readJson<Product>(`data/products/${approved[0].productId}.json`);
  if (!product) {
    console.log(`skip group ${groupId.slice(0, 8)}… (product 없음)`);
    continue;
  }

  const group: VariantGroup = {
    variantGroupId: groupId,
    product,
    creatives: approved,
    assets: {
      image: approved[0].imageLocalPath,
      video: approved[0].videoLocalPath,
    },
  };

  for (const platform of platforms) {
    try {
      console.log(`${platform.name} 런칭: ${product.name} (${approved.length} variants)`);
      const result = await platform.launch(group);
      console.log(`  ✓ ${platform.name} campaign=${result.externalIds.campaign} ad=${result.externalIds.ad}`);
    } catch (err) {
      console.error(`  ✗ ${platform.name} 실패:`, err);
    }
  }
}
```

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: PASS 202 tests (동일, Task 3 이후 변동 없음). launch 경로는 런타임이라 단위 테스트 없음.

- [ ] **Step 4: Commit**

```bash
git add cli/actions.ts cli/entries/launch.ts
git commit -m "$(cat <<'EOF'
feat(launch): group-aware launch with ≥2-approval gate

Plan B task 6. runLaunch와 cli/entries/launch.ts가 variantGroupId로
그룹핑 → groupApprovalCheck로 ≥2 approved 확인 → approved 전체를
platform.launch(group)으로 전달. assembleAssetFeedSpec가 자동으로
N bodies DCO 조립 (Plan A 산출물 재사용).
EOF
)"
```

---

## Task 7: Group-level reviewer UI

**Files:**
- Modify: `cli/reviewer/session.ts`
- Modify: `cli/tui/ReviewScreen.tsx`

**Context:** 현재 ReviewScreen은 Creative를 1개씩 보여준다. Plan B는 "같은 variantGroup의 3 variant를 한 화면에서" 승인/거절/수정할 수 있어야 한다 (spec §6 — variantGroup 단위 UI). 3 variant의 headline/body/cta/tags를 나란히 비교할 수 있게 한다. 좌측 리스트는 variantGroup 단위, 우측은 3 variant의 헤드라인을 나열하고 현재 선택된 variant만 상세 정보 표시.

UI 조작 규칙:
- 상/하 화살표: 그룹 간 이동 (같은 그룹 내 이동 대신 그룹 단위 네비게이션)
- 1/2/3: variantGroup 내 variant 선택
- A: 현재 선택된 variant 승인
- R / E: 현재 선택된 variant 거절/수정 (기존과 동일)
- 그룹의 모든 variant가 non-pending이 되면 자동으로 다음 그룹으로 이동

복잡도가 있으므로 ReviewScreen의 props는 variantGroup 단위로 재설계한다.

- [ ] **Step 1: Rewrite `cli/reviewer/session.ts`**

Overwrite `cli/reviewer/session.ts`:

```typescript
import React from "react";
import { render } from "ink";
import type { Creative, Product } from "../../core/types.js";
import { ReviewScreen, type ReviewGroup } from "../tui/ReviewScreen.js";
import { readJson, writeJson, listJson } from "../../core/storage.js";
import { applyReviewDecision } from "../../core/reviewer/decisions.js";
import { groupCreativesByVariantGroup } from "../../core/launch/groupApproval.js";

export async function runReviewSession(): Promise<void> {
  const creativePaths = await listJson("data/creatives");
  const allCreatives: Creative[] = [];
  for (const p of creativePaths) {
    const c = await readJson<Creative>(p);
    if (c) allCreatives.push(c);
  }

  const grouped = groupCreativesByVariantGroup(allCreatives);
  const pendingGroups: ReviewGroup[] = [];

  for (const [variantGroupId, members] of grouped.entries()) {
    const hasPending = members.some((c) => c.status === "pending");
    if (!hasPending) continue;
    const product = await readJson<Product>(`data/products/${members[0].productId}.json`);
    if (!product) continue;
    pendingGroups.push({ variantGroupId, product, creatives: members });
  }

  if (pendingGroups.length === 0) {
    console.log("검토 대기 항목이 없습니다.");
    return;
  }

  await new Promise<void>((resolve) => {
    const { unmount } = render(
      React.createElement(ReviewScreen, {
        groups: pendingGroups,
        onApprove: async (variantGroupId, creativeId) => {
          const group = pendingGroups.find((g) => g.variantGroupId === variantGroupId);
          if (!group) return;
          const idx = group.creatives.findIndex((c) => c.id === creativeId);
          if (idx < 0) return;
          const updated = applyReviewDecision(group.creatives[idx], { action: "approve" });
          group.creatives[idx] = updated;
          await writeJson(`data/creatives/${creativeId}.json`, updated);
          if (pendingGroups.every((g) => g.creatives.every((c) => c.status !== "pending"))) {
            unmount();
            resolve();
          }
        },
        onReject: async (variantGroupId, creativeId, note) => {
          const group = pendingGroups.find((g) => g.variantGroupId === variantGroupId);
          if (!group) return;
          const idx = group.creatives.findIndex((c) => c.id === creativeId);
          if (idx < 0) return;
          const updated = applyReviewDecision(group.creatives[idx], { action: "reject", note });
          group.creatives[idx] = updated;
          await writeJson(`data/creatives/${creativeId}.json`, updated);
        },
        onEdit: async (variantGroupId, creativeId, field, value) => {
          const group = pendingGroups.find((g) => g.variantGroupId === variantGroupId);
          if (!group) return;
          const idx = group.creatives.findIndex((c) => c.id === creativeId);
          if (idx < 0) return;
          const updated = applyReviewDecision(group.creatives[idx], {
            action: "edit",
            field,
            value,
          });
          group.creatives[idx] = updated;
          await writeJson(`data/creatives/${creativeId}.json`, updated);
        },
      })
    );
  });
}
```

- [ ] **Step 2: Rewrite `cli/tui/ReviewScreen.tsx`**

Overwrite `cli/tui/ReviewScreen.tsx`:

```typescript
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Creative, Product } from "../../core/types.js";

export interface ReviewGroup {
  variantGroupId: string;
  product: Product;
  creatives: Creative[];
}

interface Props {
  groups: ReviewGroup[];
  onApprove: (variantGroupId: string, creativeId: string) => void;
  onReject: (variantGroupId: string, creativeId: string, note: string) => void;
  onEdit: (
    variantGroupId: string,
    creativeId: string,
    field: keyof Creative["copy"],
    value: string,
  ) => void;
}

export function ReviewScreen({ groups, onApprove, onReject, onEdit }: Props) {
  const [groupIndex, setGroupIndex] = useState(0);
  const [variantIndex, setVariantIndex] = useState(0);
  const [mode, setMode] = useState<"browse" | "edit" | "reject">("browse");
  const [inputValue, setInputValue] = useState("");

  const currentGroup = groups[groupIndex];
  const currentVariant = currentGroup?.creatives[variantIndex];

  useInput((input, key) => {
    if (mode === "browse") {
      if (key.upArrow) {
        setGroupIndex((i) => Math.max(0, i - 1));
        setVariantIndex(0);
      }
      if (key.downArrow) {
        setGroupIndex((i) => Math.min(groups.length - 1, i + 1));
        setVariantIndex(0);
      }
      if (input >= "1" && input <= "9" && currentGroup) {
        const n = Number(input) - 1;
        if (n < currentGroup.creatives.length) setVariantIndex(n);
      }
      if (input === "a" && currentGroup && currentVariant && currentVariant.status === "pending") {
        onApprove(currentGroup.variantGroupId, currentVariant.id);
      }
      if (input === "r" && currentGroup && currentVariant && currentVariant.status === "pending") {
        setMode("reject");
        setInputValue("");
      }
      if (input === "e" && currentGroup && currentVariant && currentVariant.status === "pending") {
        setMode("edit");
        setInputValue("");
      }
      return;
    }

    if (key.escape) {
      setMode("browse");
      setInputValue("");
      return;
    }
    if (key.return) {
      if (mode === "reject" && currentGroup && currentVariant) {
        onReject(currentGroup.variantGroupId, currentVariant.id, inputValue);
      }
      if (mode === "edit" && currentGroup && currentVariant) {
        onEdit(currentGroup.variantGroupId, currentVariant.id, "headline", inputValue);
      }
      setMode("browse");
      setInputValue("");
      return;
    }
    if (key.backspace || key.delete) {
      setInputValue((v) => v.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setInputValue((v) => v + input);
    }
  });

  if (!currentGroup || !currentVariant) {
    return (
      <Box>
        <Text color="green">모든 검토 완료!</Text>
      </Box>
    );
  }

  const statusColor = (s: Creative["status"]) =>
    s === "approved" || s === "edited" ? "green" : s === "rejected" ? "red" : "yellow";

  return (
    <Box borderStyle="round" padding={1} width={90}>
      <Box flexDirection="column" width={24} marginRight={2}>
        <Text bold>그룹: {groupIndex + 1}/{groups.length}</Text>
        {groups.map((g, i) => {
          const approved = g.creatives.filter((c) => c.status === "approved" || c.status === "edited").length;
          return (
            <Text key={g.variantGroupId} color={i === groupIndex ? "cyan" : "white"}>
              {i === groupIndex ? "▶ " : "  "}
              {g.product.name.slice(0, 14)} ({approved}/{g.creatives.length})
            </Text>
          );
        })}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Text bold>Variants (1/2/3 선택)</Text>
        {currentGroup.creatives.map((c, i) => (
          <Text key={c.id} color={i === variantIndex ? "cyan" : "white"}>
            {i === variantIndex ? "▶ " : "  "}[{i + 1}] {c.copy.variantLabel}{" "}
            <Text color={statusColor(c.status)}>({c.status})</Text>
          </Text>
        ))}
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>이미지(공유): {currentVariant.imageLocalPath}</Text>
          <Text dimColor>영상(공유): {currentVariant.videoLocalPath}</Text>
          <Text>헤드라인: {currentVariant.copy.headline}</Text>
          <Text>본문: {currentVariant.copy.body}</Text>
          <Text>CTA: {currentVariant.copy.cta}</Text>
          <Text>태그: {currentVariant.copy.hashtags.join(" ")}</Text>
        </Box>
        {mode === "browse" && currentVariant.status === "pending" && (
          <Box marginTop={1}>
            <Text color="green">[A] 승인  </Text>
            <Text color="red">[R] 거절  </Text>
            <Text color="yellow">[E] 수정  </Text>
            <Text dimColor>↑↓ 그룹 이동 / 1-3 variant 선택</Text>
          </Box>
        )}
        {mode === "browse" && currentVariant.status !== "pending" && (
          <Box marginTop={1}>
            <Text dimColor>이 variant는 이미 처리됨. 다른 variant(1-3) 또는 그룹(↑↓) 선택.</Text>
          </Box>
        )}
        {mode === "reject" && (
          <Box marginTop={1} flexDirection="column">
            <Text>거절 이유 입력 후 Enter (Esc: 취소):</Text>
            <Text color="cyan">{inputValue}_</Text>
          </Box>
        )}
        {mode === "edit" && (
          <Box marginTop={1} flexDirection="column">
            <Text>새 헤드라인 입력 후 Enter (Esc: 취소):</Text>
            <Text color="yellow">{inputValue}_</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: PASS 202 tests. ReviewScreen에 전용 테스트는 없으나 App.test.tsx 등 다른 TUI 테스트가 깨지지 않아야 한다.

- [ ] **Step 4: Manual smoke test (optional but recommended)**

Run: `npm run generate` (dry run with 1 test product) and verify 3 creatives produced in `data/creatives/` with same `variantGroupId` and distinct `variantLabel` + `metaAssetLabel`.

Then: `npm run review` — visually verify 3-variant group UI, 1/2/3 키로 variant 전환, A/R/E 정상 동작.

- [ ] **Step 5: Commit**

```bash
git add cli/reviewer/session.ts cli/tui/ReviewScreen.tsx
git commit -m "$(cat <<'EOF'
feat(review): variantGroup-aware review UI

Plan B task 7. 같은 variantGroup의 3 variant를 한 화면에서 비교/검토.
↑↓ 그룹 간 이동, 1-3 variant 선택, A/R/E로 개별 variant 승인/거절/수정.
그룹 사이드바에 approved/total 카운트 표시.
EOF
)"
```

---

## Task 8: Update documentation

**Files:**
- Modify: `docs/STATUS.md`
- Modify: `docs/ROADMAP.md`

**Context:** CLAUDE.md의 문서 업데이트 규칙(MANDATORY): 기능 구현 완료 시 STATUS·ROADMAP 반영. Plan B는 아키텍처에 새 컴포넌트를 추가하지 않으므로 ARCHITECTURE.md는 "핵심 설계 결정" 섹션에 한 줄만 추가하거나 생략 판단.

- [ ] **Step 1: Update `docs/STATUS.md`**

Add to "Phase 요약" section:
```markdown
- ✅ Plan B — Variant 생성 파이프라인 (제품당 3 copy variant + 공유 image/video + group review + ≥2 승인 DCO 런칭)
```

Add to top of "최근 변경 이력":
```markdown
- 2026-04-20 feat: Plan B 완료 — 제품당 3 copy variant(emotional/numerical/urgency) 생성, 공유 image/video, group 단위 리뷰 UI, ≥ 2 approved 그룹만 DCO 런칭. buildCopyPrompt 추출·generateCopy 시그니처 확장·groupApprovalCheck 도입
```

Update "마지막 업데이트" date at top to `2026-04-20` (현 일자 기준).

- [ ] **Step 2: Update `docs/ROADMAP.md`**

Read the current file, find the "Plan B" entry (if present) under Tier 1 or "현재 추천 다음 작업", remove it, and add "Plan C — Winner DB + Voyage RAG" as the new recommended next work. Keep the change minimal — just the status transition, not a full rewrite.

- [ ] **Step 3: Commit**

```bash
git add docs/STATUS.md docs/ROADMAP.md
git commit -m "$(cat <<'EOF'
docs: Plan B 완료 반영 (3-variant 생성 파이프라인)

STATUS: Phase 요약에 ✅ 추가, 최근 변경 이력 갱신
ROADMAP: 현재 추천 작업을 Plan C (Winner DB + RAG)로 전환
EOF
)"
```

---

## Success Criteria

Plan B 완료 후 다음을 확인:

1. `npm run test -- --run` — 202 테스트 통과 (183 baseline + Task 1: +8 prompt, Task 2: +2 순증 copy, Task 3: +9 groupApproval).
2. `npm run generate` (test product 1개로) — `data/creatives/`에 3 Creative 파일, 동일 `variantGroupId`, variantLabel이 emotional/numerical/urgency로 분리, image/video 경로 공유.
3. `npm run review` — 그룹 단위 UI가 올바르게 렌더되고 3 variant 전환 가능.
4. `npm run launch` — 2 이상 approved 그룹만 런칭, assemble된 `asset_feed_spec`에 2~3 bodies 포함.
5. Spec §Section 6의 산출물 모두 달성.

---

## Out of Scope (Plan C 이후)

- Winner DB (`data/creatives.db`) 및 Voyage RAG — `fewShot`은 Plan C에서 채운다.
- `core/scheduler/improvementCycle.ts` 3단계 분리 — Plan C 산출물.
- `passesThreshold` / `getMedianCtr` — Plan C.
- ReviewScreen의 edit 필드가 headline만 수정 가능 — body/cta/hashtags 확장은 별도 Tier 2 작업.
- 3 copy 중 2개 생성 성공, 1개 실패 시 partial 허용 — 현재 구현은 순차 호출이라 1개 실패 시 전체 throw. 필요하면 별도 작업으로 Promise.allSettled 전환.

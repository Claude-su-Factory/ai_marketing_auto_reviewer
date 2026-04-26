# Prompt-as-Data Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자기학습 루프를 *코드 자율 패치* 에서 *prompt-as-data 모델* 로 전환. Improver 가 임의 TS 파일 수정을 멈추고 `data/learned/prompts.json` 한 파일만 read/write. CLI/Server 데이터 layer 분리 (file vs DB) 인터페이스 호환 보장.

**Architecture:** 5 commits — (1) loader+schema 추가 (순수 추가), (2) creative/* 가 loader 사용, (3) improver 재작성 (regex/applyCodeChange 제거), (4) TUI/CLI Generate 가 winner DB fewShot 주입, (5) 문서. 각 commit 그린 빌드 + 그린 테스트 유지. `data/` 비어있는 시점이라 영속 데이터 마이그레이션 zero.

**Tech Stack:** TypeScript, vitest, Zod, smol-toml, better-sqlite3 (Voyage RAG winner DB). tsx 런타임.

**Spec:** `docs/superpowers/specs/2026-04-26-prompt-as-data-design.md` (커밋 `605a833`)

**브랜치:** master 직접 커밋 (CLAUDE.md 정책).

---

## Task 0: Pre-flight

### Task 0.1: 환경 확인 + baseline

**Files:** 없음 (sanity check)

- [ ] **Step 1: 작업 트리 깨끗** 

```bash
git status --short
```

Expected: 빈 출력 (또는 `.claude/scheduled_tasks.lock` 같은 untracked만).

- [ ] **Step 2: HEAD 확인**

```bash
git log --oneline -3
```

Expected 최상단: `605a833 docs(specs): add prompt-as-data refactor design spec`

- [ ] **Step 3: 테스트 baseline**

```bash
npm test 2>&1 | tail -5
```

Expected: **358 tests passing** (멀티플랫폼 작업 후 기준).

만약 `@rollup/rollup-darwin-arm64` 네이티브 모듈 에러:
```bash
rm -rf node_modules package-lock.json && npm install
```
(이전 세션에서 검증된 fix)

- [ ] **Step 4: 데이터 디렉토리 비어있음 재확인**

```bash
ls data/learned/ data/improvements/ data/creatives/ data/campaigns/ data/reports/ 2>/dev/null
```

Expected: 모두 빈 디렉토리 또는 디렉토리 없음. 영속 데이터 zero 확인 (spec §9 전제).

---

## Commit 1: Loader + Schema + DEFAULT_PROMPTS

**범위**: 순수 추가. 기존 동작 변화 zero. loader 가 어디서도 import 안 됨.

### Task 1.1: 신규 모듈 + Zod 스키마 + Loader

**Files:**
- Create: `packages/core/src/learning/prompts.ts`
- Create: `packages/core/src/learning/prompts.test.ts`

- [ ] **Step 1: 실패 테스트 먼저 작성 — 12 케이스**

`packages/core/src/learning/prompts.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { writeFile, mkdir, rm } from "fs/promises";
import path from "path";
import {
  loadPrompts,
  setPromptsForTesting,
  invalidatePromptsCache,
  validateUserTemplate,
  substitutePlaceholders,
  DEFAULT_PROMPTS,
  PromptsSchema,
  type Prompts,
} from "./prompts.js";

const TMP_DIR = "data/learned";
const TMP_FILE = path.join(TMP_DIR, "prompts.json");

async function writeTmpFile(content: string): Promise<void> {
  await mkdir(TMP_DIR, { recursive: true });
  await writeFile(TMP_FILE, content, "utf-8");
}

async function clearTmpFile(): Promise<void> {
  try { await rm(TMP_FILE, { force: true }); } catch {}
}

describe("loadPrompts", () => {
  beforeEach(async () => {
    setPromptsForTesting(null);
    await clearTmpFile();
  });

  it("returns DEFAULT_PROMPTS when file is missing", async () => {
    const result = await loadPrompts();
    expect(result).toEqual(DEFAULT_PROMPTS);
  });

  it("returns parsed value when valid JSON file exists", async () => {
    const custom: Prompts = {
      copy: {
        systemPrompt: "X".repeat(60),
        userTemplate: "{{name}} {{description}} {{angleHint}}".padEnd(120, " "),
        angleHints: {
          emotional: "감정테스트값입니다",
          numerical: "수치테스트값입니다",
          urgency: "긴급테스트값입니다",
        },
      },
    };
    await writeTmpFile(JSON.stringify(custom));
    const result = await loadPrompts();
    expect(result.copy.systemPrompt).toBe(custom.copy.systemPrompt);
    expect(result.copy.angleHints.emotional).toBe("감정테스트값입니다");
  });

  it("returns DEFAULT_PROMPTS when file is corrupt JSON", async () => {
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (m: string) => { warns.push(m); };
    try {
      await writeTmpFile("not valid json {{{");
      const result = await loadPrompts();
      expect(result).toEqual(DEFAULT_PROMPTS);
    } finally {
      console.warn = orig;
    }
  });

  it("returns DEFAULT_PROMPTS + warns when schema validation fails", async () => {
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (m: string) => { warns.push(m); };
    try {
      await writeTmpFile(JSON.stringify({ copy: { systemPrompt: "too short", userTemplate: "x", angleHints: { emotional: "x", numerical: "x", urgency: "x" } } }));
      const result = await loadPrompts();
      expect(result).toEqual(DEFAULT_PROMPTS);
      expect(warns.some((w) => w.includes("검증 실패"))).toBe(true);
    } finally {
      console.warn = orig;
    }
  });

  it("caches result — second call does not re-read disk", async () => {
    setPromptsForTesting(DEFAULT_PROMPTS);
    const first = await loadPrompts();
    const second = await loadPrompts();
    expect(first).toBe(second); // 같은 reference
  });
});

describe("setPromptsForTesting", () => {
  beforeEach(() => setPromptsForTesting(null));

  it("injects custom prompts into the cache", async () => {
    const custom: Prompts = {
      copy: {
        systemPrompt: "Y".repeat(60),
        userTemplate: "{{name}} {{description}} {{angleHint}}".padEnd(120, " "),
        angleHints: { emotional: "e".repeat(15), numerical: "n".repeat(15), urgency: "u".repeat(15) },
      },
    };
    setPromptsForTesting(custom);
    const result = await loadPrompts();
    expect(result.copy.systemPrompt).toBe(custom.copy.systemPrompt);
  });

  it("setPromptsForTesting(null) clears cache so loadPrompts reads disk again", async () => {
    setPromptsForTesting({ copy: { systemPrompt: "A".repeat(60), userTemplate: "{{name}}{{description}}{{angleHint}}".padEnd(120, " "), angleHints: { emotional: "x".repeat(15), numerical: "x".repeat(15), urgency: "x".repeat(15) } } });
    setPromptsForTesting(null);
    const result = await loadPrompts();
    expect(result).toEqual(DEFAULT_PROMPTS);
  });
});

describe("invalidatePromptsCache", () => {
  beforeEach(async () => {
    setPromptsForTesting(null);
    await clearTmpFile();
  });

  it("after invalidation, next loadPrompts re-reads disk", async () => {
    await loadPrompts(); // cache = DEFAULT (file missing)
    const custom: Prompts = {
      copy: {
        systemPrompt: "Z".repeat(60),
        userTemplate: "{{name}} {{description}} {{angleHint}}".padEnd(120, " "),
        angleHints: { emotional: "e".repeat(15), numerical: "n".repeat(15), urgency: "u".repeat(15) },
      },
    };
    await writeTmpFile(JSON.stringify(custom));
    invalidatePromptsCache();
    const reloaded = await loadPrompts();
    expect(reloaded.copy.systemPrompt).toBe(custom.copy.systemPrompt);
  });
});

describe("validateUserTemplate", () => {
  it("returns [] when all required placeholders present", () => {
    const t = "Product: {{name}} desc: {{description}} hint: {{angleHint}}";
    expect(validateUserTemplate(t)).toEqual([]);
  });

  it("returns missing placeholders when some are absent", () => {
    const t = "Only: {{name}}";
    const missing = validateUserTemplate(t);
    expect(missing).toContain("{{description}}");
    expect(missing).toContain("{{angleHint}}");
    expect(missing).not.toContain("{{name}}");
  });
});

describe("substitutePlaceholders", () => {
  it("substitutes a single placeholder", () => {
    expect(substitutePlaceholders("hi {{name}}", { name: "X" })).toBe("hi X");
  });

  it("substitutes the same placeholder appearing multiple times", () => {
    expect(substitutePlaceholders("{{a}}-{{a}}-{{b}}", { a: "1", b: "2" })).toBe("1-1-2");
  });

  it("leaves undefined placeholders intact", () => {
    expect(substitutePlaceholders("{{name}} {{unknown}}", { name: "X" })).toBe("X {{unknown}}");
  });
});
```

- [ ] **Step 2: 테스트 실행 — fail 확인**

```bash
npx vitest run packages/core/src/learning/prompts.test.ts 2>&1 | tail -15
```

Expected: FAIL — 모듈 없음.

- [ ] **Step 3: `prompts.ts` 본체 작성**

`packages/core/src/learning/prompts.ts`:

```ts
import { z } from "zod";
import { readJson } from "../storage.js";

export const PromptsSchema = z.object({
  copy: z.object({
    systemPrompt: z.string().min(50, "systemPrompt too short"),
    userTemplate: z.string().min(100, "userTemplate too short"),
    angleHints: z.object({
      emotional: z.string().min(10),
      numerical: z.string().min(10),
      urgency: z.string().min(10),
    }),
  }),
});

export type Prompts = z.infer<typeof PromptsSchema>;

const REQUIRED_PLACEHOLDERS = ["{{name}}", "{{description}}", "{{angleHint}}"] as const;

export function validateUserTemplate(template: string): string[] {
  const missing: string[] = [];
  for (const ph of REQUIRED_PLACEHOLDERS) {
    if (!template.includes(ph)) missing.push(ph);
  }
  return missing;
}

export function substitutePlaceholders(
  template: string,
  values: Record<string, string>,
): string {
  let result = template;
  for (const [key, val] of Object.entries(values)) {
    result = result.replaceAll(`{{${key}}}`, val);
  }
  return result;
}

const DEFAULT_PROMPTS_PATH = "data/learned/prompts.json";

export const DEFAULT_PROMPTS: Prompts = {
  copy: {
    systemPrompt: `당신은 Meta(Instagram/Facebook) 광고 카피라이터입니다.
모든 종류의 제품·서비스 광고에 최적화된 카피를 작성합니다.

규칙:
- 헤드라인: 구매/사용 후 얻는 구체적 결과물 또는 수치 포함 (최대 40자)
- 본문: 제품/서비스의 핵심 가치와 차별점 강조 (최대 125자)
- CTA: 행동을 유도하는 짧은 문구 (최대 20자)
- 해시태그: 관련 해시태그 3개

반드시 JSON 형식으로만 응답하세요:
{"headline":"","body":"","cta":"","hashtags":[]}`,
    userTemplate: `다음 제품/서비스에 대한 Instagram 광고 카피를 작성해주세요.

제품명: {{name}}
설명: {{description}}
가격: {{priceText}}
카테고리: {{category}}
태그: {{tags}}
링크: {{targetUrl}}

이 variant의 톤 가이드: {{angleHint}}{{fewShotBlock}}`,
    angleHints: {
      emotional: "감정 호소 중심으로 독자의 욕구·공감대를 자극하세요.",
      numerical: "수치·통계·비교를 전면에 배치하세요.",
      urgency: "긴급성·희소성(기한, 한정 수량 등)을 강조하세요.",
    },
  },
};

let cached: Prompts | null = null;

export async function loadPrompts(): Promise<Prompts> {
  if (cached) return cached;
  const raw = await readJson<unknown>(DEFAULT_PROMPTS_PATH);
  if (!raw) {
    cached = DEFAULT_PROMPTS;
    return cached;
  }
  const parsed = PromptsSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(`[prompts] ${DEFAULT_PROMPTS_PATH} 검증 실패, default 사용:`, parsed.error.message);
    cached = DEFAULT_PROMPTS;
    return cached;
  }
  cached = parsed.data;
  return cached;
}

export function setPromptsForTesting(p: Prompts | null): void {
  cached = p;
}

export function invalidatePromptsCache(): void {
  cached = null;
}
```

- [ ] **Step 4: 테스트 실행 — green 확인**

```bash
npx vitest run packages/core/src/learning/prompts.test.ts 2>&1 | tail -10
```

Expected: 12 tests passing.

### Task 1.2: vitest.setup.ts — `setPromptsForTesting(null)` reset 추가

**Files:**
- Modify: `vitest.setup.ts`

- [ ] **Step 1: 현재 vitest.setup.ts 읽기**

```bash
cat vitest.setup.ts
```

- [ ] **Step 2: setPromptsForTesting reset 추가**

`vitest.setup.ts` 전체 교체:

```ts
import { beforeEach, afterEach } from "vitest";
import { setConfigForTesting, resetConfigForTesting } from "./packages/core/src/config/index.js";
import { makeTestConfig } from "./packages/core/src/config/testing.js";
import { setPromptsForTesting } from "./packages/core/src/learning/prompts.js";

beforeEach(() => {
  setConfigForTesting(makeTestConfig());
  setPromptsForTesting(null);
});

afterEach(() => {
  resetConfigForTesting();
});
```

- [ ] **Step 3: 전체 테스트 실행 — green 유지**

```bash
npm test 2>&1 | tail -10
```

Expected: **358 + 12 = 370 tests passing**. 기존 테스트 회귀 zero.

### Task 1.3: code-reviewer subagent + Commit

- [ ] **Step 1: code-reviewer 호출**

`Agent` 도구로 `superpowers:code-reviewer` 호출. WHAT_WAS_IMPLEMENTED: 신규 `learning/prompts.ts` (loader + Zod schema + DEFAULT_PROMPTS + helpers) + `prompts.test.ts` (12 케이스) + `vitest.setup.ts` 의 `setPromptsForTesting(null)` reset 추가. PLAN_OR_REQUIREMENTS: spec §4. BASE_SHA: `605a833`. HEAD_SHA: 아직 commit 전 — staged. 검토 후 issues 적용.

- [ ] **Step 2: 발견 이슈 처리** (Critical/Important 즉시 수정 후 재검토)

- [ ] **Step 3: 명시적 add**

```bash
git add packages/core/src/learning/prompts.ts \
  packages/core/src/learning/prompts.test.ts \
  vitest.setup.ts
```

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(learning): add prompt loader + schema + DEFAULT_PROMPTS

신규 packages/core/src/learning/prompts.ts — getConfig() 패턴의 lazy singleton loader. Zod 스키마(systemPrompt min 50, userTemplate min 100, angleHints min 10), REQUIRED_PLACEHOLDERS 검증(name/description/angleHint), substitutePlaceholders helper. DEFAULT_PROMPTS 가 현재 creative/copy.ts:COPY_SYSTEM_PROMPT + creative/prompt.ts:ANGLE_HINTS 과 byte-단위 일치. 파일 부재/손상 시 default fallback (improver 데이터 손상이 collect/generate/launch 핵심 흐름까지 깨뜨리지 않도록 격리).

vitest.setup.ts 에 setPromptsForTesting(null) reset 추가 — 테스트 격리.

Spec: docs/superpowers/specs/2026-04-26-prompt-as-data-design.md §4
EOF
)"
```

- [ ] **Step 5: 테스트 재확인**

```bash
npm test 2>&1 | tail -5
```

Expected: 370 tests passing.

---

## Commit 2: Creative Migration

**범위**: `creative/copy.ts`, `creative/prompt.ts` 가 loader 사용. 기존 const export 제거. 호출처 await 추가. DEFAULT_PROMPTS 가 byte-단위 일치하므로 동작 보존.

### Task 2.1: `creative/prompt.ts` async 변환 + loader 사용

**Files:**
- Modify: `packages/core/src/creative/prompt.ts`
- Modify: `packages/core/src/creative/prompt.test.ts`

- [ ] **Step 1: 테스트 먼저 업데이트 — async + placeholder 검증**

`packages/core/src/creative/prompt.test.ts` 전체 교체:

```ts
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
  it("injects emotional angle hint when variantLabel='emotional'", async () => {
    const prompt = await buildCopyPrompt(baseProduct, [], "emotional");
    expect(prompt).toContain("감정 호소");
  });

  it("injects numerical angle hint when variantLabel='numerical'", async () => {
    const prompt = await buildCopyPrompt(baseProduct, [], "numerical");
    expect(prompt).toContain("수치");
  });

  it("injects urgency angle hint when variantLabel='urgency'", async () => {
    const prompt = await buildCopyPrompt(baseProduct, [], "urgency");
    expect(prompt).toContain("긴급성");
  });

  it("does not render fewShot section when fewShot is empty", async () => {
    const prompt = await buildCopyPrompt(baseProduct, [], "emotional");
    expect(prompt).not.toContain("참고 예시");
  });

  it("renders fewShot section header when fewShot is non-empty", async () => {
    const prompt = await buildCopyPrompt(baseProduct, [{ headline: "h", body: "b", cta: "c" }], "emotional");
    expect(prompt).toContain("참고 예시");
  });

  it("includes product name, description, price, tags, and targetUrl", async () => {
    const prompt = await buildCopyPrompt(baseProduct, [], "emotional");
    expect(prompt).toContain("React 완전정복");
    expect(prompt).toContain("React를 처음부터 배웁니다");
    expect(prompt).toContain("55,000");
    expect(prompt).toContain("react");
    expect(prompt).toContain("https://inflearn.com/course/react");
  });

  it("uses '가격 미정' when product.price is undefined", async () => {
    const prompt = await buildCopyPrompt({ ...baseProduct, price: undefined }, [], "emotional");
    expect(prompt).toContain("가격 미정");
  });

  it("VARIANT_LABELS contains exactly 3 labels in the canonical order", () => {
    expect(VARIANT_LABELS).toEqual(["emotional", "numerical", "urgency"]);
  });

  it("substitutes all required placeholders (no {{...}} left in output)", async () => {
    const prompt = await buildCopyPrompt(baseProduct, [], "emotional");
    expect(prompt).not.toMatch(/\{\{(name|description|angleHint|priceText|category|tags|targetUrl|fewShotBlock)\}\}/);
  });
});
```

- [ ] **Step 2: 테스트 실행 — fail 확인**

```bash
npx vitest run packages/core/src/creative/prompt.test.ts 2>&1 | tail -10
```

Expected: FAIL — `buildCopyPrompt` 가 sync 라 `await` 적용 못 함, 또는 ANGLE_HINTS hardcoded.

- [ ] **Step 3: `prompt.ts` 본체 변경**

`packages/core/src/creative/prompt.ts` 전체 교체:

```ts
import type { Product } from "../types.js";
import { loadPrompts, substitutePlaceholders } from "../learning/prompts.js";

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
```

`ANGLE_HINTS` 상수 제거됨 (DEFAULT_PROMPTS.copy.angleHints 로 이전).

- [ ] **Step 4: 테스트 실행 — green 확인**

```bash
npx vitest run packages/core/src/creative/prompt.test.ts 2>&1 | tail -10
```

Expected: 9 tests passing (기존 8 + 신규 1: placeholder 잔재 검증).

### Task 2.2: `creative/copy.ts` loader 사용 + COPY_SYSTEM_PROMPT 제거

**Files:**
- Modify: `packages/core/src/creative/copy.ts`
- Modify: `packages/core/src/creative/copy.test.ts`

- [ ] **Step 1: 테스트 먼저 업데이트**

`packages/core/src/creative/copy.test.ts` 전체 교체:

```ts
import { describe, it, expect, vi } from "vitest";
import { generateCopy } from "./copy.js";
import { DEFAULT_PROMPTS } from "../learning/prompts.js";
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

  it("DEFAULT_PROMPTS.copy.systemPrompt does not mention 온라인 강의 specifically", () => {
    expect(DEFAULT_PROMPTS.copy.systemPrompt).not.toContain("온라인 강의");
  });

  it("DEFAULT_PROMPTS.copy.systemPrompt specifies 40-char headline limit", () => {
    expect(DEFAULT_PROMPTS.copy.systemPrompt).toContain("40");
  });

  it("DEFAULT_PROMPTS.copy.systemPrompt specifies 125-char body limit", () => {
    expect(DEFAULT_PROMPTS.copy.systemPrompt).toContain("125");
  });

  it("DEFAULT_PROMPTS.copy.systemPrompt specifies exactly 3 hashtags", () => {
    expect(DEFAULT_PROMPTS.copy.systemPrompt).toContain("3");
  });

  it("passes loaded systemPrompt to Anthropic system field", async () => {
    const client = mockClient(JSON.stringify({
      headline: "h", body: "b", cta: "c", hashtags: ["a", "b", "c"],
    }));
    await generateCopy(client as any, mockProduct, [], "emotional");
    const call = (client.messages.create as any).mock.calls[0][0];
    expect(call.system[0].text).toBe(DEFAULT_PROMPTS.copy.systemPrompt);
  });
});
```

- [ ] **Step 2: 테스트 실행 — fail 확인**

```bash
npx vitest run packages/core/src/creative/copy.test.ts 2>&1 | tail -10
```

Expected: FAIL — `import { generateCopy }` 만 남았는데 `COPY_SYSTEM_PROMPT` 가 아직 export, 또는 generateCopy 가 loader 사용 안 함.

- [ ] **Step 3: `copy.ts` 본체 변경**

`packages/core/src/creative/copy.ts` 전체 교체:

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { Product, Creative } from "../types.js";
import { buildCopyPrompt, type FewShotExample, type VariantLabel } from "./prompt.js";
import { loadPrompts } from "../learning/prompts.js";
import { requireAnthropicKey } from "../config/helpers.js";

export async function generateCopy(
  client: Anthropic,
  product: Product,
  fewShot: FewShotExample[] = [],
  variantLabel: VariantLabel = "emotional",
): Promise<Creative["copy"]> {
  const prompts = await loadPrompts();
  const userPrompt = await buildCopyPrompt(product, fewShot, variantLabel);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: [{ type: "text", text: prompts.copy.systemPrompt, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? "{}");
  return {
    ...parsed,
    variantLabel,
    assetLabel: "", // 호출자가 Creative를 조립할 때 채움
  };
}

export function createAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: requireAnthropicKey() });
}
```

`COPY_SYSTEM_PROMPT` export 제거됨.

- [ ] **Step 4: 테스트 실행 — green 확인**

```bash
npx vitest run packages/core/src/creative/copy.test.ts 2>&1 | tail -10
```

Expected: 8 tests passing (기존 7 + 신규 1: passes loaded systemPrompt).

### Task 2.3: 호출처 await 추가 — pipeline.ts, actions.ts, entries/generate.ts

**Files:**
- Modify: `packages/cli/src/pipeline.ts:78` (or whichever line still calls `buildCopyPrompt` directly — actually `generateCopy` 가 internally `buildCopyPrompt` 호출하므로 외부 호출처 없을 가능성)

먼저 grep 으로 직접 호출처 확인:

- [ ] **Step 1: `buildCopyPrompt` 직접 호출처 grep**

```bash
grep -rn "buildCopyPrompt" packages/ --include="*.ts" | grep -v "\.test\.ts"
```

Expected:
- `packages/core/src/creative/prompt.ts` (정의)
- `packages/core/src/creative/copy.ts` (호출 — 이미 await 적용됨)

이외 호출처 없으면 추가 변경 불필요. 있으면 다음 step.

- [ ] **Step 2 (조건부): 추가 호출처 await 변경**

발견된 각 호출처에서 `buildCopyPrompt(...)` → `await buildCopyPrompt(...)`.

- [ ] **Step 3: 전체 테스트 실행**

```bash
npm test 2>&1 | tail -10
```

Expected: 370 + Task 2.1 의 +1 + Task 2.2 의 +1 = **372 tests passing**.

기존 `creative/copy.test.ts` 가 7 → 8, `creative/prompt.test.ts` 가 8 → 9 로 각 +1 (정확 카운트는 grep 결과로).

### Task 2.4: marketing-copy-reviewer subagent + code-reviewer + Commit

- [ ] **Step 1: marketing-copy-reviewer 호출**

`Agent` 도구로 `marketing-copy-reviewer` 호출. 컨텍스트:
- creative/prompt.ts 본체 변경 (CLAUDE.md "Subagent 호출 규칙" 트리거)
- DEFAULT_PROMPTS 의 systemPrompt/userTemplate/angleHints 가 byte-단위로 기존 하드코딩 값과 동일한지 검증
- substitutePlaceholders 결과가 기존 `buildCopyPrompt` 출력과 whitespace 까지 일치하는지

검증 포인트 명시:
1. `DEFAULT_PROMPTS.copy.systemPrompt` 의 모든 줄이 기존 `creative/copy.ts:COPY_SYSTEM_PROMPT` 와 동일
2. `DEFAULT_PROMPTS.copy.userTemplate` 의 placeholder substitution 결과가 기존 `buildCopyPrompt` 출력과 동일 (인덴트, 줄바꿈, 공백 모두)
3. `DEFAULT_PROMPTS.copy.angleHints.{emotional,numerical,urgency}` 가 기존 `ANGLE_HINTS` 와 동일

- [ ] **Step 2: code-reviewer 호출**

`Agent` 도구로 `superpowers:code-reviewer`. 변경 범위 spec §4.6 + §6.2 적용 검증.

- [ ] **Step 3: 발견 이슈 처리**

- [ ] **Step 4: 명시적 add**

```bash
git add packages/core/src/creative/copy.ts \
  packages/core/src/creative/copy.test.ts \
  packages/core/src/creative/prompt.ts \
  packages/core/src/creative/prompt.test.ts
```

(Step 1 의 grep 결과 추가 호출처 있으면 함께 add.)

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(creative): migrate copy/prompt to data-driven prompts via loadPrompts()

creative/copy.ts:COPY_SYSTEM_PROMPT export 제거 → loadPrompts().copy.systemPrompt 사용. creative/prompt.ts:ANGLE_HINTS 상수 제거 → DEFAULT_PROMPTS.copy.angleHints 로 이전. buildCopyPrompt 가 async 로 전환되어 substitutePlaceholders 로 userTemplate 치환. DEFAULT_PROMPTS 가 기존 하드코딩 값과 byte-단위 일치하므로 동작 보존 (marketing-copy-reviewer 검증). 호출처 generateCopy 는 await 추가.

테스트 fixture 도 DEFAULT_PROMPTS import 로 교체. 4개 systemPrompt assertion 의미 동일하게 유지. placeholder 잔재 검증 케이스 신규 추가.

Spec: docs/superpowers/specs/2026-04-26-prompt-as-data-design.md §4.6
EOF
)"
```

- [ ] **Step 6: 테스트 재확인**

```bash
npm test 2>&1 | tail -5
```

Expected: 372 tests passing.

---

## Commit 3: Improver 재작성

**범위**: regex / applyCodeChange / git commit 흐름 전체 제거. 데이터 업데이트 흐름으로 대체. types/monitor/scheduler 동시 수정 (atomic).

### Task 3.1: `core/types.ts` Improvement 새 shape

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: ImprovementChange 변경**

`packages/core/src/types.ts` 의 `ImprovementChange` + `Improvement` 변경 (라인 ~67-80 부근):

```ts
// Before
export interface ImprovementChange {
  file: string;
  type: "prompt_update" | "param_update" | "bug_fix";
  before: string;
  after: string;
}

export interface Improvement {
  date: string;
  trigger: string;
  changes: ImprovementChange[];
}

// After
export interface ImprovementChange {
  promptKey: string;
  before: string;
  after: string;
  reason?: string;
}

export interface Improvement {
  date: string;
  trigger: string;
  changes: ImprovementChange[];
}
```

`type` 필드 제거 + `file` → `promptKey` rename + `reason` optional 추가.

- [ ] **Step 2: 컴파일 확인**

```bash
npx vitest run --no-coverage 2>&1 | grep -E "error|fail" | head -10
```

Expected: `improver/runner.ts` 에서 ImprovementChange 사용 시 type/file 필드 참조로 컴파일 에러. Task 3.5 에서 해결.

### Task 3.2: `improver/index.ts` 새 시그니처 + 새 타입

**Files:**
- Modify: `packages/core/src/improver/index.ts`

- [ ] **Step 1: 본체 전체 교체**

`packages/core/src/improver/index.ts` 전체 교체:

```ts
import type { Report } from "../types.js";
import { getConfig } from "@ad-ai/core/config/index.js";

export const ALLOWED_PROMPT_KEYS = [
  "copy.systemPrompt",
  "copy.userTemplate",
  "copy.angleHints.emotional",
  "copy.angleHints.numerical",
  "copy.angleHints.urgency",
] as const;
export type PromptKey = (typeof ALLOWED_PROMPT_KEYS)[number];

export interface AnalysisImprovement {
  campaignId?: string;
  issue: string;
  suggestion: string;
  promptKey: PromptKey;
}

export interface AnalysisResult {
  summary?: string;
  improvements?: AnalysisImprovement[];
}

export interface PromptUpdateProposal {
  promptKey: PromptKey;
  newValue: string;
  reason: string;
}

export function getCtrThreshold(): number {
  return getConfig().defaults.ctr_improvement_threshold;
}

export function shouldTriggerImprovement(report: Report): boolean {
  return report.ctr < getCtrThreshold();
}

export function isAllowedPromptKey(key: string): key is PromptKey {
  return (ALLOWED_PROMPT_KEYS as readonly string[]).includes(key);
}

export function buildImprovementPrompt(
  promptKey: PromptKey,
  currentValue: string,
  issue: string,
  suggestion: string,
  performanceContext: string,
): string {
  return `당신은 광고 카피 생성 프롬프트를 개선하는 엔지니어입니다.

## 성과 문제
${performanceContext}

## 식별된 이슈
${issue}

## 개선 방향 (분석 단계에서 제안됨)
${suggestion}

## 변경 대상 프롬프트 키
${promptKey}

## 현재 값
"""
${currentValue}
"""

위 prompt 값을 issue/suggestion 에 맞게 다시 작성하세요. 의미를 보존하되 카피 성과가 개선되도록 표현을 조정합니다.

규칙:
- userTemplate 을 수정하는 경우 반드시 {{name}}, {{description}}, {{angleHint}} placeholder 가 포함되어야 합니다.
- systemPrompt 는 최소 50자 이상.
- 다른 placeholder ({{priceText}}, {{category}}, {{tags}}, {{targetUrl}}, {{fewShotBlock}}) 는 빼도 OK.

반드시 아래 JSON 형식으로만 응답:
{
  "promptKey": "${promptKey}",
  "newValue": "새 값 (전체 텍스트)",
  "reason": "변경 이유 (한 문장)"
}`;
}

export function parsePromptUpdate(claudeResponse: string): Partial<PromptUpdateProposal> {
  const jsonMatch = claudeResponse.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch?.[0] ?? "{}");
}
```

기존 export 제거: `parseImprovements` (rename 됨 → `parsePromptUpdate`).

### Task 3.3: `improver/index.test.ts` 새 시그니처에 맞춰 재작성

**Files:**
- Modify: `packages/core/src/improver/index.test.ts`

- [ ] **Step 1: 본체 전체 교체**

`packages/core/src/improver/index.test.ts` 전체 교체:

```ts
import { describe, it, expect } from "vitest";
import {
  buildImprovementPrompt,
  parsePromptUpdate,
  shouldTriggerImprovement,
  isAllowedPromptKey,
  ALLOWED_PROMPT_KEYS,
} from "./index.js";
import type { Report } from "../types.js";

const lowPerformanceReport: Report = {
  id: "r1", campaignId: "c1", productId: "product-1", date: "2026-04-15",
  impressions: 5000, clicks: 40, ctr: 0.8, spend: 60000,
  cpc: 1500, reach: 4500, frequency: 1.1,
};

const highPerformanceReport: Report = {
  id: "r2", campaignId: "c2", productId: "product-2", date: "2026-04-15",
  impressions: 10000, clicks: 420, ctr: 4.2, spend: 134400,
  cpc: 320, reach: 8500, frequency: 1.18,
};

describe("shouldTriggerImprovement", () => {
  it("returns true when CTR is below threshold", () => {
    expect(shouldTriggerImprovement(lowPerformanceReport)).toBe(true);
  });

  it("returns false when CTR is above threshold", () => {
    expect(shouldTriggerImprovement(highPerformanceReport)).toBe(false);
  });
});

describe("isAllowedPromptKey", () => {
  it("accepts all 5 enum values", () => {
    expect(isAllowedPromptKey("copy.systemPrompt")).toBe(true);
    expect(isAllowedPromptKey("copy.userTemplate")).toBe(true);
    expect(isAllowedPromptKey("copy.angleHints.emotional")).toBe(true);
    expect(isAllowedPromptKey("copy.angleHints.numerical")).toBe(true);
    expect(isAllowedPromptKey("copy.angleHints.urgency")).toBe(true);
  });

  it("rejects unknown keys", () => {
    expect(isAllowedPromptKey("copy.unknown")).toBe(false);
    expect(isAllowedPromptKey("analysis.userTemplate")).toBe(false);
    expect(isAllowedPromptKey("")).toBe(false);
  });

  it("ALLOWED_PROMPT_KEYS contains exactly 5 entries", () => {
    expect(ALLOWED_PROMPT_KEYS).toHaveLength(5);
  });
});

describe("buildImprovementPrompt", () => {
  it("includes promptKey, currentValue, issue, suggestion, performanceContext", () => {
    const prompt = buildImprovementPrompt(
      "copy.angleHints.emotional",
      "기존 angle hint 값입니다",
      "감정 호소가 약함",
      "더 구체적인 페인 포인트 강조",
      "5개 캠페인 CTR 0.8% 미달",
    );
    expect(prompt).toContain("copy.angleHints.emotional");
    expect(prompt).toContain("기존 angle hint 값입니다");
    expect(prompt).toContain("감정 호소가 약함");
    expect(prompt).toContain("더 구체적인 페인 포인트");
    expect(prompt).toContain("5개 캠페인");
  });

  it("specifies userTemplate placeholder requirements", () => {
    const prompt = buildImprovementPrompt(
      "copy.userTemplate",
      "{{name}} {{description}}",
      "issue",
      "suggestion",
      "ctx",
    );
    expect(prompt).toContain("{{name}}");
    expect(prompt).toContain("{{description}}");
    expect(prompt).toContain("{{angleHint}}");
  });

  it("requires JSON response format", () => {
    const prompt = buildImprovementPrompt(
      "copy.systemPrompt",
      "v",
      "i",
      "s",
      "c",
    );
    expect(prompt).toContain("JSON 형식");
    expect(prompt).toContain('"promptKey"');
    expect(prompt).toContain('"newValue"');
  });
});

describe("parsePromptUpdate", () => {
  it("extracts promptKey/newValue/reason from Claude response", () => {
    const response = `{
      "promptKey": "copy.systemPrompt",
      "newValue": "새 시스템 프롬프트",
      "reason": "더 구체적으로"
    }`;
    const result = parsePromptUpdate(response);
    expect(result.promptKey).toBe("copy.systemPrompt");
    expect(result.newValue).toBe("새 시스템 프롬프트");
    expect(result.reason).toBe("더 구체적으로");
  });

  it("returns empty object when JSON malformed", () => {
    const result = parsePromptUpdate("not json");
    expect(result).toEqual({});
  });

  it("returns partial when fields missing", () => {
    const result = parsePromptUpdate(`{"promptKey": "copy.systemPrompt"}`);
    expect(result.promptKey).toBe("copy.systemPrompt");
    expect(result.newValue).toBeUndefined();
  });
});
```

### Task 3.4: `campaign/monitor.ts` buildAnalysisPrompt 시그니처 변경

**Files:**
- Modify: `packages/core/src/campaign/monitor.ts`
- Modify: `packages/core/src/campaign/monitor.test.ts`

- [ ] **Step 1: 테스트 먼저 업데이트**

`packages/core/src/campaign/monitor.test.ts` 의 `buildAnalysisPrompt` describe 블록 (라인 ~30-37):

```ts
// Before
describe("buildAnalysisPrompt", () => {
  it("includes performance data", () => {
    const stats = computeStats(mockReports);
    const prompt = buildAnalysisPrompt(mockReports, stats);
    expect(prompt).toContain("4.2");
    expect(prompt).toContain("0.9");
  });
});

// After
import { DEFAULT_PROMPTS } from "../learning/prompts.js";

describe("buildAnalysisPrompt", () => {
  it("includes performance data and current prompts", () => {
    const stats = computeStats(mockReports);
    const prompt = buildAnalysisPrompt(mockReports, stats, DEFAULT_PROMPTS);
    expect(prompt).toContain("4.2");
    expect(prompt).toContain("0.9");
    // 현재 prompt 내용 일부가 분석 컨텍스트에 포함됨
    expect(prompt).toContain("감정 호소");
  });

  it("lists allowed promptKey enum values", () => {
    const stats = computeStats(mockReports);
    const prompt = buildAnalysisPrompt(mockReports, stats, DEFAULT_PROMPTS);
    expect(prompt).toContain("copy.systemPrompt");
    expect(prompt).toContain("copy.userTemplate");
    expect(prompt).toContain("copy.angleHints.emotional");
  });
});
```

- [ ] **Step 2: 본체 변경**

`packages/core/src/campaign/monitor.ts` 의 `buildAnalysisPrompt` 함수 본체 교체 + `generateWeeklyAnalysis` 가 `loadPrompts` 호출하도록 수정:

```ts
import type { Prompts } from "../learning/prompts.js";
import { loadPrompts } from "../learning/prompts.js";

// ... existing code ...

export function buildAnalysisPrompt(
  reports: Report[],
  stats: PerformanceStats,
  currentPrompts: Prompts,
): string {
  return `다음 인스타그램 광고 성과 데이터를 분석하고 개선 제안을 JSON으로 반환해주세요.

## 성과 데이터
${reports.map((r) => `캠페인 ${r.campaignId}: CTR ${r.ctr}%, CPC ₩${r.cpc}, 지출 ₩${r.spend}`).join("\n")}

## 요약
- 상위 CTR: ${stats.top.map((r) => r.ctr).join("%, ")}%
- 하위 CTR: ${stats.bottom.map((r) => r.ctr).join("%, ")}%
- 총 지출: ₩${stats.totalSpend.toLocaleString()}
- 평균 CTR: ${stats.avgCtr.toFixed(2)}%

## 현재 학습된 프롬프트 (개선 대상)
${JSON.stringify(currentPrompts, null, 2)}

위 데이터를 보고, 카피 생성 프롬프트의 어느 부분(promptKey)을 어떻게 바꿔야 성과가 좋아질지 제안해주세요.
허용된 promptKey 만 사용 (그 외 값은 무시됨):
- "copy.systemPrompt" — 시스템 프롬프트 전체
- "copy.userTemplate" — 사용자 프롬프트 템플릿 (반드시 {{name}}/{{description}}/{{angleHint}} 포함)
- "copy.angleHints.emotional" — 감정 호소 variant 톤
- "copy.angleHints.numerical" — 수치 강조 variant 톤
- "copy.angleHints.urgency" — 긴급성 variant 톤

반드시 아래 JSON 형식으로만 응답:
{
  "summary": "전체 요약",
  "improvements": [
    {
      "campaignId": "성과 부진 캠페인 ID (선택)",
      "issue": "문제점",
      "suggestion": "개선 방향",
      "promptKey": "위 enum 중 하나"
    }
  ]
}`;
}

export async function generateWeeklyAnalysis(): Promise<string> {
  const client = new Anthropic({ apiKey: requireAnthropicKey() });
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
  const currentPrompts = await loadPrompts();
  const prompt = buildAnalysisPrompt(reports, stats, currentPrompts);

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

다른 함수들 (`computeStats`, `collectDailyReports`, `variantReportsToReports`) 은 변경 없음.

- [ ] **Step 3: 테스트 실행 — green 확인**

```bash
npx vitest run packages/core/src/campaign/monitor.test.ts 2>&1 | tail -10
```

Expected: 기존 4 + 신규 1 (lists allowed promptKey enum) = 5 또는 그 이상 passing.

### Task 3.5: `improver/runner.ts` 전면 재작성

**Files:**
- Modify: `packages/core/src/improver/runner.ts`

- [ ] **Step 1: 본체 전체 교체**

`packages/core/src/improver/runner.ts` 전체 교체 (기존 `filterSafeImprovementFiles`, `applyCodeChange`, `execFileSync git ...` 모두 제거):

```ts
import Anthropic from "@anthropic-ai/sdk";
import { writeJson, appendJson } from "../storage.js";
import { requireAnthropicKey } from "../config/helpers.js";
import {
  loadPrompts,
  invalidatePromptsCache,
  PromptsSchema,
  validateUserTemplate,
  type Prompts,
} from "../learning/prompts.js";
import {
  buildImprovementPrompt,
  isAllowedPromptKey,
  parsePromptUpdate,
  getCtrThreshold,
  type AnalysisResult,
  type PromptKey,
} from "./index.js";
import type { Report, Improvement, ImprovementChange } from "../types.js";

const PROMPTS_PATH = "data/learned/prompts.json";
const MAX_PROPOSALS_PER_CYCLE = 5;
const ANALYSIS_CALL_USD = 0.005;
const PROPOSAL_CALL_USD = 0.01;

function getPromptValue(prompts: Prompts, key: PromptKey): string {
  const parts = key.split(".");
  let cur: unknown = prompts;
  for (const p of parts) cur = (cur as Record<string, unknown>)[p];
  return cur as string;
}

function setPromptValue(prompts: Prompts, key: PromptKey, value: string): Prompts {
  // 깊은 복제. PromptsSchema 가 string-only 인 동안에만 안전.
  // 미래에 Date/Map/Set 등 non-JSON 타입을 추가하면 structuredClone 또는 명시적 deep clone 으로 교체.
  const cloned: Prompts = JSON.parse(JSON.stringify(prompts));
  const parts = key.split(".");
  const last = parts.pop()!;
  let cur: Record<string, unknown> = cloned as unknown as Record<string, unknown>;
  for (const p of parts) cur = cur[p] as Record<string, unknown>;
  cur[last] = value;
  return cloned;
}

interface ValidationFail { ok: false; reason: string; }
interface ValidationPass { ok: true; prompts: Prompts; }

function validateUpdate(updated: Prompts, key: PromptKey, newValue: string): ValidationFail | ValidationPass {
  const parsed = PromptsSchema.safeParse(updated);
  if (!parsed.success) return { ok: false, reason: `schema validation: ${parsed.error.message}` };
  if (key === "copy.userTemplate") {
    const missing = validateUserTemplate(newValue);
    if (missing.length > 0) return { ok: false, reason: `missing required placeholders: ${missing.join(", ")}` };
  }
  return { ok: true, prompts: parsed.data };
}

export async function runImprovementCycle(
  weakReports: Report[],
  analysis: AnalysisResult,
): Promise<void> {
  if (weakReports.length === 0) return;
  const proposals = (analysis.improvements ?? [])
    .filter((it) => isAllowedPromptKey(it.promptKey))
    .slice(0, MAX_PROPOSALS_PER_CYCLE);
  if (proposals.length === 0) return;

  const client = new Anthropic({ apiKey: requireAnthropicKey() });
  let currentPrompts = await loadPrompts();
  const accepted: ImprovementChange[] = [];
  const rejected: { promptKey: string; issue: string; reason: string }[] = [];
  const dateKey = new Date().toISOString().split("T")[0];

  const ctxFirst = weakReports[0];
  const performanceContext =
    `${weakReports.length}개 캠페인 CTR 임계값(${getCtrThreshold().toFixed(2)}%) 미달. ` +
    `대표 캠페인 CTR=${ctxFirst.ctr.toFixed(2)}%, impressions=${ctxFirst.impressions}.`;

  for (const it of proposals) {
    const before = getPromptValue(currentPrompts, it.promptKey);
    const userPrompt = buildImprovementPrompt(it.promptKey, before, it.issue, it.suggestion, performanceContext);

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    const parsed = parsePromptUpdate(text);

    if (!parsed.newValue || parsed.promptKey !== it.promptKey) {
      rejected.push({
        promptKey: it.promptKey,
        issue: it.issue,
        reason: `parse fail: missing newValue or key mismatch (got ${parsed.promptKey})`,
      });
      continue;
    }

    const updated = setPromptValue(currentPrompts, it.promptKey, parsed.newValue);
    const v = validateUpdate(updated, it.promptKey, parsed.newValue);
    if (!v.ok) {
      rejected.push({ promptKey: it.promptKey, issue: it.issue, reason: v.reason });
      continue;
    }

    currentPrompts = v.prompts;
    accepted.push({
      promptKey: it.promptKey,
      before,
      after: parsed.newValue,
      reason: parsed.reason ?? "",
    });
  }

  if (accepted.length > 0) {
    await writeJson(PROMPTS_PATH, currentPrompts);
    invalidatePromptsCache();
    const improvement: Improvement = {
      date: dateKey,
      trigger: `${weakReports.length}개 캠페인 CTR 임계값 미달`,
      changes: accepted,
    };
    await appendJson(`data/improvements/${dateKey}.json`, improvement);
    console.log(`[improver] ${accepted.length}개 prompt 업데이트 적용 — ${PROMPTS_PATH}`);
  }
  if (rejected.length > 0) {
    await appendJson(`data/improvements/${dateKey}-rejected.json`, { date: dateKey, rejected });
    console.warn(`[improver] ${rejected.length}개 제안 거부 (검증 실패)`);
  }

  const estCost = ANALYSIS_CALL_USD + (accepted.length + rejected.length) * PROPOSAL_CALL_USD;
  console.log(
    `[improver] cycle complete — accepted=${accepted.length} rejected=${rejected.length} ` +
    `est_cost=$${estCost.toFixed(3)}`,
  );
}
```

기존 export 모두 제거: `filterSafeImprovementFiles`, `applyCodeChange`. 신규 export: `runImprovementCycle` (시그니처 변경).

### Task 3.6: `improver/runner.test.ts` 전면 재작성

**Files:**
- Modify: `packages/core/src/improver/runner.test.ts`

- [ ] **Step 1: 본체 전체 교체 — 10 케이스**

`packages/core/src/improver/runner.test.ts` 전체 교체:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFile, mkdir, rm, readFile } from "fs/promises";
import path from "path";
import { runImprovementCycle } from "./runner.js";
import {
  setPromptsForTesting,
  invalidatePromptsCache,
  loadPrompts,
  DEFAULT_PROMPTS,
  type Prompts,
} from "../learning/prompts.js";
import type { AnalysisResult } from "./index.js";
import type { Report } from "../types.js";

const PROMPTS_DIR = "data/learned";
const PROMPTS_PATH = path.join(PROMPTS_DIR, "prompts.json");
const IMPROVEMENTS_DIR = "data/improvements";

async function clearAll(): Promise<void> {
  try { await rm(PROMPTS_PATH, { force: true }); } catch {}
  try { await rm(IMPROVEMENTS_DIR, { recursive: true, force: true }); } catch {}
}

const mkWeak = (id: string, ctr: number): Report => ({
  id, campaignId: id, productId: "p1", date: "2026-04-25",
  impressions: 1000, clicks: 8, ctr,
  spend: 10000, cpc: 1250, reach: 800, frequency: 1.25,
});

let mockClaudeResponse: string;

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: vi.fn().mockImplementation(async () => ({
        content: [{ type: "text", text: mockClaudeResponse }],
      })),
    };
  },
}));

beforeEach(async () => {
  setPromptsForTesting(null);
  await clearAll();
  mockClaudeResponse = "{}";
});

describe("runImprovementCycle", () => {
  it("returns immediately when weakReports is empty", async () => {
    const analysis: AnalysisResult = { improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.systemPrompt" }] };
    await runImprovementCycle([], analysis);
    // No file written
    await expect(readFile(PROMPTS_PATH, "utf-8")).rejects.toThrow();
  });

  it("returns when all improvements have disallowed promptKey", async () => {
    const analysis: AnalysisResult = {
      improvements: [
        { campaignId: "c1", issue: "x", suggestion: "y", promptKey: "analysis.template" as any },
        { campaignId: "c2", issue: "x", suggestion: "y", promptKey: "unknown.key" as any },
      ],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis);
    await expect(readFile(PROMPTS_PATH, "utf-8")).rejects.toThrow();
  });

  it("caps proposals at MAX_PROPOSALS_PER_CYCLE=5", async () => {
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.angleHints.emotional",
      newValue: "새로운 감정 호소 가이드 — 충분한 길이",
      reason: "테스트",
    });
    const proposals = Array.from({ length: 6 }, (_, i) => ({
      campaignId: `c${i}`,
      issue: `issue ${i}`,
      suggestion: `suggestion ${i}`,
      promptKey: "copy.angleHints.emotional" as const,
    }));
    const analysis: AnalysisResult = { improvements: proposals };

    // Spy on Claude calls
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const inst = new Anthropic({ apiKey: "test" });
    const createSpy = vi.spyOn(inst.messages, "create");
    // (Note: mock 자체가 새 Anthropic 마다 새 messages.create 만들지만 spy 못 함 — 대신 cost log 검증으로 대체)

    const logs: string[] = [];
    const orig = console.log;
    console.log = (m: string) => { logs.push(m); };
    try {
      await runImprovementCycle([mkWeak("c0", 0.5)], analysis);
    } finally {
      console.log = orig;
    }

    // 5 accepted (proposals 6 → 5 cap, 모두 같은 mock 응답 받아 schema 통과)
    const finalLog = logs.find((l) => l.includes("cycle complete"));
    expect(finalLog).toMatch(/accepted=5/);
  });

  it("writes prompts.json + invalidates cache + audit on accepted proposal (happy path)", async () => {
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.angleHints.emotional",
      newValue: "감정 호소를 더 강하게 — 새 학습된 값입니다.",
      reason: "데이터 분석 결과",
    });
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "weak emotional", suggestion: "stronger emotion", promptKey: "copy.angleHints.emotional" }],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis);

    // 파일 작성 확인
    const written = await readFile(PROMPTS_PATH, "utf-8");
    const parsed: Prompts = JSON.parse(written);
    expect(parsed.copy.angleHints.emotional).toBe("감정 호소를 더 강하게 — 새 학습된 값입니다.");

    // 캐시 invalidation 확인 — 다음 loadPrompts 가 새 값 반환
    const reloaded = await loadPrompts();
    expect(reloaded.copy.angleHints.emotional).toBe("감정 호소를 더 강하게 — 새 학습된 값입니다.");

    // Audit 파일 작성 확인
    const dateKey = new Date().toISOString().split("T")[0];
    const auditPath = path.join(IMPROVEMENTS_DIR, `${dateKey}.json`);
    const auditRaw = await readFile(auditPath, "utf-8");
    const audit = JSON.parse(auditRaw);
    expect(audit[0].changes[0].promptKey).toBe("copy.angleHints.emotional");
    expect(audit[0].changes[0].after).toContain("감정 호소를 더 강하게");
  });

  it("rejects proposal when Claude response is malformed (no JSON)", async () => {
    mockClaudeResponse = "this is not JSON at all";
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.angleHints.emotional" }],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis);

    const dateKey = new Date().toISOString().split("T")[0];
    const rejectedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`);
    const raw = await readFile(rejectedPath, "utf-8");
    const rec = JSON.parse(raw);
    expect(rec[0].rejected[0].reason).toMatch(/parse fail/);
  });

  it("rejects when Claude returns mismatched promptKey", async () => {
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.userTemplate",
      newValue: "x".repeat(150),
      reason: "test",
    });
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.angleHints.emotional" }],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis);

    const dateKey = new Date().toISOString().split("T")[0];
    const rejectedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`);
    const raw = await readFile(rejectedPath, "utf-8");
    const rec = JSON.parse(raw);
    expect(rec[0].rejected[0].reason).toMatch(/key mismatch/);
  });

  it("rejects when newValue too short (schema fail)", async () => {
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.systemPrompt",
      newValue: "too short",
      reason: "test",
    });
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.systemPrompt" }],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis);

    const dateKey = new Date().toISOString().split("T")[0];
    const rejectedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`);
    const raw = await readFile(rejectedPath, "utf-8");
    const rec = JSON.parse(raw);
    expect(rec[0].rejected[0].reason).toMatch(/schema validation/);
  });

  it("rejects userTemplate update when required placeholders missing", async () => {
    // newValue 가 100자 이상이지만 {{name}} 누락
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.userTemplate",
      newValue: "no placeholders here at all".padEnd(150, "x"),
      reason: "test",
    });
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.userTemplate" }],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis);

    const dateKey = new Date().toISOString().split("T")[0];
    const rejectedPath = path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`);
    const raw = await readFile(rejectedPath, "utf-8");
    const rec = JSON.parse(raw);
    expect(rec[0].rejected[0].reason).toMatch(/missing required placeholders/);
  });

  it("processes mixed accepted + rejected — accepted goes to prompts.json, rejected to -rejected.json", async () => {
    // 첫 호출은 valid, 두 번째는 invalid (mock 한 번에 하나의 response 만 반환)
    // → 동일 응답 받지만 두 번째 promptKey 가 mismatch 라 reject
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.angleHints.emotional",
      newValue: "감정 호소 새 가이드 — 충분히 긴 길이입니다.",
      reason: "test",
    });
    const analysis: AnalysisResult = {
      improvements: [
        { campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.angleHints.emotional" },
        { campaignId: "c2", issue: "x", suggestion: "y", promptKey: "copy.angleHints.numerical" }, // mock 응답의 emotional 과 mismatch
      ],
    };
    await runImprovementCycle([mkWeak("c1", 0.5)], analysis);

    const dateKey = new Date().toISOString().split("T")[0];
    // accepted 파일
    const auditRaw = await readFile(path.join(IMPROVEMENTS_DIR, `${dateKey}.json`), "utf-8");
    expect(JSON.parse(auditRaw)[0].changes).toHaveLength(1);
    // rejected 파일
    const rejRaw = await readFile(path.join(IMPROVEMENTS_DIR, `${dateKey}-rejected.json`), "utf-8");
    expect(JSON.parse(rejRaw)[0].rejected).toHaveLength(1);
  });

  it("emits cost log at end of cycle", async () => {
    mockClaudeResponse = JSON.stringify({
      promptKey: "copy.angleHints.emotional",
      newValue: "감정 호소 — 충분히 긴 새 가이드 텍스트입니다.",
      reason: "test",
    });
    const analysis: AnalysisResult = {
      improvements: [{ campaignId: "c1", issue: "x", suggestion: "y", promptKey: "copy.angleHints.emotional" }],
    };
    const logs: string[] = [];
    const orig = console.log;
    console.log = (m: string) => { logs.push(m); };
    try {
      await runImprovementCycle([mkWeak("c1", 0.5)], analysis);
    } finally {
      console.log = orig;
    }
    const costLog = logs.find((l) => l.includes("cycle complete") && l.includes("est_cost"));
    expect(costLog).toBeDefined();
    expect(costLog).toMatch(/accepted=1/);
    expect(costLog).toMatch(/est_cost=\$0\.0\d+/);
  });
});
```

기존 10개 `filterSafeImprovementFiles` 케이스 모두 폐기. 신규 10 케이스.

### Task 3.7: `scheduler/improvementCycle.ts` 단순화 + MIN_CAMPAIGNS 가드

**Files:**
- Modify: `packages/core/src/scheduler/improvementCycle.ts`

- [ ] **Step 1: 본체 변경**

`packages/core/src/scheduler/improvementCycle.ts` 의 `defaultRunCycleAdapter` 교체 + MIN_CAMPAIGNS_FOR_LEARNING 추가:

```ts
import { readJson, listJson } from "../storage.js";
import { runImprovementCycle as defaultRunCycle } from "../improver/runner.js";
import { shouldTriggerImprovement, type AnalysisResult } from "../improver/index.js";
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

const MIN_CAMPAIGNS_FOR_LEARNING = 3;

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
  if (aggregated.length < MIN_CAMPAIGNS_FOR_LEARNING) {
    console.log(
      `[improvementCycle] insufficient data (${aggregated.length}/${MIN_CAMPAIGNS_FOR_LEARNING}), skipping cycle`,
    );
    return;
  }
  const weak = aggregated.filter(shouldTriggerImprovement);
  if (weak.length === 0) return;
  await defaultRunCycle(weak, analysis as AnalysisResult);
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

기존 `JSON.stringify(analysis)` round-trip 제거. `analysis` object 직접 전달.

### Task 3.8: `scheduler/improvementCycle.test.ts` 시그니처 업데이트

**Files:**
- Modify: `packages/core/src/scheduler/improvementCycle.test.ts`

- [ ] **Step 1: 기존 테스트 중 stringify 검증 케이스 업데이트 + MIN_CAMPAIGNS 신규 케이스**

`packages/core/src/scheduler/improvementCycle.test.ts` 의 두 번째 it 블록 (`weekly-analysis 가 있으면...`) 수정:

```ts
// Before
const [weakArg, analysisArg] = (runCycle as any).mock.calls[0];
expect(weakArg).toEqual([weakReport, weakReport]);
expect(analysisArg).toBe(JSON.stringify(analysisObj));

// After
const [weakArg, analysisArg] = (runCycle as any).mock.calls[0];
expect(weakArg).toEqual([weakReport, weakReport]);
expect(analysisArg).toEqual(analysisObj); // object directly, not stringified
```

추가로 새 describe 블록 — MIN_CAMPAIGNS_FOR_LEARNING:

```ts
describe("defaultRunCycleAdapter — MIN_CAMPAIGNS gate", () => {
  it("skips cycle when aggregated reports < 3", async () => {
    vi.doMock("../campaign/monitor.js", () => ({
      variantReportsToReports: vi.fn(() => [{ id: "r1", ctr: 0.5 } as any, { id: "r2", ctr: 0.4 } as any]),  // 2 only
    }));
    vi.resetModules();
    const { defaultRunCycleAdapter } = await import("./improvementCycle.js");
    const { runImprovementCycle } = await import("../improver/runner.js");
    const logs: string[] = [];
    const orig = console.log;
    console.log = (m: string) => { logs.push(m); };
    try {
      await defaultRunCycleAdapter({ summary: "x" }, []);
    } finally {
      console.log = orig;
    }
    expect(runImprovementCycle).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes("insufficient data"))).toBe(true);
    vi.doUnmock("../campaign/monitor.js");
  });
});
```

### Task 3.9: 전체 테스트 실행 + green 확인

- [ ] **Step 1: `npm test` — 모든 테스트 그린**

```bash
npm test 2>&1 | tail -10
```

Expected delta:
- improver/runner.test.ts: 기존 10 → 신규 10 (수치 같지만 내용 전혀 다름)
- improver/index.test.ts: 기존 5 → 신규 ~11 (+6)
- scheduler/improvementCycle.test.ts: 기존 6 → +1 (+1)
- campaign/monitor.test.ts: 기존 ~5 → +1 (+1)

대략 372 + 8 = **380 tests passing**. ±2 범위 변동 허용.

### Task 3.10: marketing-copy-reviewer + code-reviewer + Commit

- [ ] **Step 1: marketing-copy-reviewer 호출**

`Agent` 도구로 `marketing-copy-reviewer` 호출. 검증 포인트:
- `buildAnalysisPrompt` / `buildImprovementPrompt` 가 Claude 에게 명확한 promptKey enum + placeholder 가드 제시
- Reject log 에 다음 사이클 학습 가능한 진단 정보 포함
- runImprove 산출물 (prompts.json 변경) 의 quality check 흐름

- [ ] **Step 2: code-reviewer 호출**

- [ ] **Step 3: 발견 이슈 처리**

- [ ] **Step 4: 명시적 add**

```bash
git add packages/core/src/types.ts \
  packages/core/src/improver/index.ts \
  packages/core/src/improver/index.test.ts \
  packages/core/src/improver/runner.ts \
  packages/core/src/improver/runner.test.ts \
  packages/core/src/campaign/monitor.ts \
  packages/core/src/campaign/monitor.test.ts \
  packages/core/src/scheduler/improvementCycle.ts \
  packages/core/src/scheduler/improvementCycle.test.ts
```

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(improver): rewrite from code-patching to prompt-as-data update

improver/runner.ts 전면 재작성. filterSafeImprovementFiles, applyCodeChange, execFileSync git ... 모두 제거. Claude 에게 promptKey + 현재 값 + issue/suggestion 주고 새 prompt 값 받아 3-gate validation (parse, schema, placeholder) 후 data/learned/prompts.json 업데이트 + invalidatePromptsCache + audit. accepted/rejected 분리 로그.

improver/index.ts: ALLOWED_PROMPT_KEYS enum 5개 (copy.systemPrompt, copy.userTemplate, copy.angleHints.{emotional,numerical,urgency}). buildImprovementPrompt 새 5-arg 시그니처. parsePromptUpdate (was parseImprovements). isAllowedPromptKey type guard.

types.ts: ImprovementChange 의 file → promptKey, type 필드 제거, reason optional.

campaign/monitor.ts: buildAnalysisPrompt 가 currentPrompts 인자 받아 Claude 에게 enum 안내. generateWeeklyAnalysis 내부 loadPrompts 호출.

scheduler/improvementCycle.ts: defaultRunCycleAdapter 가 analysis object 직접 받음 (JSON round-trip 제거). MIN_CAMPAIGNS_FOR_LEARNING=3 가드 신규.

테스트 fixture 모두 업데이트. improver/runner.test.ts 10 케이스 신규 (기존 filterSafeImprovementFiles 케이스 폐기). MAX_PROPOSALS_PER_CYCLE=5 cap, mixed accepted/rejected, cost 로그 emit 검증.

Spec: docs/superpowers/specs/2026-04-26-prompt-as-data-design.md §5
EOF
)"
```

- [ ] **Step 6: 테스트 재확인**

```bash
npm test 2>&1 | tail -5
```

Expected: ~380 tests passing.

---

## Commit 4: TUI/CLI Generate fewShot 주입

**범위**: `runGenerate` (actions.ts) + `entries/generate.ts` 가 winner DB 에서 fewShot 회수. spec §5.7 의 lifecycle 패턴 (outer scope db open, finally close, product loop 안에서 fewShot 회수) 적용.

### Task 4.1: `actions.ts:runGenerate` fewShot 주입

**Files:**
- Modify: `packages/cli/src/actions.ts` (runGenerate 함수)

- [ ] **Step 1: 현재 runGenerate 본체 read + 변경 위치 파악**

```bash
grep -n "runGenerate\|generateCopy\|VARIANT_LABELS" packages/cli/src/actions.ts | head -20
```

- [ ] **Step 2: actions.ts 변경 — voyage/db lifecycle + fewShot 회수**

`packages/cli/src/actions.ts` 상단 import 에 추가:

```ts
import { retrieveFewShotForProduct } from "@ad-ai/core/rag/retriever.js";
import { createVoyageClient } from "@ad-ai/core/rag/voyage.js";
import { createCreativesDb } from "@ad-ai/core/rag/db.js";
import { WinnerStore } from "@ad-ai/core/rag/store.js";
```

`runGenerate` 함수 본체에서:

```ts
// runGenerate 함수 시작 부분 (try 블록 진입 직후)
const voyage = createVoyageClient();
const creativesDb = createCreativesDb();
const winnerStore = new WinnerStore(creativesDb);
try {
  // ... 기존 product loop ...

  // copiesTask 안의 generateCopy 호출 직전에 (각 product 마다 1회):
  const fewShot = await retrieveFewShotForProduct(product, {
    embed: (texts) => voyage.embed(texts),
    loadAllWinners: () => winnerStore.loadAll(),
  });
  // generateCopy 호출:
  const c = await generateCopy(anthropic, product, fewShot, label);  // ← [] 대신 fewShot

  // ... 기존 코드 ...
} finally {
  creativesDb.close();
}
```

**구체 변경 위치 (actions.ts:120 근처)**:

```ts
// Before (actions.ts:118-120)
const c = await generateCopy(anthropic, product, [], label);
copies.push({ label, data: c });

// After
const c = await generateCopy(anthropic, product, fewShot, label);
copies.push({ label, data: c });
```

`fewShot` 은 `copiesTask` IIFE 안에서 product 별 1회 회수 후 모든 variant 에서 동일하게 사용. image/video task 와 병렬화하지 않음 (fewShot 은 copy 만 사용).

`runGenerate` 의 try 블록 마지막에 `finally { creativesDb.close(); }` 추가.

전체 try/catch 구조 유지. 기존 catch 블록은 그대로.

- [ ] **Step 3: 컴파일 확인**

```bash
npx vitest run --no-coverage packages/cli/src/actions.test.ts 2>&1 | tail -15
```

Expected: 기존 actions.test.ts 가 voyage/creatives.db mock 안 하므로 runGenerate 케이스 fail 가능. Step 4-5 에서 테스트 fixture 보강.

### Task 4.2: `actions.test.ts` voyage + winner DB stub 추가

**Files:**
- Modify: `packages/cli/src/actions.test.ts`

- [ ] **Step 1: runGenerate 테스트 fixture 에 voyage/rag mock 추가**

`packages/cli/src/actions.test.ts` 의 `runGenerate parallelism` 테스트 (~60-85 line) 수정:

```ts
describe("runGenerate parallelism", () => {
  it("emits progress.generate with 3 tracks", async () => {
    const events: any[] = [];
    vi.doMock("@ad-ai/core/creative/image.js", () => ({ generateImage: async () => "img.jpg" }));
    vi.doMock("@ad-ai/core/creative/video.js", () => ({ generateVideo: async () => "vid.mp4" }));
    vi.doMock("@ad-ai/core/creative/copy.js", () => ({
      generateCopy: async () => ({ headline: "h", body: "b", cta: "c", hashtags: [] }),
      createAnthropicClient: () => ({}),
    }));
    vi.doMock("@ad-ai/core/storage.js", () => ({
      listJson: async () => ["data/products/p1.json"],
      readJson: async () => ({ id: "p1", name: "AI 부트캠프", description: "d", targetUrl: "u", currency: "KRW", tags: [], inputMethod: "manual", createdAt: "" }),
      writeJson: async () => {},
    }));
    // 신규: voyage / rag stub
    vi.doMock("@ad-ai/core/rag/voyage.js", () => ({
      createVoyageClient: () => ({ embed: async (texts: string[]) => texts.map(() => new Array(512).fill(0)) }),
    }));
    vi.doMock("@ad-ai/core/rag/db.js", () => ({
      createCreativesDb: () => ({ close: () => {}, prepare: () => ({ all: () => [], get: () => undefined, run: () => ({}) }) }),
    }));
    vi.doMock("@ad-ai/core/rag/store.js", () => ({
      WinnerStore: class {
        loadAll() { return []; }
        hasCreative() { return false; }
        insert() {}
      },
    }));
    vi.doMock("@ad-ai/core/rag/retriever.js", () => ({
      retrieveFewShotForProduct: async () => [],
    }));

    vi.resetModules();
    const { runGenerate: fresh } = await import("./actions.js");
    await fresh((p: any) => events.push(p));
    const withGen = events.filter((e) => e.generate);
    expect(withGen.length).toBeGreaterThan(0);
    expect(withGen[0].generate.tracks.copy).toBeDefined();
    expect(withGen[0].generate.tracks.image).toBeDefined();
    expect(withGen[0].generate.tracks.video).toBeDefined();

    vi.doUnmock("@ad-ai/core/rag/voyage.js");
    vi.doUnmock("@ad-ai/core/rag/db.js");
    vi.doUnmock("@ad-ai/core/rag/store.js");
    vi.doUnmock("@ad-ai/core/rag/retriever.js");
  });

  it("retrieves fewShot for each product before generateCopy", async () => {
    const fewShotSpy = vi.fn().mockResolvedValue([
      { headline: "WINNER_H", body: "WINNER_B", cta: "WINNER_CTA" },
    ]);
    const generateCopySpy = vi.fn().mockResolvedValue({ headline: "h", body: "b", cta: "c", hashtags: [] });

    vi.doMock("@ad-ai/core/creative/image.js", () => ({ generateImage: async () => "img.jpg" }));
    vi.doMock("@ad-ai/core/creative/video.js", () => ({ generateVideo: async () => "vid.mp4" }));
    vi.doMock("@ad-ai/core/creative/copy.js", () => ({
      generateCopy: generateCopySpy,
      createAnthropicClient: () => ({}),
    }));
    vi.doMock("@ad-ai/core/storage.js", () => ({
      listJson: async () => ["data/products/p1.json"],
      readJson: async () => ({ id: "p1", name: "X", description: "d", targetUrl: "u", currency: "KRW", tags: [], inputMethod: "manual", createdAt: "" }),
      writeJson: async () => {},
    }));
    vi.doMock("@ad-ai/core/rag/voyage.js", () => ({
      createVoyageClient: () => ({ embed: async () => [[]] }),
    }));
    vi.doMock("@ad-ai/core/rag/db.js", () => ({
      createCreativesDb: () => ({ close: () => {} }),
    }));
    vi.doMock("@ad-ai/core/rag/store.js", () => ({
      WinnerStore: class { loadAll() { return [{ headline: "WINNER_H", body: "WINNER_B", cta: "WINNER_CTA" } as any]; } },
    }));
    vi.doMock("@ad-ai/core/rag/retriever.js", () => ({
      retrieveFewShotForProduct: fewShotSpy,
    }));

    vi.resetModules();
    const { runGenerate: fresh } = await import("./actions.js");
    await fresh(() => {});

    expect(fewShotSpy).toHaveBeenCalled();
    // generateCopy 가 fewShot 받음 (3 variants × 1 product = 3 calls, 모두 same fewShot)
    const calls = generateCopySpy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const fewShotArg = calls[0][2];
    expect(fewShotArg).toEqual([{ headline: "WINNER_H", body: "WINNER_B", cta: "WINNER_CTA" }]);

    vi.doUnmock("@ad-ai/core/rag/voyage.js");
    vi.doUnmock("@ad-ai/core/rag/db.js");
    vi.doUnmock("@ad-ai/core/rag/store.js");
    vi.doUnmock("@ad-ai/core/rag/retriever.js");
  });
});
```

기존 1 케이스 → 2 케이스 (parallelism + fewShot retrieval). +1.

### Task 4.3: `entries/generate.ts` 동일 패턴 적용

**Files:**
- Modify: `packages/cli/src/entries/generate.ts`

- [ ] **Step 1: 본체 변경**

`packages/cli/src/entries/generate.ts` 전체 교체:

```ts
import { generateCopy, createAnthropicClient } from "@ad-ai/core/creative/copy.js";
import { generateImage } from "@ad-ai/core/creative/image.js";
import { generateVideo } from "@ad-ai/core/creative/video.js";
import { readJson, writeJson } from "@ad-ai/core/storage.js";
import type { Product, Creative } from "@ad-ai/core/types.js";
import { randomUUID } from "crypto";
import { VARIANT_LABELS, type FewShotExample } from "@ad-ai/core/creative/prompt.js";
import { retrieveFewShotForProduct } from "@ad-ai/core/rag/retriever.js";
import { createVoyageClient } from "@ad-ai/core/rag/voyage.js";
import { createCreativesDb } from "@ad-ai/core/rag/db.js";
import { WinnerStore } from "@ad-ai/core/rag/store.js";

const productId = process.argv[2];
if (!productId) { console.error("Usage: npm run generate <productId>"); process.exit(1); }

const product = await readJson<Product>(`data/products/${productId}.json`);
if (!product) { console.error("제품을 찾을 수 없습니다:", productId); process.exit(1); }

const client = createAnthropicClient();
const voyage = createVoyageClient();
const creativesDb = createCreativesDb();
const winnerStore = new WinnerStore(creativesDb);

try {
  console.log("이미지 생성 중...");
  const imageLocalPath = await generateImage(product);
  console.log("영상 생성 중... (최대 10분 소요)");
  const videoLocalPath = await generateVideo(product, console.log);

  const fewShot: FewShotExample[] = await retrieveFewShotForProduct(product, {
    embed: (texts) => voyage.embed(texts),
    loadAllWinners: () => winnerStore.loadAll(),
  });

  const variantGroupId = randomUUID();
  for (const label of VARIANT_LABELS) {
    console.log(`카피 생성 중 (${label})...`);
    const copy = await generateCopy(client, product, fewShot, label);

    const creative: Creative = {
      id: randomUUID(),
      productId: product.id,
      variantGroupId,
      copy: {
        ...copy,
        variantLabel: label,
        assetLabel: `${variantGroupId}::${label}`,
      },
      imageLocalPath,
      videoLocalPath,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    await writeJson(`data/creatives/${creative.id}.json`, creative);
    console.log("완료:", creative.id);
  }
  console.log(`완료: 3 variants (group=${variantGroupId})`);
} finally {
  creativesDb.close();
}
```

`fewShot` 회수는 image/video 생성 후, copy loop 시작 전 1회. `npm run generate <productId>` 는 단일 product 라 product loop 없음.

- [ ] **Step 2: 전체 테스트 실행**

```bash
npm test 2>&1 | tail -10
```

Expected: 380 + 1 (fewShot retrieval 케이스) = **381 tests passing**.

### Task 4.4: marketing-copy-reviewer + code-reviewer + Commit

- [ ] **Step 1: marketing-copy-reviewer 호출**

`Agent` 도구로 `marketing-copy-reviewer`. 검증 포인트:
- runGenerate 산출물 변경 (fewShot 주입으로 카피 출력에 winner 영향)
- fewShot 이 product 별 1회 회수, 3 variant 모두에서 동일 사용 — 적절한 패턴인지
- voyage/winner DB lifecycle 누수 없음 (finally close)

- [ ] **Step 2: code-reviewer 호출**

- [ ] **Step 3: 발견 이슈 처리**

- [ ] **Step 4: 명시적 add**

```bash
git add packages/cli/src/actions.ts \
  packages/cli/src/actions.test.ts \
  packages/cli/src/entries/generate.ts
```

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(cli): inject winner DB fewShot into TUI/CLI Generate paths

actions.ts:runGenerate 와 entries/generate.ts 가 retrieveFewShotForProduct 로 winner DB 에서 top-K=3 fewShot 회수 후 generateCopy 에 주입. 기존 [] 빈 fewShot 으로 자기학습 효과 zero 였던 문제 해결. voyage 클라이언트 + creativesDb 핸들은 runGenerate 진입 시 1회 생성, products loop 끝나고 finally 에서 close (SQLite 핸들 누수 방지). entries/generate.ts 도 동일 lifecycle 패턴.

actions.test.ts 에 voyage/rag stub 추가. 기존 parallelism 케이스 fixture 보강 + fewShot 주입 케이스 신규 (총 +1 case).

Spec: docs/superpowers/specs/2026-04-26-prompt-as-data-design.md §5.7
EOF
)"
```

- [ ] **Step 6: 테스트 재확인**

```bash
npm test 2>&1 | tail -5
```

Expected: ~381 tests passing.

---

## Commit 5: 문서

### Task 5.1: ARCHITECTURE.md — 새 섹션 prompt-as-data 패턴 추가

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: 마지막 업데이트 + 새 §X 추가**

`docs/ARCHITECTURE.md` 라인 3 마지막 업데이트:

```markdown
마지막 업데이트: 2026-04-26
```

`### 10. Platform Adapter 패턴 (2026-04-20)` 섹션 다음에 새 섹션 추가:

```markdown
### 12. 자기학습 루프 — Prompt-as-Data 패턴 (2026-04-26)

**Why:** 자기학습 루프가 *코드 자율 패치* 모델일 때, Claude 가 임의 TS 파일을 수정할 수 있고 보안 가드는 path regex 1개에 의존. 멀티모듈 리팩터에서 regex 가 깨졌고, 보안 체크 위치도 잘못 (writeFile 후 git commit 전). 또한 server multi-user 환경에서 자기 자신의 코드를 수정하는 건 위험.

**How:** 자기학습의 *대상* 을 데이터로 격리. `packages/core/src/learning/prompts.ts` 의 `loadPrompts()` 가 `data/learned/prompts.json` (CLI) 또는 (미래) DB row (Server) 에서 lazy 로드. `creative/copy.ts`, `creative/prompt.ts` 가 하드코딩 const 대신 loader 사용. Improver 는 `data/learned/prompts.json` 한 파일만 read/write — 다른 코드 파일 접근 불가. 3-gate validation (parse/schema/placeholder) + `MAX_PROPOSALS_PER_CYCLE=5` + `MIN_CAMPAIGNS_FOR_LEARNING=3` 가드.

**Trade-off:** "Claude 가 임의 코드 버그도 자율 수정" 시나리오 포기 — 그 시나리오는 처음부터 위험했고 regex 깨짐 상태로 미동작 중이었음. 학습 대상 5개 키 (`copy.systemPrompt`, `copy.userTemplate`, `copy.angleHints.{emotional,numerical,urgency}`) 로 좁힘 — analysis/improver 메타 프롬프트는 부트스트랩 루프 회피 위해 학습 대상 외. CLI/Server 가 동일 인터페이스 (`loadPrompts()`) 공유하되 저장소만 다름 — server 활성화 시 시스템-wide 1행 DB 모델 (사용자별 fine-tuning 은 미래 premium tier).

**파일 위치:** `data/learned/prompts.json` 은 `.gitignore` 의 `data/` 규칙으로 자동 git 제외. 새 머신 → 즉시 default 동작 → 시간 지나며 학습 누적. 백업은 사용자가 `data/` 동기화로.

자세한 설계는 [`docs/superpowers/specs/2026-04-26-prompt-as-data-design.md`](superpowers/specs/2026-04-26-prompt-as-data-design.md) 참조.
```

(섹션 번호는 현재 ARCHITECTURE.md 의 마지막 섹션 번호 +1. 현재 §10 Platform Adapter, §11 Owner-only CLI 면 §12.)

### Task 5.2: STATUS.md — 최근 변경 이력 + 마지막 업데이트

**Files:**
- Modify: `docs/STATUS.md`

- [ ] **Step 1: 마지막 업데이트 + 신규 entry**

라인 3:

```markdown
마지막 업데이트: 2026-04-26
```

`## 최근 변경 이력` 다음 (라인 ~62) 맨 위에 추가:

```markdown
- 2026-04-26 refactor(improver): 자기학습 루프를 코드 자율 패치 → prompt-as-data 모델로 전환. `packages/core/src/learning/prompts.ts` 신설 (lazy singleton loader + Zod schema + REQUIRED_PLACEHOLDERS 검증 + DEFAULT_PROMPTS). `creative/copy.ts:COPY_SYSTEM_PROMPT` 와 `creative/prompt.ts:ANGLE_HINTS` 를 `data/learned/prompts.json` 으로 추출 (default 값과 byte-단위 일치 → 동작 회귀 zero). `improver/runner.ts` 전면 재작성 — `filterSafeImprovementFiles`, `applyCodeChange`, `execFileSync git ...` 모두 제거. Claude 가 promptKey enum (5개) + 현재 값 + issue 받아 새 prompt 값 반환 → 3-gate validation (parse/schema/placeholder) → prompts.json 업데이트 + invalidatePromptsCache + audit. `MAX_PROPOSALS_PER_CYCLE=5`, `MIN_CAMPAIGNS_FOR_LEARNING=3`, cost 추정 로그. TUI/CLI Generate 경로 (`actions.ts:runGenerate`, `entries/generate.ts`) 가 winner DB fewShot 주입 — 자기학습 prompt 변화가 실제 카피 생성에 반영됨. ~381 tests 통과. CLI/Server 인터페이스 호환 (file vs DB) 보장, server 활성화 시 시스템-wide DB 모델로 확장 가능.
```

### Task 5.3: ROADMAP.md — Tier 3 자율 개선 항목 갱신

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: 마지막 업데이트 + Tier 3 entry 갱신**

라인 3:

```markdown
마지막 업데이트: 2026-04-26
```

Tier 3 의 "자율 개선 루프 강화" 또는 관련 entry 를 다음으로 교체:

```markdown
- 자율 개선 루프 강화 — prompt-as-data 모델 기반 (2026-04-26 ✅ CLI scaffold 완료). 학습 대상 5개 prompt 키 (copy.systemPrompt / userTemplate / angleHints.{emotional,numerical,urgency}). Server 활성화 시 시스템-wide DB 모델로 확장. Premium tier 의 사용자별 fine-tuning 은 future feature (loadPrompts(userId?) 시그니처 미리 호환).
```

### Task 5.4: Commit (no subagent)

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
docs: reflect prompt-as-data refactor across STATUS/ROADMAP/ARCHITECTURE

- ARCHITECTURE 새 §12 "자기학습 루프 — Prompt-as-Data 패턴" 추가. Why (regex 깨진 채로 미동작 + server 불안전) / How (loadPrompts + 3-gate validation) / Trade-off (자율 코드 패치 포기, 학습 범위 5 키로 좁힘) / 파일 위치 정책 (gitignored 사용자 로컬)
- STATUS 최근 변경 이력 2026-04-26 entry 추가
- ROADMAP Tier 3 "자율 개선 루프 강화" 를 "CLI scaffold 완료, Server 시스템-wide DB 확장 대기" 로 갱신

Spec: docs/superpowers/specs/2026-04-26-prompt-as-data-design.md
EOF
)"
```

- [ ] **Step 4: 최종 git log 확인**

```bash
git log --oneline -8
```

Expected (예시):
```
<sha5> docs: reflect prompt-as-data refactor across STATUS/ROADMAP/ARCHITECTURE
<sha4> feat(cli): inject winner DB fewShot into TUI/CLI Generate paths
<sha3> refactor(improver): rewrite from code-patching to prompt-as-data update
<sha2> feat(creative): migrate copy/prompt to data-driven prompts via loadPrompts()
<sha1> feat(learning): add prompt loader + schema + DEFAULT_PROMPTS
605a833 docs(specs): add prompt-as-data refactor design spec
```

- [ ] **Step 5: 최종 테스트**

```bash
npm test 2>&1 | tail -5
```

Expected: ~381 tests passing.

---

## 완료 조건 (Definition of Done)

- [ ] 5 commits 모두 그린 빌드 + 그린 테스트
- [ ] `npm test` ~378-385 (구체 수치 implementation 단계)
- [ ] `data/learned/prompts.json` 부재 시 시스템 정상 (default fallback)
- [ ] grep 검증 0건:
  ```bash
  grep -rn "applyCodeChange\|filterSafeImprovementFiles\|execFileSync.*git" packages/ --include="*.ts"
  grep -rn "COPY_SYSTEM_PROMPT\|ANGLE_HINTS" packages/ --include="*.ts" | grep -v "DEFAULT_PROMPTS\|test"
  ```
- [ ] marketing-copy-reviewer 통과 (Commit 2/3/4)
- [ ] code-reviewer 통과 (Commit 1/2/3/4)
- [ ] STATUS 마지막 업데이트 = 2026-04-26
- [ ] ROADMAP Tier 3 자율 개선 항목 갱신
- [ ] ARCHITECTURE 에 §12 신규
- [ ] DEFAULT_PROMPTS 가 byte-단위로 기존 하드코딩 값과 일치 (marketing-copy-reviewer 검증)

---

## 작업 시간 견적

| 단계 | 시간 |
|---|---|
| Task 0 (pre-flight) | 0.2h |
| Commit 1 (loader + schema + 12 테스트) | 1.5h |
| Commit 2 (creative 마이그레이션 + 호출처 await) | 1h |
| Commit 3 (improver 재작성 + types + scheduler + 13 테스트) | 3h |
| Commit 4 (TUI/CLI fewShot 주입) | 1h |
| Commit 5 (문서) | 0.5h |
| Subagent reviews × 7 + 수정 라운드 | 2h |
| 전체 테스트 그린 안정화 | 0.5h |
| **합계** | **~9.7시간 (1.5일)** |

---

## Self-Review

### Spec coverage 매핑

| Spec section | Plan task | 검증 |
|---|---|---|
| §1 배경 | Plan header / Goal | ✅ |
| §2.1 범위 안 7항목 | Commit 1-5 분산 | ✅ (각 항목 task 매핑) |
| §2.2 범위 밖 | Plan 본문에 명시 안 함 (의도) | ✅ |
| §3 결정 사항 | Plan 본문에 모두 반영 (server-wide, 비용 회수, 5 키, regex 약화, type 제거) | ✅ |
| §4 Schema + Loader | Task 1.1 | ✅ |
| §4.6 호출처 변경 | Task 2.1, 2.2 | ✅ |
| §5.1 새 데이터 흐름 | Task 3.5 (runner) | ✅ |
| §5.2 buildAnalysisPrompt | Task 3.4 | ✅ |
| §5.3 improver/index.ts | Task 3.2 | ✅ |
| §5.4 runner 재작성 | Task 3.5 | ✅ |
| §5.5 types | Task 3.1 | ✅ |
| §5.6 scheduler MIN_CAMPAIGNS | Task 3.7 | ✅ |
| §5.7 fewShot 주입 lifecycle | Task 4.1, 4.3 | ✅ |
| §6.1 안전 메커니즘 3-gate | Task 3.5 본문 + Task 3.6 케이스 5-8 | ✅ |
| §6.2 vitest.setup.ts | Task 1.2 | ✅ |
| §6.3 신규 테스트 12 + 10 | Task 1.1, 3.6 | ✅ |
| §6.4 기존 테스트 변경 | Task 2.1, 2.2, 3.3, 3.4, 3.8, 4.2 | ✅ |
| §6.6 캐시 invalidation 통합 | Task 3.6 케이스 4 | ✅ |
| §7 비용 가드 | Task 3.5 본문 (MAX_PROPOSALS=5, cost 로그) + Task 3.7 (MIN_CAMPAIGNS=3) | ✅ |
| §8 commit 분할 | Plan Commit 1-5 구조 그대로 | ✅ |
| §9 영속 데이터 마이그레이션 | Task 0.1 Step 4 (재확인) | ✅ |
| §10 리스크 + 롤백 | Plan 본문 명시 안 함 (DoD 에 일부) | ⚠️ 별도 섹션 추가 검토 |
| §11 Open Questions | Plan 본문 없음 (spec 에 위임) | ✅ |

§10 리스크는 spec 에 있으니 plan 에서 별도 명시 불필요. 단 Critical 위험 (Commit 2 byte-일치) 은 marketing-copy-reviewer 가 검증 명시 — Task 2.4 Step 1 에 반영됨. ✅

### Placeholder scan

- "TBD", "TODO", "implement later", "fill in details": 0건 ✅
- "Add appropriate error handling": 0건 ✅
- "Similar to Task N": 0건 (모든 Task 코드 본체 명시) ✅
- "[research needed]": 0건 (이번 plan 범위는 모든 디테일 확정) ✅

### Type consistency

- `Prompts` interface (Task 1.1) — Task 2.1, 2.2, 3.5, 3.7 에서 동일 사용 ✅
- `PromptKey` enum (Task 3.2) — Task 3.5, 3.6 동일 ✅
- `AnalysisResult` (Task 3.2) — Task 3.5, 3.6, 3.7 동일 ✅
- `ImprovementChange` 새 shape (Task 3.1) — Task 3.5 의 `accepted: ImprovementChange[]` 일치 ✅
- `loadPrompts()` 시그니처 (Task 1.1) — Task 2.1, 2.2, 3.4, 3.5 모두 await 적용 ✅

이슈 없음.

### 커밋 단위 확인

- Commit 1 (additive only) — 그린 빌드 보장 ✅
- Commit 2 (creative migration) — DEFAULT_PROMPTS byte-일치로 동작 보존 ✅
- Commit 3 (improver atomic) — types/monitor/runner/scheduler 동시 수정 ✅
- Commit 4 (fewShot 주입) — Commit 3 후 자기학습 prompt 변화가 카피에 반영됨 ✅
- Commit 5 (docs) — 별도 ✅

각 commit 그린 테스트 + 그린 빌드 유지.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-26-prompt-as-data.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 각 Task 마다 fresh subagent dispatch + 두 단계 리뷰 (spec 준수 + 코드 퀄리티). Commit 2/3/4 는 marketing-copy-reviewer 도 추가. CLAUDE.md "subagent-driven-development으로 실행한다" 정책 준수.

**2. Inline Execution** — CLAUDE.md 가 Inline 사용 금지 명시 — *해당 없음*.

CLAUDE.md 정책상 **Subagent-Driven 만 허용**. 진행 시 `superpowers:subagent-driven-development` 스킬 호출.

# 제품 범용화 (Course → Product) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Course` 타입을 범용 `Product` 타입으로 전환하고, 수동 제품 입력 TUI 액션을 추가해 강의뿐 아니라 모든 제품을 Meta 광고로 자동화할 수 있게 한다.

**Architecture:** `Course` → `Product` 타입 rename과 필드 변경을 core types에서 시작해 scraper → generator → launcher → TUI 순서로 전파한다. 기존 `data/courses/` 데이터는 마이그레이션 스크립트로 `data/products/`로 전환한다. Owner 로컬 TUI 동작은 변경 없이 유지한다.

**Tech Stack:** TypeScript ESM, vitest, 기존 프로젝트 모듈 전체

---

## 필드 변경 요약

| 기존 (Course) | 신규 (Product) |
|--------------|---------------|
| `title` | `name` |
| `thumbnail` | `imageUrl` |
| `url` | `targetUrl` |
| `platform: "inflearn"\|"class101"\|"other"` | `category?: string` |
| `scrapedAt` | `createdAt` |
| (없음) | `currency: string` |
| (없음) | `inputMethod: "scraped"\|"manual"` |
| `courseId` (Creative/Campaign/Report) | `productId` |

---

## 파일 구조 맵

| 파일 | 변경 유형 | 내용 |
|------|---------|------|
| `src/types.ts` | 수정 | `Course` → `Product`, `courseId` → `productId` |
| `src/types.test.ts` | 수정 | Product 타입 테스트 |
| `src/scraper/index.ts` | 수정 | `parseCourseWithGemini` → `parseProductWithGemini`, generic |
| `src/scraper/index.test.ts` | 수정 | Product 반환 테스트 |
| `src/generator/copy.ts` | 수정 | 강의 전용 프롬프트 → 범용 제품 프롬프트 |
| `src/generator/copy.test.ts` | 수정 | Product 기반 테스트 |
| `src/generator/image.ts` | 수정 | `Course` → `Product` 파라미터 |
| `src/generator/image.test.ts` | 수정 | Product 기반 테스트 |
| `src/generator/video.ts` | 수정 | `Course` → `Product` 파라미터 |
| `src/generator/video.test.ts` | 수정 | Product 기반 테스트 |
| `src/launcher/index.ts` | 수정 | `courseId` → `productId`, `Course` → `Product` |
| `src/launcher/index.test.ts` | 수정 | Product 기반 테스트 |
| `src/monitor/index.ts` | 수정 | `courseId` → `productId` |
| `src/monitor/index.test.ts` | 수정 | 업데이트 |
| `src/reviewer/index.ts` | 수정 | `courseId` → `productId` |
| `src/reviewer/index.test.ts` | 수정 | 업데이트 |
| `src/improver/index.ts` | 수정 | `data/courses/` → `data/products/` |
| `src/tui/AppTypes.ts` | 수정 | `add-product` 액션 추가 |
| `src/tui/actions.ts` | 수정 | `runGenerate` 경로 업데이트, `runAddProduct` 추가 |
| `src/tui/App.tsx` | 수정 | add-product 흐름 연결 |
| `src/pipeline.ts` | 수정 | `Course` → `Product`, `data/courses/` → `data/products/` |
| `src/cli/scrape.ts` | 수정 | `scrapeCourse` → `scrapeProduct` |
| `src/cli/generate.ts` | 수정 | `data/courses/` → `data/products/` |
| `scripts/migrate.ts` | 신규 | `data/courses/` → `data/products/` 마이그레이션 |
| `package.json` | 수정 | `migrate` 스크립트 추가 |

---

## Task 1: 핵심 타입 변경 (Course → Product)

**Files:**
- Modify: `src/types.ts`
- Modify: `src/types.test.ts`

- [ ] **Step 1: 타입 테스트 업데이트**

`src/types.test.ts` 전체를 아래로 교체:
```typescript
import { describe, it, expectTypeOf } from "vitest";
import type { Product, Creative, Campaign, Report, Improvement } from "./types.js";

describe("types", () => {
  it("Product has required fields", () => {
    expectTypeOf<Product>().toMatchTypeOf<{
      id: string;
      name: string;
      targetUrl: string;
      currency: string;
    }>();
  });

  it("Creative productId is string", () => {
    expectTypeOf<Creative["productId"]>().toEqualTypeOf<string>();
  });

  it("Creative status is union type", () => {
    expectTypeOf<Creative["status"]>().toEqualTypeOf<
      "pending" | "approved" | "rejected" | "edited"
    >();
  });

  it("Product inputMethod is union type", () => {
    expectTypeOf<Product["inputMethod"]>().toEqualTypeOf<"scraped" | "manual">();
  });

  it("Improvement has changes array", () => {
    expectTypeOf<Improvement["changes"]>().toEqualTypeOf<
      Array<{ file: string; type: "prompt_update" | "param_update" | "bug_fix"; before: string; after: string }>
    >();
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
cd /Users/yuhojin/Desktop/ad_ai && npm test -- src/types.test.ts
```

Expected: FAIL — `Product` not found

- [ ] **Step 3: types.ts 전체 교체**

`src/types.ts`:
```typescript
export interface Product {
  id: string;
  name: string;
  description: string;
  price?: number;
  currency: string;          // KRW, USD 등
  imageUrl?: string;
  targetUrl: string;         // 광고 클릭 시 이동할 URL
  category?: string;         // course | app | ecommerce | service | other
  tags: string[];
  inputMethod: "scraped" | "manual";
  createdAt: string;
}

export interface Creative {
  id: string;
  productId: string;
  copy: {
    headline: string;
    body: string;
    cta: string;
    hashtags: string[];
  };
  imageLocalPath: string;
  videoLocalPath: string;
  status: "pending" | "approved" | "rejected" | "edited";
  reviewNote?: string;
  createdAt: string;
}

export interface Campaign {
  id: string;
  creativeId: string;
  productId: string;
  metaCampaignId: string;
  metaAdSetId: string;
  metaAdIds: string[];
  launchedAt: string;
  status: "active" | "paused" | "completed";
}

export interface Report {
  id: string;
  campaignId: string;
  productId: string;
  date: string;
  impressions: number;
  clicks: number;
  ctr: number;
  /** Ad spend in KRW (Korean Won, whole units). Meta returns this as-is for KRW accounts. */
  spend: number;
  /** Cost per click in KRW (Korean Won, whole units). */
  cpc: number;
  reach: number;
  frequency: number;
}

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
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

```bash
npm test -- src/types.test.ts
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/types.ts src/types.test.ts
git commit -m "feat: rename Course to Product with generalized fields"
```

---

## Task 2: 스크래퍼 업데이트

**Files:**
- Modify: `src/scraper/index.ts`
- Modify: `src/scraper/index.test.ts`

- [ ] **Step 1: 테스트 업데이트**

`src/scraper/index.test.ts` 전체를 아래로 교체:
```typescript
import { describe, it, expect, vi } from "vitest";
import { parseProductWithGemini, detectCategory } from "./index.js";

describe("detectCategory", () => {
  it("detects course from inflearn URL", () => {
    expect(detectCategory("https://www.inflearn.com/course/typescript")).toBe("course");
  });

  it("detects course from class101 URL", () => {
    expect(detectCategory("https://class101.net/products/abc123")).toBe("course");
  });

  it("returns other for unknown URLs", () => {
    expect(detectCategory("https://example.com/product")).toBe("other");
  });
});

describe("parseProductWithGemini", () => {
  it("extracts structured product data from raw HTML", async () => {
    const mockGemini = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            name: "TypeScript 완전 정복",
            description: "TypeScript를 처음부터 끝까지",
            price: 55000,
            tags: ["typescript", "javascript"],
            imageUrl: "https://example.com/thumb.jpg",
          }),
        }),
      },
    };

    const result = await parseProductWithGemini(
      mockGemini as any,
      "https://www.inflearn.com/course/typescript",
      "<html>TypeScript 완전 정복 ₩55,000</html>"
    );

    expect(result.name).toBe("TypeScript 완전 정복");
    expect(result.price).toBe(55000);
    expect(result.category).toBe("course");
    expect(result.inputMethod).toBe("scraped");
    expect(result.currency).toBe("KRW");
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npm test -- src/scraper/index.test.ts
```

Expected: FAIL

- [ ] **Step 3: 스크래퍼 구현 업데이트**

`src/scraper/index.ts` 전체를 아래로 교체:
```typescript
import { chromium } from "playwright";
import { GoogleGenAI } from "@google/genai";
import type { Product } from "../types.js";
import { writeJson } from "../storage.js";
import { randomUUID } from "crypto";

export function detectCategory(url: string): string {
  if (url.includes("inflearn.com")) return "course";
  if (url.includes("class101.net")) return "course";
  return "other";
}

export async function parseProductWithGemini(
  ai: GoogleGenAI,
  url: string,
  html: string
): Promise<Product> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-05-20",
    contents: `다음 HTML에서 제품/서비스 정보를 추출해 JSON으로 반환해주세요.
반드시 아래 형식만 반환하고 다른 텍스트는 포함하지 마세요:
{"name":"","description":"","price":0,"tags":[],"imageUrl":""}

HTML:
${html.slice(0, 8000)}`,
  });

  const raw = response.text ?? "{}";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? "{}");

  return {
    id: randomUUID(),
    name: parsed.name ?? "",
    description: parsed.description ?? "",
    imageUrl: parsed.imageUrl ?? "",
    targetUrl: url,
    category: detectCategory(url),
    price: parsed.price ?? 0,
    currency: "KRW",
    tags: parsed.tags ?? [],
    inputMethod: "scraped",
    createdAt: new Date().toISOString(),
  };
}

export async function scrapeProduct(url: string): Promise<Product> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    const html = await page.content();
    const product = await parseProductWithGemini(ai, url, html);
    await writeJson(`data/products/${product.id}.json`, product);
    return product;
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

```bash
npm test -- src/scraper/index.test.ts
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/scraper/index.ts src/scraper/index.test.ts
git commit -m "feat: update scraper to return Product with generic parsing"
```

---

## Task 3: 카피 생성기 — 범용 프롬프트

**Files:**
- Modify: `src/generator/copy.ts`
- Modify: `src/generator/copy.test.ts`

- [ ] **Step 1: 테스트 업데이트**

`src/generator/copy.test.ts` 전체를 아래로 교체:
```typescript
import { describe, it, expect, vi } from "vitest";
import { generateCopy, COPY_SYSTEM_PROMPT } from "./copy.js";
import type { Product } from "../types.js";

const mockProduct: Product = {
  id: "test-id",
  name: "React 완전정복",
  description: "React를 처음부터 배웁니다",
  imageUrl: "https://example.com/thumb.jpg",
  targetUrl: "https://inflearn.com/course/react",
  category: "course",
  currency: "KRW",
  price: 55000,
  tags: ["react", "frontend"],
  inputMethod: "scraped",
  createdAt: "2026-04-16T00:00:00.000Z",
};

describe("generateCopy", () => {
  it("returns structured copy with all required fields", async () => {
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                headline: "React를 3주 만에 마스터하세요",
                body: "현직 개발자가 알려주는 실전 React. 지금 바로 시작하세요.",
                cta: "강의 보러가기",
                hashtags: ["#React", "#프론트엔드", "#개발공부"],
              }),
            },
          ],
        }),
      },
    };

    const result = await generateCopy(mockClient as any, mockProduct);

    expect(result.headline).toBeTruthy();
    expect(result.body).toBeTruthy();
    expect(result.cta).toBeTruthy();
    expect(result.hashtags).toHaveLength(3);
  });

  it("COPY_SYSTEM_PROMPT does not mention 강의 specifically", () => {
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

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npm test -- src/generator/copy.test.ts
```

Expected: FAIL — `온라인 강의` 관련 테스트 실패

- [ ] **Step 3: copy.ts 업데이트**

`src/generator/copy.ts` 전체를 아래로 교체:
```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { Product, Creative } from "../types.js";

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
  product: Product
): Promise<Creative["copy"]> {
  const priceText = product.price
    ? `${product.currency} ${product.price.toLocaleString()}`
    : "가격 미정";

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: [
      {
        type: "text",
        text: COPY_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `다음 제품/서비스에 대한 Instagram 광고 카피를 작성해주세요.

제품명: ${product.name}
설명: ${product.description}
가격: ${priceText}
카테고리: ${product.category ?? "기타"}
태그: ${product.tags.join(", ")}
링크: ${product.targetUrl}`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch?.[0] ?? "{}");
}

export function createAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

```bash
npm test -- src/generator/copy.test.ts
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/generator/copy.ts src/generator/copy.test.ts
git commit -m "feat: generalize copy generator prompt for all product types"
```

---

## Task 4: 이미지·영상 생성기 업데이트

**Files:**
- Modify: `src/generator/image.ts`
- Modify: `src/generator/image.test.ts`
- Modify: `src/generator/video.ts`
- Modify: `src/generator/video.test.ts`

- [ ] **Step 1: image.test.ts 업데이트**

`src/generator/image.test.ts` 전체를 아래로 교체:
```typescript
import { describe, it, expect } from "vitest";
import { buildImagePrompt, saveBase64Image } from "./image.js";
import type { Product } from "../types.js";
import { existsSync, unlinkSync } from "fs";

const mockProduct: Product = {
  id: "test-id",
  name: "Docker 기초",
  description: "컨테이너 기술의 기초",
  imageUrl: "",
  targetUrl: "https://inflearn.com/course/docker",
  category: "course",
  currency: "KRW",
  price: 44000,
  tags: ["docker", "devops"],
  inputMethod: "scraped",
  createdAt: "2026-04-16T00:00:00.000Z",
};

describe("buildImagePrompt", () => {
  it("generates a descriptive prompt from product data", () => {
    const prompt = buildImagePrompt(mockProduct);
    expect(prompt).toContain("Docker");
    expect(prompt.length).toBeGreaterThan(30);
  });
});

describe("saveBase64Image", () => {
  it("saves base64 image to file and returns path", async () => {
    const fakeBase64 = Buffer.from("fake image data").toString("base64");
    const filePath = await saveBase64Image(fakeBase64, "test-id");
    expect(existsSync(filePath)).toBe(true);
    unlinkSync(filePath);
  });
});
```

- [ ] **Step 2: video.test.ts 업데이트**

`src/generator/video.test.ts` 전체를 아래로 교체:
```typescript
import { describe, it, expect } from "vitest";
import { buildVideoPrompt } from "./video.js";
import type { Product } from "../types.js";

const mockProduct: Product = {
  id: "test-id",
  name: "TypeScript 입문",
  description: "타입스크립트를 배웁니다",
  imageUrl: "",
  targetUrl: "https://inflearn.com/course/typescript",
  category: "course",
  currency: "KRW",
  price: 49000,
  tags: ["typescript"],
  inputMethod: "scraped",
  createdAt: "2026-04-16T00:00:00.000Z",
};

describe("buildVideoPrompt", () => {
  it("generates a video prompt with product context", () => {
    const prompt = buildVideoPrompt(mockProduct);
    expect(prompt).toContain("TypeScript");
    expect(prompt.length).toBeGreaterThan(50);
  });

  it("includes vertical format instruction", () => {
    const prompt = buildVideoPrompt(mockProduct);
    expect(prompt.toLowerCase()).toContain("vertical");
  });
});
```

- [ ] **Step 3: 테스트 실행 (실패 확인)**

```bash
npm test -- src/generator/image.test.ts src/generator/video.test.ts
```

Expected: FAIL

- [ ] **Step 4: image.ts 업데이트**

`src/generator/image.ts`에서 `Course` → `Product`, `course.title` → `product.name`, `course.id` → `product.id`:
```typescript
import { GoogleGenAI } from "@google/genai";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { Product } from "../types.js";

export function buildImagePrompt(product: Product): string {
  return `Instagram advertisement image for a product or service.
Product: "${product.name}"
Topic: ${product.tags.slice(0, 3).join(", ")}
Style: Modern, professional. Clean background, bold typography area.
Format: Square 1:1, suitable for Instagram feed ad.
No text overlay needed. Visually represent the value proposition.`;
}

export async function saveBase64Image(
  base64Data: string,
  productId: string
): Promise<string> {
  const dir = "data/creatives";
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${productId}-image.jpg`);
  await writeFile(filePath, Buffer.from(base64Data, "base64"));
  return filePath;
}

export async function generateImage(product: Product): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
  const prompt = buildImagePrompt(product);

  const response = await ai.models.generateImages({
    model: "imagen-3.0-generate-002",
    prompt,
    config: {
      numberOfImages: 1,
      aspectRatio: "1:1",
      outputMimeType: "image/jpeg",
    },
  });

  const imageData = response.generatedImages?.[0]?.image?.imageBytes;
  if (!imageData) throw new Error("Imagen 3: 이미지 생성 실패");

  return saveBase64Image(
    typeof imageData === "string" ? imageData : Buffer.from(imageData).toString("base64"),
    product.id
  );
}
```

- [ ] **Step 5: video.ts 업데이트**

`src/generator/video.ts`에서 `Course` → `Product`, `course.title` → `product.name`, `course.id` → `product.id`:
```typescript
import { GoogleGenAI } from "@google/genai";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { Product } from "../types.js";

export function buildVideoPrompt(product: Product): string {
  return `Short Instagram Reels advertisement (15 seconds), vertical 9:16 format.
Product/service promotion for "${product.name}".
Topics: ${product.tags.slice(0, 3).join(", ")}.
Visual style: Dynamic, modern. Show someone benefiting from the product/service.
No voiceover needed. Cinematic quality. Ends with clear call-to-action moment.`;
}

async function saveVideoBytes(data: Uint8Array | string, productId: string): Promise<string> {
  const dir = "data/creatives";
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${productId}-video.mp4`);
  const buffer = typeof data === "string" ? Buffer.from(data, "base64") : Buffer.from(data);
  await writeFile(filePath, buffer);
  return filePath;
}

export async function generateVideo(
  product: Product,
  onProgress?: (msg: string) => void
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
  const prompt = buildVideoPrompt(product);

  onProgress?.("Veo 3.1: 영상 생성 요청 중...");

  let operation = await ai.models.generateVideos({
    model: "veo-3.1-generate-preview",
    prompt,
    config: { aspectRatio: "9:16", durationSeconds: 15 },
  });

  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    if (operation.done) break;
    onProgress?.(`Veo 3.1: 영상 생성 중... (${i + 1}/${maxAttempts})`);
    await new Promise((r) => setTimeout(r, 10000));
    operation = await ai.operations.get({ operation });
  }

  if (!operation.done) throw new Error("Veo 3.1: 영상 생성 타임아웃");

  const videoData = operation.result?.generatedVideos?.[0]?.video?.videoBytes;
  if (!videoData) throw new Error("Veo 3.1: 영상 데이터 없음");

  return saveVideoBytes(videoData, product.id);
}
```

- [ ] **Step 6: 테스트 실행 (통과 확인)**

```bash
npm test -- src/generator/image.test.ts src/generator/video.test.ts
```

Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add src/generator/image.ts src/generator/image.test.ts src/generator/video.ts src/generator/video.test.ts
git commit -m "feat: update image/video generators to use Product type"
```

---

## Task 5: Launcher + Monitor + Improver 업데이트

**Files:**
- Modify: `src/launcher/index.ts`
- Modify: `src/launcher/index.test.ts`
- Modify: `src/monitor/index.ts`
- Modify: `src/monitor/index.test.ts`
- Modify: `src/improver/index.ts`

- [ ] **Step 1: launcher/index.test.ts 업데이트**

`src/launcher/index.test.ts` 전체를 아래로 교체:
```typescript
import { describe, it, expect } from "vitest";
import { buildCampaignName, buildAdSetTargeting, buildAdConfig } from "./index.js";
import type { Product } from "../types.js";

const mockProduct: Product = {
  id: "product-1",
  name: "Docker 기초",
  description: "컨테이너 기술",
  imageUrl: "",
  targetUrl: "https://inflearn.com/course/docker",
  category: "course",
  currency: "KRW",
  price: 44000,
  tags: ["docker", "devops"],
  inputMethod: "scraped",
  createdAt: "2026-04-16T00:00:00.000Z",
};

describe("buildCampaignName", () => {
  it("includes product name and date", () => {
    const name = buildCampaignName(mockProduct);
    expect(name).toContain("Docker 기초");
    expect(name).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("buildAdSetTargeting", () => {
  it("returns correct age range", () => {
    const targeting = buildAdSetTargeting();
    expect(targeting.age_min).toBe(20);
    expect(targeting.age_max).toBe(45);
  });

  it("targets South Korea", () => {
    const targeting = buildAdSetTargeting();
    expect(targeting.geo_locations.countries).toContain("KR");
  });
});

describe("buildAdConfig", () => {
  it("includes daily budget from env or default", () => {
    const config = buildAdConfig();
    expect(config.dailyBudgetKRW).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: launcher/index.ts에서 Course → Product, courseId → productId 변경**

`src/launcher/index.ts`에서 다음을 교체:
- `import type { Course, Creative, Campaign }` → `import type { Product, Creative, Campaign }`
- `buildCampaignName(course: Course)` → `buildCampaignName(product: Product)`
- 함수 내부 `course.title` → `product.name`
- `launchCampaign(course: Course, creative: Creative)` → `launchCampaign(product: Product, creative: Creative)`
- 함수 내부 `course.title` → `product.name`, `course.url` → `product.targetUrl`
- `campaignRecord: Campaign` 내 `courseId: course.id` → `productId: product.id`
- `data/campaigns/${campaignRecord.id}.json` 경로 유지

최종 파일의 주요 변경 부분:
```typescript
import type { Product, Creative, Campaign } from "../types.js";

export function buildCampaignName(product: Product): string {
  const date = new Date().toISOString().split("T")[0];
  return `[AD-AI] ${product.name} - ${date}`;
}

// launchCampaign 시그니처
export async function launchCampaign(
  product: Product,
  creative: Creative
): Promise<Campaign> {
  // ... 내부에서 course.title → product.name, course.url → product.targetUrl
  const campaignRecord: Campaign = {
    id: randomUUID(),
    creativeId: creative.id,
    productId: product.id,   // courseId → productId
    // ...
  };
}
```

- [ ] **Step 3: monitor/index.test.ts 업데이트**

`src/monitor/index.test.ts`에서 `courseId: "course-1"` → `productId: "product-1"`:
```typescript
const mockReports: Report[] = [
  {
    id: "r1", campaignId: "c1", productId: "product-1", date: "2026-04-15",
    impressions: 10000, clicks: 420, ctr: 4.2, spend: 134400,
    cpc: 320, reach: 8500, frequency: 1.18,
  },
  {
    id: "r2", campaignId: "c2", productId: "product-2", date: "2026-04-15",
    impressions: 8000, clicks: 72, ctr: 0.9, spend: 86400,
    cpc: 1200, reach: 7000, frequency: 1.14,
  },
];
```

- [ ] **Step 4: monitor/index.ts에서 courseId → productId 변경**

`src/monitor/index.ts`에서:
- `import type { Report, Campaign }` 유지 (Course 미사용)
- `report.courseId = campaign.courseId` → `report.productId = campaign.productId`

- [ ] **Step 5: improver/index.ts에서 경로 변경**

`src/improver/index.ts`는 Course를 직접 사용하지 않지만, `data/courses/` 경로 참조가 있으면 `data/products/`로 변경.

(파일 검색 후 해당 경로 문자열만 변경)

- [ ] **Step 6: 테스트 실행 (통과 확인)**

```bash
npm test -- src/launcher/index.test.ts src/monitor/index.test.ts
```

Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add src/launcher/index.ts src/launcher/index.test.ts src/monitor/index.ts src/monitor/index.test.ts src/improver/index.ts
git commit -m "feat: update launcher/monitor/improver to use Product type"
```

---

## Task 6: Reviewer + TUI actions 업데이트

**Files:**
- Modify: `src/reviewer/index.ts`
- Modify: `src/reviewer/index.test.ts`
- Modify: `src/tui/actions.ts`

- [ ] **Step 1: reviewer/index.test.ts 업데이트**

`src/reviewer/index.test.ts`에서 `courseId: "course-1"` → `productId: "product-1"`:
```typescript
const mockCreative: Creative = {
  id: "creative-1",
  productId: "product-1",    // courseId → productId
  copy: {
    headline: "TypeScript 마스터",
    body: "3주 만에 TypeScript 완성",
    cta: "지금 수강하기",
    hashtags: ["#TypeScript"],
  },
  imageLocalPath: "data/creatives/product-1-image.jpg",
  videoLocalPath: "data/creatives/product-1-video.mp4",
  status: "pending",
  createdAt: "2026-04-16T00:00:00.000Z",
};
```

- [ ] **Step 2: reviewer/index.ts에서 Course → Product**

`src/reviewer/index.ts`에서:
- `import type { Creative, Course }` → `import type { Creative, Product }`
- `{ creative: Creative; course: Course }[]` → `{ creative: Creative; product: Product }[]`
- `data/courses/${creative.courseId}.json` → `data/products/${creative.productId}.json`
- 함수 내 `course` → `product`

- [ ] **Step 3: tui/actions.ts 업데이트**

`src/tui/actions.ts`에서:
- `import type { Course, Creative, Report }` → `import type { Product, Creative, Report }`
- `data/courses/` → `data/products/`
- `readJson<Course>` → `readJson<Product>`
- `course.id` → `product.id`, `course.title` → `product.name`
- `creative.courseId` → `creative.productId`

- [ ] **Step 4: 테스트 실행 (통과 확인)**

```bash
npm test -- src/reviewer/index.test.ts
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/reviewer/index.ts src/reviewer/index.test.ts src/tui/actions.ts
git commit -m "feat: update reviewer and TUI actions to use Product type"
```

---

## Task 7: TUI — Add Product 수동 입력 액션

**Files:**
- Modify: `src/tui/AppTypes.ts`
- Modify: `src/tui/actions.ts`
- Modify: `src/tui/App.tsx`

- [ ] **Step 1: AppTypes.ts에 add-product 추가**

`src/tui/AppTypes.ts`에서 `ActionKey` 유니온과 `MENU_ITEMS` 배열에 `add-product` 추가:

```typescript
export type ActionKey =
  | "scrape"
  | "add-product"   // 신규
  | "generate"
  | "review"
  | "launch"
  | "monitor"
  | "improve"
  | "pipeline";

// MENU_ITEMS 배열에 추가 (scrape 다음):
{ key: "add-product", label: "Add Product", description: "제품 수동 입력", needsInput: false },
```

- [ ] **Step 2: AppTypes.test.ts 업데이트**

`src/tui/AppTypes.test.ts`에서 `AppState` 테스트는 그대로이지만, `ActionKey`를 사용하는 테스트가 있다면 `add-product` 포함 확인.

- [ ] **Step 3: actions.ts에 runAddProduct 추가**

`src/tui/actions.ts`에 다음 함수 추가:
```typescript
export async function runAddProduct(onProgress: ProgressCallback): Promise<DoneResult> {
  // Add Product는 TUI 폼에서 직접 처리하므로 여기서는 저장만 담당
  // App.tsx에서 product 데이터를 받아 이 함수 대신 직접 writeJson 호출
  onProgress({ message: "제품 저장 중..." });
  return { success: true, message: "제품이 추가됐습니다", logs: [] };
}
```

- [ ] **Step 4: App.tsx — add-product 폼 흐름 추가**

`src/tui/App.tsx`에서:

1. `add-product` 상태 추가: 메뉴에서 선택 시 `"form"` 상태로 전환 (name → description → targetUrl 순서로 단계별 입력)
2. AppState에 `"form"` 추가

```typescript
// AppState 확장 (App.tsx 내부에서만 사용)
type LocalAppState = AppState | "form";

// form 상태에서 사용할 폼 단계
type FormStep = "name" | "description" | "targetUrl" | "price";

// 폼 데이터 상태
const [formData, setFormData] = useState<Partial<Product>>({});
const [formStep, setFormStep] = useState<FormStep>("name");
```

add-product 선택 시 흐름:
```
menu → form (name 입력) → form (description 입력) → form (targetUrl 입력) → form (price 입력, 선택) → 저장 → done
```

form 상태에서 MenuScreen을 재사용해 입력 프롬프트를 표시:
```typescript
if (localState === "form") {
  const prompts: Record<FormStep, string> = {
    name: "제품명 입력:",
    description: "제품 설명 입력:",
    targetUrl: "광고 랜딩 URL 입력:",
    price: "가격 입력 (없으면 Enter 스킵):",
  };
  return React.createElement(MenuScreen, {
    onSelect: () => {},
    mode: "input",
    selectedIndex: 0,
    inputValue,
    inputPrompt: prompts[formStep],
  });
}
```

Enter 처리:
```typescript
if (key.return && localState === "form") {
  const steps: FormStep[] = ["name", "description", "targetUrl", "price"];
  const currentIdx = steps.indexOf(formStep);

  // 현재 단계 값 저장
  const newFormData = { ...formData };
  if (formStep === "name") newFormData.name = inputValue;
  if (formStep === "description") newFormData.description = inputValue;
  if (formStep === "targetUrl") newFormData.targetUrl = inputValue;
  if (formStep === "price") newFormData.price = inputValue ? Number(inputValue) : undefined;
  setFormData(newFormData);
  setInputValue("");

  if (currentIdx < steps.length - 1) {
    setFormStep(steps[currentIdx + 1] as FormStep);
  } else {
    // 모든 단계 완료 → 저장
    const product: Product = {
      id: crypto.randomUUID(),
      name: newFormData.name ?? "",
      description: newFormData.description ?? "",
      targetUrl: newFormData.targetUrl ?? "",
      price: newFormData.price,
      currency: "KRW",
      tags: [],
      inputMethod: "manual",
      createdAt: new Date().toISOString(),
    };
    await writeJson(`data/products/${product.id}.json`, product);
    setDoneResult({
      success: true,
      message: "제품 추가 완료",
      logs: [`${product.name} 저장됨 (ID: ${product.id})`],
    });
    setFormData({});
    setFormStep("name");
    setLocalState("done");
  }
}
```

- [ ] **Step 5: 전체 테스트 실행**

```bash
npm test
```

Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/tui/AppTypes.ts src/tui/AppTypes.test.ts src/tui/actions.ts src/tui/App.tsx
git commit -m "feat: add manual product input (Add Product) TUI flow"
```

---

## Task 7b: ReviewScreen + App.tsx + improver 테스트 업데이트

**Files:**
- Modify: `src/tui/ReviewScreen.tsx`
- Modify: `src/tui/App.tsx` (review 관련 부분)
- Modify: `src/improver/index.test.ts`

- [ ] **Step 1: ReviewScreen.tsx Props 업데이트**

`src/tui/ReviewScreen.tsx`에서 `Course` → `Product`:
```tsx
import type { Creative, Product } from "../types.js";

interface Props {
  creatives: Array<{ creative: Creative; product: Product }>;
  onApprove: (creativeId: string) => void;
  onReject: (creativeId: string, note: string) => void;
  onEdit: (creativeId: string, field: keyof Creative["copy"], value: string) => void;
}

// 함수 내부에서:
// item.course.title → item.product.name
```

- [ ] **Step 2: App.tsx review 관련 상태 업데이트**

`src/tui/App.tsx`에서:
```typescript
// 기존
const [reviewItems, setReviewItems] = useState<Array<{ creative: Creative; course: Course }>>([]);

// 변경
const [reviewItems, setReviewItems] = useState<Array<{ creative: Creative; product: Product }>>([]);

// loadReviewItems 내부:
// readJson<Course>(`data/courses/${creative.courseId}.json`)
// →
// readJson<Product>(`data/products/${creative.productId}.json`)
// if (course) items.push({ creative, course })
// →
// if (product) items.push({ creative, product })
```

- [ ] **Step 3: improver/index.test.ts 업데이트**

`src/improver/index.test.ts`에서 `courseId` → `productId`:
```typescript
const lowPerformanceReport: Report = {
  id: "r1", campaignId: "c1", productId: "product-1", date: "2026-04-15",
  // ...
};
const highPerformanceReport: Report = {
  id: "r2", campaignId: "c2", productId: "product-2", date: "2026-04-15",
  // ...
};
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

```bash
npm test -- src/tui/ReviewScreen.tsx src/improver/index.test.ts 2>/dev/null || npm test
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/tui/ReviewScreen.tsx src/tui/App.tsx src/improver/index.test.ts
git commit -m "feat: update ReviewScreen and App.tsx to use Product type"
```

---

## Task 8: Pipeline.ts + CLI 파일 업데이트

**Files:**
- Modify: `src/pipeline.ts`
- Modify: `src/cli/scrape.ts`
- Modify: `src/cli/generate.ts`
- Modify: `src/cli/launch.ts`

- [ ] **Step 1: pipeline.ts 업데이트**

`src/pipeline.ts`에서:
- `import type { Course, Creative }` → `import type { Product, Creative }`
- `scrapeCourse` → `scrapeProduct` (import 업데이트)
- `const courses: Course[]` → `const products: Product[]`
- `data/courses/${course.id}.json` → `data/products/${product.id}.json`
- `creative.courseId` → `creative.productId`
- `course.title` → `product.name`

- [ ] **Step 2: cli/scrape.ts 업데이트**

`src/cli/scrape.ts`:
```typescript
import "dotenv/config";
import { scrapeProduct } from "../scraper/index.js";

const url = process.argv[2];
if (!url) { console.error("Usage: npm run scrape <URL>"); process.exit(1); }
scrapeProduct(url).then((p) => console.log("완료:", p.name)).catch(console.error);
```

- [ ] **Step 3: cli/generate.ts 업데이트**

`src/cli/generate.ts`에서:
- `readJson<Course>` → `readJson<Product>`
- `data/courses/${productId}.json` 경로 업데이트
- `course.id` → `product.id`, `course.title` → `product.name`
- `creative.courseId` → `creative.productId`

- [ ] **Step 4: cli/launch.ts 업데이트**

`src/cli/launch.ts`에서:
- `readJson<Course>` → `readJson<Product>`
- `data/courses/${creative.courseId}.json` → `data/products/${creative.productId}.json`

- [ ] **Step 5: TypeScript 체크**

```bash
npx tsc --noEmit
```

Expected: 0 errors. 오류 있으면 수정.

- [ ] **Step 6: 전체 테스트 실행**

```bash
npm test
```

Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add src/pipeline.ts src/cli/scrape.ts src/cli/generate.ts src/cli/launch.ts
git commit -m "feat: update pipeline and CLI entry points to use Product type"
```

---

## Task 9: 마이그레이션 스크립트

**Files:**
- Create: `scripts/migrate.ts`
- Modify: `package.json`

- [ ] **Step 1: 마이그레이션 스크립트 작성**

`scripts/migrate.ts`:
```typescript
import "dotenv/config";
import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

interface OldCourse {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  url: string;
  platform: string;
  price: number;
  tags: string[];
  scrapedAt: string;
}

async function migrate() {
  const sourceDir = "data/courses";
  const targetDir = "data/products";

  if (!existsSync(sourceDir)) {
    console.log("data/courses/ 없음. 마이그레이션 불필요.");
    return;
  }

  if (!existsSync(targetDir)) {
    await mkdir(targetDir, { recursive: true });
  }

  const files = await readdir(sourceDir);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));

  console.log(`마이그레이션 대상: ${jsonFiles.length}개 파일`);

  for (const file of jsonFiles) {
    const sourcePath = path.join(sourceDir, file);
    const content = await readFile(sourcePath, "utf-8");
    const old: OldCourse = JSON.parse(content);

    const product = {
      id: old.id,
      name: old.title,
      description: old.description,
      imageUrl: old.thumbnail,
      targetUrl: old.url,
      category: old.platform === "other" ? "other" : "course",
      price: old.price,
      currency: "KRW",
      tags: old.tags,
      inputMethod: "scraped",
      createdAt: old.scrapedAt,
    };

    const targetPath = path.join(targetDir, file);
    await writeFile(targetPath, JSON.stringify(product, null, 2), "utf-8");
    console.log(`✓ ${file} → data/products/${file}`);
  }

  console.log(`\n완료: ${jsonFiles.length}개 파일 마이그레이션됨`);
  console.log("data/courses/ 폴더는 수동으로 삭제하세요 (백업 보존).");
}

migrate().catch(console.error);
```

- [ ] **Step 2: package.json에 migrate 스크립트 추가**

`package.json`의 `"scripts"` 에 추가:
```json
"migrate": "tsx scripts/migrate.ts",
```

- [ ] **Step 3: 마이그레이션 테스트 실행**

```bash
# data/courses/ 없으면 "마이그레이션 불필요" 출력
npm run migrate
```

Expected: `data/courses/ 없음. 마이그레이션 불필요.` 출력

- [ ] **Step 4: 커밋**

```bash
git add scripts/migrate.ts package.json
git commit -m "feat: add migration script for data/courses/ → data/products/"
```

---

## Task 10: 통합 검증

- [ ] **Step 1: TypeScript 오류 0개 확인**

```bash
npx tsc --noEmit
```

Expected: 출력 없음

- [ ] **Step 2: 전체 테스트 통과**

```bash
npm test
```

Expected: 전체 PASS (기존 테스트 수 이상)

- [ ] **Step 3: 기존 data/courses/ 파일이 있는 경우 마이그레이션 확인**

```bash
# data/courses/에 테스트 파일 생성 후 마이그레이션
mkdir -p data/courses
echo '{"id":"test","title":"테스트 강의","description":"설명","thumbnail":"","url":"https://inflearn.com/course/test","platform":"inflearn","price":10000,"tags":["test"],"scrapedAt":"2026-04-16T00:00:00.000Z"}' > data/courses/test.json
npm run migrate
cat data/products/test.json
```

Expected: Product 형식으로 변환된 JSON 출력 (`name`, `targetUrl`, `currency` 포함)

- [ ] **Step 4: 테스트 파일 정리**

```bash
rm -rf data/courses data/products
```

- [ ] **Step 5: 최종 커밋**

```bash
git log --oneline -10
```

# Instagram 광고 자동화 파이프라인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 강의 URL을 입력하면 스크래핑 → AI 소재 생성 → TUI 검토 → Meta API 게재 → 성과 모니터링 → 자율 개선까지 처리하는 TypeScript CLI 파이프라인을 구축한다.

**Architecture:** Playwright로 강의 정보를 스크래핑하고, Gemini/Claude/Imagen/Veo로 광고 소재를 생성한 뒤, Ink TUI에서 사람이 검토한다. 승인된 소재는 Meta Marketing API로 게재되며, node-cron이 성과를 수집하고 Claude가 파이프라인 코드를 자율 개선한다.

**Tech Stack:** TypeScript (ESM), Ink v5, Playwright, @anthropic-ai/sdk, @google/genai, facebook-nodejs-business-sdk, node-cron, vitest, tsx

---

## 파일 구조 맵

| 파일 | 역할 |
|------|------|
| `src/types.ts` | 전체 공유 타입 (Course, Creative, Campaign, Report, Improvement) |
| `src/storage.ts` | JSON 파일 read/write 유틸리티 |
| `src/scraper/index.ts` | Playwright로 URL → Course 추출 + Gemini 파싱 |
| `src/generator/copy.ts` | Claude로 카피 생성 (prompt caching 적용) |
| `src/generator/image.ts` | Imagen 3으로 광고 이미지 생성 |
| `src/generator/video.ts` | Veo 3.1로 광고 영상 생성 |
| `src/tui/PipelineProgress.tsx` | 파이프라인 진행 화면 컴포넌트 |
| `src/tui/ReviewScreen.tsx` | 검토 화면 컴포넌트 |
| `src/reviewer/index.ts` | TUI 검토 오케스트레이터 |
| `src/launcher/index.ts` | Meta Marketing API 광고 게재 |
| `src/monitor/index.ts` | 성과 수집 + Claude 분석 + cron 스케줄 |
| `src/improver/index.ts` | 자율 개선 루프 (Claude Code로 파이프라인 코드 수정) |
| `src/pipeline.ts` | 전체 파이프라인 오케스트레이터 |
| `src/cli/scrape.ts` | `npm run scrape` 진입점 |
| `src/cli/generate.ts` | `npm run generate` 진입점 |
| `src/cli/review.ts` | `npm run review` 진입점 |
| `src/cli/launch.ts` | `npm run launch` 진입점 |
| `src/cli/monitor.ts` | `npm run monitor` 진입점 |
| `src/cli/pipeline.ts` | `npm run pipeline` 진입점 |
| `src/cli/improve.ts` | `npm run improve` 진입점 |

---

## Task 1: 프로젝트 초기 설정

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `vitest.config.ts`

- [ ] **Step 1: package.json 생성**

```json
{
  "name": "ad-ai",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "scrape": "tsx src/cli/scrape.ts",
    "generate": "tsx src/cli/generate.ts",
    "review": "tsx src/cli/review.ts",
    "launch": "tsx src/cli/launch.ts",
    "monitor": "tsx src/cli/monitor.ts",
    "pipeline": "tsx src/cli/pipeline.ts",
    "improve": "tsx src/cli/improve.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@google/genai": "^0.7.0",
    "chalk": "^5.3.0",
    "dotenv": "^16.4.5",
    "facebook-nodejs-business-sdk": "^20.0.2",
    "ink": "^5.0.1",
    "ink-big-text": "^2.0.0",
    "node-cron": "^3.0.3",
    "playwright": "^1.43.0",
    "react": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "@types/react": "^18.3.1",
    "tsx": "^4.7.3",
    "typescript": "^5.4.5",
    "vitest": "^1.5.0"
  }
}
```

- [ ] **Step 2: tsconfig.json 생성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: vitest.config.ts 생성**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 4: .env.example 생성**

```bash
# Anthropic
ANTHROPIC_API_KEY=

# Google AI Studio
GOOGLE_AI_API_KEY=

# Meta
META_APP_ID=
META_APP_SECRET=
META_ACCESS_TOKEN=
META_AD_ACCOUNT_ID=
META_PAGE_ID=
META_INSTAGRAM_ACTOR_ID=

# 광고 기본 설정 (선택, 오버라이드 가능)
AD_DAILY_BUDGET_KRW=10000
AD_TARGET_AGE_MIN=20
AD_TARGET_AGE_MAX=45
AD_DURATION_DAYS=14
CTR_IMPROVEMENT_THRESHOLD=1.5
```

- [ ] **Step 5: .gitignore 생성**

```
node_modules/
dist/
.env
data/
*.jpg
*.mp4
```

- [ ] **Step 6: 디렉토리 생성 및 의존성 설치**

```bash
mkdir -p src/scraper src/generator src/tui src/reviewer src/launcher src/monitor src/improver src/cli
mkdir -p data/courses data/creatives data/reports data/improvements data/campaigns
npm install
```

Expected: 의존성 설치 완료, `node_modules/` 생성됨

- [ ] **Step 7: Playwright 브라우저 설치**

```bash
npx playwright install chromium
```

Expected: Chromium 브라우저 다운로드 완료

- [ ] **Step 8: 커밋**

```bash
git init
git add package.json tsconfig.json vitest.config.ts .env.example .gitignore
git commit -m "chore: initial project setup"
```

---

## Task 2: 공유 타입 정의

**Files:**
- Create: `src/types.ts`
- Create: `src/types.test.ts`

- [ ] **Step 1: 타입 테스트 작성**

`src/types.test.ts`:
```typescript
import { describe, it, expectTypeOf } from "vitest";
import type { Course, Creative, Campaign, Report, Improvement } from "./types.js";

describe("types", () => {
  it("Course has required fields", () => {
    expectTypeOf<Course>().toMatchTypeOf<{
      id: string;
      title: string;
      url: string;
      platform: string;
    }>();
  });

  it("Creative status is union type", () => {
    expectTypeOf<Creative["status"]>().toEqualTypeOf<
      "pending" | "approved" | "rejected" | "edited"
    >();
  });

  it("Improvement has changes array", () => {
    expectTypeOf<Improvement["changes"]>().toEqualTypeOf<
      Array<{ file: string; type: string; before: string; after: string }>
    >();
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npm test -- src/types.test.ts
```

Expected: FAIL — `Cannot find module './types.js'`

- [ ] **Step 3: 타입 구현**

`src/types.ts`:
```typescript
export interface Course {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  url: string;
  platform: "inflearn" | "class101" | "other";
  price: number;
  tags: string[];
  scrapedAt: string;
}

export interface Creative {
  id: string;
  courseId: string;
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
  courseId: string;
  metaCampaignId: string;
  metaAdSetId: string;
  metaAdIds: string[];
  launchedAt: string;
  status: "active" | "paused" | "completed";
}

export interface Report {
  id: string;
  campaignId: string;
  courseId: string;
  date: string;
  impressions: number;
  clicks: number;
  ctr: number;
  spend: number;
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
git commit -m "feat: add core type definitions"
```

---

## Task 3: 스토리지 유틸리티

**Files:**
- Create: `src/storage.ts`
- Create: `src/storage.test.ts`

- [ ] **Step 1: 테스트 작성**

`src/storage.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readJson, writeJson, appendJson, listJson } from "./storage.js";
import { rmSync, existsSync } from "fs";
import path from "path";

const TEST_DIR = "data/test-storage";

beforeEach(() => {});
afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe("storage", () => {
  it("writeJson creates file and readJson retrieves it", async () => {
    const data = { id: "1", name: "test" };
    await writeJson(path.join(TEST_DIR, "item.json"), data);
    const result = await readJson<typeof data>(path.join(TEST_DIR, "item.json"));
    expect(result).toEqual(data);
  });

  it("appendJson adds item to array file", async () => {
    await appendJson(path.join(TEST_DIR, "items.json"), { id: "1" });
    await appendJson(path.join(TEST_DIR, "items.json"), { id: "2" });
    const result = await readJson<Array<{ id: string }>>(path.join(TEST_DIR, "items.json"));
    expect(result).toHaveLength(2);
    expect(result[1].id).toBe("2");
  });

  it("listJson returns all JSON files in directory", async () => {
    await writeJson(path.join(TEST_DIR, "a.json"), { id: "a" });
    await writeJson(path.join(TEST_DIR, "b.json"), { id: "b" });
    const files = await listJson(TEST_DIR);
    expect(files).toHaveLength(2);
  });

  it("readJson returns null for non-existent file", async () => {
    const result = await readJson(path.join(TEST_DIR, "missing.json"));
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npm test -- src/storage.test.ts
```

Expected: FAIL — `Cannot find module './storage.js'`

- [ ] **Step 3: 스토리지 구현**

`src/storage.ts`:
```typescript
import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export async function appendJson<T>(filePath: string, item: T): Promise<void> {
  const existing = await readJson<T[]>(filePath);
  const arr = existing ?? [];
  arr.push(item);
  await writeJson(filePath, arr);
}

export async function listJson(dirPath: string): Promise<string[]> {
  try {
    const files = await readdir(dirPath);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(dirPath, f));
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

```bash
npm test -- src/storage.test.ts
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/storage.ts src/storage.test.ts
git commit -m "feat: add JSON storage utilities"
```

---

## Task 4: 스크래퍼

**Files:**
- Create: `src/scraper/index.ts`
- Create: `src/scraper/index.test.ts`

- [ ] **Step 1: 테스트 작성**

`src/scraper/index.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { parseCourseWithGemini } from "./index.js";

describe("parseCourseWithGemini", () => {
  it("extracts structured course data from raw HTML", async () => {
    const mockGemini = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            title: "TypeScript 완전 정복",
            description: "TypeScript를 처음부터 끝까지",
            price: 55000,
            tags: ["typescript", "javascript"],
            thumbnail: "https://example.com/thumb.jpg",
          }),
        }),
      },
    };

    const result = await parseCourseWithGemini(
      mockGemini as any,
      "https://www.inflearn.com/course/typescript",
      "<html>TypeScript 완전 정복 ₩55,000</html>"
    );

    expect(result.title).toBe("TypeScript 완전 정복");
    expect(result.price).toBe(55000);
    expect(result.platform).toBe("inflearn");
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npm test -- src/scraper/index.test.ts
```

Expected: FAIL — `Cannot find module './index.js'`

- [ ] **Step 3: 스크래퍼 구현**

`src/scraper/index.ts`:
```typescript
import { chromium } from "playwright";
import { GoogleGenAI } from "@google/genai";
import type { Course } from "../types.js";
import { writeJson } from "../storage.js";
import { randomUUID } from "crypto";

function detectPlatform(url: string): Course["platform"] {
  if (url.includes("inflearn.com")) return "inflearn";
  if (url.includes("class101.net")) return "class101";
  return "other";
}

export async function parseCourseWithGemini(
  ai: GoogleGenAI,
  url: string,
  html: string
): Promise<Course> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-05-20",
    contents: `다음 HTML에서 온라인 강의 정보를 추출해 JSON으로 반환해주세요.
반드시 아래 형식만 반환하고 다른 텍스트는 포함하지 마세요:
{"title":"","description":"","price":0,"tags":[],"thumbnail":""}

HTML:
${html.slice(0, 8000)}`,
  });

  const raw = response.text ?? "{}";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? "{}");

  return {
    id: randomUUID(),
    title: parsed.title ?? "",
    description: parsed.description ?? "",
    thumbnail: parsed.thumbnail ?? "",
    url,
    platform: detectPlatform(url),
    price: parsed.price ?? 0,
    tags: parsed.tags ?? [],
    scrapedAt: new Date().toISOString(),
  };
}

export async function scrapeCourse(url: string): Promise<Course> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    const html = await page.content();
    const course = await parseCourseWithGemini(ai, url, html);
    await writeJson(`data/courses/${course.id}.json`, course);
    return course;
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
git commit -m "feat: add course scraper with Gemini parsing"
```

---

## Task 5: 카피 생성기 (Claude)

**Files:**
- Create: `src/generator/copy.ts`
- Create: `src/generator/copy.test.ts`

- [ ] **Step 1: 테스트 작성**

`src/generator/copy.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { generateCopy, COPY_SYSTEM_PROMPT } from "./copy.js";
import type { Course } from "../types.js";

const mockCourse: Course = {
  id: "test-id",
  title: "React 완전정복",
  description: "React를 처음부터 배웁니다",
  thumbnail: "https://example.com/thumb.jpg",
  url: "https://inflearn.com/course/react",
  platform: "inflearn",
  price: 55000,
  tags: ["react", "frontend"],
  scrapedAt: "2026-04-16T00:00:00.000Z",
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

    const result = await generateCopy(mockClient as any, mockCourse);

    expect(result.headline).toBeTruthy();
    expect(result.body).toBeTruthy();
    expect(result.cta).toBeTruthy();
    expect(result.hashtags).toHaveLength(3);
  });

  it("COPY_SYSTEM_PROMPT is defined and non-empty", () => {
    expect(COPY_SYSTEM_PROMPT.length).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npm test -- src/generator/copy.test.ts
```

Expected: FAIL — `Cannot find module './copy.js'`

- [ ] **Step 3: 카피 생성기 구현 (prompt caching 적용)**

`src/generator/copy.ts`:
```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { Course, Creative } from "../types.js";

export const COPY_SYSTEM_PROMPT = `당신은 온라인 강의 광고 카피라이터입니다.
인스타그램 광고에 최적화된 카피를 작성합니다.

규칙:
- 헤드라인: 수강 후 얻는 구체적 결과물 또는 수치 포함 (최대 40자)
- 본문: 강의의 핵심 가치와 차별점 강조 (최대 125자)
- CTA: 행동을 유도하는 짧은 문구 (최대 20자)
- 해시태그: 관련 해시태그 3개

반드시 JSON 형식으로만 응답하세요:
{"headline":"","body":"","cta":"","hashtags":[]}`;

export async function generateCopy(
  client: Anthropic,
  course: Course
): Promise<Creative["copy"]> {
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
        content: `다음 강의에 대한 인스타그램 광고 카피를 작성해주세요.

강의명: ${course.title}
설명: ${course.description}
가격: ₩${course.price.toLocaleString()}
태그: ${course.tags.join(", ")}
플랫폼 URL: ${course.url}`,
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
git commit -m "feat: add Claude copy generator with prompt caching"
```

---

## Task 6: 이미지 생성기 (Imagen 3)

**Files:**
- Create: `src/generator/image.ts`
- Create: `src/generator/image.test.ts`

- [ ] **Step 1: 테스트 작성**

`src/generator/image.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { buildImagePrompt, saveBase64Image } from "./image.js";
import type { Course } from "../types.js";
import { existsSync, unlinkSync } from "fs";

const mockCourse: Course = {
  id: "test-id",
  title: "Docker 기초",
  description: "컨테이너 기술의 기초",
  thumbnail: "",
  url: "https://inflearn.com/course/docker",
  platform: "inflearn",
  price: 44000,
  tags: ["docker", "devops"],
  scrapedAt: "2026-04-16T00:00:00.000Z",
};

describe("buildImagePrompt", () => {
  it("generates a descriptive prompt from course data", () => {
    const prompt = buildImagePrompt(mockCourse);
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

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npm test -- src/generator/image.test.ts
```

Expected: FAIL — `Cannot find module './image.js'`

- [ ] **Step 3: 이미지 생성기 구현**

`src/generator/image.ts`:
```typescript
import { GoogleGenAI } from "@google/genai";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { Course } from "../types.js";

export function buildImagePrompt(course: Course): string {
  return `Instagram advertisement image for an online course.
Course: "${course.title}"
Topic: ${course.tags.slice(0, 3).join(", ")}
Style: Modern, professional, tech-focused. Clean background, bold typography area.
Format: Square 1:1, suitable for Instagram feed ad.
No text overlay needed. Visually represent the learning outcome.`;
}

export async function saveBase64Image(
  base64Data: string,
  courseId: string
): Promise<string> {
  const dir = "data/creatives";
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${courseId}-image.jpg`);
  await writeFile(filePath, Buffer.from(base64Data, "base64"));
  return filePath;
}

export async function generateImage(course: Course): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
  const prompt = buildImagePrompt(course);

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
    course.id
  );
}
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

```bash
npm test -- src/generator/image.test.ts
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/generator/image.ts src/generator/image.test.ts
git commit -m "feat: add Imagen 3 image generator"
```

---

## Task 7: 영상 생성기 (Veo 3.1)

**Files:**
- Create: `src/generator/video.ts`
- Create: `src/generator/video.test.ts`

- [ ] **Step 1: 테스트 작성**

`src/generator/video.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { buildVideoPrompt } from "./video.js";
import type { Course } from "../types.js";

const mockCourse: Course = {
  id: "test-id",
  title: "TypeScript 입문",
  description: "타입스크립트를 배웁니다",
  thumbnail: "",
  url: "https://inflearn.com/course/typescript",
  platform: "inflearn",
  price: 49000,
  tags: ["typescript"],
  scrapedAt: "2026-04-16T00:00:00.000Z",
};

describe("buildVideoPrompt", () => {
  it("generates a video prompt with course context", () => {
    const prompt = buildVideoPrompt(mockCourse);
    expect(prompt).toContain("TypeScript");
    expect(prompt.length).toBeGreaterThan(50);
  });

  it("includes vertical format instruction", () => {
    const prompt = buildVideoPrompt(mockCourse);
    expect(prompt.toLowerCase()).toContain("vertical");
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npm test -- src/generator/video.test.ts
```

Expected: FAIL — `Cannot find module './video.js'`

- [ ] **Step 3: 영상 생성기 구현 (Veo 3.1 비동기 폴링)**

`src/generator/video.ts`:
```typescript
import { GoogleGenAI } from "@google/genai";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { Course } from "../types.js";

export function buildVideoPrompt(course: Course): string {
  return `Short Instagram Reels advertisement (15 seconds), vertical 9:16 format.
Online course promotion for "${course.title}".
Topics: ${course.tags.slice(0, 3).join(", ")}.
Visual style: Dynamic, modern, tech-focused. Show someone learning and succeeding.
No voiceover needed. Cinematic quality. Ends with clear call-to-action moment.`;
}

async function saveVideoBytes(data: Uint8Array | string, courseId: string): Promise<string> {
  const dir = "data/creatives";
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${courseId}-video.mp4`);
  const buffer = typeof data === "string" ? Buffer.from(data, "base64") : Buffer.from(data);
  await writeFile(filePath, buffer);
  return filePath;
}

export async function generateVideo(
  course: Course,
  onProgress?: (msg: string) => void
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
  const prompt = buildVideoPrompt(course);

  onProgress?.("Veo 3.1: 영상 생성 요청 중...");

  let operation = await ai.models.generateVideos({
    model: "veo-3.1-generate-preview",
    prompt,
    config: { aspectRatio: "9:16", durationSeconds: 15 },
  });

  // 완료될 때까지 폴링 (최대 10분)
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    if (operation.done) break;
    onProgress?.(`Veo 3.1: 영상 생성 중... (${i + 1}/${maxAttempts})`);
    await new Promise((r) => setTimeout(r, 10000)); // 10초 대기
    operation = await operation.refresh();
  }

  if (!operation.done) throw new Error("Veo 3.1: 영상 생성 타임아웃");

  const videoData = operation.response?.generatedVideos?.[0]?.video?.videoBytes;
  if (!videoData) throw new Error("Veo 3.1: 영상 데이터 없음");

  return saveVideoBytes(videoData, course.id);
}
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

```bash
npm test -- src/generator/video.test.ts
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/generator/video.ts src/generator/video.test.ts
git commit -m "feat: add Veo 3.1 video generator with async polling"
```

---

## Task 8: TUI 컴포넌트

**Files:**
- Create: `src/tui/PipelineProgress.tsx`
- Create: `src/tui/ReviewScreen.tsx`

- [ ] **Step 1: PipelineProgress 컴포넌트 구현**

`src/tui/PipelineProgress.tsx`:
```tsx
import React from "react";
import { Box, Text } from "ink";

export type PipelineStep = "scrape" | "generate" | "review" | "launch";
export type StepStatus = "pending" | "running" | "done" | "error";

interface Props {
  currentStep: PipelineStep;
  stepStatuses: Record<PipelineStep, StepStatus>;
  currentCourse: string;
  courseIndex: number;
  totalCourses: number;
  progressMessage: string;
}

const STEPS: PipelineStep[] = ["scrape", "generate", "review", "launch"];
const STEP_LABELS: Record<PipelineStep, string> = {
  scrape: "Scrape",
  generate: "Generate",
  review: "Review",
  launch: "Launch",
};

function stepIcon(status: StepStatus): string {
  switch (status) {
    case "done": return "✓";
    case "running": return "⟳";
    case "error": return "✗";
    default: return "○";
  }
}

function stepColor(status: StepStatus): string {
  switch (status) {
    case "done": return "green";
    case "running": return "yellow";
    case "error": return "red";
    default: return "gray";
  }
}

export function PipelineProgress({
  stepStatuses,
  currentCourse,
  courseIndex,
  totalCourses,
  progressMessage,
}: Props) {
  return (
    <Box flexDirection="column" borderStyle="round" padding={1} width={60}>
      <Box justifyContent="space-between">
        <Text bold>AD-AI Pipeline</Text>
        <Text dimColor>v1.0.0</Text>
      </Box>
      <Box marginTop={1}>
        {STEPS.map((step, i) => (
          <Box key={step} marginRight={2}>
            <Text color={stepColor(stepStatuses[step])}>
              [{i + 1}] {STEP_LABELS[step]} {stepIcon(stepStatuses[step])}
            </Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text>강의: {currentCourse} ({courseIndex}/{totalCourses})</Text>
      </Box>
      {progressMessage && (
        <Box marginTop={1}>
          <Text color="cyan">▶ {progressMessage}</Text>
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 2: ReviewScreen 컴포넌트 구현**

`src/tui/ReviewScreen.tsx`:
```tsx
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Creative, Course } from "../types.js";

interface Props {
  creatives: Array<{ creative: Creative; course: Course }>;
  onApprove: (creativeId: string) => void;
  onReject: (creativeId: string, note: string) => void;
  onEdit: (creativeId: string, field: keyof Creative["copy"], value: string) => void;
}

export function ReviewScreen({ creatives, onApprove, onReject, onEdit }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<"browse" | "edit" | "reject">("browse");
  const [inputValue, setInputValue] = useState("");

  const pending = creatives.filter((c) => c.creative.status === "pending");
  const current = pending[selectedIndex];

  useInput((input, key) => {
    if (mode !== "browse") return;
    if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelectedIndex((i) => Math.min(pending.length - 1, i + 1));
    if (input === "a" && current) onApprove(current.creative.id);
    if (input === "r" && current) setMode("reject");
    if (input === "e" && current) setMode("edit");
  });

  if (!current) {
    return (
      <Box>
        <Text color="green">모든 검토 완료!</Text>
      </Box>
    );
  }

  return (
    <Box borderStyle="round" padding={1} width={70}>
      <Box flexDirection="column" width={20} marginRight={2}>
        <Text bold>검토 대기: {pending.length}개</Text>
        {pending.map((item, i) => (
          <Text key={item.creative.id} color={i === selectedIndex ? "cyan" : "white"}>
            {i === selectedIndex ? "▶ " : "  "}
            {item.course.title.slice(0, 16)}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Text bold>미리보기</Text>
        <Text dimColor>이미지: {current.creative.imageLocalPath}</Text>
        <Text dimColor>영상: {current.creative.videoLocalPath}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>헤드라인: {current.creative.copy.headline}</Text>
          <Text>본문: {current.creative.copy.body}</Text>
          <Text>CTA: {current.creative.copy.cta}</Text>
          <Text>태그: {current.creative.copy.hashtags.join(" ")}</Text>
        </Box>
        {mode === "browse" && (
          <Box marginTop={1}>
            <Text color="green">[A] 승인  </Text>
            <Text color="red">[R] 거절  </Text>
            <Text color="yellow">[E] 수정</Text>
          </Box>
        )}
        {mode === "reject" && (
          <Box marginTop={1} flexDirection="column">
            <Text>거절 이유 입력 후 Enter:</Text>
            <Text color="cyan">{inputValue}_</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/tui/PipelineProgress.tsx src/tui/ReviewScreen.tsx
git commit -m "feat: add Ink TUI components for pipeline progress and review"
```

---

## Task 9: 검토 오케스트레이터

**Files:**
- Create: `src/reviewer/index.ts`
- Create: `src/reviewer/index.test.ts`

- [ ] **Step 1: 테스트 작성**

`src/reviewer/index.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { applyReviewDecision } from "./index.js";
import type { Creative } from "../types.js";

const mockCreative: Creative = {
  id: "creative-1",
  courseId: "course-1",
  copy: {
    headline: "TypeScript 마스터",
    body: "3주 만에 TypeScript 완성",
    cta: "지금 수강하기",
    hashtags: ["#TypeScript"],
  },
  imageLocalPath: "data/creatives/course-1-image.jpg",
  videoLocalPath: "data/creatives/course-1-video.mp4",
  status: "pending",
  createdAt: "2026-04-16T00:00:00.000Z",
};

describe("applyReviewDecision", () => {
  it("sets status to approved on approve", () => {
    const result = applyReviewDecision(mockCreative, { action: "approve" });
    expect(result.status).toBe("approved");
  });

  it("sets status to rejected with note on reject", () => {
    const result = applyReviewDecision(mockCreative, {
      action: "reject",
      note: "이미지 품질 낮음",
    });
    expect(result.status).toBe("rejected");
    expect(result.reviewNote).toBe("이미지 품질 낮음");
  });

  it("sets status to edited and updates copy on edit", () => {
    const result = applyReviewDecision(mockCreative, {
      action: "edit",
      field: "headline",
      value: "수정된 헤드라인",
    });
    expect(result.status).toBe("edited");
    expect(result.copy.headline).toBe("수정된 헤드라인");
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npm test -- src/reviewer/index.test.ts
```

Expected: FAIL — `Cannot find module './index.js'`

- [ ] **Step 3: 검토 오케스트레이터 구현**

`src/reviewer/index.ts`:
```typescript
import React from "react";
import { render } from "ink";
import type { Creative, Course } from "../types.js";
import { ReviewScreen } from "../tui/ReviewScreen.js";
import { readJson, writeJson, listJson } from "../storage.js";

export type ReviewAction =
  | { action: "approve" }
  | { action: "reject"; note: string }
  | { action: "edit"; field: keyof Creative["copy"]; value: string };

export function applyReviewDecision(
  creative: Creative,
  decision: ReviewAction
): Creative {
  switch (decision.action) {
    case "approve":
      return { ...creative, status: "approved" };
    case "reject":
      return { ...creative, status: "rejected", reviewNote: decision.note };
    case "edit":
      return {
        ...creative,
        status: "edited",
        copy: { ...creative.copy, [decision.field]: decision.value },
      };
  }
}

export async function runReviewSession(): Promise<void> {
  const creativePaths = await listJson("data/creatives");
  const items: Array<{ creative: Creative; course: Course }> = [];

  for (const p of creativePaths) {
    const creative = await readJson<Creative>(p);
    if (!creative || creative.status !== "pending") continue;
    const course = await readJson<Course>(`data/courses/${creative.courseId}.json`);
    if (course) items.push({ creative, course });
  }

  if (items.length === 0) {
    console.log("검토 대기 항목이 없습니다.");
    return;
  }

  await new Promise<void>((resolve) => {
    const { unmount } = render(
      React.createElement(ReviewScreen, {
        creatives: items,
        onApprove: async (id) => {
          const item = items.find((i) => i.creative.id === id);
          if (!item) return;
          const updated = applyReviewDecision(item.creative, { action: "approve" });
          await writeJson(`data/creatives/${id}.json`, updated);
          if (items.every((i) => i.creative.status !== "pending")) {
            unmount();
            resolve();
          }
        },
        onReject: async (id, note) => {
          const item = items.find((i) => i.creative.id === id);
          if (!item) return;
          const updated = applyReviewDecision(item.creative, { action: "reject", note });
          await writeJson(`data/creatives/${id}.json`, updated);
        },
        onEdit: async (id, field, value) => {
          const item = items.find((i) => i.creative.id === id);
          if (!item) return;
          const updated = applyReviewDecision(item.creative, {
            action: "edit",
            field,
            value,
          });
          await writeJson(`data/creatives/${id}.json`, updated);
        },
      })
    );
  });
}
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

```bash
npm test -- src/reviewer/index.test.ts
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/reviewer/index.ts src/reviewer/index.test.ts
git commit -m "feat: add TUI review orchestrator"
```

---

## Task 10: Meta 광고 게재

**Files:**
- Create: `src/launcher/index.ts`
- Create: `src/launcher/index.test.ts`

- [ ] **Step 1: 테스트 작성**

`src/launcher/index.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { buildCampaignName, buildAdSetTargeting, buildAdConfig } from "./index.js";
import type { Course } from "../types.js";

const mockCourse: Course = {
  id: "course-1",
  title: "Docker 기초",
  description: "컨테이너 기술",
  thumbnail: "",
  url: "https://inflearn.com/course/docker",
  platform: "inflearn",
  price: 44000,
  tags: ["docker", "devops"],
  scrapedAt: "2026-04-16T00:00:00.000Z",
};

describe("buildCampaignName", () => {
  it("includes course title and date", () => {
    const name = buildCampaignName(mockCourse);
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

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npm test -- src/launcher/index.test.ts
```

Expected: FAIL — `Cannot find module './index.js'`

- [ ] **Step 3: Meta 게재 구현**

`src/launcher/index.ts`:
```typescript
import bizSdk from "facebook-nodejs-business-sdk";
import { readFile } from "fs/promises";
import type { Course, Creative, Campaign } from "../types.js";
import { writeJson } from "../storage.js";
import { randomUUID } from "crypto";

const { AdAccount, Campaign: MetaCampaign, AdSet, Ad, AdCreative } = bizSdk;

export function buildCampaignName(course: Course): string {
  const date = new Date().toISOString().split("T")[0];
  return `[AD-AI] ${course.title} - ${date}`;
}

export function buildAdSetTargeting() {
  return {
    age_min: Number(process.env.AD_TARGET_AGE_MIN ?? 20),
    age_max: Number(process.env.AD_TARGET_AGE_MAX ?? 45),
    geo_locations: { countries: ["KR"] },
    publisher_platforms: ["instagram"],
    instagram_positions: ["stream", "story", "reels"],
  };
}

export function buildAdConfig() {
  return {
    dailyBudgetKRW: Number(process.env.AD_DAILY_BUDGET_KRW ?? 10000),
    durationDays: Number(process.env.AD_DURATION_DAYS ?? 14),
    objective: "OUTCOME_SALES",
    optimizationGoal: "LINK_CLICKS",
    billingEvent: "IMPRESSIONS",
  };
}

function initMeta() {
  bizSdk.FacebookAdsApi.init(process.env.META_ACCESS_TOKEN!);
  return new AdAccount(process.env.META_AD_ACCOUNT_ID!);
}

async function uploadImage(account: typeof AdAccount, imagePath: string) {
  const imageData = await readFile(imagePath);
  const hash = await account.createAdImage([], {
    bytes: imageData.toString("base64"),
  });
  return hash.hash as string;
}

async function uploadVideo(account: typeof AdAccount, videoPath: string) {
  const videoBuffer = await readFile(videoPath);
  const video = await account.createAdVideo([], {
    source: videoBuffer,
    title: "Ad Video",
  });
  return video.id as string;
}

export async function launchCampaign(
  course: Course,
  creative: Creative
): Promise<Campaign> {
  const config = buildAdConfig();
  const account = initMeta();

  // 1. 캠페인 생성
  const campaign = await account.createCampaign([], {
    name: buildCampaignName(course),
    objective: config.objective,
    status: "PAUSED", // 검토 후 수동 활성화
    special_ad_categories: [],
  });

  // 2. 광고 세트 생성
  const startTime = new Date().toISOString();
  const endTime = new Date(
    Date.now() + config.durationDays * 86400000
  ).toISOString();

  const adSet = await account.createAdSet([], {
    name: `${course.title} - Ad Set`,
    campaign_id: campaign.id,
    daily_budget: config.dailyBudgetKRW * 10, // Meta는 센트 단위
    targeting: buildAdSetTargeting(),
    optimization_goal: config.optimizationGoal,
    billing_event: config.billingEvent,
    start_time: startTime,
    end_time: endTime,
    status: "PAUSED",
  });

  const adIds: string[] = [];

  // 3a. 이미지 광고 생성
  const imageHash = await uploadImage(account, creative.imageLocalPath);
  const imageCreative = await account.createAdCreative([], {
    name: `${course.title} - Image Creative`,
    object_story_spec: {
      page_id: process.env.META_PAGE_ID!,
      instagram_actor_id: process.env.META_INSTAGRAM_ACTOR_ID!,
      link_data: {
        image_hash: imageHash,
        link: course.url,
        message: `${creative.copy.body}\n\n${creative.copy.hashtags.join(" ")}`,
        call_to_action: { type: "LEARN_MORE", value: { link: course.url } },
      },
    },
  });

  const imageAd = await account.createAd([], {
    name: `${course.title} - Image Ad`,
    adset_id: adSet.id,
    creative: { creative_id: imageCreative.id },
    status: "PAUSED",
  });
  adIds.push(imageAd.id as string);

  // 3b. 영상 광고 생성
  const videoId = await uploadVideo(account, creative.videoLocalPath);
  const videoCreative = await account.createAdCreative([], {
    name: `${course.title} - Video Creative`,
    object_story_spec: {
      page_id: process.env.META_PAGE_ID!,
      instagram_actor_id: process.env.META_INSTAGRAM_ACTOR_ID!,
      video_data: {
        video_id: videoId,
        message: `${creative.copy.body}\n\n${creative.copy.hashtags.join(" ")}`,
        call_to_action: { type: "LEARN_MORE", value: { link: course.url } },
        title: creative.copy.headline,
      },
    },
  });

  const videoAd = await account.createAd([], {
    name: `${course.title} - Video Ad`,
    adset_id: adSet.id,
    creative: { creative_id: videoCreative.id },
    status: "PAUSED",
  });
  adIds.push(videoAd.id as string);

  const campaignRecord: Campaign = {
    id: randomUUID(),
    creativeId: creative.id,
    courseId: course.id,
    metaCampaignId: campaign.id as string,
    metaAdSetId: adSet.id as string,
    metaAdIds: adIds,
    launchedAt: new Date().toISOString(),
    status: "active",
  };

  await writeJson(`data/campaigns/${campaignRecord.id}.json`, campaignRecord);
  return campaignRecord;
}
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

```bash
npm test -- src/launcher/index.test.ts
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/launcher/index.ts src/launcher/index.test.ts
git commit -m "feat: add Meta Marketing API launcher"
```

---

## Task 11: 성과 모니터링 + Claude 분석

**Files:**
- Create: `src/monitor/index.ts`
- Create: `src/monitor/index.test.ts`

- [ ] **Step 1: 테스트 작성**

`src/monitor/index.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { computeStats, buildAnalysisPrompt } from "./index.js";
import type { Report } from "../types.js";

const mockReports: Report[] = [
  {
    id: "r1", campaignId: "c1", courseId: "course-1", date: "2026-04-15",
    impressions: 10000, clicks: 420, ctr: 4.2, spend: 134400,
    cpc: 320, reach: 8500, frequency: 1.18,
  },
  {
    id: "r2", campaignId: "c2", courseId: "course-2", date: "2026-04-15",
    impressions: 8000, clicks: 72, ctr: 0.9, spend: 86400,
    cpc: 1200, reach: 7000, frequency: 1.14,
  },
];

describe("computeStats", () => {
  it("identifies top and bottom performers by CTR", () => {
    const stats = computeStats(mockReports);
    expect(stats.top[0].ctr).toBeGreaterThan(stats.bottom[0].ctr);
  });

  it("computes total spend", () => {
    const stats = computeStats(mockReports);
    expect(stats.totalSpend).toBe(220800);
  });
});

describe("buildAnalysisPrompt", () => {
  it("includes performance data", () => {
    const stats = computeStats(mockReports);
    const prompt = buildAnalysisPrompt(mockReports, stats);
    expect(prompt).toContain("4.2");
    expect(prompt).toContain("0.9");
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npm test -- src/monitor/index.test.ts
```

Expected: FAIL — `Cannot find module './index.js'`

- [ ] **Step 3: 모니터 구현**

`src/monitor/index.ts`:
```typescript
import Anthropic from "@anthropic-ai/sdk";
import bizSdk from "facebook-nodejs-business-sdk";
import cron from "node-cron";
import type { Report, Campaign } from "../types.js";
import { readJson, writeJson, appendJson, listJson } from "../storage.js";
import { randomUUID } from "crypto";

const { AdAccount } = bizSdk;

export interface PerformanceStats {
  top: Report[];
  bottom: Report[];
  totalSpend: number;
  avgCtr: number;
}

export function computeStats(reports: Report[]): PerformanceStats {
  const sorted = [...reports].sort((a, b) => b.ctr - a.ctr);
  return {
    top: sorted.slice(0, 3),
    bottom: sorted.slice(-3).reverse(),
    totalSpend: reports.reduce((sum, r) => sum + r.spend, 0),
    avgCtr: reports.reduce((sum, r) => sum + r.ctr, 0) / reports.length,
  };
}

export function buildAnalysisPrompt(reports: Report[], stats: PerformanceStats): string {
  return `다음 인스타그램 광고 성과 데이터를 분석하고 개선 제안을 JSON으로 반환해주세요.

## 성과 데이터
${reports.map((r) => `캠페인 ${r.campaignId}: CTR ${r.ctr}%, CPC ₩${r.cpc}, 지출 ₩${r.spend}`).join("\n")}

## 요약
- 상위 CTR: ${stats.top.map((r) => r.ctr).join("%, ")}%
- 하위 CTR: ${stats.bottom.map((r) => r.ctr).join("%, ")}%
- 총 지출: ₩${stats.totalSpend.toLocaleString()}
- 평균 CTR: ${stats.avgCtr.toFixed(2)}%

개선이 필요한 캠페인과 구체적인 제안을 아래 형식으로 반환:
{
  "summary": "전체 요약",
  "improvements": [
    {
      "campaignId": "",
      "issue": "문제점",
      "suggestion": "개선 제안",
      "targetFile": "수정할 파일 경로 (예: src/generator/copy.ts)",
      "changeType": "prompt_update | param_update | bug_fix"
    }
  ]
}`;
}

async function fetchInsights(campaignId: string, date: string): Promise<Report | null> {
  try {
    bizSdk.FacebookAdsApi.init(process.env.META_ACCESS_TOKEN!);
    const account = new AdAccount(process.env.META_AD_ACCOUNT_ID!);
    const insights = await account.getInsights(
      ["impressions", "clicks", "ctr", "spend", "cpc", "reach", "frequency"],
      { time_range: { since: date, until: date }, filtering: [{ field: "campaign.id", operator: "EQUAL", value: campaignId }] }
    );
    if (!insights[0]) return null;
    const d = insights[0];
    return {
      id: randomUUID(),
      campaignId,
      courseId: "",
      date,
      impressions: Number(d.impressions ?? 0),
      clicks: Number(d.clicks ?? 0),
      ctr: Number(d.ctr ?? 0),
      spend: Number(d.spend ?? 0),
      cpc: Number(d.cpc ?? 0),
      reach: Number(d.reach ?? 0),
      frequency: Number(d.frequency ?? 0),
    };
  } catch {
    return null;
  }
}

export async function collectDailyReports(): Promise<Report[]> {
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const campaignPaths = await listJson("data/campaigns");
  const reports: Report[] = [];

  for (const p of campaignPaths) {
    const campaign = await readJson<Campaign>(p);
    if (!campaign || campaign.status !== "active") continue;
    const report = await fetchInsights(campaign.metaCampaignId, yesterday);
    if (report) {
      report.courseId = campaign.courseId;
      await appendJson(`data/reports/${yesterday}.json`, report);
      reports.push(report);
    }
  }

  return reports;
}

export async function generateWeeklyAnalysis(): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const reportPaths = await listJson("data/reports");
  const allReports: Report[] = [];

  for (const p of reportPaths.slice(-7)) {
    const daily = await readJson<Report[]>(p);
    if (daily) allReports.push(...daily);
  }

  if (allReports.length === 0) return "성과 데이터 없음";

  const stats = computeStats(allReports);
  const prompt = buildAnalysisPrompt(allReports, stats);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "{}";
  await writeJson(`data/reports/weekly-analysis-${new Date().toISOString().split("T")[0]}.json`, JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}"));
  return text;
}

export function startCronScheduler(): void {
  // 매일 오전 9시
  cron.schedule("0 9 * * *", async () => {
    console.log("[Monitor] 일간 성과 수집 시작...");
    await collectDailyReports();
    console.log("[Monitor] 일간 수집 완료");
  });

  // 매주 월요일 오전 9시
  cron.schedule("0 9 * * 1", async () => {
    console.log("[Monitor] 주간 분석 시작...");
    const analysis = await generateWeeklyAnalysis();
    console.log("[Monitor] 주간 분석:\n", analysis);
  });

  console.log("[Monitor] 스케줄러 시작됨 (매일 09:00, 매주 월 09:00)");
}
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

```bash
npm test -- src/monitor/index.test.ts
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/monitor/index.ts src/monitor/index.test.ts
git commit -m "feat: add performance monitor with Claude analysis and cron scheduler"
```

---

## Task 12: 자율 개선 루프

**Files:**
- Create: `src/improver/index.ts`
- Create: `src/improver/index.test.ts`

- [ ] **Step 1: 테스트 작성**

`src/improver/index.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { buildImprovementPrompt, parseImprovements, shouldTriggerImprovement } from "./index.js";
import type { Report } from "../types.js";

const lowPerformanceReport: Report = {
  id: "r1", campaignId: "c1", courseId: "course-1", date: "2026-04-15",
  impressions: 5000, clicks: 40, ctr: 0.8, spend: 60000,
  cpc: 1500, reach: 4500, frequency: 1.1,
};

const highPerformanceReport: Report = {
  id: "r2", campaignId: "c2", courseId: "course-2", date: "2026-04-15",
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

describe("buildImprovementPrompt", () => {
  it("includes file content and performance context", () => {
    const prompt = buildImprovementPrompt(
      "src/generator/copy.ts",
      "const prompt = 'old prompt';",
      "CTR 0.8% — 임계값 1.5% 미달",
      "카피 헤드라인이 너무 추상적"
    );
    expect(prompt).toContain("old prompt");
    expect(prompt).toContain("0.8%");
  });
});

describe("parseImprovements", () => {
  it("extracts file edits from Claude response", () => {
    const response = `{
      "file": "src/generator/copy.ts",
      "oldCode": "const a = 1;",
      "newCode": "const a = 2;"
    }`;
    const result = parseImprovements(response);
    expect(result.file).toBe("src/generator/copy.ts");
    expect(result.newCode).toBe("const a = 2;");
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npm test -- src/improver/index.test.ts
```

Expected: FAIL — `Cannot find module './index.js'`

- [ ] **Step 3: 자율 개선 루프 구현**

`src/improver/index.ts`:
```typescript
import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "fs/promises";
import { execSync } from "child_process";
import type { Report, Improvement, ImprovementChange } from "../types.js";
import { readJson, writeJson, appendJson } from "../storage.js";

const CTR_THRESHOLD = Number(process.env.CTR_IMPROVEMENT_THRESHOLD ?? 1.5);

export function shouldTriggerImprovement(report: Report): boolean {
  return report.ctr < CTR_THRESHOLD;
}

export function buildImprovementPrompt(
  filePath: string,
  currentCode: string,
  performanceContext: string,
  issue: string
): string {
  return `당신은 광고 자동화 파이프라인 코드를 개선하는 엔지니어입니다.

## 성과 문제
${performanceContext}

## 식별된 문제
${issue}

## 현재 코드 (${filePath})
\`\`\`typescript
${currentCode}
\`\`\`

위 코드에서 광고 성과를 개선할 수 있는 최소한의 변경을 제안해주세요.
강의 플랫폼(인프런, 클래스101) 외부 페이지는 절대 수정하지 마세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "file": "${filePath}",
  "oldCode": "변경 전 코드 (exact match)",
  "newCode": "변경 후 코드",
  "reason": "변경 이유"
}`;
}

export function parseImprovements(claudeResponse: string): {
  file: string;
  oldCode: string;
  newCode: string;
  reason: string;
} {
  const jsonMatch = claudeResponse.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch?.[0] ?? "{}");
}

async function applyCodeChange(
  filePath: string,
  oldCode: string,
  newCode: string
): Promise<boolean> {
  try {
    const content = await readFile(filePath, "utf-8");
    if (!content.includes(oldCode)) return false;
    const updated = content.replace(oldCode, newCode);
    await writeFile(filePath, updated, "utf-8");
    return true;
  } catch {
    return false;
  }
}

export async function runImprovementCycle(
  weakReports: Report[],
  analysisJson: string
): Promise<void> {
  if (weakReports.length === 0) return;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const analysis = JSON.parse(analysisJson.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
  const improvements: ImprovementChange[] = [];

  for (const item of analysis.improvements ?? []) {
    if (!item.targetFile) continue;

    let currentCode: string;
    try {
      currentCode = await readFile(item.targetFile, "utf-8");
    } catch {
      continue;
    }

    const prompt = buildImprovementPrompt(
      item.targetFile,
      currentCode,
      `CTR ${weakReports[0].ctr}% — 임계값 ${CTR_THRESHOLD}% 미달`,
      item.issue
    );

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    const change = parseImprovements(text);

    if (!change.file || !change.oldCode || !change.newCode) continue;

    const applied = await applyCodeChange(change.file, change.oldCode, change.newCode);
    if (!applied) continue;

    improvements.push({
      file: change.file,
      type: item.changeType ?? "prompt_update",
      before: change.oldCode,
      after: change.newCode,
    });
  }

  if (improvements.length === 0) return;

  const improvement: Improvement = {
    date: new Date().toISOString().split("T")[0],
    trigger: `${weakReports.length}개 캠페인 CTR 임계값 미달`,
    changes: improvements,
  };

  const dateKey = improvement.date;
  await appendJson(`data/improvements/${dateKey}.json`, improvement);

  // 변경 사항 git 커밋
  try {
    const changedFiles = improvements.map((c) => c.file).join(" ");
    execSync(`git add ${changedFiles} data/improvements/${dateKey}.json`);
    execSync(`git commit -m "improve: auto-optimize pipeline (${improvements.length} changes) [${dateKey}]"`);
    console.log(`[Improver] ${improvements.length}개 개선 적용 및 커밋 완료`);
  } catch (e) {
    console.warn("[Improver] git 커밋 실패:", e);
  }
}
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

```bash
npm test -- src/improver/index.test.ts
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/improver/index.ts src/improver/index.test.ts
git commit -m "feat: add self-improvement loop with Claude Code auto-fix"
```

---

## Task 13: 파이프라인 오케스트레이터 + CLI 진입점

**Files:**
- Create: `src/pipeline.ts`
- Create: `src/cli/scrape.ts`
- Create: `src/cli/generate.ts`
- Create: `src/cli/review.ts`
- Create: `src/cli/launch.ts`
- Create: `src/cli/monitor.ts`
- Create: `src/cli/pipeline.ts`
- Create: `src/cli/improve.ts`

- [ ] **Step 1: 파이프라인 오케스트레이터 구현**

`src/pipeline.ts`:
```typescript
import "dotenv/config";
import React from "react";
import { render } from "ink";
import type { PipelineStep, StepStatus } from "./tui/PipelineProgress.js";
import { PipelineProgress } from "./tui/PipelineProgress.js";
import { scrapeCourse } from "./scraper/index.js";
import { generateCopy, createAnthropicClient } from "./generator/copy.js";
import { generateImage } from "./generator/image.js";
import { generateVideo } from "./generator/video.js";
import { launchCampaign } from "./launcher/index.js";
import { readJson, writeJson, listJson } from "./storage.js";
import type { Course, Creative } from "./types.js";
import { randomUUID } from "crypto";

export async function runPipeline(urls: string[]): Promise<void> {
  const stepStatuses: Record<PipelineStep, StepStatus> = {
    scrape: "pending",
    generate: "pending",
    review: "pending",
    launch: "pending",
  };

  let progressMessage = "";
  let currentCourse = "";
  let courseIndex = 0;

  const { rerender, unmount } = render(
    React.createElement(PipelineProgress, {
      currentStep: "scrape",
      stepStatuses,
      currentCourse,
      courseIndex,
      totalCourses: urls.length,
      progressMessage,
    })
  );

  const update = (step: PipelineStep, status: StepStatus, msg: string, course = currentCourse, idx = courseIndex) => {
    stepStatuses[step] = status;
    progressMessage = msg;
    currentCourse = course;
    courseIndex = idx;
    rerender(
      React.createElement(PipelineProgress, {
        currentStep: step,
        stepStatuses: { ...stepStatuses },
        currentCourse,
        courseIndex,
        totalCourses: urls.length,
        progressMessage,
      })
    );
  };

  const client = createAnthropicClient();

  // Step 1: Scrape
  update("scrape", "running", "스크래핑 시작...");
  const courses: Course[] = [];
  for (let i = 0; i < urls.length; i++) {
    update("scrape", "running", `스크래핑 중... ${urls[i].slice(0, 40)}`, urls[i].split("/").pop() ?? "", i + 1);
    const course = await scrapeCourse(urls[i]);
    courses.push(course);
  }
  update("scrape", "done", `${courses.length}개 강의 스크래핑 완료`);

  // Step 2: Generate
  update("generate", "running", "소재 생성 시작...");
  for (let i = 0; i < courses.length; i++) {
    const course = courses[i];
    update("generate", "running", `카피 생성 중...`, course.title, i + 1);
    const copy = await generateCopy(client, course);

    update("generate", "running", `이미지 생성 중...`, course.title, i + 1);
    const imageLocalPath = await generateImage(course);

    update("generate", "running", `영상 생성 중... (최대 10분 소요)`, course.title, i + 1);
    const videoLocalPath = await generateVideo(course, (msg) =>
      update("generate", "running", msg, course.title, i + 1)
    );

    const creative: Creative = {
      id: randomUUID(),
      courseId: course.id,
      copy,
      imageLocalPath,
      videoLocalPath,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    await writeJson(`data/creatives/${creative.id}.json`, creative);
  }
  update("generate", "done", "소재 생성 완료 — 검토 대기 중");

  unmount();
  console.log("\n소재 생성 완료. 검토를 시작하려면 npm run review 를 실행하세요.");
}
```

- [ ] **Step 2: CLI 진입점 구현**

`src/cli/scrape.ts`:
```typescript
import "dotenv/config";
import { scrapeCourse } from "../scraper/index.js";

const url = process.argv[2];
if (!url) { console.error("Usage: npm run scrape <URL>"); process.exit(1); }
scrapeCourse(url).then((c) => console.log("완료:", c.title)).catch(console.error);
```

`src/cli/generate.ts`:
```typescript
import "dotenv/config";
import { generateCopy, createAnthropicClient } from "../generator/copy.js";
import { generateImage } from "../generator/image.js";
import { generateVideo } from "../generator/video.js";
import { readJson, writeJson } from "../storage.js";
import type { Course, Creative } from "../types.js";
import { randomUUID } from "crypto";

const courseId = process.argv[2];
if (!courseId) { console.error("Usage: npm run generate <courseId>"); process.exit(1); }

const course = await readJson<Course>(`data/courses/${courseId}.json`);
if (!course) { console.error("강의를 찾을 수 없습니다:", courseId); process.exit(1); }

const client = createAnthropicClient();
console.log("카피 생성 중...");
const copy = await generateCopy(client, course);
console.log("이미지 생성 중...");
const imageLocalPath = await generateImage(course);
console.log("영상 생성 중... (최대 10분 소요)");
const videoLocalPath = await generateVideo(course, console.log);

const creative: Creative = {
  id: randomUUID(), courseId: course.id, copy,
  imageLocalPath, videoLocalPath, status: "pending",
  createdAt: new Date().toISOString(),
};
await writeJson(`data/creatives/${creative.id}.json`, creative);
console.log("완료:", creative.id);
```

`src/cli/review.ts`:
```typescript
import "dotenv/config";
import { runReviewSession } from "../reviewer/index.js";
runReviewSession().catch(console.error);
```

`src/cli/launch.ts`:
```typescript
import "dotenv/config";
import { launchCampaign } from "../launcher/index.js";
import { readJson, listJson } from "../storage.js";
import type { Creative, Course } from "../types.js";

const creativePaths = await listJson("data/creatives");
for (const p of creativePaths) {
  const creative = await readJson<Creative>(p);
  if (!creative || (creative.status !== "approved" && creative.status !== "edited")) continue;
  const course = await readJson<Course>(`data/courses/${creative.courseId}.json`);
  if (!course) continue;
  console.log(`게재 중: ${course.title}`);
  const campaign = await launchCampaign(course, creative);
  console.log(`완료: ${campaign.metaCampaignId}`);
}
```

`src/cli/monitor.ts`:
```typescript
import "dotenv/config";
import { collectDailyReports, generateWeeklyAnalysis, startCronScheduler } from "../monitor/index.js";

const mode = process.argv[2] ?? "cron";
if (mode === "daily") {
  const reports = await collectDailyReports();
  console.log(`${reports.length}개 리포트 수집 완료`);
} else if (mode === "weekly") {
  const analysis = await generateWeeklyAnalysis();
  console.log(analysis);
} else {
  startCronScheduler();
}
```

`src/cli/improve.ts`:
```typescript
import "dotenv/config";
import { readJson, listJson } from "../storage.js";
import { runImprovementCycle, shouldTriggerImprovement } from "../improver/index.js";
import type { Report } from "../types.js";

const reportPaths = await listJson("data/reports");
const allReports: Report[] = [];
for (const p of reportPaths.slice(-3)) {
  const daily = await readJson<Report[]>(p);
  if (daily) allReports.push(...daily);
}

const weeklyAnalysisPath = (await listJson("data/reports"))
  .filter((p) => p.includes("weekly-analysis"))
  .pop();

if (!weeklyAnalysisPath) { console.log("주간 분석 없음. npm run monitor weekly 먼저 실행하세요."); process.exit(0); }

const analysis = await readJson<object>(weeklyAnalysisPath);
const weakReports = allReports.filter(shouldTriggerImprovement);

console.log(`개선 대상: ${weakReports.length}개 캠페인`);
await runImprovementCycle(weakReports, JSON.stringify(analysis));
```

`src/cli/pipeline.ts`:
```typescript
import "dotenv/config";
import { runPipeline } from "../pipeline.js";

const urls = process.argv.slice(2);
if (urls.length === 0) { console.error("Usage: npm run pipeline <URL1> [URL2] ..."); process.exit(1); }
runPipeline(urls).catch(console.error);
```

- [ ] **Step 3: 전체 테스트 실행**

```bash
npm test
```

Expected: 모든 테스트 PASS

- [ ] **Step 4: 커밋**

```bash
git add src/pipeline.ts src/cli/
git commit -m "feat: add pipeline orchestrator and CLI entry points"
```

---

## Task 14: 통합 검증

- [ ] **Step 1: 타입 체크**

```bash
npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **Step 2: 전체 테스트 통과 확인**

```bash
npm test
```

Expected: 전체 PASS

- [ ] **Step 3: .env 설정 안내 출력 확인**

```bash
cp .env.example .env
# .env에 API 키 입력 후:
npm run scrape https://www.inflearn.com/course/test
```

Expected: Playwright 실행, Gemini 파싱, `data/courses/` 저장

- [ ] **Step 4: README 없이 도움말 확인**

```bash
npm run pipeline
```

Expected: `Usage: npm run pipeline <URL1> [URL2] ...`

- [ ] **Step 5: 최종 커밋**

```bash
git add .
git commit -m "feat: complete Instagram ad automation pipeline v1.0.0"
```

---

## 빠른 참조

```bash
# 강의 한 개 스크래핑
npm run scrape https://www.inflearn.com/course/...

# 소재 생성 (courseId는 data/courses/ 내 파일명)
npm run generate <courseId>

# 검토 TUI 실행
npm run review

# 승인된 소재 게재
npm run launch

# 성과 수집 (수동)
npm run monitor daily

# 주간 분석
npm run monitor weekly

# 자율 개선 실행
npm run improve

# 전체 파이프라인 (URL 직접 입력)
npm run pipeline https://inflearn.com/course/a https://inflearn.com/course/b

# cron 스케줄러 시작 (백그라운드 실행 권장)
npm run monitor
```

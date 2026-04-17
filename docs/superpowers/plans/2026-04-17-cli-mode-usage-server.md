# CLI 모드 분리 + Usage API Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CLI에 Owner/Customer 모드 분기를 추가하고, Customer 모드에서 AI 호출을 프록시하는 Usage API Server를 구축한다. Owner 로컬 TUI는 변경 없이 유지한다.

**Architecture:** `src/mode.ts`가 앱 시작 시 모드를 감지하고, `src/client/aiProxy.ts`가 모드에 따라 AI를 직접 호출(Owner)하거나 Usage Server로 프록시(Customer)한다. Server는 Express + SQLite로 구축하며, 모든 AI 프록시 요청에 세션 토큰 인증과 rate limiting을 적용한다.

**Tech Stack:** TypeScript ESM, Express, better-sqlite3, vitest, 기존 프로젝트 모듈

**Spec:** `docs/superpowers/specs/2026-04-17-cli-mode-usage-server-design.md`

---

## 파일 구조 맵

### 신규 파일

| 파일 | 역할 |
|------|------|
| `src/mode.ts` | 모드 감지 (Owner vs Customer) |
| `src/mode.test.ts` | 모드 감지 테스트 |
| `src/client/usageServer.ts` | Usage Server HTTP 클라이언트 |
| `src/client/usageServer.test.ts` | HTTP 클라이언트 테스트 |
| `src/client/aiProxy.ts` | 모드별 AI 호출 분기 |
| `src/client/aiProxy.test.ts` | aiProxy 테스트 |
| `server/db.ts` | SQLite 연결 + 테이블 생성 |
| `server/db.test.ts` | DB 테스트 |
| `server/auth.ts` | 세션 토큰 생성/검증 |
| `server/auth.test.ts` | 세션 토큰 테스트 |
| `server/rateLimit.ts` | 라이선스별 분당 제한 |
| `server/rateLimit.test.ts` | Rate limit 테스트 |
| `server/pricing.ts` | 단가표 상수 |
| `server/routes/license.ts` | POST /license/validate |
| `server/routes/aiCopy.ts` | POST /ai/copy |
| `server/routes/aiImage.ts` | POST /ai/image |
| `server/routes/aiVideo.ts` | POST /ai/video + GET /ai/video/status/:jobId |
| `server/routes/aiParse.ts` | POST /ai/parse |
| `server/routes/aiAnalyze.ts` | POST /ai/analyze |
| `server/routes/usage.ts` | POST /usage/report + GET /usage/summary |
| `server/jobs/videoJob.ts` | Veo 비동기 잡 관리 |
| `server/index.ts` | Express 앱 조립 |
| `server/admin.ts` | 어드민 CLI |

### 수정 파일

| 파일 | 변경 |
|------|------|
| `src/tui/AppTypes.ts` | MenuItem에 `ownerOnly` 필드 추가 |
| `src/tui/actions.ts` | aiProxy 경유로 변경 |
| `src/tui/App.tsx` | detectMode() + Customer 메뉴 필터링 |
| `src/cli/app.ts` | mode 전달 |
| `package.json` | 의존성 + 스크립트 |
| `.env.example` | 새 환경변수 |

---

## Task 1: 의존성 설치 + 환경 설정

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: 의존성 설치**

```bash
cd /Users/yuhojin/Desktop/ad_ai
npm install express better-sqlite3
npm install --save-dev @types/express @types/better-sqlite3
```

- [ ] **Step 2: package.json에 스크립트 추가**

`package.json`의 `"scripts"` 블록에 추가:
```json
"server": "tsx server/index.ts",
"admin": "tsx server/admin.ts"
```

- [ ] **Step 3: .env.example에 새 변수 추가**

`.env.example` 파일 끝에 추가:
```bash

# CLI 모드 설정 (owner | customer)
AD_AI_MODE=owner
AD_AI_LICENSE_KEY=
AD_AI_SERVER_URL=http://localhost:3000

# Server 전용
SERVER_PORT=3000
```

- [ ] **Step 4: 서버 디렉토리 생성**

```bash
mkdir -p server/routes server/jobs
```

- [ ] **Step 5: 커밋**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add Express/SQLite deps and server scripts"
```

---

## Task 2: 모드 감지 모듈 (src/mode.ts)

**Files:**
- Create: `src/mode.ts`
- Create: `src/mode.test.ts`

- [ ] **Step 1: 테스트 작성**

`src/mode.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectMode } from "./mode.js";
import type { ModeConfig } from "./mode.js";

describe("detectMode", () => {
  beforeEach(() => {
    delete process.env.AD_AI_MODE;
    delete process.env.AD_AI_LICENSE_KEY;
    delete process.env.AD_AI_SERVER_URL;
  });

  it("returns owner mode when no key and no mode env", () => {
    const config = detectMode([]);
    expect(config.mode).toBe("owner");
    expect(config.licenseKey).toBeUndefined();
  });

  it("returns customer mode when --key flag provided", () => {
    const config = detectMode(["--key=AD-AI-TEST-1234"]);
    expect(config.mode).toBe("customer");
    expect(config.licenseKey).toBe("AD-AI-TEST-1234");
  });

  it("returns customer mode when AD_AI_LICENSE_KEY env set", () => {
    process.env.AD_AI_LICENSE_KEY = "AD-AI-ENV-5678";
    const config = detectMode([]);
    expect(config.mode).toBe("customer");
    expect(config.licenseKey).toBe("AD-AI-ENV-5678");
  });

  it("returns customer mode when AD_AI_MODE=customer", () => {
    process.env.AD_AI_MODE = "customer";
    process.env.AD_AI_LICENSE_KEY = "AD-AI-MODE-TEST";
    const config = detectMode([]);
    expect(config.mode).toBe("customer");
  });

  it("returns owner mode when AD_AI_MODE=owner even if key exists", () => {
    process.env.AD_AI_MODE = "owner";
    process.env.AD_AI_LICENSE_KEY = "AD-AI-IGNORED";
    const config = detectMode([]);
    expect(config.mode).toBe("owner");
  });

  it("uses default server URL when not specified", () => {
    const config = detectMode(["--key=AD-AI-TEST-1234"]);
    expect(config.serverUrl).toBe("http://localhost:3000");
  });

  it("uses custom server URL from env", () => {
    process.env.AD_AI_SERVER_URL = "https://api.ad-ai.com";
    const config = detectMode(["--key=AD-AI-TEST-1234"]);
    expect(config.serverUrl).toBe("https://api.ad-ai.com");
  });

  it("sets tempDir to data/temp", () => {
    const config = detectMode([]);
    expect(config.tempDir).toBe("data/temp");
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npm test -- src/mode.test.ts
```

Expected: FAIL

- [ ] **Step 3: 구현**

`src/mode.ts`:
```typescript
export type AppMode = "owner" | "customer";

export interface ModeConfig {
  mode: AppMode;
  licenseKey?: string;
  serverUrl?: string;
  sessionToken?: string;
  tempDir: string;
}

export function detectMode(argv: string[] = process.argv.slice(2)): ModeConfig {
  const tempDir = "data/temp";

  // 1. AD_AI_MODE 환경변수로 명시적 모드 지정
  const explicitMode = process.env.AD_AI_MODE;
  if (explicitMode === "owner") {
    return { mode: "owner", tempDir };
  }

  // 2. --key 플래그 확인
  const keyFromArg = argv.find((a) => a.startsWith("--key="))?.split("=")[1];

  // 3. 환경변수 확인
  const keyFromEnv = process.env.AD_AI_LICENSE_KEY;

  const licenseKey = keyFromArg ?? keyFromEnv;

  // AD_AI_MODE=customer 이거나 키가 있으면 Customer 모드
  if (explicitMode === "customer" || licenseKey) {
    return {
      mode: "customer",
      licenseKey,
      serverUrl: process.env.AD_AI_SERVER_URL ?? "http://localhost:3000",
      tempDir,
    };
  }

  return { mode: "owner", tempDir };
}
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

```bash
npm test -- src/mode.test.ts
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/mode.ts src/mode.test.ts
git commit -m "feat: add mode detection module (Owner vs Customer)"
```

---

## Task 3: SQLite DB 모듈 (server/db.ts)

**Files:**
- Create: `server/db.ts`
- Create: `server/db.test.ts`
- Create: `server/pricing.ts`

- [ ] **Step 1: 테스트 작성**

`server/db.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type AppDb } from "./db.js";
import { unlinkSync, existsSync } from "fs";

const TEST_DB = "server/test.db";

let db: AppDb;
beforeEach(() => { db = createDb(TEST_DB); });
afterEach(() => {
  db.close();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
});

describe("createDb", () => {
  it("creates licenses table", () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain("licenses");
  });

  it("creates usage_events table", () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain("usage_events");
  });

  it("creates billing_cycles table", () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain("billing_cycles");
  });

  it("can insert and query a license", () => {
    db.prepare("INSERT INTO licenses (id, key, customer_email) VALUES (?, ?, ?)").run("id1", "AD-AI-TEST-1234", "test@example.com");
    const row = db.prepare("SELECT * FROM licenses WHERE key = ?").get("AD-AI-TEST-1234") as any;
    expect(row.customer_email).toBe("test@example.com");
    expect(row.status).toBe("active");
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패)**

```bash
npm test -- server/db.test.ts
```

- [ ] **Step 3: pricing.ts 구현**

`server/pricing.ts`:
```typescript
export const PRICING: Record<string, { aiCost: number; charged: number }> = {
  copy_gen:        { aiCost: 0.003, charged: 0.01 },
  image_gen:       { aiCost: 0.02,  charged: 0.05 },
  video_gen:       { aiCost: 0.50,  charged: 1.50 },
  parse:           { aiCost: 0.001, charged: 0.005 },
  analyze:         { aiCost: 0.01,  charged: 0.03 },
  campaign_launch: { aiCost: 0,     charged: 0.10 },
};
```

- [ ] **Step 4: db.ts 구현**

`server/db.ts`:
```typescript
import Database from "better-sqlite3";

export type AppDb = Database.Database;

export function createDb(path = "server/data.db"): AppDb {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      customer_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      stripe_customer_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      license_id TEXT NOT NULL REFERENCES licenses(id),
      type TEXT NOT NULL,
      ai_cost_usd REAL NOT NULL DEFAULT 0,
      charged_usd REAL NOT NULL DEFAULT 0,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS billing_cycles (
      id TEXT PRIMARY KEY,
      license_id TEXT NOT NULL REFERENCES licenses(id),
      period_start DATETIME NOT NULL,
      period_end DATETIME NOT NULL,
      total_ai_cost_usd REAL DEFAULT 0,
      total_charged_usd REAL DEFAULT 0,
      stripe_invoice_id TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return db;
}
```

- [ ] **Step 5: 테스트 실행 (통과)**

```bash
npm test -- server/db.test.ts
```

- [ ] **Step 6: 커밋**

```bash
git add server/db.ts server/db.test.ts server/pricing.ts
git commit -m "feat: add SQLite database module with licenses/usage/billing tables"
```

---

## Task 4: 인증 + Rate Limiting 미들웨어

**Files:**
- Create: `server/auth.ts`
- Create: `server/auth.test.ts`
- Create: `server/rateLimit.ts`
- Create: `server/rateLimit.test.ts`

- [ ] **Step 1: auth 테스트 작성**

`server/auth.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { createSessionStore } from "./auth.js";

describe("SessionStore", () => {
  it("creates a session token for a license", () => {
    const store = createSessionStore();
    const { token, expiresAt } = store.create("license-1");
    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("validates a valid token", () => {
    const store = createSessionStore();
    const { token } = store.create("license-1");
    const result = store.validate(token);
    expect(result).not.toBeNull();
    expect(result!.licenseId).toBe("license-1");
  });

  it("returns null for invalid token", () => {
    const store = createSessionStore();
    expect(store.validate("invalid-token")).toBeNull();
  });

  it("returns null for expired token", () => {
    const store = createSessionStore(0); // 0ms TTL = instant expire
    const { token } = store.create("license-1");
    expect(store.validate(token)).toBeNull();
  });
});
```

- [ ] **Step 2: rateLimit 테스트 작성**

`server/rateLimit.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { createRateLimiter } from "./rateLimit.js";

describe("RateLimiter", () => {
  it("allows requests under limit", () => {
    const limiter = createRateLimiter(5, 60000);
    for (let i = 0; i < 5; i++) {
      expect(limiter.check("license-1").allowed).toBe(true);
    }
  });

  it("blocks requests over limit", () => {
    const limiter = createRateLimiter(3, 60000);
    limiter.check("license-1");
    limiter.check("license-1");
    limiter.check("license-1");
    const result = limiter.check("license-1");
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("tracks licenses independently", () => {
    const limiter = createRateLimiter(1, 60000);
    limiter.check("license-1");
    expect(limiter.check("license-1").allowed).toBe(false);
    expect(limiter.check("license-2").allowed).toBe(true);
  });
});
```

- [ ] **Step 3: 테스트 실행 (실패)**

```bash
npm test -- server/auth.test.ts server/rateLimit.test.ts
```

- [ ] **Step 4: auth.ts 구현**

`server/auth.ts`:
```typescript
import { randomUUID } from "crypto";

interface Session {
  licenseId: string;
  expiresAt: number;
}

export function createSessionStore(ttlMs = 24 * 60 * 60 * 1000) {
  const sessions = new Map<string, Session>();

  return {
    create(licenseId: string) {
      const token = randomUUID();
      const expiresAt = Date.now() + ttlMs;
      sessions.set(token, { licenseId, expiresAt });
      return { token, expiresAt: new Date(expiresAt).toISOString() };
    },

    validate(token: string): { licenseId: string } | null {
      const session = sessions.get(token);
      if (!session) return null;
      if (Date.now() > session.expiresAt) {
        sessions.delete(token);
        return null;
      }
      return { licenseId: session.licenseId };
    },

    revoke(token: string) {
      sessions.delete(token);
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
```

- [ ] **Step 5: rateLimit.ts 구현**

`server/rateLimit.ts`:
```typescript
interface RateBucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(maxRequests = 10, windowMs = 60000) {
  const buckets = new Map<string, RateBucket>();

  return {
    check(licenseId: string): { allowed: boolean; retryAfter?: number } {
      const now = Date.now();
      let bucket = buckets.get(licenseId);

      if (!bucket || now > bucket.resetAt) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(licenseId, bucket);
      }

      bucket.count++;

      if (bucket.count > maxRequests) {
        return {
          allowed: false,
          retryAfter: Math.ceil((bucket.resetAt - now) / 1000),
        };
      }

      return { allowed: true };
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
```

- [ ] **Step 6: 테스트 실행 (통과)**

```bash
npm test -- server/auth.test.ts server/rateLimit.test.ts
```

- [ ] **Step 7: 커밋**

```bash
git add server/auth.ts server/auth.test.ts server/rateLimit.ts server/rateLimit.test.ts
git commit -m "feat: add session auth and rate limiting middleware"
```

---

## Task 5: 서버 라우트 — License + AI 프록시 (동기)

**Files:**
- Create: `server/routes/license.ts`
- Create: `server/routes/aiCopy.ts`
- Create: `server/routes/aiImage.ts`
- Create: `server/routes/aiParse.ts`
- Create: `server/routes/aiAnalyze.ts`
- Create: `server/routes/usage.ts`

이 태스크에서는 동기적으로 응답하는 라우트를 모두 구현한다. 비동기 Video는 Task 6에서 별도 구현.

- [ ] **Step 1: license.ts 구현**

`server/routes/license.ts`:
```typescript
import { Router } from "express";
import type { AppDb } from "../db.js";
import type { SessionStore } from "../auth.js";

export function createLicenseRouter(db: AppDb, sessions: SessionStore) {
  const router = Router();

  router.post("/license/validate", (req, res) => {
    const { key } = req.body;
    if (!key) { res.status(400).json({ error: "License key required" }); return; }

    const license = db.prepare("SELECT * FROM licenses WHERE key = ?").get(key) as any;
    if (!license || license.status !== "active") {
      res.status(401).json({ error: "Invalid license key" });
      return;
    }

    const { token, expiresAt } = sessions.create(license.id);
    res.json({ sessionToken: token, expiresAt, customerEmail: license.customer_email });
  });

  return router;
}
```

- [ ] **Step 2: aiCopy.ts 구현**

`server/routes/aiCopy.ts`:
```typescript
import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { generateCopy, COPY_SYSTEM_PROMPT } from "../../src/generator/copy.js";
import type { Product } from "../../src/types.js";
import type { AppDb } from "../db.js";
import { PRICING } from "../pricing.js";
import { randomUUID } from "crypto";

export function createAiCopyRouter(db: AppDb) {
  const router = Router();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  router.post("/ai/copy", async (req, res) => {
    try {
      const { product } = req.body as { product: Product };
      const licenseId = (req as any).licenseId;

      const copy = await generateCopy(client, product);

      const pricing = PRICING.copy_gen;
      db.prepare(
        "INSERT INTO usage_events (id, license_id, type, ai_cost_usd, charged_usd, metadata) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(randomUUID(), licenseId, "copy_gen", pricing.aiCost, pricing.charged, JSON.stringify({ productId: product.id }));

      res.json(copy);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  return router;
}
```

- [ ] **Step 3: aiImage.ts 구현**

`server/routes/aiImage.ts`:
```typescript
import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import { buildImagePrompt } from "../../src/generator/image.js";
import type { Product } from "../../src/types.js";
import type { AppDb } from "../db.js";
import { PRICING } from "../pricing.js";
import { randomUUID } from "crypto";

export function createAiImageRouter(db: AppDb) {
  const router = Router();

  router.post("/ai/image", async (req, res) => {
    try {
      const { product } = req.body as { product: Product };
      const licenseId = (req as any).licenseId;
      const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
      const prompt = buildImagePrompt(product);

      const response = await ai.models.generateImages({
        model: "imagen-3.0-generate-002",
        prompt,
        config: { numberOfImages: 1, aspectRatio: "1:1", outputMimeType: "image/jpeg" },
      });

      const imageData = response.generatedImages?.[0]?.image?.imageBytes;
      if (!imageData) { res.status(500).json({ error: "Imagen 3: 이미지 생성 실패" }); return; }

      const imageBase64 = typeof imageData === "string"
        ? imageData
        : Buffer.from(imageData).toString("base64");

      const pricing = PRICING.image_gen;
      db.prepare(
        "INSERT INTO usage_events (id, license_id, type, ai_cost_usd, charged_usd, metadata) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(randomUUID(), licenseId, "image_gen", pricing.aiCost, pricing.charged, JSON.stringify({ productId: product.id }));

      res.json({ imageBase64 });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  return router;
}
```

- [ ] **Step 4: aiParse.ts 구현**

`server/routes/aiParse.ts`:
```typescript
import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import { parseProductWithGemini } from "../../src/scraper/index.js";
import type { AppDb } from "../db.js";
import { PRICING } from "../pricing.js";
import { randomUUID } from "crypto";

export function createAiParseRouter(db: AppDb) {
  const router = Router();

  router.post("/ai/parse", async (req, res) => {
    try {
      const { url, html } = req.body as { url: string; html: string };
      const licenseId = (req as any).licenseId;
      const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });

      const product = await parseProductWithGemini(ai, url, html);

      const pricing = PRICING.parse;
      db.prepare(
        "INSERT INTO usage_events (id, license_id, type, ai_cost_usd, charged_usd, metadata) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(randomUUID(), licenseId, "parse", pricing.aiCost, pricing.charged, JSON.stringify({ url }));

      res.json(product);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  return router;
}
```

- [ ] **Step 5: aiAnalyze.ts 구현**

`server/routes/aiAnalyze.ts`:
```typescript
import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { computeStats, buildAnalysisPrompt } from "../../src/monitor/index.js";
import type { Report } from "../../src/types.js";
import type { AppDb } from "../db.js";
import { PRICING } from "../pricing.js";
import { randomUUID } from "crypto";

export function createAiAnalyzeRouter(db: AppDb) {
  const router = Router();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  router.post("/ai/analyze", async (req, res) => {
    try {
      const { reports } = req.body as { reports: Report[] };
      const licenseId = (req as any).licenseId;

      const stats = computeStats(reports);
      const prompt = buildAnalysisPrompt(reports, stats);

      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });

      const analysis = response.content[0].type === "text" ? response.content[0].text : "";

      const pricing = PRICING.analyze;
      db.prepare(
        "INSERT INTO usage_events (id, license_id, type, ai_cost_usd, charged_usd, metadata) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(randomUUID(), licenseId, "analyze", pricing.aiCost, pricing.charged, JSON.stringify({ reportCount: reports.length }));

      res.json({ analysis });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  return router;
}
```

- [ ] **Step 6: usage.ts 구현**

`server/routes/usage.ts`:
```typescript
import { Router } from "express";
import type { AppDb } from "../db.js";
import { PRICING } from "../pricing.js";
import { randomUUID } from "crypto";

export function createUsageRouter(db: AppDb) {
  const router = Router();

  router.post("/usage/report", (req, res) => {
    const { type, metadata } = req.body;
    const licenseId = (req as any).licenseId;

    const pricing = PRICING[type];
    if (!pricing) { res.status(400).json({ error: `Unknown usage type: ${type}` }); return; }

    db.prepare(
      "INSERT INTO usage_events (id, license_id, type, ai_cost_usd, charged_usd, metadata) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(randomUUID(), licenseId, type, pricing.aiCost, pricing.charged, JSON.stringify(metadata ?? {}));

    res.json({ recorded: true });
  });

  router.get("/usage/summary", (req, res) => {
    const licenseId = (req as any).licenseId;
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

    const events = db.prepare(
      "SELECT type, COUNT(*) as count, SUM(charged_usd) as total FROM usage_events WHERE license_id = ? AND created_at >= ? GROUP BY type"
    ).all(licenseId, periodStart) as Array<{ type: string; count: number; total: number }>;

    const summary: Record<string, number> = {};
    let totalCharged = 0;
    for (const e of events) {
      summary[e.type] = e.count;
      totalCharged += e.total;
    }

    res.json({
      currentPeriod: { start: periodStart.split("T")[0], end: periodEnd.split("T")[0] },
      events: summary,
      totalCharged: Math.round(totalCharged * 100) / 100,
    });
  });

  return router;
}
```

- [ ] **Step 7: 커밋**

```bash
git add server/routes/license.ts server/routes/aiCopy.ts server/routes/aiImage.ts server/routes/aiParse.ts server/routes/aiAnalyze.ts server/routes/usage.ts
git commit -m "feat: add server routes — license, AI proxies, usage tracking"
```

---

## Task 6: Veo 비동기 잡 + Video 라우트

**Files:**
- Create: `server/jobs/videoJob.ts`
- Create: `server/routes/aiVideo.ts`

- [ ] **Step 1: videoJob.ts 구현**

`server/jobs/videoJob.ts`:
```typescript
import { GoogleGenAI } from "@google/genai";
import { writeFile, mkdir, readdir, unlink, stat } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { buildVideoPrompt } from "../../src/generator/video.js";
import type { Product } from "../../src/types.js";
import type { AppDb } from "../db.js";
import { PRICING } from "../pricing.js";

export interface VideoJob {
  id: string;
  licenseId: string;
  status: "pending" | "done" | "failed";
  progress?: string;
  filePath?: string;
  downloadUrl?: string;
  error?: string;
  createdAt: number;
}

const jobs = new Map<string, VideoJob>();
const TMP_DIR = "server/tmp";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function getJob(jobId: string): VideoJob | undefined {
  return jobs.get(jobId);
}

export async function startVideoJob(
  product: Product,
  licenseId: string,
  serverBaseUrl: string,
  db: AppDb
): Promise<string> {
  const jobId = `veo-${randomUUID().slice(0, 8)}`;
  const job: VideoJob = {
    id: jobId,
    licenseId,
    status: "pending",
    createdAt: Date.now(),
  };
  jobs.set(jobId, job);

  // 비동기로 Veo 생성 시작 (await 하지 않음)
  runVeoGeneration(job, product, serverBaseUrl, db).catch((e) => {
    job.status = "failed";
    job.error = String(e);
  });

  return jobId;
}

async function runVeoGeneration(
  job: VideoJob,
  product: Product,
  serverBaseUrl: string,
  db: AppDb
) {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
  const prompt = buildVideoPrompt(product);

  let operation = await ai.models.generateVideos({
    model: "veo-3.1-generate-preview",
    prompt,
    config: { aspectRatio: "9:16", durationSeconds: 15 },
  });

  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    if (operation.done) break;
    job.progress = `${i + 1}/${maxAttempts}`;
    await new Promise((r) => setTimeout(r, 10000));
    operation = await ai.operations.get({ operation });
  }

  if (!operation.done) {
    job.status = "failed";
    job.error = "Veo 3.1: 영상 생성 타임아웃";
    return;
  }

  const videoData = operation.result?.generatedVideos?.[0]?.video?.videoBytes;
  if (!videoData) {
    job.status = "failed";
    job.error = "Veo 3.1: 영상 데이터 없음";
    return;
  }

  if (!existsSync(TMP_DIR)) await mkdir(TMP_DIR, { recursive: true });
  const filePath = path.join(TMP_DIR, `${job.id}.mp4`);
  const buffer = typeof videoData === "string"
    ? Buffer.from(videoData, "base64")
    : Buffer.from(videoData);
  await writeFile(filePath, buffer);

  job.filePath = filePath;
  job.downloadUrl = `${serverBaseUrl}/files/${job.id}.mp4`;
  job.status = "done";

  // Usage 기록
  const pricing = PRICING.video_gen;
  db.prepare(
    "INSERT INTO usage_events (id, license_id, type, ai_cost_usd, charged_usd, metadata) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(randomUUID(), job.licenseId, "video_gen", pricing.aiCost, pricing.charged, JSON.stringify({ jobId: job.id }));
}

export async function cleanupOldFiles() {
  if (!existsSync(TMP_DIR)) return;
  const files = await readdir(TMP_DIR);
  const now = Date.now();
  for (const file of files) {
    const filePath = path.join(TMP_DIR, file);
    const stats = await stat(filePath);
    if (now - stats.mtimeMs > MAX_AGE_MS) {
      await unlink(filePath);
    }
  }
}
```

- [ ] **Step 2: aiVideo.ts 구현**

`server/routes/aiVideo.ts`:
```typescript
import { Router } from "express";
import { startVideoJob, getJob } from "../jobs/videoJob.js";
import type { Product } from "../../src/types.js";
import type { AppDb } from "../db.js";

export function createAiVideoRouter(db: AppDb, serverBaseUrl: string) {
  const router = Router();

  router.post("/ai/video", async (req, res) => {
    try {
      const { product } = req.body as { product: Product };
      const licenseId = (req as any).licenseId;
      const jobId = await startVideoJob(product, licenseId, serverBaseUrl, db);
      res.json({ jobId, status: "pending" });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.get("/ai/video/status/:jobId", (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }

    if (job.status === "pending") {
      res.json({ status: "pending", progress: job.progress });
    } else if (job.status === "done") {
      res.json({ status: "done", downloadUrl: job.downloadUrl });
    } else {
      res.json({ status: "failed", error: job.error });
    }
  });

  return router;
}
```

- [ ] **Step 3: 커밋**

```bash
git add server/jobs/videoJob.ts server/routes/aiVideo.ts
git commit -m "feat: add async Veo video job manager and video route"
```

---

## Task 7: Express 서버 조립 (server/index.ts)

**Files:**
- Create: `server/index.ts`

- [ ] **Step 1: server/index.ts 구현**

`server/index.ts`:
```typescript
import "dotenv/config";
import express from "express";
import path from "path";
import { existsSync, mkdirSync } from "fs";
import { createDb } from "./db.js";
import { createSessionStore } from "./auth.js";
import { createRateLimiter } from "./rateLimit.js";
import { createLicenseRouter } from "./routes/license.js";
import { createAiCopyRouter } from "./routes/aiCopy.js";
import { createAiImageRouter } from "./routes/aiImage.js";
import { createAiVideoRouter } from "./routes/aiVideo.js";
import { createAiParseRouter } from "./routes/aiParse.js";
import { createAiAnalyzeRouter } from "./routes/aiAnalyze.js";
import { createUsageRouter } from "./routes/usage.js";
import { cleanupOldFiles } from "./jobs/videoJob.js";

const PORT = Number(process.env.SERVER_PORT ?? 3000);
const SERVER_URL = `http://localhost:${PORT}`;

const db = createDb();
const sessions = createSessionStore();
const rateLimiter = createRateLimiter(10, 60000);

const app = express();
app.use(express.json({ limit: "10mb" }));

// Static file serving for video downloads
const tmpDir = "server/tmp";
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
app.use("/files", express.static(tmpDir));

// License route (no auth required)
app.use(createLicenseRouter(db, sessions));

// Auth middleware for /ai/* and /usage/* routes
app.use("/ai", (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authorization header required" });
    return;
  }
  const token = authHeader.slice(7);
  const session = sessions.validate(token);
  if (!session) {
    res.status(401).json({ error: "Invalid or expired session token" });
    return;
  }
  (req as any).licenseId = session.licenseId;

  // Rate limiting
  const rateResult = rateLimiter.check(session.licenseId);
  if (!rateResult.allowed) {
    res.status(429).json({ error: "Rate limit exceeded", retryAfter: rateResult.retryAfter });
    return;
  }

  next();
});

app.use("/usage", (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authorization header required" });
    return;
  }
  const token = authHeader.slice(7);
  const session = sessions.validate(token);
  if (!session) {
    res.status(401).json({ error: "Invalid or expired session token" });
    return;
  }
  (req as any).licenseId = session.licenseId;
  next();
});

// AI proxy routes
app.use(createAiCopyRouter(db));
app.use(createAiImageRouter(db));
app.use(createAiVideoRouter(db, SERVER_URL));
app.use(createAiParseRouter(db));
app.use(createAiAnalyzeRouter(db));
app.use(createUsageRouter(db));

// Cleanup old video files every hour
setInterval(cleanupOldFiles, 60 * 60 * 1000);
cleanupOldFiles();

app.listen(PORT, () => {
  console.log(`[Usage Server] Running on ${SERVER_URL}`);
  console.log(`[Usage Server] DB: server/data.db`);
});
```

- [ ] **Step 2: 커밋**

```bash
git add server/index.ts
git commit -m "feat: assemble Express server with all routes and middleware"
```

---

## Task 8: 어드민 CLI (server/admin.ts)

**Files:**
- Create: `server/admin.ts`

- [ ] **Step 1: admin.ts 구현**

`server/admin.ts`:
```typescript
import "dotenv/config";
import { createDb } from "./db.js";
import { randomUUID } from "crypto";

const db = createDb();
const args = process.argv.slice(2);
const command = args[0];

function generateKey(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `AD-AI-${part()}-${part()}`;
}

function getFlag(flag: string): string | undefined {
  const arg = args.find((a) => a.startsWith(`--${flag}=`));
  return arg?.split("=")[1];
}

switch (command) {
  case "create-license": {
    const email = getFlag("email");
    if (!email) { console.error("Usage: npm run admin -- create-license --email=<email>"); process.exit(1); }
    const id = randomUUID();
    const key = generateKey();
    db.prepare("INSERT INTO licenses (id, key, customer_email) VALUES (?, ?, ?)").run(id, key, email);

    // 첫 BillingCycle 생성
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
    db.prepare(
      "INSERT INTO billing_cycles (id, license_id, period_start, period_end) VALUES (?, ?, ?, ?)"
    ).run(randomUUID(), id, periodStart, periodEnd);

    console.log(`License created: ${key}`);
    console.log(`Email: ${email}`);
    break;
  }

  case "list-licenses": {
    const rows = db.prepare("SELECT key, customer_email, status, created_at FROM licenses ORDER BY created_at DESC").all() as any[];
    if (rows.length === 0) { console.log("No licenses found."); break; }
    for (const r of rows) {
      console.log(`${r.key}  ${r.customer_email}  ${r.status}  ${r.created_at}`);
    }
    break;
  }

  case "suspend-license": {
    const key = getFlag("key");
    if (!key) { console.error("Usage: npm run admin -- suspend-license --key=<key>"); process.exit(1); }
    const result = db.prepare("UPDATE licenses SET status = 'suspended' WHERE key = ?").run(key);
    if (result.changes === 0) { console.error(`License not found: ${key}`); process.exit(1); }
    console.log(`License ${key} suspended`);
    break;
  }

  case "usage": {
    const key = getFlag("key");
    if (!key) { console.error("Usage: npm run admin -- usage --key=<key>"); process.exit(1); }
    const license = db.prepare("SELECT id FROM licenses WHERE key = ?").get(key) as any;
    if (!license) { console.error(`License not found: ${key}`); process.exit(1); }
    const events = db.prepare(
      "SELECT type, COUNT(*) as count, SUM(charged_usd) as total FROM usage_events WHERE license_id = ? GROUP BY type"
    ).all(license.id) as Array<{ type: string; count: number; total: number }>;
    if (events.length === 0) { console.log("No usage recorded."); break; }
    for (const e of events) {
      console.log(`${e.type}: ${e.count} ($${e.total.toFixed(2)})`);
    }
    break;
  }

  default:
    console.log("Commands: create-license, list-licenses, suspend-license, usage");
}
```

- [ ] **Step 2: 커밋**

```bash
git add server/admin.ts
git commit -m "feat: add admin CLI for license management"
```

---

## Task 9: Usage Server HTTP 클라이언트 (src/client/usageServer.ts)

**Files:**
- Create: `src/client/usageServer.ts`
- Create: `src/client/usageServer.test.ts`

- [ ] **Step 1: 테스트 작성**

`src/client/usageServer.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { buildUrl } from "./usageServer.js";

describe("buildUrl", () => {
  it("combines base URL and path", () => {
    expect(buildUrl("http://localhost:3000", "/ai/copy")).toBe("http://localhost:3000/ai/copy");
  });

  it("handles trailing slash in base URL", () => {
    expect(buildUrl("http://localhost:3000/", "/ai/copy")).toBe("http://localhost:3000/ai/copy");
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패)**

```bash
npm test -- src/client/usageServer.test.ts
```

- [ ] **Step 3: usageServer.ts 구현**

`src/client/usageServer.ts`:
```typescript
import type { ModeConfig } from "../mode.js";

export function buildUrl(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/$/, "") + path;
}

export async function serverFetch(
  config: ModeConfig,
  path: string,
  body: object,
  maxRetries = 3
): Promise<Response> {
  const url = buildUrl(config.serverUrl!, path);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.sessionToken) {
    headers["Authorization"] = `Bearer ${config.sessionToken}`;
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      // 401 → 세션 만료, 토큰 갱신 시도
      if (response.status === 401 && config.licenseKey && attempt < maxRetries - 1) {
        const refreshed = await refreshSession(config);
        if (refreshed) {
          headers["Authorization"] = `Bearer ${config.sessionToken}`;
          continue;
        }
      }

      // 429 → rate limit, retryAfter 대기
      if (response.status === 429 && attempt < maxRetries - 1) {
        const data = await response.json() as { retryAfter?: number };
        const waitMs = (data.retryAfter ?? 5) * 1000;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      return response;
    } catch (e) {
      if (attempt === maxRetries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  throw new Error("서버 연결 실패: Usage Server에 연결할 수 없습니다.");
}

export async function serverGet(
  config: ModeConfig,
  path: string
): Promise<Response> {
  const url = buildUrl(config.serverUrl!, path);
  const headers: Record<string, string> = {};
  if (config.sessionToken) {
    headers["Authorization"] = `Bearer ${config.sessionToken}`;
  }
  return fetch(url, { headers });
}

async function refreshSession(config: ModeConfig): Promise<boolean> {
  try {
    const url = buildUrl(config.serverUrl!, "/license/validate");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: config.licenseKey }),
    });
    if (!response.ok) return false;
    const data = await response.json() as { sessionToken: string };
    config.sessionToken = data.sessionToken;
    return true;
  } catch {
    return false;
  }
}

export async function validateLicense(config: ModeConfig): Promise<boolean> {
  try {
    const url = buildUrl(config.serverUrl!, "/license/validate");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: config.licenseKey }),
    });
    if (!response.ok) return false;
    const data = await response.json() as { sessionToken: string };
    config.sessionToken = data.sessionToken;
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: 테스트 실행 (통과)**

```bash
npm test -- src/client/usageServer.test.ts
```

- [ ] **Step 5: 커밋**

```bash
git add src/client/usageServer.ts src/client/usageServer.test.ts
git commit -m "feat: add Usage Server HTTP client with retry and token refresh"
```

---

## Task 10: aiProxy 모듈 (src/client/aiProxy.ts)

**Files:**
- Create: `src/client/aiProxy.ts`
- Create: `src/client/aiProxy.test.ts`

- [ ] **Step 1: 테스트 작성**

`src/client/aiProxy.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { createAiProxy } from "./aiProxy.js";
import type { ModeConfig } from "../mode.js";

describe("createAiProxy", () => {
  it("owner mode returns proxy with all methods", () => {
    const config: ModeConfig = { mode: "owner", tempDir: "data/temp" };
    const proxy = createAiProxy(config);
    expect(typeof proxy.generateCopy).toBe("function");
    expect(typeof proxy.generateImage).toBe("function");
    expect(typeof proxy.generateVideo).toBe("function");
    expect(typeof proxy.parseProduct).toBe("function");
    expect(typeof proxy.analyzePerformance).toBe("function");
    expect(typeof proxy.reportUsage).toBe("function");
  });

  it("customer mode returns proxy with all methods", () => {
    const config: ModeConfig = {
      mode: "customer",
      licenseKey: "AD-AI-TEST",
      serverUrl: "http://localhost:3000",
      sessionToken: "test-token",
      tempDir: "data/temp",
    };
    const proxy = createAiProxy(config);
    expect(typeof proxy.generateCopy).toBe("function");
    expect(typeof proxy.generateImage).toBe("function");
    expect(typeof proxy.generateVideo).toBe("function");
    expect(typeof proxy.parseProduct).toBe("function");
    expect(typeof proxy.analyzePerformance).toBe("function");
    expect(typeof proxy.reportUsage).toBe("function");
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패)**

```bash
npm test -- src/client/aiProxy.test.ts
```

- [ ] **Step 3: aiProxy.ts 구현**

`src/client/aiProxy.ts`:
```typescript
import type { ModeConfig } from "../mode.js";
import type { Product, Creative, Report } from "../types.js";
import { generateCopy, createAnthropicClient } from "../generator/copy.js";
import { generateImage } from "../generator/image.js";
import { generateVideo } from "../generator/video.js";
import { parseProductWithGemini } from "../scraper/index.js";
import { computeStats, buildAnalysisPrompt } from "../monitor/index.js";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { serverFetch, serverGet } from "./usageServer.js";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

export type UsageType = "copy_gen" | "image_gen" | "video_gen" | "parse" | "analyze" | "campaign_launch";

export interface AiProxy {
  generateCopy(product: Product): Promise<Creative["copy"]>;
  generateImage(product: Product): Promise<string>;
  generateVideo(product: Product, onProgress?: (msg: string) => void): Promise<string>;
  parseProduct(url: string, html: string): Promise<Product>;
  analyzePerformance(reports: Report[]): Promise<string>;
  reportUsage(type: UsageType, metadata?: object): Promise<void>;
}

function createOwnerProxy(): AiProxy {
  const anthropic = createAnthropicClient();

  return {
    generateCopy: (product) => generateCopy(anthropic, product),
    generateImage: (product) => generateImage(product),
    generateVideo: (product, onProgress) => generateVideo(product, onProgress),
    parseProduct: async (url, html) => {
      const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
      return parseProductWithGemini(ai, url, html);
    },
    analyzePerformance: async (reports) => {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
      const stats = computeStats(reports);
      const prompt = buildAnalysisPrompt(reports, stats);
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      return response.content[0].type === "text" ? response.content[0].text : "";
    },
    reportUsage: async () => {}, // no-op for owner
  };
}

function createCustomerProxy(config: ModeConfig): AiProxy {
  async function ensureTempDir(): Promise<string> {
    if (!existsSync(config.tempDir)) await mkdir(config.tempDir, { recursive: true });
    return config.tempDir;
  }

  return {
    generateCopy: async (product) => {
      const res = await serverFetch(config, "/ai/copy", { product });
      if (!res.ok) throw new Error(`AI copy failed: ${res.status}`);
      return res.json() as Promise<Creative["copy"]>;
    },

    generateImage: async (product) => {
      const res = await serverFetch(config, "/ai/image", { product });
      if (!res.ok) throw new Error(`AI image failed: ${res.status}`);
      const { imageBase64 } = await res.json() as { imageBase64: string };
      const dir = await ensureTempDir();
      const filePath = path.join(dir, `${product.id}-image.jpg`);
      await writeFile(filePath, Buffer.from(imageBase64, "base64"));
      return filePath;
    },

    generateVideo: async (product, onProgress) => {
      const res = await serverFetch(config, "/ai/video", { product });
      if (!res.ok) throw new Error(`AI video failed: ${res.status}`);
      const { jobId } = await res.json() as { jobId: string };

      // 폴링
      for (let i = 0; i < 60; i++) {
        const statusRes = await serverGet(config, `/ai/video/status/${jobId}`);
        const statusData = await statusRes.json() as { status: string; progress?: string; downloadUrl?: string; error?: string };

        if (statusData.status === "done" && statusData.downloadUrl) {
          onProgress?.("영상 다운로드 중...");
          const videoRes = await fetch(statusData.downloadUrl);
          const buffer = Buffer.from(await videoRes.arrayBuffer());
          const dir = await ensureTempDir();
          const filePath = path.join(dir, `${product.id}-video.mp4`);
          await writeFile(filePath, buffer);
          return filePath;
        }

        if (statusData.status === "failed") {
          throw new Error(statusData.error ?? "Video generation failed");
        }

        onProgress?.(`Veo 3.1: 영상 생성 중... (${statusData.progress ?? `${i + 1}/60`})`);
        await new Promise((r) => setTimeout(r, 10000));
      }

      throw new Error("Veo 3.1: 영상 생성 타임아웃");
    },

    parseProduct: async (url, html) => {
      const res = await serverFetch(config, "/ai/parse", { url, html });
      if (!res.ok) throw new Error(`AI parse failed: ${res.status}`);
      return res.json() as Promise<Product>;
    },

    analyzePerformance: async (reports) => {
      const res = await serverFetch(config, "/ai/analyze", { reports });
      if (!res.ok) throw new Error(`AI analyze failed: ${res.status}`);
      const { analysis } = await res.json() as { analysis: string };
      return analysis;
    },

    reportUsage: async (type, metadata) => {
      await serverFetch(config, "/usage/report", { type, metadata });
    },
  };
}

export function createAiProxy(config: ModeConfig): AiProxy {
  if (config.mode === "owner") return createOwnerProxy();
  return createCustomerProxy(config);
}
```

- [ ] **Step 4: 테스트 실행 (통과)**

```bash
npm test -- src/client/aiProxy.test.ts
```

- [ ] **Step 5: 커밋**

```bash
git add src/client/aiProxy.ts src/client/aiProxy.test.ts
git commit -m "feat: add aiProxy with Owner/Customer mode routing"
```

---

## Task 11: CLI 통합 (AppTypes + actions + App + app.ts)

**Files:**
- Modify: `src/tui/AppTypes.ts`
- Modify: `src/tui/actions.ts`
- Modify: `src/tui/App.tsx`
- Modify: `src/cli/app.ts`

- [ ] **Step 1: AppTypes.ts에 ownerOnly 추가**

`src/tui/AppTypes.ts`의 MenuItem에 `ownerOnly` 필드 추가:

```typescript
export interface MenuItem {
  key: ActionKey;
  label: string;
  description: string;
  needsInput: boolean;
  inputPrompt?: string;
  ownerOnly?: boolean;    // 추가
}
```

MENU_ITEMS의 improve 항목에 `ownerOnly: true` 추가:

```typescript
{ key: "improve",  label: "Improve",  description: "자율 개선",            needsInput: false, ownerOnly: true },
```

- [ ] **Step 2: actions.ts — aiProxy 경유로 변경**

`src/tui/actions.ts`의 주요 변경:
1. import 추가: `import type { AiProxy } from "../client/aiProxy.js";`
2. `runScrape`, `runGenerate`, `runLaunch`, `runMonitor`, `runImprove`, `runPipelineAction` 모두 첫 번째 파라미터로 `proxy: AiProxy`를 받도록 변경
3. 기존 `generateCopy(client, product)` → `proxy.generateCopy(product)` 로 교체
4. 기존 `generateImage(product)` → `proxy.generateImage(product)` 로 교체
5. 기존 `generateVideo(product, callback)` → `proxy.generateVideo(product, callback)` 로 교체
6. `runScrape`에서 Playwright는 로컬 실행 유지, 파싱만 `proxy.parseProduct(url, html)` 사용
7. `runLaunch`에서 성공 후 `proxy.reportUsage("campaign_launch", { campaignId })` 추가
8. `runMonitor` weekly에서 Claude 분석을 `proxy.analyzePerformance(reports)` 로 교체
9. `createAnthropicClient()` import 제거 (더 이상 직접 호출 안 함)

`runScrape` 변경 예시:
```typescript
export async function runScrape(
  proxy: AiProxy,
  url: string,
  onProgress: ProgressCallback
): Promise<DoneResult> {
  try {
    onProgress({ message: `스크래핑 중... ${url.slice(0, 40)}` });
    // Playwright는 로컬에서 실행
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      const html = await page.content();
      const product = await proxy.parseProduct(url, html);
      await writeJson(`data/products/${product.id}.json`, product);
      return {
        success: true,
        message: "Scrape 완료",
        logs: [`${product.name} 저장됨`],
      };
    } finally {
      await browser.close();
    }
  } catch (e) {
    return { success: false, message: "Scrape 실패", logs: [String(e)] };
  }
}
```

- [ ] **Step 3: App.tsx 변경**

주요 변경:
1. import 추가: `import { detectMode } from "../mode.js"`, `import { createAiProxy } from "../client/aiProxy.js"`, `import { validateLicense } from "../client/usageServer.js"`
2. App 컴포넌트 시작 시 `detectMode()` + Customer면 `validateLicense()`
3. `createAiProxy(config)` 생성 후 모든 action 호출에 proxy 전달
4. Customer 모드에서 `ownerOnly: true` 메뉴 항목 필터링
5. TUI 하단에 모드 표시: `Customer mode · AD-AI-XXXX`

- [ ] **Step 4: cli/app.ts 변경**

`src/cli/app.ts`:
```typescript
import "dotenv/config";
import React from "react";
import { render } from "ink";
import { App } from "../tui/App.js";

render(React.createElement(App));
```

(App 내부에서 detectMode() 호출하므로 app.ts 자체는 변경 최소)

- [ ] **Step 5: 전체 테스트 실행**

```bash
npm test
```

Expected: 기존 테스트 + 새 테스트 모두 PASS. actions.ts 시그니처 변경으로 인해 actions.test.ts는 업데이트 필요 없음 (buildOverallProgress, validateMonitorMode는 변경 없음).

- [ ] **Step 6: TypeScript 체크**

```bash
npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 7: 커밋**

```bash
git add src/tui/AppTypes.ts src/tui/actions.ts src/tui/App.tsx src/cli/app.ts
git commit -m "feat: integrate aiProxy into CLI — Owner/Customer mode routing"
```

---

## Task 12: 통합 검증

- [ ] **Step 1: TypeScript 오류 0개**

```bash
npx tsc --noEmit
```

- [ ] **Step 2: 전체 테스트 통과**

```bash
npm test
```

- [ ] **Step 3: 서버 시작 테스트**

```bash
npm run server &
sleep 2
curl -s http://localhost:3000/license/validate -H "Content-Type: application/json" -d '{"key":"nonexistent"}' | head -1
kill %1
```

Expected: `{"error":"Invalid license key"}`

- [ ] **Step 4: 어드민 테스트**

```bash
npm run admin -- create-license --email=test@example.com
npm run admin -- list-licenses
```

Expected: 라이선스 생성 + 목록 출력

- [ ] **Step 5: Owner 모드 TUI 확인**

```bash
npm run app
```

Expected: 기존과 동일하게 TUI 시작 (모든 메뉴 표시)

- [ ] **Step 6: .gitignore에 서버 DB 추가**

```bash
echo "server/data.db" >> .gitignore
echo "server/tmp/" >> .gitignore
echo "server/test.db" >> .gitignore
git add .gitignore
git commit -m "chore: ignore server DB and temp files"
```

- [ ] **Step 7: 최종 커밋 확인**

```bash
git log --oneline -15
```

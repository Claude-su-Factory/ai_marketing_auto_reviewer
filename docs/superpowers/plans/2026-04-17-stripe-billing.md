# Stripe 결제 연동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실시간 잔액 차감 + 자동 충전 모델로 Stripe 결제를 연동하여 과금 누수 없이 Customer 사용량을 과금한다.

**Architecture:** `server/billing.ts`가 선차감/환불/잔액체크를 SQLite 트랜잭션으로 관리하고, `server/stripe.ts`가 Stripe SDK를 래핑한다. 모든 AI 라우트에 `handleAiRoute` 공통 패턴을 적용하여 선차감 후 AI 호출, 실패 시 환불한다. Webhook으로 충전 결과를 비동기 수신한다.

**Tech Stack:** Stripe SDK, Express, better-sqlite3, 기존 서버 코드

**Spec:** `docs/superpowers/specs/2026-04-17-stripe-billing-design.md`

---

## 파일 구조 맵

### 신규 파일

| 파일 | 역할 |
|------|------|
| `server/billing.ts` | 잔액 관리 (선차감, 환불, 체크, 자동 충전 트리거) |
| `server/billing.test.ts` | 잔액 로직 테스트 |
| `server/stripe.ts` | Stripe SDK 래퍼 (Customer, Checkout, PaymentIntent) |
| `server/routes/stripeWebhook.ts` | POST /stripe/webhook 핸들러 |

### 수정 파일

| 파일 | 변경 |
|------|------|
| `server/db.ts` | licenses에 balance/recharge/payment_method 컬럼, usage_events에 status 컬럼 |
| `server/routes/aiCopy.ts` | 선차감 패턴 적용 |
| `server/routes/aiImage.ts` | 선차감 패턴 적용 |
| `server/routes/aiVideo.ts` | 선차감 패턴 적용 |
| `server/routes/aiParse.ts` | 선차감 패턴 적용 |
| `server/routes/aiAnalyze.ts` | 선차감 패턴 적용 |
| `server/index.ts` | Webhook 라우트 + orphaned events cleanup |
| `server/admin.ts` | --tier, Stripe Customer/Checkout, balance/add-balance |
| `package.json` | stripe 의존성 |
| `.env.example` | STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET |

---

## Task 1: Stripe 의존성 + 환경 설정

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Stripe SDK 설치**

```bash
cd /Users/yuhojin/Desktop/ad_ai && npm install stripe
```

- [ ] **Step 2: .env.example에 Stripe 변수 추가**

`.env.example` 끝에 추가:
```bash

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

- [ ] **Step 3: 커밋**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add Stripe SDK dependency"
```

---

## Task 2: DB 스키마 확장

**Files:**
- Modify: `server/db.ts`
- Modify: `server/db.test.ts`

- [ ] **Step 1: db.test.ts에 새 컬럼 테스트 추가**

`server/db.test.ts`에 테스트 추가:
```typescript
it("licenses table has balance_usd column", () => {
  db.prepare("INSERT INTO licenses (id, key, customer_email) VALUES (?, ?, ?)").run("id-bal", "AD-AI-BAL-TEST", "bal@test.com");
  const row = db.prepare("SELECT balance_usd, recharge_amount, recharge_tier FROM licenses WHERE id = ?").get("id-bal") as any;
  expect(row.balance_usd).toBe(0);
  expect(row.recharge_amount).toBe(20);
  expect(row.recharge_tier).toBe("standard");
});

it("usage_events table has status column", () => {
  db.prepare("INSERT INTO licenses (id, key, customer_email) VALUES (?, ?, ?)").run("id-status", "AD-AI-ST-TEST", "st@test.com");
  db.prepare("INSERT INTO usage_events (id, license_id, type, status) VALUES (?, ?, ?, ?)").run("ev1", "id-status", "copy_gen", "pending");
  const row = db.prepare("SELECT status FROM usage_events WHERE id = ?").get("ev1") as any;
  expect(row.status).toBe("pending");
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npm test -- server/db.test.ts
```

Expected: FAIL — `balance_usd` 컬럼 없음

- [ ] **Step 3: db.ts 스키마 업데이트**

`server/db.ts`의 `db.exec(...)` 블록 끝에 ALTER 문 추가. CREATE TABLE IF NOT EXISTS 내부에 새 컬럼을 직접 추가 (기존 DB가 없으면 바로 생성, 있으면 ALTER로 추가):

`server/db.ts`의 licenses 테이블 정의를 변경:
```sql
CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  customer_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  stripe_customer_id TEXT,
  balance_usd REAL NOT NULL DEFAULT 0,
  recharge_amount REAL NOT NULL DEFAULT 20,
  recharge_tier TEXT NOT NULL DEFAULT 'standard',
  stripe_payment_method_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

usage_events 테이블에 `status` 컬럼 추가:
```sql
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES licenses(id),
  type TEXT NOT NULL,
  ai_cost_usd REAL NOT NULL DEFAULT 0,
  charged_usd REAL NOT NULL DEFAULT 0,
  metadata TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

기존 DB 마이그레이션을 위해 CREATE TABLE 뒤에 안전한 ALTER 추가:
```typescript
// 기존 DB 마이그레이션 (컬럼 없으면 추가, 있으면 무시)
const safeAlter = (sql: string) => {
  try { db.exec(sql); } catch {}
};
safeAlter("ALTER TABLE licenses ADD COLUMN balance_usd REAL NOT NULL DEFAULT 0");
safeAlter("ALTER TABLE licenses ADD COLUMN recharge_amount REAL NOT NULL DEFAULT 20");
safeAlter("ALTER TABLE licenses ADD COLUMN recharge_tier TEXT NOT NULL DEFAULT 'standard'");
safeAlter("ALTER TABLE licenses ADD COLUMN stripe_payment_method_id TEXT");
safeAlter("ALTER TABLE usage_events ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'");
```

- [ ] **Step 4: 테스트 실행 (통과)**

```bash
npm test -- server/db.test.ts
```

- [ ] **Step 5: 전체 테스트 이상 없음 확인**

```bash
npm test
```

- [ ] **Step 6: 커밋**

```bash
git add server/db.ts server/db.test.ts
git commit -m "feat: add balance, recharge, and status columns to DB schema"
```

---

## Task 3: 잔액 관리 모듈 (server/billing.ts)

**Files:**
- Create: `server/billing.ts`
- Create: `server/billing.test.ts`

- [ ] **Step 1: 테스트 작성**

`server/billing.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type AppDb } from "./db.js";
import { createBillingService } from "./billing.js";
import { randomUUID } from "crypto";
import { unlinkSync, existsSync } from "fs";

const TEST_DB = "server/test-billing.db";
let db: AppDb;
let billing: ReturnType<typeof createBillingService>;
let licenseId: string;

beforeEach(() => {
  db = createDb(TEST_DB);
  billing = createBillingService(db);
  licenseId = randomUUID();
  db.prepare(
    "INSERT INTO licenses (id, key, customer_email, balance_usd, recharge_amount, recharge_tier) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(licenseId, "AD-AI-TEST-1234", "test@test.com", 10.0, 20, "standard");
});

afterEach(() => {
  db.close();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
});

describe("checkBalance", () => {
  it("returns true when balance is sufficient", () => {
    expect(billing.checkBalance(licenseId, 5.0)).toBe(true);
  });

  it("returns false when balance is insufficient", () => {
    expect(billing.checkBalance(licenseId, 15.0)).toBe(false);
  });

  it("returns false for exactly zero balance with non-zero cost", () => {
    db.prepare("UPDATE licenses SET balance_usd = 0 WHERE id = ?").run(licenseId);
    expect(billing.checkBalance(licenseId, 0.01)).toBe(false);
  });
});

describe("deductAndRecord", () => {
  it("reduces balance and creates pending usage event", () => {
    const eventId = billing.deductAndRecord(licenseId, "copy_gen", 0.003, 0.01);
    expect(eventId).toBeTruthy();

    const license = db.prepare("SELECT balance_usd FROM licenses WHERE id = ?").get(licenseId) as any;
    expect(license.balance_usd).toBeCloseTo(9.99);

    const event = db.prepare("SELECT * FROM usage_events WHERE id = ?").get(eventId) as any;
    expect(event.status).toBe("pending");
    expect(event.charged_usd).toBe(0.01);
  });
});

describe("confirmUsage", () => {
  it("sets usage event status to completed", () => {
    const eventId = billing.deductAndRecord(licenseId, "copy_gen", 0.003, 0.01);
    billing.confirmUsage(eventId);

    const event = db.prepare("SELECT status FROM usage_events WHERE id = ?").get(eventId) as any;
    expect(event.status).toBe("completed");
  });
});

describe("refund", () => {
  it("restores balance and marks event as refunded", () => {
    const eventId = billing.deductAndRecord(licenseId, "copy_gen", 0.003, 0.01);
    billing.refund(eventId, licenseId, 0.01);

    const license = db.prepare("SELECT balance_usd FROM licenses WHERE id = ?").get(licenseId) as any;
    expect(license.balance_usd).toBeCloseTo(10.0);

    const event = db.prepare("SELECT status FROM usage_events WHERE id = ?").get(eventId) as any;
    expect(event.status).toBe("refunded");
  });
});

describe("needsRecharge", () => {
  it("returns true when balance below threshold", () => {
    db.prepare("UPDATE licenses SET balance_usd = 4.0 WHERE id = ?").run(licenseId);
    expect(billing.needsRecharge(licenseId)).toBe(true);
  });

  it("returns false when balance above threshold", () => {
    expect(billing.needsRecharge(licenseId)).toBe(false);
  });
});

describe("addBalance", () => {
  it("increases balance by specified amount", () => {
    billing.addBalance(licenseId, 20.0);
    const license = db.prepare("SELECT balance_usd FROM licenses WHERE id = ?").get(licenseId) as any;
    expect(license.balance_usd).toBeCloseTo(30.0);
  });
});

describe("getLicense", () => {
  it("returns license with balance fields", () => {
    const license = billing.getLicense(licenseId);
    expect(license).not.toBeNull();
    expect(license!.balance_usd).toBe(10.0);
    expect(license!.recharge_tier).toBe("standard");
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패)**

```bash
npm test -- server/billing.test.ts
```

- [ ] **Step 3: billing.ts 구현**

`server/billing.ts`:
```typescript
import type { AppDb } from "./db.js";
import { PRICING } from "./pricing.js";
import { randomUUID } from "crypto";

const RECHARGE_THRESHOLD = 5.0;

export interface LicenseWithBalance {
  id: string;
  key: string;
  customer_email: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  balance_usd: number;
  recharge_amount: number;
  recharge_tier: string;
}

export function createBillingService(db: AppDb) {
  return {
    getLicense(licenseId: string): LicenseWithBalance | null {
      return db.prepare("SELECT * FROM licenses WHERE id = ?").get(licenseId) as LicenseWithBalance | null;
    },

    checkBalance(licenseId: string, required: number): boolean {
      const license = db.prepare("SELECT balance_usd FROM licenses WHERE id = ?").get(licenseId) as any;
      if (!license) return false;
      return license.balance_usd >= required;
    },

    deductAndRecord(
      licenseId: string,
      usageType: string,
      aiCost: number,
      charged: number
    ): string {
      const eventId = randomUUID();
      const txn = db.transaction(() => {
        db.prepare("UPDATE licenses SET balance_usd = balance_usd - ? WHERE id = ?").run(charged, licenseId);
        db.prepare(
          "INSERT INTO usage_events (id, license_id, type, ai_cost_usd, charged_usd, status, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(eventId, licenseId, usageType, aiCost, charged, "pending", "{}");
      });
      txn();
      return eventId;
    },

    confirmUsage(eventId: string): void {
      db.prepare("UPDATE usage_events SET status = 'completed' WHERE id = ?").run(eventId);
    },

    refund(eventId: string, licenseId: string, amount: number): void {
      const txn = db.transaction(() => {
        db.prepare("UPDATE licenses SET balance_usd = balance_usd + ? WHERE id = ?").run(amount, licenseId);
        db.prepare("UPDATE usage_events SET status = 'refunded' WHERE id = ?").run(eventId);
      });
      txn();
    },

    needsRecharge(licenseId: string): boolean {
      const license = db.prepare("SELECT balance_usd, recharge_amount FROM licenses WHERE id = ?").get(licenseId) as any;
      if (!license) return false;
      return license.balance_usd < RECHARGE_THRESHOLD && license.recharge_amount > 0;
    },

    addBalance(licenseId: string, amount: number): void {
      db.prepare("UPDATE licenses SET balance_usd = balance_usd + ? WHERE id = ?").run(amount, licenseId);
    },

    suspendLicense(licenseId: string): void {
      db.prepare("UPDATE licenses SET status = 'suspended' WHERE id = ?").run(licenseId);
    },

    activateLicense(licenseId: string): void {
      db.prepare("UPDATE licenses SET status = 'active' WHERE id = ?").run(licenseId);
    },

    setPaymentMethod(licenseId: string, paymentMethodId: string): void {
      db.prepare("UPDATE licenses SET stripe_payment_method_id = ? WHERE id = ?").run(paymentMethodId, licenseId);
    },

    cleanupOrphanedEvents(): number {
      const orphaned = db.prepare(
        "SELECT id, license_id, charged_usd FROM usage_events WHERE status = 'pending'"
      ).all() as Array<{ id: string; license_id: string; charged_usd: number }>;

      for (const event of orphaned) {
        const txn = db.transaction(() => {
          db.prepare("UPDATE licenses SET balance_usd = balance_usd + ? WHERE id = ?").run(event.charged_usd, event.license_id);
          db.prepare("UPDATE usage_events SET status = 'refunded' WHERE id = ?").run(event.id);
        });
        txn();
      }

      return orphaned.length;
    },
  };
}

export type BillingService = ReturnType<typeof createBillingService>;
```

- [ ] **Step 4: 테스트 실행 (통과)**

```bash
npm test -- server/billing.test.ts
```

- [ ] **Step 5: 커밋**

```bash
git add server/billing.ts server/billing.test.ts
git commit -m "feat: add billing service with deduct-first pattern and refund"
```

---

## Task 4: Stripe SDK 래퍼 (server/stripe.ts)

**Files:**
- Create: `server/stripe.ts`
- Create: `server/stripe.test.ts`

- [ ] **Step 1: 테스트 작성**

`server/stripe.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { getTierAmount, RECHARGE_TIERS } from "./stripe.js";

describe("RECHARGE_TIERS", () => {
  it("has basic, standard, pro tiers", () => {
    expect(RECHARGE_TIERS.basic).toBe(10);
    expect(RECHARGE_TIERS.standard).toBe(20);
    expect(RECHARGE_TIERS.pro).toBe(50);
  });
});

describe("getTierAmount", () => {
  it("returns correct amount for valid tier", () => {
    expect(getTierAmount("standard")).toBe(20);
  });

  it("returns default 20 for unknown tier", () => {
    expect(getTierAmount("unknown")).toBe(20);
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패)**

```bash
npm test -- server/stripe.test.ts
```

- [ ] **Step 3: stripe.ts 구현**

`server/stripe.ts`:
```typescript
import Stripe from "stripe";

export const RECHARGE_TIERS: Record<string, number> = {
  basic: 10,
  standard: 20,
  pro: 50,
};

export function getTierAmount(tier: string): number {
  return RECHARGE_TIERS[tier] ?? 20;
}

export function createStripeClient(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2025-03-31.basil",
  });
}

export async function createStripeCustomer(
  stripe: Stripe,
  email: string,
  licenseKey: string
): Promise<string> {
  const customer = await stripe.customers.create({
    email,
    metadata: { licenseKey },
  });
  return customer.id;
}

export async function createCheckoutSession(
  stripe: Stripe,
  customerId: string,
  amount: number,
  licenseId: string,
  successUrl = "https://ad-ai.com/success",
  cancelUrl = "https://ad-ai.com/cancel"
): Promise<string> {
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "payment",
    payment_intent_data: {
      setup_future_usage: "off_session",
      metadata: { licenseId, type: "initial_charge" },
    },
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: "AD-AI Credits" },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  return session.url!;
}

export async function triggerAutoRecharge(
  stripe: Stripe,
  customerId: string,
  paymentMethodId: string,
  amount: number,
  licenseId: string
): Promise<void> {
  await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: "usd",
    customer: customerId,
    payment_method: paymentMethodId,
    off_session: true,
    confirm: true,
    metadata: { licenseId, type: "auto_recharge" },
  });
}
```

- [ ] **Step 4: 테스트 실행 (통과)**

```bash
npm test -- server/stripe.test.ts
```

- [ ] **Step 5: 커밋**

```bash
git add server/stripe.ts server/stripe.test.ts
git commit -m "feat: add Stripe SDK wrapper with customer, checkout, recharge"
```

---

## Task 5: Webhook 핸들러

**Files:**
- Create: `server/routes/stripeWebhook.ts`

- [ ] **Step 1: stripeWebhook.ts 구현**

`server/routes/stripeWebhook.ts`:
```typescript
import { Router } from "express";
import Stripe from "stripe";
import type { BillingService } from "../billing.js";
import type { AppDb } from "../db.js";

export function createStripeWebhookRouter(
  stripe: Stripe,
  webhookSecret: string,
  billing: BillingService,
  db: AppDb
) {
  const router = Router();

  router.post("/stripe/webhook", (req, res) => {
    const sig = req.headers["stripe-signature"] as string;
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (e) {
      console.error("[Webhook] Signature verification failed:", e);
      res.status(400).json({ error: "Webhook signature failed" });
      return;
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const licenseId = session.metadata?.licenseId
          ?? (session.payment_intent as any)?.metadata?.licenseId;

        if (licenseId) {
          const amount = (session.amount_total ?? 0) / 100;
          billing.addBalance(licenseId, amount);
          billing.activateLicense(licenseId);

          // 결제 수단 저장
          if (session.payment_intent) {
            const piId = typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent.id;

            stripe.paymentIntents.retrieve(piId).then((pi) => {
              if (pi.payment_method) {
                const pmId = typeof pi.payment_method === "string"
                  ? pi.payment_method
                  : pi.payment_method.id;
                billing.setPaymentMethod(licenseId, pmId);
              }
            }).catch(() => {});
          }

          console.log(`[Webhook] Checkout completed: license ${licenseId}, +$${amount}`);
        }
        break;
      }

      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        // 자동 충전만 처리 (첫 결제는 checkout.session.completed에서 처리)
        if (pi.metadata?.type === "auto_recharge" && pi.metadata?.licenseId) {
          const amount = pi.amount / 100;
          billing.addBalance(pi.metadata.licenseId, amount);
          console.log(`[Webhook] Auto-recharge succeeded: license ${pi.metadata.licenseId}, +$${amount}`);
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        if (pi.metadata?.licenseId) {
          billing.suspendLicense(pi.metadata.licenseId);
          console.log(`[Webhook] Payment failed: license ${pi.metadata.licenseId} suspended`);
        }
        break;
      }
    }

    res.json({ received: true });
  });

  return router;
}
```

- [ ] **Step 2: 커밋**

```bash
git add server/routes/stripeWebhook.ts
git commit -m "feat: add Stripe webhook handler with dedup and auto-recharge"
```

---

## Task 6: AI 라우트에 선차감 패턴 적용

**Files:**
- Modify: `server/routes/aiCopy.ts`
- Modify: `server/routes/aiImage.ts`
- Modify: `server/routes/aiParse.ts`
- Modify: `server/routes/aiAnalyze.ts`
- Modify: `server/routes/aiVideo.ts`

모든 AI 라우트에 동일한 패턴을 적용한다. 기존 로직을 `billing.checkBalance → billing.deductAndRecord → AI 호출 → billing.confirmUsage / billing.refund`로 감싼다.

- [ ] **Step 1: aiCopy.ts 수정**

`server/routes/aiCopy.ts`를 아래로 교체:
```typescript
import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { generateCopy } from "../../src/generator/copy.js";
import type { Product } from "../../src/types.js";
import type { BillingService } from "../billing.js";
import { PRICING } from "../pricing.js";
import { createStripeClient, triggerAutoRecharge } from "../stripe.js";

export function createAiCopyRouter(billing: BillingService) {
  const router = Router();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  router.post("/ai/copy", async (req, res) => {
    const { product } = req.body as { product: Product };
    const licenseId = (req as any).licenseId;
    const pricing = PRICING.copy_gen;

    if (!billing.checkBalance(licenseId, pricing.charged)) {
      res.status(402).json({ error: "잔액 부족", required: pricing.charged });
      return;
    }

    const eventId = billing.deductAndRecord(licenseId, "copy_gen", pricing.aiCost, pricing.charged);

    try {
      const copy = await generateCopy(client, product);
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

  return router;
}
```

- [ ] **Step 2: aiImage.ts 수정**

동일 패턴 적용. `createAiImageRouter(billing: BillingService)` 시그니처로 변경. `PRICING.image_gen` 사용. 기존 AI 호출 로직은 유지하되 선차감/확인/환불로 감싼다.

- [ ] **Step 3: aiParse.ts 수정**

동일 패턴. `PRICING.parse` 사용.

- [ ] **Step 4: aiAnalyze.ts 수정**

동일 패턴. `PRICING.analyze` 사용.

- [ ] **Step 5: aiVideo.ts 수정**

Video는 특별: POST /ai/video에서 선차감, 잡 완료 시 confirmUsage, 잡 실패 시 refund.

`server/routes/aiVideo.ts` 수정:
```typescript
import { Router } from "express";
import { startVideoJob, getJob } from "../jobs/videoJob.js";
import type { Product } from "../../src/types.js";
import type { BillingService } from "../billing.js";
import { PRICING } from "../pricing.js";

export function createAiVideoRouter(billing: BillingService, serverBaseUrl: string) {
  const router = Router();

  router.post("/ai/video", async (req, res) => {
    const { product } = req.body as { product: Product };
    const licenseId = (req as any).licenseId;
    const pricing = PRICING.video_gen;

    if (!billing.checkBalance(licenseId, pricing.charged)) {
      res.status(402).json({ error: "잔액 부족", required: pricing.charged });
      return;
    }

    const eventId = billing.deductAndRecord(licenseId, "video_gen", pricing.aiCost, pricing.charged);

    try {
      // startVideoJob에 eventId 전달 → 완료/실패 시 billing 호출
      const jobId = await startVideoJob(product, licenseId, serverBaseUrl, billing, eventId);
      res.json({ jobId, status: "pending" });
    } catch (e) {
      billing.refund(eventId, licenseId, pricing.charged);
      res.status(500).json({ error: "영상 생성 시작 실패. 잔액이 환불되었습니다." });
    }
  });

  router.get("/ai/video/status/:jobId", (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }
    if (job.licenseId !== (req as any).licenseId) { res.status(403).json({ error: "Access denied" }); return; }

    if (job.status === "pending") res.json({ status: "pending", progress: job.progress });
    else if (job.status === "done") res.json({ status: "done", downloadUrl: job.downloadUrl });
    else res.json({ status: "failed", error: job.error });
  });

  return router;
}
```

- [ ] **Step 6: videoJob.ts 수정**

`server/jobs/videoJob.ts`에서:
- `startVideoJob` 시그니처에 `billing: BillingService, eventId: string` 추가
- DB 직접 접근 대신 `billing.confirmUsage(eventId)` / `billing.refund(eventId, ...)` 사용
- 기존 `db` 파라미터 제거

- [ ] **Step 7: 전체 테스트 실행**

```bash
npm test
```

- [ ] **Step 8: 커밋**

```bash
git add server/routes/aiCopy.ts server/routes/aiImage.ts server/routes/aiParse.ts server/routes/aiAnalyze.ts server/routes/aiVideo.ts server/jobs/videoJob.ts
git commit -m "feat: apply deduct-first billing pattern to all AI routes"
```

---

## Task 7: 서버 조립 업데이트

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: server/index.ts 수정**

주요 변경:
1. Webhook 라우트를 `express.json()` 이전에 등록 (raw body 필요)
2. `createBillingService(db)` 생성
3. 모든 AI 라우트에 `billing` 전달 (기존 `db` 대신)
4. 서버 시작 시 `billing.cleanupOrphanedEvents()` 호출
5. Stripe 클라이언트 + webhook secret 전달

```typescript
import "dotenv/config";
import express from "express";
import { existsSync, mkdirSync } from "fs";
import { createDb } from "./db.js";
import { createSessionStore } from "./auth.js";
import { createRateLimiter } from "./rateLimit.js";
import { createBillingService } from "./billing.js";
import { createStripeClient } from "./stripe.js";
import { createLicenseRouter } from "./routes/license.js";
import { createAiCopyRouter } from "./routes/aiCopy.js";
import { createAiImageRouter } from "./routes/aiImage.js";
import { createAiVideoRouter } from "./routes/aiVideo.js";
import { createAiParseRouter } from "./routes/aiParse.js";
import { createAiAnalyzeRouter } from "./routes/aiAnalyze.js";
import { createUsageRouter } from "./routes/usage.js";
import { createStripeWebhookRouter } from "./routes/stripeWebhook.js";
import { cleanupOldFiles } from "./jobs/videoJob.js";

const PORT = Number(process.env.SERVER_PORT ?? 3000);
const SERVER_URL = process.env.SERVER_BASE_URL ?? `http://localhost:${PORT}`;

const db = createDb();
const sessions = createSessionStore();
const rateLimiter = createRateLimiter(10, 60000);
const billing = createBillingService(db);

// Orphaned pending events 정리 (서버 재시작 시)
const orphanedCount = billing.cleanupOrphanedEvents();
if (orphanedCount > 0) console.log(`[Billing] ${orphanedCount}개 orphaned pending events 환불 완료`);

const app = express();

// Stripe Webhook은 raw body 필요 — express.json() 이전에 등록
if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET) {
  const stripe = createStripeClient();
  app.use(createStripeWebhookRouter(stripe, process.env.STRIPE_WEBHOOK_SECRET, billing, db));
}

app.use(express.json({ limit: "10mb" }));

// Static files
const tmpDir = "server/tmp";
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
app.use("/files", express.static(tmpDir));

// License (no auth)
app.use(createLicenseRouter(db, sessions));

// Auth + rate limit middleware
const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) { res.status(401).json({ error: "Authorization header required" }); return; }
  const token = authHeader.slice(7);
  const session = sessions.validate(token);
  if (!session) { res.status(401).json({ error: "Invalid or expired session token" }); return; }
  (req as any).licenseId = session.licenseId;
  next();
};

const rateLimitMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const rateResult = rateLimiter.check((req as any).licenseId);
  if (!rateResult.allowed) { res.status(429).json({ error: "Rate limit exceeded", retryAfter: rateResult.retryAfter }); return; }
  next();
};

app.use("/ai", authMiddleware, rateLimitMiddleware);
app.use("/usage", authMiddleware);

// Routes (billing instead of db for AI routes)
app.use(createAiCopyRouter(billing));
app.use(createAiImageRouter(billing));
app.use(createAiVideoRouter(billing, SERVER_URL));
app.use(createAiParseRouter(billing));
app.use(createAiAnalyzeRouter(billing));
app.use(createUsageRouter(db));

// Cleanup
setInterval(cleanupOldFiles, 60 * 60 * 1000);
cleanupOldFiles();

app.listen(PORT, () => {
  console.log(`[Usage Server] Running on ${SERVER_URL}`);
});
```

- [ ] **Step 2: TypeScript 체크**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: 커밋**

```bash
git add server/index.ts
git commit -m "feat: integrate billing + webhook into Express server"
```

---

## Task 8: Admin CLI 업데이트

**Files:**
- Modify: `server/admin.ts`
- Modify: `server/adminUtils.ts`

- [ ] **Step 1: admin.ts 수정**

`create-license` 명령에 `--tier` 옵션 추가 + Stripe Customer/Checkout 생성.
`balance`, `add-balance` 명령 추가.

`server/admin.ts`를 업데이트:
```typescript
import "dotenv/config";
import { createDb } from "./db.js";
import { createBillingService } from "./billing.js";
import { createStripeClient, createStripeCustomer, createCheckoutSession, getTierAmount } from "./stripe.js";
import { generateKey, getFlag } from "./adminUtils.js";
import { randomUUID } from "crypto";

const db = createDb();
const billing = createBillingService(db);
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "create-license": {
    const email = getFlag(args, "email");
    const tier = getFlag(args, "tier") ?? "standard";
    if (!email) { console.error("Usage: npm run admin -- create-license --email=<email> [--tier=basic|standard|pro]"); process.exit(1); }

    const id = randomUUID();
    const key = generateKey();
    const rechargeAmount = getTierAmount(tier);

    db.prepare(
      "INSERT INTO licenses (id, key, customer_email, status, recharge_amount, recharge_tier) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, key, email, "pending_payment", rechargeAmount, tier);

    // Stripe Customer + Checkout (if Stripe configured)
    if (process.env.STRIPE_SECRET_KEY) {
      const stripe = createStripeClient();
      createStripeCustomer(stripe, email, key).then(async (customerId) => {
        db.prepare("UPDATE licenses SET stripe_customer_id = ? WHERE id = ?").run(customerId, id);
        const checkoutUrl = await createCheckoutSession(stripe, customerId, rechargeAmount, id);
        console.log(`License: ${key}`);
        console.log(`Email: ${email}`);
        console.log(`Tier: ${tier} ($${rechargeAmount} auto-recharge)`);
        console.log(`Payment URL: ${checkoutUrl}`);
        console.log(`Status: pending_payment (결제 완료 후 active)`);
      }).catch((e) => {
        console.error("Stripe error:", e);
        console.log(`License: ${key} (Stripe 연동 실패, 수동 활성화 필요)`);
      });
    } else {
      // Stripe 없으면 바로 active
      db.prepare("UPDATE licenses SET status = 'active' WHERE id = ?").run(id);
      console.log(`License: ${key}`);
      console.log(`Email: ${email}`);
      console.log(`Status: active (Stripe 미설정, 무료 사용)`);
    }
    break;
  }

  case "list-licenses": {
    const rows = db.prepare("SELECT key, customer_email, status, balance_usd, recharge_tier, created_at FROM licenses ORDER BY created_at DESC").all() as any[];
    if (rows.length === 0) { console.log("No licenses found."); break; }
    for (const r of rows) {
      console.log(`${r.key}  ${r.customer_email}  ${r.status}  $${r.balance_usd.toFixed(2)}  ${r.recharge_tier}  ${r.created_at}`);
    }
    break;
  }

  case "suspend-license": {
    const key = getFlag(args, "key");
    if (!key) { console.error("Usage: npm run admin -- suspend-license --key=<key>"); process.exit(1); }
    const license = db.prepare("SELECT id FROM licenses WHERE key = ?").get(key) as any;
    if (!license) { console.error(`License not found: ${key}`); process.exit(1); }
    billing.suspendLicense(license.id);
    console.log(`License ${key} suspended`);
    break;
  }

  case "balance": {
    const key = getFlag(args, "key");
    if (!key) { console.error("Usage: npm run admin -- balance --key=<key>"); process.exit(1); }
    const license = db.prepare("SELECT * FROM licenses WHERE key = ?").get(key) as any;
    if (!license) { console.error(`License not found: ${key}`); process.exit(1); }
    console.log(`Balance: $${license.balance_usd.toFixed(2)} (tier: ${license.recharge_tier}, recharge at < $5)`);
    break;
  }

  case "add-balance": {
    const key = getFlag(args, "key");
    const amount = Number(getFlag(args, "amount"));
    if (!key || !amount) { console.error("Usage: npm run admin -- add-balance --key=<key> --amount=<USD>"); process.exit(1); }
    const license = db.prepare("SELECT id, balance_usd FROM licenses WHERE key = ?").get(key) as any;
    if (!license) { console.error(`License not found: ${key}`); process.exit(1); }
    billing.addBalance(license.id, amount);
    console.log(`Balance updated: $${(license.balance_usd + amount).toFixed(2)}`);
    break;
  }

  case "usage": {
    const key = getFlag(args, "key");
    if (!key) { console.error("Usage: npm run admin -- usage --key=<key>"); process.exit(1); }
    const license = db.prepare("SELECT id FROM licenses WHERE key = ?").get(key) as any;
    if (!license) { console.error(`License not found: ${key}`); process.exit(1); }
    const events = db.prepare(
      "SELECT type, COUNT(*) as count, SUM(charged_usd) as total FROM usage_events WHERE license_id = ? AND status = 'completed' GROUP BY type"
    ).all(license.id) as Array<{ type: string; count: number; total: number }>;
    if (events.length === 0) { console.log("No usage recorded."); break; }
    for (const e of events) {
      console.log(`${e.type}: ${e.count} ($${e.total.toFixed(2)})`);
    }
    break;
  }

  default:
    console.log("Commands: create-license, list-licenses, suspend-license, balance, add-balance, usage");
}
```

- [ ] **Step 2: 커밋**

```bash
git add server/admin.ts
git commit -m "feat: update admin CLI with Stripe integration, balance, tier commands"
```

---

## Task 9: 통합 검증

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
curl -s http://localhost:3000/license/validate -H "Content-Type: application/json" -d '{"key":"nonexistent"}'
kill %1
```

Expected: `{"error":"Invalid license key"}`

- [ ] **Step 4: Admin balance 명령 테스트**

```bash
npm run admin -- create-license --email=test@example.com --tier=basic
npm run admin -- list-licenses
```

Expected: pending_payment 상태의 라이선스 + balance $0

- [ ] **Step 5: .gitignore 확인**

`server/data.db`, `server/tmp/`, `server/test*.db` 모두 .gitignore에 있는지 확인.

- [ ] **Step 6: 최종 커밋 확인**

```bash
git log --oneline -10
```

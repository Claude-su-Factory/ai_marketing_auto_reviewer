# Stripe Webhook Dedup 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stripe가 네트워크 실패 시 동일 Webhook 이벤트를 재시도할 때 발생하는 이중 결제/이중 잔액 추가를 방지한다.

**Architecture:** 새 테이블 `stripe_events (event_id TEXT PRIMARY KEY, processed_at DATETIME DEFAULT CURRENT_TIMESTAMP)`를 추가하고, Webhook 핸들러 진입 시 `INSERT OR IGNORE`로 이벤트를 기록한다. `db.changes() === 0`이면 중복 수신이므로 200을 반환하고 실제 처리를 스킵한다. 서명 검증(기존 로직)은 dedup 체크 이전에 수행한다.

**Tech Stack:** better-sqlite3, Stripe Node SDK (`stripe.webhooks.generateTestHeaderString` / `constructEvent`), Express, Vitest.

**배경 — SP3 스펙의 "Webhook 중복 방지"와의 차이:**
SP3 스펙 177줄 "Webhook 중복 방지"는 동일 결제에서 발생하는 `checkout.session.completed`와 `payment_intent.succeeded` 두 이벤트를 `metadata.type`으로 분리하는 설계이며 이미 구현되어 있다. 본 플랜은 **같은 `event.id`가 재수신되는 경우**(Stripe HTTP 재시도)를 다루며, SP3에서 누락된 부분이다.

**함께 수정하는 선행 결함 — `express.raw()` 미들웨어 누락:**
SP3 스펙 157행은 `app.post("/stripe/webhook", express.raw({ type: "application/json" }), ...)`을 요구하지만, 실제 `server/routes/stripeWebhook.ts`와 `server/index.ts` 모두에 적용되어 있지 않다. 이 상태로는 `req.body`가 `undefined`여서 `stripe.webhooks.constructEvent()`가 항상 실패하므로 현재 프로덕션 Webhook은 작동하지 않는다. Task 0에서 이 결함도 함께 수정한다 — dedup 통합 테스트(Task 4)가 이 수정을 동시에 검증할 수 있다.

---

## 파일 구조

**생성:**
- `server/webhookDedup.ts` — `markEventProcessed(db, eventId): boolean` 단일 함수. `true`면 최초 처리, `false`면 중복.
- `server/webhookDedup.test.ts` — 단위 테스트.
- `server/routes/stripeWebhook.test.ts` — 통합 테스트 (라우터 레벨).

**수정:**
- `server/db.ts` — `stripe_events` 테이블 CREATE 구문 추가.
- `server/db.test.ts` — 신규 테이블 생성 확인 테스트 추가.
- `server/routes/stripeWebhook.ts` — 서명 검증 직후 dedup 체크 통합.
- `docs/superpowers/specs/2026-04-17-stripe-billing-design.md` — "Webhook Idempotency Addendum" 섹션 추가.
- `docs/STATUS.md` — "알려진 결함"에서 Webhook dedup 제거, 컴포넌트 상태 ✅로 복원.
- `docs/ROADMAP.md` — Tier 1의 Webhook dedup 항목 제거, SP4가 다시 최우선.
- `docs/ARCHITECTURE.md` — 설계 결정 #5의 "⚠️ 미해결 이슈" 블록 삭제, dedup 메커니즘 설명 추가.

---

## Task 0: Webhook 라우터에 `express.raw()` 미들웨어 적용 (선행 결함)

**Files:**
- Modify: `server/routes/stripeWebhook.ts`

- [ ] **Step 1: import에 express 추가**

`server/routes/stripeWebhook.ts` 최상단 import 블록에 추가:

```typescript
import express from "express";
```

`Router`는 이미 `express`에서 import 되고 있으므로 `import express, { Router } from "express";`로 병합해도 됨.

- [ ] **Step 2: `router.post` 시그니처에 raw 미들웨어 삽입**

Before:
```typescript
  router.post("/stripe/webhook", (req, res) => {
```

After:
```typescript
  router.post("/stripe/webhook", express.raw({ type: "application/json" }), (req, res) => {
```

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: 기존 회귀**

Run: `npx vitest run`
Expected: PASS — 기존 테스트 모두 통과. (이 수정은 미들웨어를 기본값 없이 추가만 하므로 다른 라우트에 영향 없음.)

- [ ] **Step 5: 커밋**

```bash
git add server/routes/stripeWebhook.ts
git commit -m "fix: apply express.raw body parser to Stripe webhook route"
```

이 커밋은 SP3 구현에서 누락된 선행 결함을 수정한다. 통합 테스트는 Task 4에서 추가.

---

## Task 1: `stripe_events` 테이블 추가

**Files:**
- Modify: `server/db.ts`
- Modify: `server/db.test.ts`

- [ ] **Step 1: db.test.ts에 실패 테스트 추가**

`server/db.test.ts`의 `describe("createDb", ...)` 블록 안에 추가:

```typescript
it("creates stripe_events table with event_id primary key", () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
  expect(tables.map((t) => t.name)).toContain("stripe_events");

  const info = db.prepare("PRAGMA table_info(stripe_events)").all() as Array<{ name: string; pk: number }>;
  const pk = info.find((c) => c.pk === 1);
  expect(pk?.name).toBe("event_id");
});

it("stripe_events rejects duplicate event_id", () => {
  db.prepare("INSERT INTO stripe_events (event_id) VALUES (?)").run("evt_123");
  expect(() => db.prepare("INSERT INTO stripe_events (event_id) VALUES (?)").run("evt_123")).toThrow(/UNIQUE/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run server/db.test.ts`
Expected: FAIL — "stripe_events" 테이블이 없어 `tables.map(...)`에 포함되지 않음.

- [ ] **Step 3: 최소 구현**

`server/db.ts`의 `db.exec(\`...\`)` 블록 안 `billing_cycles` 테이블 정의 뒤에 추가 (기존 문자열 템플릿 내부 끝):

```typescript
    CREATE TABLE IF NOT EXISTS stripe_events (
      event_id TEXT PRIMARY KEY,
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run server/db.test.ts`
Expected: PASS — 모든 db 테스트 통과.

- [ ] **Step 5: 커밋**

```bash
git add server/db.ts server/db.test.ts
git commit -m "feat: add stripe_events table for webhook dedup"
```

---

## Task 2: `webhookDedup` 헬퍼 구현

**Files:**
- Create: `server/webhookDedup.ts`
- Create: `server/webhookDedup.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`server/webhookDedup.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type AppDb } from "./db.js";
import { markEventProcessed } from "./webhookDedup.js";
import { unlinkSync, existsSync } from "fs";

const TEST_DB = "server/test-dedup.db";
let db: AppDb;

beforeEach(() => { db = createDb(TEST_DB); });
afterEach(() => { db.close(); if (existsSync(TEST_DB)) unlinkSync(TEST_DB); });

describe("markEventProcessed", () => {
  it("returns true on first call with a new event_id", () => {
    expect(markEventProcessed(db, "evt_new_1")).toBe(true);
  });

  it("returns false on second call with the same event_id", () => {
    markEventProcessed(db, "evt_dup_1");
    expect(markEventProcessed(db, "evt_dup_1")).toBe(false);
  });

  it("persists the event_id so that subsequent calls still return false", () => {
    markEventProcessed(db, "evt_persist");
    markEventProcessed(db, "evt_persist");
    expect(markEventProcessed(db, "evt_persist")).toBe(false);
  });

  it("treats different event_ids independently", () => {
    expect(markEventProcessed(db, "evt_a")).toBe(true);
    expect(markEventProcessed(db, "evt_b")).toBe(true);
    expect(markEventProcessed(db, "evt_a")).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run server/webhookDedup.test.ts`
Expected: FAIL — `./webhookDedup.js`가 존재하지 않음 (Cannot find module).

- [ ] **Step 3: 최소 구현**

`server/webhookDedup.ts`:

```typescript
import type { AppDb } from "./db.js";

export function markEventProcessed(db: AppDb, eventId: string): boolean {
  const result = db.prepare("INSERT OR IGNORE INTO stripe_events (event_id) VALUES (?)").run(eventId);
  return result.changes === 1;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run server/webhookDedup.test.ts`
Expected: PASS — 4개 테스트 모두 통과.

- [ ] **Step 5: 커밋**

```bash
git add server/webhookDedup.ts server/webhookDedup.test.ts
git commit -m "feat: add webhook dedup helper with INSERT OR IGNORE"
```

---

## Task 3: Webhook 핸들러에 dedup 통합

**Files:**
- Modify: `server/routes/stripeWebhook.ts`

- [ ] **Step 1: 함수 시그니처 변경 — AppDb 인자 추가**

현재 함수 시그니처 (파일 상단):

```typescript
export function createStripeWebhookRouter(
  stripe: Stripe,
  webhookSecret: string,
  billing: BillingService
) {
```

이렇게 변경:

```typescript
import type { AppDb } from "../db.js";
import { markEventProcessed } from "../webhookDedup.js";

export function createStripeWebhookRouter(
  stripe: Stripe,
  webhookSecret: string,
  billing: BillingService,
  db: AppDb
) {
```

- [ ] **Step 2: dedup 체크를 서명 검증 직후 삽입**

기존 서명 검증 catch 블록 바로 뒤 (switch 문 이전)에 삽입:

```typescript
    // Dedup: Stripe가 같은 이벤트를 재시도할 수 있으므로 event.id로 중복 체크
    if (!markEventProcessed(db, event.id)) {
      console.log(`[Webhook] Duplicate event ignored: ${event.id}`);
      res.json({ received: true, duplicate: true });
      return;
    }

    switch (event.type) {
```

전체 결과는 다음과 같이 보여야 한다 (서명 검증 블록부터 switch 시작까지):

```typescript
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (e) {
      console.error("[Webhook] Signature verification failed:", e);
      res.status(400).json({ error: "Webhook signature failed" });
      return;
    }

    if (!markEventProcessed(db, event.id)) {
      console.log(`[Webhook] Duplicate event ignored: ${event.id}`);
      res.json({ received: true, duplicate: true });
      return;
    }

    switch (event.type) {
```

- [ ] **Step 3: server/index.ts에서 db 전달**

`server/index.ts` 34-37행 (Stripe webhook 등록 블록)을 다음과 같이 수정:

```typescript
if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET) {
  const stripe = createStripeClient();
  app.use(createStripeWebhookRouter(stripe, process.env.STRIPE_WEBHOOK_SECRET, billing, db));
}
```

(4번째 인자 `db` 추가. `db`는 같은 파일 22행에서 이미 생성되어 있음.)

- [ ] **Step 4: 타입 체크**

Run: `npx tsc --noEmit`
Expected: PASS — 타입 에러 없음.

- [ ] **Step 5: 기존 전체 테스트 회귀 확인**

Run: `npx vitest run`
Expected: PASS — 기존 테스트 모두 통과 (webhook 핸들러 통합 테스트는 Task 4에서 추가).

- [ ] **Step 6: 커밋**

```bash
git add server/routes/stripeWebhook.ts server/index.ts
git commit -m "feat: integrate dedup check into Stripe webhook handler"
```

---

## Task 4: Webhook 핸들러 통합 테스트

**Files:**
- Create: `server/routes/stripeWebhook.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Stripe SDK가 제공하는 `stripe.webhooks.generateTestHeaderString`으로 유효한 서명을 생성하고, 같은 이벤트를 두 번 POST했을 때 잔액이 한 번만 증가하는지 검증한다.

`server/routes/stripeWebhook.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import Stripe from "stripe";
import { createDb, type AppDb } from "../db.js";
import { createBillingService } from "../billing.js";
import { createStripeWebhookRouter } from "./stripeWebhook.js";
import { unlinkSync, existsSync } from "fs";
import { randomUUID } from "crypto";

const WEBHOOK_SECRET = "whsec_test_secret";

let db: AppDb;
let app: express.Express;
let licenseId: string;
let stripe: Stripe;
let testDbPath: string;

beforeEach(() => {
  testDbPath = `server/test-webhook-${randomUUID()}.db`;
  db = createDb(testDbPath);
  const billing = createBillingService(db);
  licenseId = randomUUID();
  db.prepare(
    "INSERT INTO licenses (id, key, customer_email, status, balance_usd) VALUES (?, ?, ?, ?, ?)"
  ).run(licenseId, "AD-AI-TEST-DEDUP", "test@test.com", "pending", 0);

  stripe = new Stripe("sk_test_dummy", { apiVersion: "2024-12-18.acacia" as any });
  app = express();
  // Task 0에서 라우터 자체에 express.raw가 적용되었으므로 여기서는 별도 설정 불필요.
  app.use(createStripeWebhookRouter(stripe, WEBHOOK_SECRET, billing, db));
});

afterEach(() => {
  db.close();
  if (existsSync(testDbPath)) unlinkSync(testDbPath);
});

function buildSignedRequest(event: any): { body: Buffer; signature: string } {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return { body: Buffer.from(payload), signature };
}

async function postWebhook(body: Buffer, signature: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      fetch(`http://127.0.0.1:${port}/stripe/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "stripe-signature": signature },
        body,
      })
        .then(async (r) => {
          const b = await r.json();
          server.close();
          resolve({ status: r.status, body: b });
        })
        .catch((e) => { server.close(); reject(e); });
    });
  });
}

describe("Stripe webhook dedup", () => {
  it("processes checkout.session.completed once and adds balance", async () => {
    const event = {
      id: "evt_test_once",
      type: "checkout.session.completed",
      data: { object: { metadata: { licenseId }, amount_total: 2000, payment_intent: null } },
    };
    const { body, signature } = buildSignedRequest(event);

    const res = await postWebhook(body, signature);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    const license = db.prepare("SELECT balance_usd, status FROM licenses WHERE id = ?").get(licenseId) as any;
    expect(license.balance_usd).toBeCloseTo(20);
    expect(license.status).toBe("active");
  });

  it("ignores the second call with the same event.id (no double credit)", async () => {
    const event = {
      id: "evt_test_dup",
      type: "checkout.session.completed",
      data: { object: { metadata: { licenseId }, amount_total: 2000, payment_intent: null } },
    };
    const { body, signature } = buildSignedRequest(event);

    const first = await postWebhook(body, signature);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ received: true });

    const second = await postWebhook(body, signature);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ received: true, duplicate: true });

    const license = db.prepare("SELECT balance_usd FROM licenses WHERE id = ?").get(licenseId) as any;
    expect(license.balance_usd).toBeCloseTo(20); // $20 만 적립되어야 함 (이중 적립 없음)

    const rows = db.prepare("SELECT COUNT(*) as c FROM stripe_events WHERE event_id = ?").get("evt_test_dup") as any;
    expect(rows.c).toBe(1);
  });

  it("rejects invalid signature with 400", async () => {
    const event = { id: "evt_bad_sig", type: "checkout.session.completed", data: { object: {} } };
    const payload = Buffer.from(JSON.stringify(event));
    const res = await postWebhook(payload, "t=0,v1=deadbeef");
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run server/routes/stripeWebhook.test.ts`
Expected: PASS — Task 3 구현이 이미 dedup을 반영했으므로 이 테스트들은 통과해야 한다. 만약 통과하지 못하면 Task 3 구현 오류이므로 먼저 고친 후 재실행.

(TDD 순서상 Task 4는 Task 3 구현의 회귀 검증 역할이다. 실패 → 구현 → 통과 흐름이 Task 3 내부에서 이미 완료되었으므로, Task 4는 "새로운 실패 테스트"가 아니라 "행동 계약을 문서화한 통합 테스트".)

- [ ] **Step 3: 커밋**

```bash
git add server/routes/stripeWebhook.test.ts
git commit -m "test: add Stripe webhook dedup integration tests"
```

---

## Task 5: 문서 업데이트

**Files:**
- Modify: `docs/STATUS.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/superpowers/specs/2026-04-17-stripe-billing-design.md`

- [ ] **Step 1: STATUS.md에서 결함 제거, 상태 복원**

- "알려진 결함" 섹션에서 Webhook dedup 미구현 항목 제거. 섹션이 비게 되면 섹션 자체 삭제.
- 컴포넌트 상태 표에서 Stripe Webhook 줄을 다시 ✅로:

Before:
```
| Stripe Webhook + 자동 충전 | ⚠️ 부분 구현 (dedup 누락) | `server/routes/stripeWebhook.ts` |
```
After:
```
| Stripe Webhook + 자동 충전 | ✅ 구현 완료 (dedup 포함) | `server/routes/stripeWebhook.ts` |
```

- "최근 변경 이력" 맨 위에 추가:
```
- 2026-04-19 feat: Stripe Webhook dedup 구현 (stripe_events 테이블 + INSERT OR IGNORE)
```
(10개 초과 시 맨 아래 항목 삭제.)

- "마지막 업데이트" 날짜를 `2026-04-19`로 변경.

- [ ] **Step 2: ROADMAP.md 우선순위 재조정**

- "현재 추천 다음 작업"을 SP4 레이어드 아키텍처 리팩터로 복원 (이전 2026-04-17 커밋 전 상태):

```markdown
## 현재 추천 다음 작업

**SP4 — 레이어드 아키텍처 리팩터**

`src/`와 `server/`의 책임 경계가 흐려져 있는 현재 구조를, 프레임워크 무관 `core/`와 presentation layer `cli/`·`server/`로 재조직한다. 순수 파일 이동 리팩터이며 동작 변경은 없다.

- 설계 문서: [`docs/superpowers/specs/2026-04-17-layered-architecture-refactor-design.md`](superpowers/specs/2026-04-17-layered-architecture-refactor-design.md)
- 구현 계획: 아직 없음 (`writing-plans` 단계 필요)
```

- Tier 1을 원래 구조로 복원:

```markdown
## Tier 1 — 바로 진행

- SP4 레이어드 리팩터 구현 계획 작성 (`writing-plans`)
- SP4 리팩터 실행 (`subagent-driven-development`)
```

- "마지막 업데이트" 날짜를 `2026-04-19`로 변경.

- [ ] **Step 3: ARCHITECTURE.md 설계 결정 #5 갱신**

현재 설계 결정 #5의 "⚠️ 미해결 이슈" 블록 전체를 삭제하고, 본문을 다음과 같이 수정:

```markdown
### 5. Webhook 서명 검증 + 이벤트 Dedup

**Why:** Stripe Webhook 엔드포인트는 공개되어 있어 서명 검증 없이는 위조된 결제 이벤트로 잔액 조작이 가능하다. 또한 Stripe는 네트워크 문제 시 동일 이벤트를 재시도하므로 `event.id` 기반 dedup이 없으면 이중 충전이 발생할 수 있다.

**How:**
1. `server/routes/stripeWebhook.ts`가 `stripe.webhooks.constructEvent()`로 `stripe-signature`와 `STRIPE_WEBHOOK_SECRET`을 비교. 실패 시 400 반환.
2. 서명 검증 통과 후 `markEventProcessed(db, event.id)` 호출. 내부는 `INSERT OR IGNORE INTO stripe_events (event_id)`. `changes === 0`이면 중복이므로 `{ received: true, duplicate: true }` 반환 후 처리 스킵.
3. 서명 검증을 위해 Webhook 라우트는 `express.json()` 전에 등록되어 raw body를 받는다 (`server/index.ts:34`).
```

- 데이터 저장소 섹션의 테이블 표에 한 줄 추가 (`billing_cycles` 행 뒤):

```
| `stripe_events` | `event_id`, `processed_at` | Webhook 재시도 dedup. INSERT OR IGNORE로 중복 차단 |
```

- 설계 결정 #5 본문 마지막에 SP3 Addendum 크로스 레퍼런스 추가:
```
자세한 Addendum 설계는 [`docs/superpowers/specs/2026-04-17-stripe-billing-design.md`](../docs/superpowers/specs/2026-04-17-stripe-billing-design.md)의 "Addendum 2026-04-19 — Webhook Idempotency" 섹션 참조.
```

- "마지막 업데이트" 날짜를 `2026-04-19`로 변경.

- [ ] **Step 4: SP3 스펙에 Addendum 추가**

`docs/superpowers/specs/2026-04-17-stripe-billing-design.md`의 "검토 이력" 섹션 직전에 다음 섹션을 삽입:

```markdown
---

## Addendum 2026-04-19 — Webhook Idempotency (Stripe retry dedup)

**배경:** 본 스펙 177줄의 "Webhook 중복 방지"는 *동일 결제*에서 발생하는 `checkout.session.completed`와 `payment_intent.succeeded` 두 이벤트를 `metadata.type`으로 분리하는 설계였다. 그러나 Stripe가 네트워크 실패 시 **같은 `event.id`를 재전송**하는 경우는 별도 처리가 필요하다. 이 addendum은 후자를 다룬다.

**구현:**
- 신규 테이블 `stripe_events (event_id TEXT PRIMARY KEY, processed_at DATETIME DEFAULT CURRENT_TIMESTAMP)`
- `server/webhookDedup.ts`의 `markEventProcessed(db, eventId)` — `INSERT OR IGNORE` 후 `changes === 1`이면 `true`, `0`이면 중복.
- Webhook 핸들러는 서명 검증 직후 dedup 체크. 중복이면 `200 { received: true, duplicate: true }`만 반환.
- 같은 플랜에서 `express.raw({ type: "application/json" })` 미들웨어 누락(SP3 구현 결함)도 함께 수정.

**구현 계획:** `docs/superpowers/plans/2026-04-19-webhook-dedup.md`
```

- [ ] **Step 5: 전체 테스트 최종 회귀**

Run: `npx vitest run`
Expected: PASS — 전체 테스트 통과.

- [ ] **Step 6: 커밋**

```bash
git add docs/STATUS.md docs/ROADMAP.md docs/ARCHITECTURE.md docs/superpowers/specs/2026-04-17-stripe-billing-design.md
git commit -m "docs: mark webhook dedup complete and document idempotency design"
```

---

## Self-Review (플랜 작성자 자체 검토)

**Spec coverage:**
- SP3 Addendum 요건(서명 검증 후 dedup, `INSERT OR IGNORE` 기반, `event.id` 기준) — Task 2, 3, 4 커버.
- `stripe_events` 테이블 설계 — Task 1 커버.
- 문서 업데이트 규칙(CLAUDE.md MANDATORY 섹션) — Task 5 커버.

**Placeholder 스캔:** 없음. 모든 코드 블록이 실제 작성 가능한 형태로 포함됨.

**Type 일관성:**
- `AppDb`: Task 1, 2, 3 모두 동일 타입 사용.
- `markEventProcessed(db, eventId): boolean`: Task 2 정의, Task 3에서 사용, Task 4 테스트에서 검증.
- `createStripeWebhookRouter(stripe, webhookSecret, billing, db)`: Task 3 변경, Task 4 테스트 setup에서 동일 시그니처 사용.

**알려진 위험:**
- Task 4의 통합 테스트는 실제 HTTP 서버를 띄워 fetch로 호출한다. `node --experimental-fetch` 없이도 Node 20+에서 fetch가 전역으로 제공되므로 프로젝트의 `@types/node: ^20`와 호환. 만약 테스트가 flaky하면 `supertest`를 devDependency로 추가하는 대안이 있다.
- `stripe.webhooks.generateTestHeaderString`는 최신 Stripe SDK에 존재. 프로젝트는 `stripe: ^22.0.2`를 쓰므로 지원됨.

---

## 검토 이력

### 2026-04-19 자체 검토 (1차, 코드 대조)

**Critical (수정 완료)**

1. **`express.raw()` 미들웨어 누락 — SP3 구현 선행 결함**
   - `server/routes/stripeWebhook.ts`와 `server/index.ts` 모두에 적용되지 않아 `req.body`가 항상 `undefined`. 현재 프로덕션 Webhook은 서명 검증 단계에서 항상 실패하는 상태였음.
   - **조치:** Task 0을 신설해 라우터에 `express.raw({ type: "application/json" })`을 인라인 삽입. Task 4 통합 테스트가 이 수정을 함께 검증하도록 테스트 setup에서 중복 미들웨어를 제거. 플랜 헤더에 "함께 수정하는 선행 결함" 블록 추가.

**Important (수정 완료)**

2. **테스트 DB 파일 경로가 고정 문자열**
   - `server/test-webhook.db` 고정 경로는 vitest 기본 동시 실행에서 다른 테스트 파일과 경합 가능.
   - **조치:** Task 4의 테스트 setup을 `testDbPath = server/test-webhook-${randomUUID()}.db`로 변경해 beforeEach마다 격리. afterEach도 동일 경로로 정리.

**Important (유지)**

3. 통합 테스트의 Node 전역 `fetch` + `app.listen(0)` 패턴은 장황하지만 새 의존성 추가를 최소화하기 위해 유지. flaky 관찰 시 `supertest` 도입으로 전환 가능 — "알려진 위험" 섹션에 명시됨.

**Minor (수정 완료)**

4. TDD 순서 — Task 4가 Task 3 구현의 회귀 검증 역할이라는 점을 Task 4 Step 2에 이미 명시. 추가 조치 불필요.

5. **ARCHITECTURE.md ↔ SP3 Addendum 크로스 레퍼런스 추가**
   - **조치:** Task 5 Step 3에 ARCHITECTURE.md 설계 결정 #5 본문 마지막에 SP3 Addendum 링크를 삽입하는 항목 추가.

### 남은 위험

- Task 4의 통합 테스트가 처음 실행될 때 flaky 관찰 시 `supertest` 전환. 현재 플랜에는 반영하지 않고 실제 flaky 시점에만 별도 작업으로.

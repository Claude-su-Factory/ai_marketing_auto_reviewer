# Sub-project 3: Stripe 결제 연동 설계

**날짜:** 2026-04-17
**프로젝트:** ad_ai
**상위 스펙:** `2026-04-16-commercialization-phase1-design.md`
**상태:** 승인됨

---

## 개요

실시간 잔액 차감 + 자동 충전 모델로 Stripe 결제를 연동한다. 고객이 충전 티어($10/$20/$50)를 선택하면 잔액이 $5 이하로 떨어질 때 자동으로 충전된다. 결제 실패 시 라이선스를 즉시 중단한다.

AI 호출 전에 잔액을 선차감하여 과금 누수를 원천 차단한다.

---

## 핵심 원칙

- 돈을 먼저 빼고, AI를 호출한다 (선차감 후 실행)
- AI 실패 시 잔액 환불 (고객 불이익 없음)
- 서버 크래시 시에도 Owner 손해 없음 (이미 차감됨)
- 모든 잔액 변동은 SQLite 트랜잭션으로 원자적 처리
- Owner의 AI 토큰 비용보다 고객 청구 금액이 항상 높음 (PRICING 테이블 보장)

---

## 잔액 모델

```
고객 가입 → 결제 수단 등록 → 첫 충전
    ↓
AI 호출 시:
    1. 잔액 >= 작업 비용?
       NO  → 402 "잔액 부족" 거절
       YES → 계속
    2. 잔액 선차감 + usage_event(pending) 기록 [트랜잭션]
    3. AI API 호출
    4-a. 성공 → usage_event → completed
    4-b. 실패 → 잔액 환불 + usage_event → refunded
    5. 잔액 < $5? → 자동 충전 트리거 (비동기)
```

### 충전 티어

| 티어 | 충전 금액 | 자동 충전 기준 |
|------|----------|--------------|
| basic | $10 | 잔액 < $5 |
| standard | $20 | 잔액 < $5 |
| pro | $50 | 잔액 < $5 |

---

## 고객 온보딩 흐름

```
1. Owner가 라이선스 생성:
   npm run admin -- create-license --email=customer@example.com --tier=standard

2. 서버가 자동으로:
   → Stripe Customer 생성 (customer_email로)
   → Stripe Checkout Session 생성 (결제 수단 등록 + 첫 충전)
   → 콘솔 출력:
     License: AD-AI-XXXX-YYYY
     Payment URL: https://checkout.stripe.com/c/pay_xxxxx

3. Owner가 고객에게 라이선스 키 + Payment URL 전달

4. 고객이 Payment URL에서 카드 등록 + 첫 충전 결제

5. Stripe Webhook → payment_intent.succeeded
   → 라이선스 잔액 = 충전 금액
   → 상태 = pending_payment → active

6. 고객이 CLI 사용 시작:
   npm run app -- --key=AD-AI-XXXX-YYYY
```

---

## 과금 보장 메커니즘 (선차감 패턴)

모든 AI 프록시 라우트에 적용하는 공통 패턴:

```typescript
async function handleAiRoute(req, res, usageType, aiFn) {
  const licenseId = req.licenseId;
  const pricing = PRICING[usageType];

  // 1. 잔액 체크
  const license = db.getLicense(licenseId);
  if (license.balance_usd < pricing.charged) {
    return res.status(402).json({
      error: "잔액 부족",
      balance: license.balance_usd,
      required: pricing.charged,
    });
  }

  // 2. 선차감 + usage_event 기록 (트랜잭션)
  const eventId = randomUUID();
  db.transaction(() => {
    db.deductBalance(licenseId, pricing.charged);
    db.insertUsageEvent(eventId, licenseId, usageType, pricing.aiCost, pricing.charged, "pending");
  });

  // 3. AI 호출
  try {
    const result = await aiFn();
    db.updateUsageEventStatus(eventId, "completed");

    // 4. 잔액 < $5 → 자동 충전 트리거
    const updated = db.getLicense(licenseId);
    if (updated.balance_usd < 5.0 && updated.recharge_amount > 0) {
      triggerAutoRecharge(licenseId, updated).catch(() => {});
    }

    return res.json(result);
  } catch (e) {
    // 5. 실패 → 환불
    db.transaction(() => {
      db.refundBalance(licenseId, pricing.charged);
      db.updateUsageEventStatus(eventId, "refunded");
    });
    return res.status(500).json({ error: "AI 처리 실패. 잔액이 환불되었습니다." });
  }
}
```

---

## Stripe 연동 상세

### 사용하는 Stripe API

| API | 용도 |
|-----|------|
| `stripe.customers.create()` | 라이선스 생성 시 Stripe Customer 생성 |
| `stripe.checkout.sessions.create()` | 결제 수단 등록 + 첫 충전 (mode: "payment", payment_intent_data.setup_future_usage: "off_session") |
| `stripe.paymentIntents.create()` | 자동 충전 시 결제 |
| Webhook: `checkout.session.completed` | 첫 결제 완료 → 잔액 추가 + 상태 active |
| Webhook: `payment_intent.succeeded` | 자동 충전 성공 → 잔액 추가 |
| Webhook: `payment_intent.payment_failed` | 충전 실패 → 라이선스 suspended |

### 환경 변수

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Webhook 엔드포인트

`POST /stripe/webhook` — `stripe.webhooks.constructEvent()`로 서명 검증 필수.

```typescript
app.post("/stripe/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];
  const event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);

  switch (event.type) {
    case "checkout.session.completed":
      // 첫 충전: 잔액 추가 + status → active
      break;
    case "payment_intent.succeeded":
      // 자동 충전: 잔액 추가
      break;
    case "payment_intent.payment_failed":
      // 충전 실패: status → suspended
      break;
  }

  res.json({ received: true });
});
```

주의: Webhook 라우트는 `express.json()` 미들웨어 이전에 등록해야 함 (raw body 필요).

### 자동 충전 트리거

```typescript
async function triggerAutoRecharge(licenseId: string, license: License) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  // 고객의 기본 결제 수단으로 충전
  await stripe.paymentIntents.create({
    amount: Math.round(license.recharge_amount * 100), // cents
    currency: "usd",
    customer: license.stripe_customer_id,
    payment_method: license.stripe_payment_method_id,
    off_session: true,
    confirm: true,
    metadata: { licenseId, type: "auto_recharge" },
  });
}
```

결과는 Webhook으로 비동기 수신. 성공 시 잔액 추가, 실패 시 suspended.

---

## DB 변경

### licenses 테이블 컬럼 추가

```sql
ALTER TABLE licenses ADD COLUMN balance_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE licenses ADD COLUMN recharge_amount REAL NOT NULL DEFAULT 20;
ALTER TABLE licenses ADD COLUMN recharge_tier TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE licenses ADD COLUMN stripe_payment_method_id TEXT;
```

### licenses.status 값 확장

기존: `active | suspended | cancelled`
추가: `pending_payment` (결제 수단 등록 대기 중)

### usage_events.status 컬럼 추가

```sql
ALTER TABLE usage_events ADD COLUMN status TEXT NOT NULL DEFAULT 'completed';
-- pending: 선차감 완료, AI 호출 중
-- completed: AI 성공, 과금 확정
-- refunded: AI 실패, 잔액 환불됨
```

---

## 파일 구조

### 신규 파일

| 파일 | 역할 |
|------|------|
| `server/stripe.ts` | Stripe SDK 래퍼 (Customer, Checkout, PaymentIntent) |
| `server/billing.ts` | 잔액 관리 (선차감, 환불, 자동 충전 트리거) |
| `server/routes/stripeWebhook.ts` | POST /stripe/webhook 핸들러 |

### 수정 파일

| 파일 | 변경 |
|------|------|
| `server/db.ts` | 테이블 ALTER 추가 (balance, recharge, payment_method, status) |
| `server/routes/aiCopy.ts` | 선차감 패턴 적용 |
| `server/routes/aiImage.ts` | 선차감 패턴 적용 |
| `server/routes/aiVideo.ts` | 선차감 패턴 적용 |
| `server/routes/aiParse.ts` | 선차감 패턴 적용 |
| `server/routes/aiAnalyze.ts` | 선차감 패턴 적용 |
| `server/index.ts` | Webhook 라우트 추가 (express.json 이전에 등록) |
| `server/admin.ts` | `--tier` 옵션 추가, Stripe Customer + Checkout 생성 |
| `package.json` | `stripe` 의존성 추가 |
| `.env.example` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` 추가 |

### 변경하지 않는 파일

- `src/` 하위 모든 클라이언트 코드 — 서버 내부 변경이므로 CLI 영향 없음
- `server/auth.ts`, `server/rateLimit.ts` — 변경 없음

---

## 에러 처리

### 잔액 부족 시

```json
HTTP 402
{ "error": "잔액 부족", "balance": 2.50, "required": 5.00 }
```

CLI에서 TUI 에러 메시지로 표시. 메뉴로 복귀.

### 자동 충전 실패 시

1. Stripe Webhook `payment_intent.payment_failed` 수신
2. 라이선스 `status → suspended`
3. 다음 AI 호출 시 `401 License suspended` 반환
4. CLI에서 "라이선스가 중단되었습니다. 결제 수단을 확인하세요." 표시

### 결제 수단 미등록 상태 (pending_payment)

1. CLI에서 `--key`로 접속 시도
2. `/license/validate` → `status: pending_payment` → 401 반환
3. CLI에서 "결제 등록이 필요합니다. Owner에게 문의하세요." 표시

---

## Admin CLI 변경

```bash
# 라이선스 생성 (Stripe 연동 포함)
npm run admin -- create-license --email=customer@example.com --tier=standard
# → License: AD-AI-XXXX-YYYY
# → Payment URL: https://checkout.stripe.com/c/pay_xxxxx
# → Tier: standard ($20 auto-recharge)

# 잔액 확인
npm run admin -- balance --key=AD-AI-XXXX-YYYY
# → Balance: $15.30 (tier: standard, recharge at < $5)

# 수동 잔액 추가 (Owner 재량)
npm run admin -- add-balance --key=AD-AI-XXXX-YYYY --amount=10
# → Balance updated: $25.30
```

---

## 제약 사항

- Stripe Test 모드로 먼저 개발, 검증 후 Live 모드 전환
- Webhook 서명 검증 (`stripe.webhooks.constructEvent`) 필수
- Webhook 라우트는 `express.raw()` 사용 — `express.json()` 미들웨어 이전에 등록
- 잔액 관련 모든 DB 조작은 SQLite 트랜잭션으로 원자적 처리
- 자동 충전은 비동기 (PaymentIntent + Webhook) — 동기 결제 아님
- `pending_payment` 상태에서는 CLI 사용 불가
- Owner 모드는 이 변경에 영향 없음

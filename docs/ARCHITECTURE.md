# 아키텍처

마지막 업데이트: 2026-04-19

---

## 시스템 개요

AD-AI는 두 개의 독립적인 구성 요소로 이루어진다.

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│ CLI 앱 (src/)               │        │ Usage API Server (server/)   │
│                             │        │                              │
│ - Scrape (Playwright)       │        │ - AI 프록시 라우트           │
│ - Generate (Claude+Imagen+  │  HTTP  │ - 라이선스 + 세션 인증       │
│   Veo)                      │◄──────►│ - 레이트 리밋 (10 req/min)   │
│ - Review (Ink TUI)          │        │ - Stripe 결제 + Webhook      │
│ - Launch (Meta Ads)         │        │ - SQLite (data.db)           │
│ - Monitor (성과 수집)       │        │ - 비동기 Veo 영상 작업       │
│ - Improve (자율 개선)       │        └──────────────────────────────┘
│                             │
│ Owner 모드: AI 키 직접 호출 │
│ Customer 모드: 서버 경유    │
└─────────────────────────────┘
```

Owner 모드는 `.env`의 AI 키로 직접 호출하여 무제한 사용하고, Customer 모드는 라이선스 키로 Usage Server에 인증한 뒤 사용량에 따라 잔액이 차감된다.

---

## 주요 디렉토리

| 경로 | 역할 |
|------|------|
| `src/cli/` | CLI 진입점 (scrape, generate, review, launch, monitor, improve, pipeline, app) |
| `src/tui/` | Ink 기반 TUI 화면 (메뉴, 리뷰, 진행 바) |
| `src/scraper/` | Playwright + Gemini로 제품 정보 수집 |
| `src/generator/` | 카피(Claude), 이미지(Imagen 3), 영상(Veo 3.1) 생성 |
| `src/reviewer/` | 검토 세션 (승인/거절/수정) |
| `src/launcher/` | Meta Ads API 게재 |
| `src/monitor/` | 일간/주간 성과 수집 + Claude 리포트 |
| `src/improver/` | 성과 기반 프롬프트 자율 개선 |
| `src/client/` | Usage Server HTTP 클라이언트 + AI 프록시 추상화 |
| `src/mode.ts` | Owner/Customer 모드 감지 |
| `server/` | Express 서버 진입점 및 DB/인증/빌링 |
| `server/routes/` | AI 프록시 라우트 + 라이선스/사용량/Webhook |
| `server/jobs/` | 비동기 작업 (Veo 영상 폴링) |
| `data/` | 제품/소재/캠페인/리포트 JSON |
| `docs/superpowers/specs/` | 기능별 상세 설계 문서 |
| `docs/superpowers/plans/` | 기능별 구현 계획 |

---

## 핵심 설계 결정

### 1. Owner vs Customer 모드 분리

**Why:** 본인이 무제한으로 사용하는 시나리오와 고객에게 유료로 제공하는 시나리오를 같은 코드베이스에서 지원하기 위함.

**How:** `src/mode.ts`의 `detectMode()`가 다음 순서로 판단한다.
1. `AD_AI_MODE=owner` 환경변수 → Owner
2. `--key=<키>` CLI 인자 또는 `AD_AI_LICENSE_KEY` 환경변수 존재 → Customer
3. `AD_AI_MODE=customer` 환경변수 → Customer (키 없이도)
4. 어느 것도 없으면 → Owner (기본값)

`src/client/aiProxy.ts`가 모드별로 호출을 라우팅. Owner는 SDK 직접 호출, Customer는 Usage Server HTTP 경유.

### 2. Deduct-First 빌링 패턴

**Why:** 동시 요청 시 잔액 race condition을 방지하고, 무료 AI 호출을 원천 차단한다.

**How:** AI 호출 전에 잔액을 먼저 차감(pending 상태)하고, 성공하면 확정(confirmed), 실패하면 환불(refunded). 고아 pending 이벤트는 서버 시작 시 정리.

### 3. SQLite (better-sqlite3)

**Why:** 단일 서버 운영을 가정한 초기 단계이며, 트랜잭션 일관성과 단순한 운영을 우선. Postgres 전환은 스케일 시점에 고려.

**How:** `server/data.db` 단일 파일. 테이블: `licenses`, `usage_events`, `billing_events`, `sessions`.

### 4. 세션 토큰 + 레이트 리밋 (메모리 스토어)

**Why:** 라이선스 키가 유출되어도 피해 범위를 제한(세션 TTL 24시간). 분당 10회 제한으로 자동화 남용을 방지.

**How:** 로그인 시 UUID 세션 토큰 발급, `/ai/*`와 `/usage/*`에 Bearer 인증. 레이트 리밋은 `/ai/*`에만 적용.

**중요한 트레이드오프:** 세션 스토어는 `server/auth.ts`의 메모리 `Map`이다. 서버 재시작 시 모든 세션이 소실되며 클라이언트는 재로그인해야 한다. 단일 서버 운영 가정에서는 수용 가능하지만, 수평 확장 시점에는 Redis 등 외부 저장소로 이전 필요.

### 5. Webhook 서명 검증 + 이벤트 Dedup

**Why:** Stripe Webhook 엔드포인트는 공개되어 있어 서명 검증 없이는 위조된 결제 이벤트로 잔액 조작이 가능하다. 또한 Stripe는 네트워크 문제 시 동일 이벤트를 재시도하므로 `event.id` 기반 dedup이 없으면 이중 충전이 발생할 수 있다.

**How:**
1. `server/routes/stripeWebhook.ts`가 `stripe.webhooks.constructEvent()`로 `stripe-signature`와 `STRIPE_WEBHOOK_SECRET`을 비교. 실패 시 400 반환.
2. 서명 검증 통과 후 `markEventProcessed(db, event.id)` 호출. 내부는 `INSERT OR IGNORE INTO stripe_events (event_id)`. `changes === 0`이면 중복이므로 `{ received: true, duplicate: true }` 반환 후 처리 스킵.
3. 서명 검증을 위해 Webhook 라우트는 `express.json()` 전에 등록되어 raw body를 받는다 (`server/index.ts:34`). 라우트 자체에도 `express.raw({ type: "application/json" })` 미들웨어가 적용되어 있다.

자세한 Addendum 설계는 [`docs/superpowers/specs/2026-04-17-stripe-billing-design.md`](superpowers/specs/2026-04-17-stripe-billing-design.md)의 "Addendum 2026-04-19 — Webhook Idempotency" 섹션 참조.

### 6. 비동기 Veo 영상 작업

**Why:** 영상 생성은 수 분 소요되어 HTTP 타임아웃 범위를 벗어난다.

**How:** `server/jobs/videoJob.ts`가 Veo API를 백그라운드에서 폴링. 클라이언트는 `jobId`로 상태 조회. 완성된 영상은 `server/tmp/`에 저장 후 24시간 뒤 자동 삭제.

### 7. 자동 충전 실패 시 즉시 중단

**Why:** 결제 실패 상태의 라이선스가 계속 사용되면 미수금이 쌓인다.

**How:** `server/billing.ts`의 `needsRecharge()`가 잔액 < $5이고 `recharge_amount > 0`일 때 자동 충전을 트리거한다. 충전 자체는 Stripe에서 비동기로 진행되며, 결과는 Webhook으로 확인한다. `payment_intent.payment_failed` 이벤트 수신 시 `suspendLicense()`가 호출되어 라이선스 `status = 'suspended'`로 즉시 전환. 이후 모든 AI 호출은 401 반환.

---

## 데이터 저장소

### SQLite (`server/data.db`)

`server/db.ts`가 정의하는 실제 테이블은 4개다.

| 테이블 | 주요 컬럼 | 용도 |
|--------|----------|------|
| `licenses` | `id`, `key`, `customer_email`, `status`, `stripe_customer_id`, `balance_usd`, `recharge_amount`, `recharge_tier`, `stripe_payment_method_id` | 라이선스 상태 및 잔액 |
| `usage_events` | `id`, `license_id`, `type`, `ai_cost_usd`, `charged_usd`, `status`(pending/completed/refunded), `metadata` | AI 호출별 차감 이벤트. 고아 pending은 서버 시작 시 환불 처리 |
| `billing_cycles` | `id`, `license_id`, `period_start`, `period_end`, `total_ai_cost_usd`, `total_charged_usd`, `stripe_invoke_id`, `status` | 월 단위 청구 주기 (현재는 스키마만 존재, 정산 로직 미구현) |
| `stripe_events` | `event_id`, `processed_at` | Webhook 재시도 dedup. INSERT OR IGNORE로 중복 차단 |

세션 토큰은 DB가 아닌 **`server/auth.ts`의 메모리 `Map`**에 저장된다.

### 파일 시스템 (`data/`)

| 디렉토리 | 내용 |
|---------|------|
| `data/products/` | 등록된 제품 JSON |
| `data/creatives/` | 생성된 소재 (카피 JSON + 이미지/영상 파일 경로) |
| `data/campaigns/` | 게재된 Meta 캠페인 정보 |
| `data/reports/` | 일간/주간 성과 데이터 |
| `data/improvements/` | 자율 개선 이력 (before/after diff) |
| `data/temp/` | Customer 모드 임시 파일 (Customer 모드 첫 실행 시 생성) |
| `data/courses/` | SP0 이전 레거시. `npm run migrate`로 `products/`로 이관. 신규 코드는 사용 금지 |
| `server/tmp/` | Veo 영상 임시 저장 (24시간 후 삭제) |

---

## 스펙 & 계획 위치

```
docs/superpowers/specs/   설계 문서 (기능별)
docs/superpowers/plans/   구현 계획 (기능별)
server/data.db            런타임 DB (git 제외)
```

<!--
업데이트 규칙:
- 새 컴포넌트 추가, 설계 결정 변경, 디렉토리 구조 변경 시에만 업데이트
- 일반적인 버그 수정이나 리팩터는 반영하지 않음
- 핵심 설계 결정 섹션에는 반드시 "Why:"와 "How:"를 명시
-->

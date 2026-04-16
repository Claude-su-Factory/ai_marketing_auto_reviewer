# 상업화 Phase 1 설계 — 라이선스 키 CLI + Usage API Server

**날짜:** 2026-04-16
**프로젝트:** ad_ai
**상태:** 승인됨

---

## 개요

현재 싱글유저 로컬 CLI를 판매 가능한 제품으로 전환하는 Phase 1 설계.
Owner(본인)는 기존 로컬 TUI 경험을 그대로 유지하며 무료로 사용한다.
고객은 라이선스 키를 발급받아 동일한 CLI를 설치해 사용하고, 사용량 기반으로 과금된다.

---

## 핵심 원칙

- Owner 모드: 변경 없음. `.env` API 키 직접 사용, 무제한, 무료
- Customer 모드: `--key` 플래그 하나로 전환. AI 호출은 Usage Server 경유
- AI API 키(Anthropic, Google)는 서버에만 존재 — 고객 머신에 노출 안 됨
- Meta 계정은 고객 본인 것 — 광고주 본인 계정 정책상 필수

---

## 전체 아키텍처

```
┌──────────────────────────────────────────────────────┐
│  CLI (기존 + 수정)                                    │
│                                                       │
│  Owner 모드:     npm run app                          │
│  (키 없음)       .env API 키 직접 사용 → AI 직접 호출 │
│                                                       │
│  Customer 모드:  npm run app -- --key=AD-AI-XXXX      │
│  (라이선스 키)   → Usage Server 경유 → AI 호출        │
└──────────────────────┬────────────────────────────────┘
                        │ HTTP (usage 보고 + AI 프록시)
                        ▼
┌──────────────────────────────────────────────────────┐
│  Usage API Server (신규 구축)                         │
│  Node.js + Hono + SQLite + Stripe                     │
│                                                       │
│  - 라이선스 키 검증                                   │
│  - AI API 프록시 (Owner 키로 고객 요청 처리)          │
│  - 토큰 사용량 추적 → 비용 계산                      │
│  - Stripe 청구                                        │
└──────────────────────────────────────────────────────┘
```

---

## 모드 분기 흐름

```
앱 시작
    ↓
라이선스 키 존재? (--key 플래그 or AD_AI_LICENSE_KEY 환경변수)
    ├── NO  → Owner 모드
    │         .env API 키 사용
    │         AI 직접 호출
    │         사용량 추적 없음
    │
    └── YES → Customer 모드
              Usage Server에 키 검증 요청
              ├── 유효 → AI 요청을 Usage Server 경유
              │          각 작업 후 사용량 자동 보고
              │          TUI 실행
              └── 무효/만료 → 에러 메시지 출력 후 종료
```

---

## Usage API Server

### 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/license/validate` | 라이선스 키 검증 + 할당량 확인 |
| `POST` | `/ai/copy` | Claude 카피 생성 프록시 |
| `POST` | `/ai/image` | Imagen 이미지 생성 프록시 |
| `POST` | `/ai/video` | Veo 영상 생성 프록시 (polling 포함) |
| `POST` | `/ai/parse` | Gemini HTML 파싱 프록시 |
| `POST` | `/usage/report` | 캠페인 게재 등 사용량 기록 |
| `GET`  | `/usage/summary` | 현재 청구 기간 사용량 조회 |
| `POST` | `/stripe/webhook` | Stripe 결제 이벤트 처리 |

### 데이터 모델

```sql
-- 라이선스 (고객 1명 = 1 license)
License {
  id             TEXT PRIMARY KEY
  key            TEXT UNIQUE        -- "AD-AI-XXXX-YYYY" 형식
  customer_email TEXT
  status         TEXT               -- active | suspended | cancelled
  stripe_customer_id TEXT
  created_at     DATETIME
}

-- 사용량 이벤트 (AI 호출 1회 = 1 row)
UsageEvent {
  id           TEXT PRIMARY KEY
  license_id   TEXT REFERENCES License
  type         TEXT               -- copy_gen | image_gen | video_gen | campaign_launch
  ai_cost_usd  REAL               -- 실제 AI API 원가
  charged_usd  REAL               -- 고객 청구 금액 (마진 포함)
  metadata     TEXT               -- JSON
  created_at   DATETIME
}

-- 청구 주기 (월 1회 Stripe 인보이스)
BillingCycle {
  id                TEXT PRIMARY KEY
  license_id        TEXT REFERENCES License
  period_start      DATETIME
  period_end        DATETIME
  total_ai_cost_usd REAL
  total_charged_usd REAL
  stripe_invoice_id TEXT
  status            TEXT           -- open | paid | failed
}
```

### 수익 구조

| 작업 | AI 원가 (추정) | 고객 청구 | 마진 |
|------|--------------|-----------|------|
| 카피 생성 (Claude) | $0.003 | $0.01 | 233% |
| 이미지 생성 (Imagen) | $0.02 | $0.05 | 150% |
| 영상 생성 (Veo) | $0.50 | $1.50 | 200% |
| 캠페인 게재 | $0 | $0.10 | - |

월 청구: 청구 기간 종료 시 UsageEvent 합산 → Stripe 인보이스 자동 발행

---

## 제품 범용화 (Course → Product)

현재 `Course` 타입을 범용 `Product` 타입으로 확장한다.

### 타입 변경

```typescript
// 기존 Course → 신규 Product
interface Product {
  id: string;
  name: string;              // 제품/서비스명
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
```

### 입력 경로

| 방식 | 설명 | TUI 액션 |
|------|------|----------|
| URL 스크래핑 | URL 입력 → Gemini 범용 파싱 | `Scrape` (기존) |
| 수동 입력 | 이름·설명·URL·가격 직접 입력 | `Add Product` (신규) |

---

## CLI 모드 분리 — 영향받는 파일

### 신규 파일

| 파일 | 역할 |
|------|------|
| `src/mode.ts` | 모드 감지 (Owner vs Customer), 설정 export |
| `src/client/usageServer.ts` | Usage Server HTTP 클라이언트 |
| `src/client/aiProxy.ts` | 모드에 따라 AI 직접 호출 or 서버 프록시 분기 |
| `server/index.ts` | Usage API Server 진입점 |
| `server/routes/` | 각 엔드포인트 핸들러 |
| `server/db.ts` | SQLite 연결 + 마이그레이션 |
| `server/billing.ts` | Stripe 연동 + 인보이스 생성 |

### 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/types.ts` | `Course` → `Product` 타입 변경 |
| `src/scraper/index.ts` | 범용 URL 파싱으로 확장, Product 반환 |
| `src/generator/copy.ts` | 강의 전용 프롬프트 → 범용 제품 프롬프트 |
| `src/tui/AppTypes.ts` | `add-product` 액션 추가 |
| `src/tui/actions.ts` | aiProxy 통해 AI 호출하도록 수정 |
| `package.json` | `server` 스크립트 추가 |

---

## 구현 순서 (권장)

이 Phase 1은 독립적인 3개 서브 프로젝트로 분리해 구현한다:

### Sub-project 1: 제품 범용화
`Course → Product` 타입 변경, 수동 입력 TUI 추가, 범용 프롬프트.
기존 기능 그대로 유지하면서 입력 범위만 확장. 독립적으로 구현 가능.

### Sub-project 2: CLI 모드 분리 + Usage Server
`src/mode.ts`, `src/client/aiProxy.ts`, Usage API Server 구축.
Owner 모드 동작은 건드리지 않고 Customer 모드 레이어만 추가.

### Sub-project 3: Stripe 결제 연동
UsageEvent 기반 월 인보이스 자동 발행, 라이선스 관리 어드민.
Sub-project 2 완료 후 진행.

---

## 라이선스 키 발급 방식

Phase 1에서는 Owner가 수동으로 키를 생성하고 고객에게 이메일로 전달한다.
자동 발급 웹 페이지(셀프서비스)는 Phase 2에서 구축한다.

```bash
# Owner가 서버에서 실행하는 어드민 명령
npm run admin -- create-license --email=customer@example.com
# → AD-AI-A1B2-C3D4 키 생성 + DB 저장 + Stripe 고객 생성
```

---

## 제약 사항

- Owner 모드는 어떤 변경에도 영향받지 않는다 — 기존 `npm run app` 동작 보장
- Meta API 키는 항상 고객 본인 `.env`에 — Meta 광고 정책상 광고주 본인 계정 필수
- AI API 키(Anthropic, Google)는 Usage Server에만 존재 — 고객 머신에 절대 노출 금지
- Usage Server는 초기에 단일 인스턴스로 운영 (SQLite) — 고객 100명 이하에서는 충분

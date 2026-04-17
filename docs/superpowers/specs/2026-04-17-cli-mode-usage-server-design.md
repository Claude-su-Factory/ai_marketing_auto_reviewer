# Sub-project 2: CLI 모드 분리 + Usage API Server 설계

**날짜:** 2026-04-17
**프로젝트:** ad_ai
**상위 스펙:** `2026-04-16-commercialization-phase1-design.md`
**상태:** 승인됨

---

## 개요

CLI에 Owner/Customer 모드 분기를 추가하고, Customer 모드에서 AI 호출을 프록시하는 Usage API Server를 구축한다. Owner의 로컬 TUI 경험은 변경하지 않는다.

Stripe 결제는 이 스펙에 포함하지 않는다 (DB 스키마에 `stripe_customer_id` 컬럼만 준비, 실제 Stripe 호출은 Sub-project 3).

---

## 핵심 원칙

- Owner 모드: 기존 `npm run app` 그대로. 코드 변경 영향 없음
- Customer 모드: `--key=AD-AI-XXXX` 플래그 하나로 전환
- AI API 키(Anthropic, Google)는 Usage Server에만 존재
- Meta 키는 고객 본인 `.env`에 — 서버가 접근하지 않음
- 기존 generator/launcher/monitor 모듈은 수정하지 않음 — aiProxy가 래핑

---

## 모드 감지

```
앱 시작
    ↓
라이선스 키 존재? (--key 플래그 or AD_AI_LICENSE_KEY 환경변수)
    ├── NO  → Owner 모드
    │         .env API 키 직접 사용
    │         AI 직접 호출
    │         사용량 추적 없음
    │         모든 메뉴 표시
    │
    └── YES → Customer 모드
              Usage Server에 키 검증 (POST /license/validate)
              ├── 유효 → 세션 토큰 수령 → AI 프록시 모드로 TUI 실행
              │          Improve 메뉴 숨김
              └── 무효/만료 → 에러 메시지 출력 후 종료
```

### src/mode.ts

```typescript
export type AppMode = "owner" | "customer";

export interface ModeConfig {
  mode: AppMode;
  licenseKey?: string;
  serverUrl?: string;
  sessionToken?: string;
}
```

감지 로직:
1. `process.argv`에서 `--key=` 플래그 파싱
2. 없으면 `process.env.AD_AI_LICENSE_KEY` 확인
3. 둘 다 없으면 Owner 모드

---

## aiProxy — AI 호출 분기점

모든 AI 호출과 사용량 보고를 하나의 인터페이스로 통합한다. 기존 generator 모듈은 수정하지 않고 aiProxy가 래핑한다.

### 인터페이스

```typescript
interface AiProxy {
  generateCopy(product: Product): Promise<Creative["copy"]>;
  generateImage(product: Product): Promise<string>;       // 이미지 로컬 경로
  generateVideo(product: Product, onProgress?: (msg: string) => void): Promise<string>;
  parseProduct(url: string, html: string): Promise<Product>;
  analyzePerformance(reports: Report[]): Promise<string>;  // Claude 분석 텍스트
  reportUsage(type: UsageType, metadata?: object): Promise<void>;
}

type UsageType = "copy_gen" | "image_gen" | "video_gen" | "parse" | "analyze" | "campaign_launch";
```

### 모드별 동작

| 메서드 | Owner 모드 | Customer 모드 |
|--------|-----------|--------------|
| `generateCopy` | `generateCopy()` 직접 호출 | `POST /ai/copy` |
| `generateImage` | `generateImage()` 직접 호출 | `POST /ai/image` |
| `generateVideo` | `generateVideo()` 직접 호출 | `POST /ai/video` → polling → 다운로드 |
| `parseProduct` | `parseProductWithGemini()` 직접 호출 | `POST /ai/parse` |
| `analyzePerformance` | Claude 직접 호출 | `POST /ai/analyze` |
| `reportUsage` | no-op (아무것도 안 함) | `POST /usage/report` |

### 수정 대상

`src/tui/actions.ts`만 수정. generator 직접 호출 → `aiProxy` 메서드 호출로 교체:

```
// 변경 전
const copy = await generateCopy(client, product);

// 변경 후
const copy = await proxy.generateCopy(product);
```

Launch 액션에서는 성공 후 usage 보고 추가:

```
// 변경 전
const campaign = await launchCampaign(product, creative);

// 변경 후
const campaign = await launchCampaign(product, creative);
await proxy.reportUsage("campaign_launch", { campaignId: campaign.id });
```

---

## Usage API Server

### Tech Stack

| 구분 | 기술 |
|------|------|
| 프레임워크 | Express |
| DB | better-sqlite3 (SQLite) |
| 언어 | TypeScript (기존 프로젝트와 동일 설정) |
| 배포 | 로컬 개발 → Railway |

### 디렉토리 구조

```
server/
├── index.ts              ← Express 앱 + 미들웨어
├── db.ts                 ← SQLite 연결 + 테이블 생성
├── auth.ts               ← 세션 토큰 생성/검증 (in-memory Map)
├── rateLimit.ts          ← 라이선스별 분당 요청 카운터
├── routes/
│   ├── license.ts        ← POST /license/validate
│   ├── aiCopy.ts         ← POST /ai/copy → Claude 프록시
│   ├── aiImage.ts        ← POST /ai/image → Imagen 프록시
│   ├── aiVideo.ts        ← POST /ai/video + GET /ai/video/status/:jobId
│   ├── aiParse.ts        ← POST /ai/parse → Gemini 프록시
│   ├── aiAnalyze.ts      ← POST /ai/analyze → Claude 성과 분석 프록시
│   └── usage.ts          ← POST /usage/report + GET /usage/summary
├── jobs/
│   └── videoJob.ts       ← Veo 비동기 잡 관리 (in-memory Map)
└── admin.ts              ← CLI 어드민 도구
```

### 인증 흐름

```
1. POST /license/validate  { key: "AD-AI-XXXX" }
   → { sessionToken: "eyJ...", expiresAt: "..." }

2. 이후 모든 요청에 헤더:
   Authorization: Bearer {sessionToken}
```

세션 토큰: `crypto.randomUUID()` 기반, 24시간 유효, in-memory Map 저장.
서버 재시작 시 세션 만료 → Customer CLI 재인증 필요 (허용 가능).

### Rate Limiting

| 대상 | 제한 |
|------|------|
| 라이선스별 | 10 req/min |

초과 시 `429 Too Many Requests` + `{ error: "Rate limit exceeded", retryAfter: N }` 반환.
in-memory 카운터. 1분마다 리셋.

### 엔드포인트 상세

#### POST /license/validate

```
Request:  { key: "AD-AI-XXXX-YYYY" }
Response: { sessionToken: "...", expiresAt: "2026-04-18T10:00:00Z", customerEmail: "..." }
Error:    { error: "Invalid license key" }  (401)
```

DB에서 key 조회 → status === "active" 확인 → 세션 토큰 생성 → 반환.

#### POST /ai/copy

```
Request:  { product: { name, description, price, currency, targetUrl, tags, category } }
Auth:     Bearer {sessionToken}
Response: { headline: "...", body: "...", cta: "...", hashtags: [...] }
```

서버가 Owner의 Anthropic 키로 Claude 호출. 응답 전 UsageEvent 기록 (type: "copy_gen").

#### POST /ai/image

```
Request:  { product: { name, tags } }
Auth:     Bearer {sessionToken}
Response: { imageBase64: "..." }
```

서버가 Imagen 3 호출. Base64 이미지 반환. CLI가 로컬에 저장. UsageEvent 기록.

#### POST /ai/video

```
Request:  { product: { name, tags } }
Auth:     Bearer {sessionToken}
Response: { jobId: "veo-xyz-123", status: "pending" }
```

서버가 Veo 3.1 호출 시작. 즉시 jobId 반환. 서버 내부에서 비동기로 폴링 계속.

#### GET /ai/video/status/:jobId

```
Auth:     Bearer {sessionToken}
Response (진행 중): { status: "pending", progress: "3/60" }
Response (완료):    { status: "done", downloadUrl: "http://server:3000/files/veo-xyz-123.mp4" }
Response (실패):    { status: "failed", error: "Veo timeout" }
```

downloadUrl은 서버 로컬 디스크에 저장된 파일을 직접 서빙. 24시간 후 자동 삭제.

#### POST /ai/parse

```
Request:  { url: "https://...", html: "<html>..." }
Auth:     Bearer {sessionToken}
Response: { name: "...", description: "...", price: 0, tags: [], imageUrl: "..." }
```

서버가 Gemini로 HTML 파싱. UsageEvent 기록.

#### POST /ai/analyze

```
Request:  { reports: [{ campaignId, ctr, spend, cpc, ... }] }
Auth:     Bearer {sessionToken}
Response: { analysis: "주간 분석 텍스트..." }
```

서버가 Claude로 성과 분석. UsageEvent 기록.

#### POST /usage/report

```
Request:  { type: "campaign_launch", metadata: { campaignId: "..." } }
Auth:     Bearer {sessionToken}
Response: { recorded: true }
```

AI 프록시 외 사용량 (캠페인 게재 등)을 기록. 서버가 charged_usd를 수익 구조표에 따라 자동 계산.

#### GET /usage/summary

```
Auth:     Bearer {sessionToken}
Response: {
  currentPeriod: { start: "2026-04-01", end: "2026-04-30" },
  events: { copy_gen: 15, image_gen: 12, video_gen: 8, campaign_launch: 5 },
  totalCharged: 18.30
}
```

### 데이터 모델 (SQLite)

```sql
CREATE TABLE licenses (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  customer_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',    -- active | suspended | cancelled
  stripe_customer_id TEXT,                  -- SP3에서 사용, 현재는 NULL
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES licenses(id),
  type TEXT NOT NULL,                       -- copy_gen | image_gen | video_gen | parse | analyze | campaign_launch
  ai_cost_usd REAL NOT NULL DEFAULT 0,
  charged_usd REAL NOT NULL DEFAULT 0,
  metadata TEXT,                            -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE billing_cycles (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES licenses(id),
  period_start DATETIME NOT NULL,
  period_end DATETIME NOT NULL,
  total_ai_cost_usd REAL DEFAULT 0,
  total_charged_usd REAL DEFAULT 0,
  stripe_invoice_id TEXT,                   -- SP3에서 사용, 현재는 NULL
  status TEXT NOT NULL DEFAULT 'open',      -- open | paid | failed
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 수익 구조 (단가표)

```typescript
const PRICING: Record<string, { aiCost: number; charged: number }> = {
  copy_gen:         { aiCost: 0.003, charged: 0.01 },
  image_gen:        { aiCost: 0.02,  charged: 0.05 },
  video_gen:        { aiCost: 0.50,  charged: 1.50 },
  parse:            { aiCost: 0.001, charged: 0.005 },
  analyze:          { aiCost: 0.01,  charged: 0.03 },
  campaign_launch:  { aiCost: 0,     charged: 0.10 },
};
```

서버 코드에 상수로 관리. 단가 변경 시 이 객체만 수정.

---

## Veo 비동기 잡 관리

```
server/jobs/videoJob.ts

in-memory Map<jobId, VideoJob>

interface VideoJob {
  id: string;
  licenseId: string;
  status: "pending" | "done" | "failed";
  progress?: string;
  filePath?: string;       // 완료 시 서버 로컬 경로
  downloadUrl?: string;    // 완료 시 HTTP URL
  error?: string;
  createdAt: number;       // Date.now()
}
```

- 잡 생성 시 즉시 jobId 반환, 서버가 비동기로 Veo 폴링 시작
- CLI가 10초 간격으로 `/ai/video/status/:jobId` 폴링
- 완료 시 영상 파일을 `server/tmp/` 디렉토리에 저장
- Express static middleware로 `server/tmp/`를 `/files/` 경로에 마운트: `app.use("/files", express.static("server/tmp"))`
- `server/tmp/` 파일은 24시간 후 자동 삭제 (서버 시작 시 cleanup 로직 + 1시간 간격 setInterval)
- 서버 재시작 시 진행 중이던 잡은 유실 (in-memory) — 고객에게 "failed" 반환

---

## 어드민 CLI

```bash
npm run admin -- create-license --email=customer@example.com
# → License created: AD-AI-A1B2-C3D4

npm run admin -- list-licenses
# → AD-AI-A1B2-C3D4  customer@example.com  active  2026-04-17

npm run admin -- suspend-license --key=AD-AI-A1B2-C3D4
# → License AD-AI-A1B2-C3D4 suspended

npm run admin -- usage --key=AD-AI-A1B2-C3D4
# → copy_gen: 15 ($0.15), image_gen: 12 ($0.60), ...
```

`server/admin.ts` — `process.argv` 파싱, DB 직접 조작. 별도 프레임워크 없음.

---

## Customer 모드 TUI 변경

- `Improve` 메뉴 숨김 (Owner 전용 기능 — 파이프라인 코드 수정은 고객에게 의미 없음)
- 나머지 메뉴 동일 (Scrape, Add Product, Generate, Review, Launch, Monitor, Pipeline)
- TUI 하단에 "Customer mode · AD-AI-XXXX" 표시 (어떤 모드인지 시각적 확인)

### AppTypes.ts 변경

MENU_ITEMS에 `ownerOnly: boolean` 필드 추가:

```typescript
{ key: "improve", label: "Improve", description: "자율 개선", needsInput: false, ownerOnly: true },
```

App.tsx에서 `config.mode === "customer"`일 때 `ownerOnly: true` 항목 필터링.

---

## 오류 처리

### Usage Server 다운 시 (Customer 모드)

1. HTTP 요청 3회 재시도 (1초 간격)
2. 3회 실패 시 TUI에 에러 표시:
```
서버 연결 실패: Usage Server에 연결할 수 없습니다.
서버 상태를 확인하거나 잠시 후 다시 시도하세요.
```
3. 메뉴로 복귀 (앱 종료 아님)

### 세션 토큰 만료 시

AI 프록시 요청에서 `401 Unauthorized` 응답 시:
1. 자동으로 `/license/validate` 재호출
2. 새 세션 토큰으로 원래 요청 재시도
3. 재검증도 실패 시 에러 메시지 + 메뉴 복귀

### Rate Limit 초과 시

`429` 응답의 `retryAfter` 값만큼 대기 후 자동 재시도 (최대 1회). 두 번째도 429면 에러 표시.

---

## 환경 변수 추가

### .env.example 추가 항목

```bash
# CLI 모드 설정 (Customer만 해당)
AD_AI_LICENSE_KEY=
AD_AI_SERVER_URL=http://localhost:3000

# Server 전용 (.env에 같이 둠, CLI에서는 사용 안 함)
SERVER_PORT=3000
```

### Owner .env 주의사항

Owner의 `.env`에는 `AD_AI_LICENSE_KEY`를 절대 설정하지 않는다. 설정 시 Customer 모드로 진입됨.

---

## package.json 추가

```json
{
  "scripts": {
    "server": "tsx server/index.ts",
    "admin": "tsx server/admin.ts"
  },
  "dependencies": {
    "express": "^4.21.0",
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/better-sqlite3": "^7.6.9"
  }
}
```

---

## 전체 파일 구조 맵

### 신규 파일

| 파일 | 역할 |
|------|------|
| `src/mode.ts` | 모드 감지 (Owner vs Customer) |
| `src/client/usageServer.ts` | Usage Server HTTP 클라이언트 (fetch + 재시도 + 토큰 갱신) |
| `src/client/aiProxy.ts` | 모드별 AI 호출 분기 (6개 메서드 + reportUsage) |
| `server/index.ts` | Express 앱 + auth/rateLimit 미들웨어 |
| `server/db.ts` | SQLite 연결 + 테이블 생성 |
| `server/auth.ts` | 세션 토큰 생성/검증 |
| `server/rateLimit.ts` | 라이선스별 분당 제한 |
| `server/routes/license.ts` | POST /license/validate |
| `server/routes/aiCopy.ts` | POST /ai/copy |
| `server/routes/aiImage.ts` | POST /ai/image |
| `server/routes/aiVideo.ts` | POST /ai/video + GET /ai/video/status/:jobId |
| `server/routes/aiParse.ts` | POST /ai/parse |
| `server/routes/aiAnalyze.ts` | POST /ai/analyze |
| `server/routes/usage.ts` | POST /usage/report + GET /usage/summary |
| `server/jobs/videoJob.ts` | Veo 비동기 잡 관리 |
| `server/admin.ts` | 어드민 CLI |

### 수정 파일

| 파일 | 변경 |
|------|------|
| `src/tui/actions.ts` | generator 직접 호출 → aiProxy 경유, Launch 후 usage report |
| `src/tui/AppTypes.ts` | MenuItem에 `ownerOnly` 필드 추가 |
| `src/tui/App.tsx` | 시작 시 detectMode(), Customer면 세션 검증, menu 필터링 |
| `src/cli/app.ts` | detectMode() 호출 + ModeConfig 전달 |
| `package.json` | server/admin 스크립트, express/better-sqlite3 의존성 |
| `.env.example` | AD_AI_LICENSE_KEY, AD_AI_SERVER_URL, SERVER_PORT 추가 |

### 변경하지 않는 파일

- `src/generator/*` — aiProxy가 래핑하므로 원본 유지
- `src/scraper/index.ts` — aiProxy.parseProduct가 래핑
- `src/launcher/index.ts` — 직접 호출 유지 (Meta는 고객 키)
- `src/monitor/index.ts` — analyzePerformance만 aiProxy로 분리
- `src/reviewer/*`, `src/tui/MenuScreen.tsx`, `src/tui/DoneScreen.tsx` — 변경 없음

---

## 제약 사항

- Owner `.env`에는 `AD_AI_LICENSE_KEY`를 절대 설정하지 않는다
- AI API 키(Anthropic, Google)는 서버 `.env`에만 존재 — 고객 머신 노출 금지
- Meta API 키는 고객 본인 `.env`에 — 서버가 접근하지 않음
- 세션 토큰은 서버 메모리에 저장 — 재시작 시 만료, 허용 가능
- Video 잡은 서버 메모리에 저장 — 재시작 시 진행 중 잡 유실, "failed" 반환
- `server/tmp/` 영상 파일은 24시간 후 자동 삭제
- SQLite 단일 인스턴스 — 고객 100명 이하에서 충분
- Stripe 실제 호출은 이 스펙에 포함하지 않음 (DB 스키마만 준비)

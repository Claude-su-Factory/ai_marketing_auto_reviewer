# TUI 업그레이드 디자인

작성일: 2026-04-22
상태: 디자인 확정, 구현 계획 작성 대기

---

## 0. 배경 및 목표

기존 CLI TUI(Ink 5.0.1 + React 18.3 기반)는 2026-04-16 `unified-tui-launcher-design` 에서 도입된 이후 기본 기능만 구현된 상태다. Review split view 와 PipelineProgress 3-track bar 등 골격은 있으나, 화면 간 톤 불일치, 병렬 처리 미구현, Monitor 화면 부재, 모든 running 상태가 한 컴포넌트에 합쳐진 구조적 문제가 있다.

본 디자인은 **기존 Ink 기반 위에서 UI 품질을 끌어올리는 업그레이드**이며, 프레임워크 교체나 마이그레이션이 아니다. 핵심 변화는 다음 3가지이다.

1. 비주얼 톤 통일 (Tokyo Night 팔레트, 공통 Header/StatusBar/ProgressTrack)
2. Generate 병렬화 (현재 순차 → `Promise.all` 기반 3-track 병렬)
3. Monitor 신규 화면 (워커가 쌓은 리포트/improvements 실시간 대시보드)

### 0.1 프로젝트 맥락

이 프로젝트의 포트폴리오 가치는 "광고 자동화 + 자기 학습 루프" 에 있으며, TUI 는 owner 의 개발·운영 인터페이스다. 특히 Monitor 신규 화면은 Plan C(자기 학습 루프) 결과를 사람이 확인할 수 있는 유일한 창구가 된다.

### 0.2 스콥 결정: CLI = owner-only

브레인스토밍 과정에서 CLI 의 배포 모델을 재결정했다.

- CLI 는 외부 서비스로 제공하지 않는다. repo clone 해서 쓰는 owner/기여자 전용이다
- 따라서 `AD_AI_MODE=customer` 분기는 불필요하다
- `cli/mode.ts`, `cli/client/aiProxy.ts`(customer 분기), `cli/client/usageServer.ts` 전부 삭제
- `server/` (billing, license, AI proxy) 는 **미래 웹 UI 대기 인프라**로 유지한다. 본 디자인 범위 밖
- 웹 UI 재개는 별도 Tier 2 작업으로 `docs/ROADMAP.md` 에 등록

---

## 1. 파일 구조

본 업그레이드 후 `cli/tui/` 구조:

```
cli/tui/
  App.tsx                           # 라우터 (기존, 축소)
  AppTypes.ts                       # (기존 유지)
  theme/
    tokens.ts                       # Tokyo Night 팔레트 + 공통 borderStyle
  format.ts                         # formatWon / formatPct / formatAgo / truncate
  components/
    Header.tsx                      # ASCII 로고 + worker 뱃지 + today 카운터
    StatusBar.tsx                   # products / creatives / today ✓ / winners
    ProgressTrack.tsx               # bar + spinner + 라벨 공통
  hooks/
    useElapsed.ts                   # 경과 시간 (fake timer 친화)
    useReports.ts                   # data/reports/ window + mtime cache + fs.watch
    useWorkerStatus.ts              # launchctl 상태 + 60초 cache
    useTodayStats.ts                # 오늘 승인 수 (StatusBar + Review 공유)
  screens/
    MenuScreen.tsx                  # 카테고리 그룹 + 색상 점
    GenerateScreen.tsx              # 3-track 병렬 progress
    ReviewScreen.tsx                # split view + 뱃지 + ASSETS 메타
    MonitorScreen.tsx               # 신규
    ScrapeScreen.tsx                # 입력 + 진행 2단
    AddProductScreen.tsx            # 체크리스트 폼
    LaunchScreen.tsx                # Meta 4단계 + 로그 3줄
    ImproveScreen.tsx               # analyze 5단계
    PipelineScreen.tsx              # 4단계 아이콘 (기존 PipelineProgress 이식)
    DoneScreen.tsx                  # 요약 카드 + 다음 단계
```

삭제되는 파일:
- `cli/tui/PipelineProgress.tsx` (PipelineScreen 으로 흡수)
- `cli/tui/MenuScreen.tsx` 는 `screens/` 로 이동하며 재작성
- `cli/mode.ts`, `cli/mode.test.ts`, `cli/client/aiProxy.ts`, `cli/client/usageServer.ts` (customer 모드 제거)

의존성 추가:
- `ink-spinner` (진행 중 스피너)
- `ink-gradient` (로고 그라디언트)
- `ink-text-input` (Scrape URL 입력, AddProduct 폼)

의존성 제외(명시적 YAGNI):
- `ink-select-input` — 기존 키바인딩으로 충분
- `terminal-image` — 터미널별 렌더링 편차 크고, 메타 표시로 대체

---

## 2. 비주얼 토큰 (Tokyo Night)

공통 팔레트를 `cli/tui/theme/tokens.ts` 에 상수로 고정한다. 모든 screen/component 가 여기만 참조한다.

```ts
export const colors = {
  bg:        "#1a1b26",
  fg:        "#c0caf5",
  dim:       "#565f89",
  accent:    "#7aa2f7", // Creation 카테고리, shortcut 키
  success:   "#9ece6a", // 완료, approved, top
  warning:   "#e0af68", // 진행중, pending
  danger:    "#f7768e", // 실패, rejected, bottom
  review:    "#bb9af7", // Review&Launch 카테고리, border, edited
  analytics: "#7dcfff", // Analytics 카테고리
};

export const border = { borderStyle: "round", borderColor: colors.review };

export const icons = {
  success: "✓",  running: "⟳",  pending: "○",  failure: "✗",
  header: "◆",  bullet: "●",  select: "▶",  up: "▲",  down: "▼",
};
```

카테고리 색상 매핑(Section 2 와 일치):
- Creation(Scrape / Add Product / Generate) → `accent` (#7aa2f7)
- Review&Launch(Review / Launch / Pipeline) → `review` (#bb9af7)
- Analytics(Monitor / Improve) → `analytics` (#7dcfff)

상태 뱃지:
- `approved` → 배경 success, 텍스트 bg
- `pending` → 배경 warning, 텍스트 bg
- `rejected` → 배경 danger, 텍스트 bg
- `edited` → 배경 review, 텍스트 bg

---

## 3. Section 2 — Shell (Menu / Header / StatusBar)

### 3.1 Header

`cli/tui/components/Header.tsx` — 모든 screen 상단 공통.

구성 요소:
- ASCII 로고 `AD-AI` + 버전 `v1.0.0`
- Owner 뱃지 (항상 표시, customer 모드 없음)
- Worker 상태 뱃지: `● worker` (활성) / `○ worker inactive` (비활성)
- 오른쪽 슬롯 (screen 별): 화면 이름 또는 카운터 (예: Review 의 `today ✓ 5`)

워커 상태 조회:
- `useWorkerStatus()` 훅이 `launchctl list com.adai.worker` 결과를 60초 캐시
- 매 Header 렌더마다 `child_process.exec` 호출하면 안 됨(~50ms × 많은 리렌더)
- 훅 내부는 `setInterval(60_000)` 하나. 변경 감지 시 상태 업데이트

### 3.2 MenuScreen

`cli/tui/screens/MenuScreen.tsx` — 8개 메뉴를 3개 카테고리로 그룹.

```
╭──────────────────────────────────────────────────────────╮
│  AD-AI  v1.0.0                                  ● owner │
│                                ● worker                   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   CREATION                                               │
│ ▸ Scrape        ● 제품 정보 수집                         │
│   Add Product   ● 제품 수동 입력                         │
│   Generate      ● 소재 생성 (카피·이미지·영상)            │
│                                                          │
│   REVIEW & LAUNCH                                        │
│   Review        ● 검토·승인                              │
│   Launch        ● 광고 게재                              │
│   Pipeline      ● 전체 파이프라인                        │
│                                                          │
│   ANALYTICS                                              │
│   Monitor       ● 성과 분석                              │
│   Improve       ● 자율 개선                              │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  products: 12  │  creatives: 36  │  winners: 8          │
╰──────────────────────────────────────────────────────────╯
  ↑↓ 이동   Enter 선택   ? 도움말   Q 종료
```

구현 포인트:
- `ownerOnly` 필터 로직 제거 (customer 모드 삭제로 불필요)
- 카테고리 라벨은 dim 색. 메뉴 항목과 나란히 배치
- 선택된 항목은 `accent` 배경 + bg 텍스트
- 왼쪽 화살표(`▶`) 는 `icons.select`

### 3.3 StatusBar

`cli/tui/components/StatusBar.tsx` — 화면 하단 공통.

표시 내용(항상 owner 기준, 분기 없음):
- `products: N` — `data/products/*.json` 파일 수
- `creatives: N` — `data/creatives/*.json` 파일 수
- `today ✓ N` — `useTodayStats()` 가 `data/creatives/*.json` 중 `status ∈ (approved, edited) AND approvedAt >= date('now', 'start of day')` 개수 반환. 파일 시스템 기반이라 SQLite 쿼리 X
- `winners: N` — `data/creatives.db` `winners` 테이블 count. DB 파일 부재 시 `winners: —` 표시 (Plan C 실행 전)

갱신 주기:
- `products`/`creatives`: 메뉴 복귀 시 1회 스캔
- `today ✓`: Review 화면에서 승인 시 즉시 +1 (낙관적 갱신), 메뉴 복귀 시 재계산
- `winners`: 60초 간격 또는 Monitor 화면 진입 시 갱신

---

## 4. Section 3 — Generate 병렬화

### 4.1 동기

현재 `cli/actions.ts runGenerate` 는 순차: 이미지(2s) → 영상(30~90s) → 카피(15s) = 47~107s/제품.
Veo 영상 대기 동안 CPU idle. 병렬화 시 `max(image, video, copies)` ≈ 30~90s. 10개 제품이면 5~10분 단축.

### 4.2 구조

- **product 내부**: 이미지·영상·카피 3-track 을 `Promise.all` 병렬 실행
- **product 간**: 순차 (큐)
- **variant 간**(3개 카피): 순차 (Anthropic rate limit 보수적 관리)

### 4.3 Progress 타입 확장

기존 `RunProgress` 는 `message`, `courseIndex`, `totalCourses`, `taskProgress` 필드를 사용하며 Scrape/Launch/Improve/Pipeline 이 공유한다. Generate 전용 구조를 **optional 필드로 추가**하여 기존 호환성을 유지한다.

```ts
// cli/tui/AppTypes.ts 확장
export interface RunProgress {
  message?: string;
  courseIndex?: number;
  totalCourses?: number;
  currentCourse?: string;
  taskProgress?: {...};  // 기존 유지
  generate?: GenerateProgress;  // 신규, optional
  launchLogs?: LaunchLog[];     // Phase 5.4 에서 추가
}

export interface GenerateProgress {
  queue: ("done" | "running" | "pending")[];
  currentProduct: { id: string; name: string };
  tracks: {
    copy:  { status: "pending" | "running" | "done"; pct: number; label: string };
    image: { status: "pending" | "running" | "done"; pct: number; label: string };
    video: { status: "pending" | "running" | "done"; pct: number; label: string };
  };
  elapsedMs: number;
}
```

`runGenerate(proxy, onProgress: (p: RunProgress) => void)` 시그니처 유지. `onProgress({ generate: {...} })` 로 전달. 렌더 측은 `progress.generate` 존재 여부로 GenerateScreen 사용 판단.

### 4.4 화면

```
╭────────────────────────────────────────────────────────────╮
│  AD-AI  v1.0.0                        ● owner  ● worker    │
├────────────────────────────────────────────────────────────┤
│  ◆ Generate — 소재 생성 중                                  │
│                                                            │
│  큐:  [✓]  [⟳]  [ ]   (2/3)                                │
│  제품:  AI 부트캠프                                         │
│                                                            │
│  ⠋  카피     ████████████░░░░░░░  62%  variant 2/3         │
│  ✓  이미지    ████████████████████  100%  done (2.1s)       │
│  ⠙  영상     ████████████████░░░░  78%  polling Veo         │
│                                                            │
│  ────────────────────────────────────────────────────────  │
│  전체     ████████████████░░░░  80%  elapsed 47s           │
│                                                            │
├────────────────────────────────────────────────────────────┤
│  products: 12  │  creatives: 36  │  today ✓ 5  │  winners:│
╰────────────────────────────────────────────────────────────╯
  Esc 취소 (현재 제품까지 저장 후 중단)
```

### 4.5 Esc 취소 정책 (conservative)

- `Esc` 누르면 `AbortController` 대신 "다음 제품으로 진행 안 함" 플래그 세팅
- 현재 제품의 3-track 은 완료까지 진행 (부분 결과 저장 손실 방지)
- SDK 레벨 abort 는 구현 복잡도 대비 이득 적음 (Anthropic/Google 은 부분 응답 지원 불규칙)

### 4.6 Rate limit 가드

- Claude/Google 각각 SDK 레벨 재시도 유지
- 3-track 병렬이지만 variant 3개 카피는 sequential 로 유지 (Anthropic RPM 보호)
- Phase 3 구현 직후 실제 제품 2개 돌려 `429` 유무 확인. 발생 시 sequential fallback

---

## 5. Section 4 — Review 업그레이드

### 5.1 유지 (스콥 외)

- split view 레이아웃 (width=90, 좌 24 / 우 flex)
- 키 바인딩 `A / R / E / ↑↓ / 1-3`
- edit 모드는 headline 만

### 5.2 변경

1. **status 뱃지** — `(pending)` 평문 → 배경색 pill. 4-state: pending(warning) / approved(success) / rejected(danger) / edited(review)
2. **ASSETS 섹션** — 이미지·영상 메타 (해상도 / 파일 크기 / 포맷) 표시. ffprobe 의존성 회피 위해 영상 런타임 필드 제외
3. **COPY 색상 구분** — cta(success) / tags(analytics) / headline·body(fg)
4. **Header 카운터** — `today ✓ N` 실시간. 승인 시 낙관적 +1
5. **Header 서브라인** — `2/3 그룹 · variant 2/3 · 승인 1 / 거절 0 / 대기 2` (현재 그룹 기준)
6. **그룹 진행률 색상** — `(3/3)` success, `(0/3)` warning

### 5.3 ASSETS 메타 로더

`getAssetMeta(path) => Promise<AssetMeta>` — 주입 가능한 함수로 추출(테스트에서 fake 주입).

- 이미지: `sharp(path).metadata()` → `{ width, height, format, size }`
- 영상: `fs.stat(path)` → `{ size }` + 파일명에서 `.mp4` 추출. 해상도는 현재 Veo 출력이 1080×1920 고정 가정하고 하드코딩(이후 다양화되면 확장)
- 캐시: `Map<string, AssetMeta>` 그룹 수명 동안. 그룹 이동 시 clear

### 5.4 화면

```
╭──────────────────────────────────────────────────────────────────────────────╮
│  AD-AI  v1.0.0             ● owner  ● worker  │  today ✓ 5                   │
├──────────────────────────────────────────────────────────────────────────────┤
│  ◆ Review  — 2/3 그룹 · variant 2/3 · 승인 1 / 거절 0 / 대기 2               │
├──────────────────────────────────────────────────────────────────────────────┤
│  GROUPS                     │  VARIANTS                                       │
│    토익 900 실전…  (3/3)    │    [1] A  [approved]                           │
│  ▸ AI 부트캠프…   (1/3)    │  ▸ [2] B  [pending]                            │
│    GraphQL 입문  (0/3)      │    [3] C  [pending]                            │
│                             │                                                 │
│                             │  ── ASSETS ────                                 │
│                             │  🖼  image  1080×1080 · 342KB · jpg            │
│                             │     data/creatives/…/ai-bootcamp-B.jpg         │
│                             │  🎬 video   1080×1920 · 4.2MB · mp4            │
│                             │     data/creatives/…/ai-bootcamp-shared.mp4    │
│                             │                                                 │
│                             │  ── COPY ────                                   │
│                             │  headline  "3개월 안에 AI 엔지니어로"          │
│                             │  body      실전 프로젝트 12개, 1:1 코드리뷰…    │
│                             │  cta       "지금 신청하기"                     │
│                             │  tags      #AI  #부트캠프  #커리어전환         │
├──────────────────────────────────────────────────────────────────────────────┤
│  [A] 승인   [R] 거절   [E] 헤드라인 수정   ↑↓ 그룹   1-3 variant              │
╰──────────────────────────────────────────────────────────────────────────────╯
```

---

## 6. Section 5 — Monitor 신규 화면

### 6.1 데이터 소스

- OVERVIEW: `data/reports/YYYY-MM-DD.json` 지난 N일 치 `VariantReport[]` 합산. `VariantReport` 는 `impressions`, `clicks`, `inlineLinkClickCtr`, `adQualityRanking`, `adEngagementRanking`, `adConversionRanking` 만 갖는다 (`core/platform/types.ts`). **`spend`, `cpc` 없음**
- TOP/BOTTOM: CTR 기준 정렬. `productId` → `data/products/*.json` in-memory join
- winners: `data/creatives.db` `winners` 테이블 count. DB 파일 부재 시 `—` 표시 (Plan C 실행 전에는 파일이 생성되지 않음)
- Worker 상태: `data/worker-state.json` 의 `lastCollectAt`, `lastAnalyzeAt`
- IMPROVEMENTS: `data/improvements/*.json` 최신 3건, `createdAt desc`. **실제 파일/스키마 존재 여부 확인되지 않음** — Phase 0a 에서 검증

### 6.1.1 Spend 제거 결정 (이번 스콥 외)

Meta API `fetchReports` 가 현재 spend 를 수집하지 않으며, `variantReportsToReports` (`core/campaign/monitor.ts:86`) 는 `spend: 0, cpc: 0` 을 하드코딩한다. 따라서 Monitor 화면에서는 spend/CPC 관련 필드를 **전부 제거**한다.

ROADMAP Tier 2 로 "Meta API spend 수집 + Monitor spend/CPC 복원" 을 별도 작업으로 등록한다.

### 6.2 화면 (spend 제거 반영)

```
╭──────────────────────────────────────────────────────────────────────────────╮
│  AD-AI  v1.0.0             ● owner  ● worker  │  📊 Monitor                  │
├──────────────────────────────────────────────────────────────────────────────┤
│  Window:  [7d]  14d  30d     Last collect: 2h ago · analyze: 1d ago · next in│
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ── OVERVIEW ────                                                            │
│  variants  36         avg CTR  2.14%       impressions  189k                 │
│  winners   8          clicks   4,054                                         │
│                                                                              │
│  ── TOP 3 (by CTR) ────                                                      │
│  ▲  AI 부트캠프 · B     CTR 4.82%  impr 22k  clicks 1,060                   │
│  ▲  토익 900 · A        CTR 3.91%  impr 18k  clicks 704                     │
│  ▲  GraphQL 입문 · C    CTR 3.44%  impr 15k  clicks 516                     │
│                                                                              │
│  ── BOTTOM 3 ────                                                            │
│  ▼  Docker 기초 · A     CTR 0.71%  impr  9k  clicks  64                     │
│  ▼  React 입문 · C      CTR 0.89%  impr 11k  clicks  97                     │
│  ▼  CS 기초 · B         CTR 1.02%  impr 12k  clicks 122                     │
│                                                                              │
│  ── RECENT IMPROVEMENTS ────                                                 │
│  ◇  2d ago  Docker headline 톤 약함 → "개발자 필수" 가변어 주입              │
│  ◇  4d ago  bottom 3 공통: CTA 약함 → "지금 시작하세요" → "한번만 해봐"       │
│  ◇  7d ago  target.age 25-34 → 22-30 (Winner 8건 공통)                       │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  R 새로고침   T 윈도우(7/14/30)   I improvement 상세   Esc 뒤로              │
╰──────────────────────────────────────────────────────────────────────────────╯
```

### 6.3 상호작용

- **R**: 강제 재스캔 (디버깅용)
- **T**: 윈도우 순환 `7d → 14d → 30d → 7d`
- **I**: Improvement 상세 모달 (문제/제안/targetFile/applied 여부)
- **Esc**: 메인 메뉴로

### 6.4 갱신 전략

- `auto-refresh` interval 은 사용 안 함(워커가 6시간마다 collect, 주기 불일치)
- `useReports(window)` 훅이 `fs.watch("data/reports")`, `fs.watch("data/improvements")`, `fs.watch("data/worker-state.json")` 구독
- 파일 mtime 변경 시만 re-read. mtime unchanged 면 skip
- Fallback: 60초 interval 로 강제 재스캔 (fs.watch 놓친 이벤트 대비)
- `ffprobe` 의존성 없음

### 6.5 Improvement 요약 포맷

`${issue.slice(0, 20)} → ${suggestion.slice(0, 30)}` truncate. 구조화 저장값 없이 렌더 시 조작.

### 6.6 메트릭 계산

- `avg CTR` = `Σ(inlineLinkClickCtr × impressions) / Σimpressions` (impression-weighted)
- `clicks` = `Σclicks`
- `impressions` = `Σimpressions`
- `winners` = `SELECT COUNT(*) FROM winners` (DB 부재 시 `—`)

spend/CPC 는 표시하지 않음 (6.1.1 결정).

---

## 7. Section 6 — 보조 화면 (톤 통일)

### 7.1 Scrape

- 입력 화면 + 진행 화면 **분리된 컴포넌트**
- 실제 scraper 는 `cli/scraper.ts` (Playwright + Gemini 범용 파싱). 특정 사이트 화이트리스트 없음
- 입력 화면 힌트: "URL 자동 감지 (Gemini 파싱)". 특정 사이트 목록 표기하지 않음
- 진행 화면은 4단계 체크리스트 (Playwright 실행 / 페이지 로드 / Gemini 파싱 / 제품 저장)

### 7.2 Add Product

- 현재: 1 필드씩만 보이고 직전 입력값 가려짐
- 변경: 체크리스트 형식으로 입력된 값 유지 + 현재 step 포커스 `[⟳]`
- 이전 step 편집은 YAGNI (취소 후 재시작)

### 7.3 Launch

- Meta 4단계 (campaign → adset → creative → ad) × 캠페인 개수
- 최근 3줄 스트리밍 로그(`HH:MM:SS  METHOD path → status id`)
- 로그 소스: `RunProgress.launchLogs: LaunchLog[]` 확장. `core/platform/meta/launcher.ts` 가 callback 으로 emit

```ts
interface LaunchLog {
  ts: string;           // "14:32:04"
  method: string;       // "POST"
  path: string;         // "/act_XXX/campaigns"
  status: number;       // 201
  refId?: string;       // "camp_abc123"
}
```

### 7.4 Improve

- analyze 5단계: 리포트 로드 → 통계 계산 → Claude 분석 → improvements 저장 → winners 업데이트
- 토큰 사용량 표시 (`prompt 2,431 tok`)
- Winner 기준은 `createQualifyJob` qualify logic 결과(Plan C)

### 7.5 Pipeline

실제 `runPipelineAction` (`cli/actions.ts:300`) 은 `scrape → generate` **2단계**만 실행한다. Review/Launch 는 Pipeline 에 포함되지 않는다.

- 기존 `PipelineProgress.tsx` 를 `screens/PipelineScreen.tsx` 로 이식·이름 변경
- **2단계 아이콘** `[1] Scrape / [2] Generate`
- Pipeline 완료 후 Done 화면에 "다음 단계: Review → Launch (수동)" 표시
- Pipeline 을 4단계로 확장하는 작업(Review/Launch 통합)은 **이번 스콥 외** → ROADMAP Tier 2

### 7.6 Done

- 성공/실패 평문 → 요약 카드 + 다음 단계 제안
- 로그는 dim 축약(최대 3줄) + `V` 키로 전체 확장
- 예: Generate 완료 시 `3개 제품 × 3개 variant = 9 creatives 생성 / 총 2m 14s / 다음: Review → 검토·승인`

### 7.7 공통

- `◆` 헤더 아이콘 (카테고리 색)
- 단계 아이콘 `✓ / ⟳ / ○ / ✗`
- shortcut 바: 키는 `accent`, 설명은 `dim`
- elapsed timer: `useElapsed()` 훅 공용

---

## 8. Section 7 — 테스트 전략

### 8.1 프레임워크

기존 `ink-testing-library` + vitest 유지. 패턴: `render() → lastFrame() → toContain(...)`.

### 8.2 테스트 파일 (16개)

- Screens(10): MenuScreen, GenerateScreen, ReviewScreen, MonitorScreen, ScrapeScreen, AddProductScreen, LaunchScreen, ImproveScreen, PipelineScreen, DoneScreen
- Components(3): Header, StatusBar, ProgressTrack
- Hooks(3): useElapsed, useReports, useWorkerStatus (+ useTodayStats 는 Phase 1 에서 추가)
- Utils(1): format.test.ts

### 8.3 케이스 우선순위 (각 screen 당)

1. 렌더 기본 — 핵심 라벨/숫자 `toContain`
2. 상태 분기 — running/done/error 등 주요 분기만
3. 키 입력 — 주요 shortcut 1-2개 (`stdin.write`)
4. 엣지 — 빈 리스트 / truncate / division by zero 등

스냅샷 테스트 **지양**(컬러/박스 디프 노이즈). `toContain` + `toMatch(/정규식/)` 중심.

### 8.4 Mock 경계

**진짜 실행**: React/Ink 렌더, 컴포넌트 로직, 순수 유틸(`computeStats`, `format.*`).

**Mock**: `fs.watch`, `fs.readFile`, `sharp.metadata`, `child_process`(launchctl), `Date.now`, `setInterval`.

**절대 호출 X**: Anthropic/Google/Voyage/Meta API, Playwright, launchd 실제 제어.

### 8.5 Helper

- `tests/mocks/fsWatch.ts` — EventEmitter 기반 `fs.watch` mock. `emitter.emit('change', path)` 로 수동 트리거
- `vitest.config` `setupFiles` 에 `vi.mock("sharp")` 전역 (native binding 로드 방지)

### 8.6 명시적 스콥 외

- ANSI 컬러/박스 렌더 정확성
- Auto-refresh 절대 타이밍(5초/60초 숫자 자체)
- Meta/Anthropic 성공률
- launchd 실제 동작
- E2E 전체 파이프라인 (별도 작업)

### 8.7 tsconfig JSX

Phase 0 에서 `tsconfig.json` `jsx` 설정 확인. 새 파일에서 JSX 사용 가능하면 그렇게. 불가능하면 `React.createElement` 유지(기존 App.test.tsx 패턴).

---

## 9. Section 8 — 구현 단계 (Phase 0 → 6)

타임라인: **7.5 ~ 9일** (1인 평일 기준, 1.5 ~ 2주 윈도우).

Phase 경계마다 앱이 동작 가능한 상태여야 한다.

### 9.1 Phase 0a — 확인 (0.1일, 커밋 없음)

스펙 작성 시점에 이미 검증된 것(재확인 불필요):
- ✅ `VariantReport` 에 spend/cpc 없음 → Monitor 에서 제거 (6.1.1 결정)
- ✅ `runPipelineAction` 은 scrape → generate 2단계만 → Pipeline 2단계로 확정 (7.5)
- ✅ scraper 는 `cli/scraper.ts` 범용 파싱, 사이트 목록 없음 → 힌트 문구 변경 (7.1)

Phase 0a 에서 여전히 확인 필요:
- `data/improvements/` 실제 파일·스키마 확인. 없으면 Phase 4 에서 정의
- `Creative` 타입에 `approvedAt` 필드 존재 확인 (`core/types.ts`). 없으면 `today ✓ N` 의 오늘 필터를 `decisions.ts` timestamp 또는 파일 mtime 으로
- `tsconfig.json` `jsx` 설정 확인 — 새 파일에서 JSX 사용 가능 여부
- Claude/Google SDK rate limit 기본값 확인
- `AD_AI_MODE` 환경변수 참조 범위 repo 전체 grep — CLI 외 (server/, core/) 참조 유무
- `core/platform/meta/launcher.ts` 호출부 grep — Phase 5.4 launchLogs emit 추가 시 영향 범위
- `ink-spinner` / `ink-gradient` / `ink-text-input` Ink 5 호환 버전 확인 (npm view)

### 9.2 Phase 0b — customer 모드 제거 (0.4일, 단독 커밋)

- 삭제: `cli/mode.ts`, `cli/mode.test.ts`, `cli/client/aiProxy.ts`, `cli/client/usageServer.ts`
- `App.tsx` 에서 `detectMode`, `ModeConfig`, `validateLicense`, `createAiProxy` import·사용 제거
- AI 호출은 core 가 직접 SDK 호출
- `docs/ARCHITECTURE.md` 에 "server/ 는 미래 웹 UI 대기 인프라, 현재 non-active" 명시
- `docs/ROADMAP.md` 에 "웹 UI + customer 모드 재도입" Tier 2 추가
- 커밋 메시지: `chore: remove CLI customer mode (owner-only CLI, see ROADMAP for web UI)`

### 9.3 Phase 1 — foundation (1일)

- `theme/tokens.ts`
- `format.ts` + `format.test.ts`
- `hooks/useElapsed.ts` + 테스트(fake timer)
- `hooks/useReports.ts` + 테스트(EventEmitter mock)
- `hooks/useWorkerStatus.ts` + 테스트
- `hooks/useTodayStats.ts` + 테스트
- `components/ProgressTrack.tsx` + 테스트
- `tests/mocks/fsWatch.ts`
- `vitest.config` setup 에 `vi.mock("sharp")` 전역

파일당 TDD 5단계 커밋. 약 8개 커밋.

### 9.4 Phase 2 — shell (1일)

- `components/Header.tsx` + 테스트
- `components/StatusBar.tsx` + 테스트
- `screens/MenuScreen.tsx` 리라이트 + 테스트 업데이트
- `App.tsx` layout 에 Header / StatusBar / Menu 끼움

Phase 2 끝나면 중간 code-reviewer 호출.

### 9.5 Phase 3 — Generate 병렬화 (1.5일)

- **3.0 (시작 전)**: Generate 경로가 `core/qualify/`(Plan C) 를 호출하지 않음을 검증. 호출하면 Plan C 실운영 검증 먼저 처리
- `RunProgress` 타입에 `GenerateProgress` 추가
- `cli/actions.ts runGenerate` 리팩토링: product 내부 `Promise.all([generateImage, generateVideo, generateAllCopies])`, product 간 sequential, variant 간 sequential
- `screens/GenerateScreen.tsx` + 테스트
- `App.tsx` running 분기에 GenerateScreen 추가
- **실운영 검증**: 제품 2개로 실제 돌려 rate limit 에러 확인. 발생 시 sequential fallback

### 9.6 Phase 4 — Monitor 신규 (1일)

- Phase 0a.2 결과에 따라 `data/improvements/` 스키마 확정(없으면 정의)
- `screens/MonitorScreen.tsx` + 테스트
- `App.tsx` Monitor 라우팅
- 기존 `runMonitor` (collect/analyze 실행) 는 Improve 화면으로 이동, Monitor 메뉴는 읽기 전용 대시보드로 재배선

### 9.7 Phase 5 — Review 업그레이드 + 보조 화면 (2 ~ 3일)

분량 크므로 5a / 5b 분할 가능:

5a:
- `screens/ReviewScreen.tsx` 업그레이드 + 테스트
- `screens/ScrapeScreen.tsx` + 테스트
- `screens/AddProductScreen.tsx` + 테스트

5b:
- `screens/LaunchScreen.tsx` + `RunProgress.launchLogs` 확장 + `core/platform/meta/launcher.ts` emit 추가 + 테스트
- `screens/ImproveScreen.tsx` + 테스트
- `screens/PipelineScreen.tsx` (기존 PipelineProgress 이식) + `App.tsx` 라우팅 변경 + `PipelineProgress.tsx` 삭제 (단일 커밋)
- `screens/DoneScreen.tsx` 업그레이드 + 테스트

### 9.8 Phase 6 — 문서 & 최종 리뷰 (0.5일)

- `docs/STATUS.md` — TUI 업그레이드 ✅, 최근 변경 이력 갱신
- `docs/ROADMAP.md` — TUI 업그레이드 제거, 다음 작업 재설정
- `docs/ARCHITECTURE.md` — `cli/tui/` 구조 변경 반영
- `README.md` — 새 UI 표기 (스크린샷/gif 교체는 옵션)
- `superpowers:code-reviewer` 최종 리뷰 (CLAUDE.md 규칙)

### 9.9 Phase 경계 불변식

- Phase 1 끝: 새 유틸/훅 존재, 아무도 안 씀. 기존 앱 동작
- Phase 2 끝: Menu/Header/StatusBar 새 디자인. running/review/done 은 기존
- Phase 3 끝: Generate 만 새 화면
- Phase 4 끝: Monitor 만 새 화면
- Phase 5 끝: 모든 screen 신규, `PipelineProgress.tsx` 삭제됨
- Phase 6 끝: 문서 반영

### 9.10 리스크

- **Phase 3 Promise.all rate limit**: 실운영 검증으로 확인. 터지면 sequential fallback
- **Phase 5 Launch 로그 스트리밍**: callback 시그니처만 확장, 크면 로그는 Phase 6 로 연기하고 4단계 아이콘만
- **Phase 4 Monitor 데이터 부족**: dev 중 `data/reports/` fixture 사용, 실제 데이터는 Plan C 실운영 검증 후 자연 축적

---

## 10. 다음 단계

1. 본 스펙 자체 검토 (아래 "검토 이력" 섹션)
2. 사용자 최종 검토 게이트
3. `superpowers:writing-plans` 로 실행 플랜 생성 (Phase → TDD 5-step 분해)
4. `superpowers:subagent-driven-development` 로 구현

---

## 검토 이력

### 2026-04-22 (자체 검토 — 작성 직후)

외부 참조 검증에서 전제 오류 다수 발견. Critical 3 / Important 6 / Minor 3. 전부 본문에 인라인 패치 완료.

**Critical**:

- **C1 — `VariantReport.spend` 부재**: `core/platform/types.ts VariantReport` 는 `impressions/clicks/inlineLinkClickCtr/rankings` 만 보유. `variantReportsToReports` (`core/campaign/monitor.ts:86`) 가 `spend:0, cpc:0` 하드코딩. 현재 시스템은 spend 를 수집하지 않음 → Monitor 에서 spend/CPC 관련 필드 전부 제거 (§6.1.1, §6.2, §6.6). "Meta API spend 수집 + Monitor 복원" 은 ROADMAP Tier 2 로 분리.
- **C2 — Pipeline 2단계/4단계 불일치**: `runPipelineAction` (`cli/actions.ts:300`) 은 `scrape → generate` 2단계만. Mockup 의 4단계는 허구 → §7.5 를 2단계로 재작성. Pipeline 4단계 확장은 ROADMAP Tier 2.
- **C3 — `core/scraper/` 경로 없음**: 실제 scraper 는 `cli/scraper.ts` 1파일, Gemini 범용 파싱 → §7.1 에서 "URL 자동 감지" 로 변경, 지원 사이트 힌트 제거.

**Important**:

- **I1 — `data/creatives.db` 미존재 대응**: StatusBar winners 카운트에 DB 부재 시 `—` fallback 명시 (§3.3, §6.6).
- **I2 — scrape 사이트 힌트 제거**: C3 와 함께 해결.
- **I3 — `today ✓ N` 쿼리의 `Creative.approvedAt` 필드 존재 미검증**: Phase 0a 에 "Creative 타입 approvedAt 확인, 없으면 decisions.ts timestamp 또는 파일 mtime 사용" 추가.
- **I4 — `AD_AI_MODE` 참조 범위 검증 누락**: Phase 0a 에 "repo 전체 grep, CLI 외 참조 확인" 추가.
- **I5 — `RunProgress` 확장 호환성**: `generate?`, `launchLogs?` optional 필드로 추가, 기존 필드 유지하는 타입 구조 §4.3 에 명시.
- **I6 — Meta launcher emit 영향 범위 미측정**: Phase 0a 에 "`core/platform/meta/launcher.ts` 호출부 grep" 추가.

**Minor**:

- **M1 — Phase 시간 근거**: "7.5 ~ 9일" 범위 표기로 완화 반영됨 (§9 도입부).
- **M2 — Ink 5 호환성**: Phase 0a 에 "`ink-spinner/ink-gradient/ink-text-input` Ink 5 호환 버전 확인" 추가.
- **M3 — 유니코드 아이콘 호환성**: `[1] [2]` 같이 ASCII 로 치환된 곳은 있으나, `◆ / ⟳ / ⠋` 등은 유지. 포트폴리오 스크린샷 타겟이 macOS 기본 터미널 / iTerm2 여서 호환성 OK 판단.

**방법론 점검**:

- 외부 참조 검증: 9개 파일/심볼 중 `VariantReport`, `runPipelineAction`, `core/scraper/`, `data/creatives.db`, `Creative.approvedAt` 5개에서 문제 발견. 보수적으로 계속 추적.
- 추측 문구: "아마/일반적으로" 없음. "Veo 출력 1080×1920 고정" 은 §5.3 에서 "이후 다양화되면 확장" 으로 유예 표시.
- Deferral 집계: Phase 0a 에 유보된 확인 항목 7개(increase by 3). 계획 단계 전이라 허용.
- 구체 예시: 화면 mockup 6개, 포맷 예시(`${issue.slice(0,20)} → ${...}`) 1개, 타입 정의 복수 확보.

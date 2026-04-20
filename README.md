# AD-AI

Meta(Instagram/Facebook) 광고 자동화 CLI 파이프라인.

제품 URL을 입력하거나 수동으로 등록하면 스크래핑 → AI 소재 생성 → 검토 → Meta 게재 → 성과 모니터링 → 자율 개선까지 처리한다. 강의, 앱, 커머스, 서비스 등 모든 제품을 지원한다.

---

## 시작하기

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

`.env` 파일을 열고 API 키를 입력한다.

### 필요한 API 키

| 키 | 용도 | 필수 |
|----|------|------|
| `ANTHROPIC_API_KEY` | 카피 생성, 성과 분석 | Scrape/Generate/Monitor 사용 시 |
| `GOOGLE_AI_API_KEY` | HTML 파싱, 이미지/영상 생성 | Scrape/Generate 사용 시 |
| `META_ACCESS_TOKEN` 외 5개 | 광고 게재 및 성과 수집 | Launch/Monitor 사용 시 |

Scrape과 Generate만 테스트하려면 `ANTHROPIC_API_KEY`와 `GOOGLE_AI_API_KEY`만 있으면 된다. Meta 관련 키 없이도 소재 생성까지는 동작한다.

---

## 통합 TUI 앱 (추천)

```bash
npm run app
```

하나의 TUI에서 모든 작업을 처리한다.

```
┌──────────────────────────────────────────────────┐
│ AD-AI                                    v1.0.0  │
│──────────────────────────────────────────────────│
│ ▶ Scrape       제품 정보 수집                     │
│   Add Product  제품 수동 입력                     │
│   Generate     소재 생성                          │
│   Review       검토·승인                          │
│   Launch       광고 게재                          │
│   Monitor      성과 분석                          │
│   Improve      자율 개선                          │
│   Pipeline     전체 파이프라인 실행                │
│──────────────────────────────────────────────────│
│ ↑↓ 이동  Enter 선택  Q 종료                       │
└──────────────────────────────────────────────────┘
```

### TUI 단축키

| 화면 | 키 | 동작 |
|------|-----|------|
| 메뉴 | `↑` / `↓` | 항목 이동 |
| 메뉴 | `Enter` | 선택·실행 |
| 메뉴 | `Q` | 종료 |
| 입력 | `Enter` | 입력 확정 |
| 입력 | `Esc` | 취소, 메뉴로 복귀 |
| 검토 | `A` | 승인 |
| 검토 | `R` | 거절 (이유 입력 → Enter) |
| 검토 | `E` | 헤드라인 수정 (새 텍스트 → Enter) |
| 완료 | 아무 키 | 메뉴로 복귀 |

---

## 빠른 테스트 가이드

API 키를 설정한 후 아래 순서로 테스트해 볼 수 있다.

### 1. 제품 등록 (두 가지 방법)

**방법 A — URL 스크래핑:**

```bash
npm run app
# → Scrape 선택 → URL 입력 → Enter
```

또는 CLI로 직접:

```bash
npm run scrape https://www.inflearn.com/course/원하는-강의
```

**방법 B — 수동 입력:**

```bash
npm run app
# → Add Product 선택 → 제품명, 설명, URL, 가격 순서로 입력
```

등록된 제품은 `data/products/` 폴더에 JSON으로 저장된다.

### 2. 소재 생성

```bash
npm run app
# → Generate 선택
```

`data/products/`에 있는 모든 제품에 대해 카피(Claude) + 이미지(Imagen 3) + 영상(Veo 3.1)을 자동 생성한다. 생성 중 작업별 프로그레스 바가 표시된다.

생성된 소재는 `data/creatives/`에 저장된다.

### 3. 검토

```bash
npm run app
# → Review 선택
```

생성된 소재를 확인하고 승인(A) / 거절(R) / 수정(E)한다.

### 4. 광고 게재 (Meta API 키 필요)

```bash
npm run app
# → Launch 선택
```

승인된 소재를 Meta Marketing API로 게재한다. `.env`에 Meta 키가 설정되어 있어야 한다.

---

## 개별 CLI 명령어

TUI 외에 기존 CLI도 그대로 사용 가능하다.

```bash
npm run scrape <URL>                   # 제품 스크래핑
npm run generate <productId>           # 단일 제품 소재 생성 (productId: data/products/ 내 파일명)
npm run review                         # 검토 TUI
npm run launch                         # 승인된 소재 게재
npm run monitor daily                  # 전날 성과 수집
npm run monitor weekly                 # 주간 분석 + Claude 리포트
npm run monitor                        # cron 스케줄러 (매일 09:00, 매주 월 09:00)
npm run improve                        # 성과 기반 파이프라인 자율 개선
npm run pipeline <URL1> [URL2] ...     # 스크래핑 + 소재 생성 일괄 실행
```

---

## 자기학습 워커 설치 (Owner 모드, macOS)

자율 개선 루프를 터미널과 무관하게 상시 실행하려면 launchd daemon으로 워커를 등록합니다.

```bash
npm install                           # tsx 등 의존성 설치 확인
bash scripts/install-worker.sh
```

설치 후 `~/Library/LaunchAgents/com.adai.worker.plist` 를 편집해서 3개 `__INJECT__` 자리를 실제 토큰 값으로 교체:

- `META_ACCESS_TOKEN`
- `META_AD_ACCOUNT_ID`
- `ANTHROPIC_API_KEY`

재로드:

```bash
launchctl unload ~/Library/LaunchAgents/com.adai.worker.plist
launchctl load ~/Library/LaunchAgents/com.adai.worker.plist
```

로그 확인:

```bash
tail -f logs/worker.log
tail -f logs/worker.err
```

워커는 6시간마다 일간 성과를 수집하고 2일마다 주간 분석 + 자동 개선 사이클을 실행합니다. Mac이 슬립이었다면 깨어난 직후 밀린 작업을 자동으로 catch-up합니다.

제거:

```bash
launchctl unload ~/Library/LaunchAgents/com.adai.worker.plist
rm ~/Library/LaunchAgents/com.adai.worker.plist
```

---

## 기존 데이터 마이그레이션

이전 버전(`data/courses/`)의 데이터가 있으면 `data/products/`로 변환한다.

```bash
npm run migrate
```

---

## 데이터 구조

```
data/
├── products/       # 등록된 제품 JSON
├── creatives/      # 생성된 소재 (카피 JSON + 이미지/영상 파일 경로)
├── campaigns/      # 게재된 캠페인 정보
├── reports/        # 일간/주간 성과 데이터
└── improvements/   # 자율 개선 이력
```

---

## 테스트

```bash
npm test
```

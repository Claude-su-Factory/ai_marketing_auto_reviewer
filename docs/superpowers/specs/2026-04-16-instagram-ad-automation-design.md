# Instagram 광고 자동화 파이프라인 설계

**날짜:** 2026-04-16  
**프로젝트:** ad_ai  
**상태:** 승인됨

---

## 개요

인프런, 클래스101 등 외부 플랫폼에서 판매 중인 온라인 강의(약 30개)를 Instagram에 광고하기 위한 완전 자동화 CLI 파이프라인. 강의 URL을 입력하면 스크래핑 → AI 소재 생성 → 사람 검토 → Meta API 게재 → 성과 모니터링까지 단계별로 처리한다.

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| 언어 | TypeScript |
| TUI 프레임워크 | Ink (React for CLI) |
| 스크래핑 | Playwright |
| 카피 생성 | Claude (claude-sonnet-4-6) via Anthropic API |
| 데이터 파싱 | gemini-2.5-flash-preview via Google AI Studio API |
| 이미지 생성 | Imagen 3 via Google AI Studio API |
| 영상 생성 | Veo 3.1 via Google AI Studio API |
| 광고 게재 | Meta Marketing API (facebook-nodejs-business-sdk) |
| 스케줄러 | node-cron |
| 스타일 | chalk |

---

## 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                    CLI Pipeline (Ink TUI)                │
│                                                          │
│  1. scrape   →  2. generate  →  3. review  →  4. launch │
│                                                          │
│  URL 입력        AI 소재 생성    터미널에서     Meta API  │
│  강의 정보        카피+이미지     승인/거절      광고 게재  │
│  자동 추출        +영상           게이트                  │
└─────────────────────────────────────────────────────────┘
         ↓ 게재 후 자동 실행
┌─────────────────────────────────────────────────────────┐
│                  5. monitor (cron)                       │
│  성과 데이터 수집 → Claude 분석 → 최적화 제안 리포트      │
└─────────────────────────────────────────────────────────┘
```

### CLI 명령어

| 단계 | 명령어 | 설명 |
|------|--------|------|
| 1 | `npm run scrape <URL>` | 강의 정보 수집 |
| 2 | `npm run generate <강의ID>` | AI 소재 생성 |
| 3 | `npm run review` | 사람 검토·승인 |
| 4 | `npm run launch <캠페인ID>` | Meta API 광고 게재 |
| 5 | `npm run monitor` | 성과 수집·리포트 (cron 자동 실행) |
| - | `npm run pipeline` | 1~4 단계 일괄 실행 |

---

## 디렉토리 구조

```
ad_ai/
├── src/
│   ├── scraper/
│   │   └── index.ts          # Playwright로 URL → 강의 데이터 추출
│   ├── generator/
│   │   ├── copy.ts           # Claude로 광고 카피, 해시태그, CTA 생성
│   │   ├── image.ts          # Imagen 3으로 광고 이미지 생성
│   │   └── video.ts          # Veo 3.1로 광고 영상 생성
│   ├── reviewer/
│   │   └── index.ts          # Ink TUI 기반 인터랙티브 검토 화면
│   ├── launcher/
│   │   └── index.ts          # Meta Marketing API 광고 게재
│   ├── monitor/
│   │   └── index.ts          # 성과 데이터 수집 + Claude 분석 리포트
│   └── pipeline.ts           # 전체 파이프라인 오케스트레이터
├── data/
│   ├── courses/              # 스크래핑된 강의 정보 JSON
│   ├── creatives/            # 생성된 카피 + 이미지 + 영상 경로
│   └── reports/              # 성과 리포트 JSON
├── docs/
│   └── superpowers/specs/    # 설계 문서
├── .env                      # API 키 (절대 커밋 금지)
├── .env.example              # 환경 변수 템플릿
└── package.json
```

---

## 데이터 모델

```typescript
// 강의 정보
interface Course {
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

// 생성된 광고 소재
interface Creative {
  courseId: string;
  copy: {
    headline: string;
    body: string;
    cta: string;
    hashtags: string[];
  };
  imageUrl: string;
  videoUrl: string;
  status: "pending" | "approved" | "rejected" | "edited";
  reviewNote?: string;
  createdAt: string;
}

// 게재된 캠페인
interface Campaign {
  creativeId: string;
  metaCampaignId: string;
  metaAdSetId: string;
  metaAdIds: string[];          // 이미지 버전 + 영상 버전
  launchedAt: string;
  status: "active" | "paused" | "completed";
}

// 성과 데이터
interface Report {
  campaignId: string;
  date: string;
  impressions: number;
  clicks: number;
  ctr: number;
  spend: number;
  cpc: number;
  reach: number;
  frequency: number;
}
```

---

## AI 역할 분담

| AI 모델 | 역할 |
|---------|------|
| `gemini-2.5-flash-preview` | 스크래핑된 HTML 파싱, 강의 정보 구조화 |
| `claude-sonnet-4-6` | 광고 카피 생성, 성과 데이터 분석, 최적화 제안 |
| Imagen 3 | 강의 주제 기반 광고 이미지 생성 |
| Veo 3.1 | 광고용 숏폼 영상 생성 |

---

## Meta 광고 구조

강의 1개당:
- Campaign 1개 (목표: `OUTCOME_SALES` 또는 `OUTCOME_AWARENESS`)
  - Ad Set 1개 (타겟팅: 관심사, 연령, 지역 설정)
    - Ad 2개 (이미지 버전 + 영상 버전)

---

## TUI 화면 설계

### 파이프라인 진행 화면

```
┌─────────────────────────────────────────────────────┐
│  AD-AI Pipeline                          v1.0.0     │
├─────────────────────────────────────────────────────┤
│  [1] Scrape    [2] Generate    [3] Review    [4] Launch │
│       ✓            ⟳ 진행중        ○             ○    │
├─────────────────────────────────────────────────────┤
│  강의: React 완전정복 (12/30)                         │
│                                                     │
│  ▶ 이미지 생성 중...  ████████░░  80%              │
│  ▶ 영상 생성 중...   ██░░░░░░░░  20%              │
├─────────────────────────────────────────────────────┤
│  [Space] 일시정지   [Q] 종료   [R] 재시도           │
└─────────────────────────────────────────────────────┘
```

### 검토 화면

```
┌─────────────────────────────────────────────────────┐
│  검토 대기: 3개                                      │
├──────────────────┬──────────────────────────────────┤
│  강의 목록       │  미리보기                          │
│                  │                                   │
│  ▶ React 완전정복 │  [이미지 경로]  [영상 경로]        │
│    TypeScript 입문│                                   │
│    Docker 기초   │  카피: "React를 제대로 배우고       │
│                  │  싶다면 이 강의 하나로 끝냅니다..." │
│                  │                                   │
│                  │  [A] 승인   [R] 거절   [E] 수정   │
└──────────────────┴──────────────────────────────────┘
```

### 검토 게이트 흐름

```
생성 완료
    ↓
TUI 검토 화면
    ↓
승인(A) ──────────────────────→ Meta API 게재
거절(R) ──→ 이유 입력 ─────────→ Claude 재생성 요청
수정(E) ──→ 직접 텍스트 편집 ──→ Meta API 게재
```

---

## 성과 모니터링

### cron 스케줄

| 스케줄 | 작업 |
|--------|------|
| 매일 오전 9시 | 전날 성과 수집 + 일간 리포트 생성 |
| 매주 월요일 오전 9시 | 주간 리포트 + Claude 최적화 제안 |

### Claude 최적화 제안 출력 예시

```
주간 성과 리포트 (2026-04-07 ~ 2026-04-13)

상위 광고
1. TypeScript 입문   CTR 4.2%  CPC ₩320
2. Docker 기초       CTR 3.8%  CPC ₩410

하위 광고
1. React 완전정복    CTR 0.9%  CPC ₩1,200

Claude 제안
• React 완전정복: "완전정복" 보다 "3시간 만에 React 시작하기" 같은
  구체적 수치 표현이 클릭률에 효과적입니다.
• 영상 광고가 이미지 대비 CTR 2.1배 높습니다.
  예산을 영상 위주로 재배분을 권장합니다.
```

---

## 환경 변수

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
```

---

## 의존성 목록

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "latest",
    "@google/generative-ai": "latest",
    "facebook-nodejs-business-sdk": "latest",
    "playwright": "latest",
    "ink": "latest",
    "ink-big-text": "latest",
    "ink-progress-bar": "latest",
    "chalk": "latest",
    "node-cron": "latest"
  },
  "devDependencies": {
    "typescript": "latest",
    "@types/node": "latest",
    "tsx": "latest"
  }
}
```

---

## 광고 설정 기본값

파이프라인 실행 시 아래 값을 기본으로 사용하며, `.env` 또는 CLI 플래그로 오버라이드 가능.

| 항목 | 기본값 |
|------|--------|
| 일일 예산 | ₩10,000 / 강의 |
| 캠페인 목표 | `OUTCOME_SALES` |
| 타겟 연령 | 20~45세 |
| 타겟 지역 | 대한민국 |
| 광고 기간 | 14일 |
| 최적화 목표 | `LINK_CLICKS` |

---

## 자율 개선 루프 (Self-Improvement Loop)

성과 모니터링 결과를 바탕으로 Claude Code가 파이프라인 코드를 스스로 개선한다.

### 개선 대상 (자율 수정 가능)

| 대상 | 예시 |
|------|------|
| 카피 생성 프롬프트 | CTR 낮은 강의의 카피 스타일 조정 |
| 이미지/영상 생성 프롬프트 | 클릭률 높은 소재의 패턴 학습·반영 |
| 타겟팅 기본값 | 성과 좋은 연령대/관심사로 파라미터 업데이트 |
| 캠페인 파라미터 | 예산 배분, 최적화 목표 자동 조정 |
| 파이프라인 버그 | 잘못된 로직, 오류 케이스 자동 수정 |

### 개선 제외 대상

- 외부 플랫폼(인프런, 클래스101)의 강의 페이지 내용

### 자율 개선 흐름

```
monitor 실행
    ↓
성과 데이터 분석 (Claude)
    ↓
개선 필요 항목 식별
    ↓
코드 자동 수정 (Claude Code CLI)
    ↓
개선 내역 기록 → data/improvements/YYYY-MM-DD.json
    ↓
git commit (개선 이력 보존)
```

### 개선 이력 저장

`data/improvements/` 폴더에 날짜별 JSON으로 기록:

```json
{
  "date": "2026-04-16",
  "trigger": "React 완전정복 CTR 0.9% (임계값 1.5% 미달)",
  "changes": [
    {
      "file": "src/generator/copy.ts",
      "type": "prompt_update",
      "before": "강의의 핵심 내용을 강조하는 카피를 작성해주세요",
      "after": "수강 후 얻을 수 있는 구체적 결과물과 수치를 포함한 카피를 작성해주세요"
    }
  ]
}
```

---

## 제약 사항 및 주의점

- Meta Access Token은 만료 기간이 있으므로 장기 토큰(Long-lived token) 발급 필요
- Veo 3.1 영상 생성은 시간이 걸릴 수 있어 비동기 처리 필수
- 인프런, 클래스101의 스크래핑 정책 변경 시 scraper 업데이트 필요
- `.env` 파일은 절대 git에 커밋하지 않는다 (`.gitignore`에 포함)
- 광고 소재 이미지/영상은 Meta 광고 정책(크기, 길이, 텍스트 비율) 준수 필요

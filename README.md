# AD-AI

인스타그램 광고 자동화 CLI 파이프라인.

강의 URL을 입력하면 스크래핑 → AI 소재 생성 → 검토 → Meta 게재 → 성과 모니터링 → 자율 개선까지 처리한다.

---

## 시작하기

```bash
cp .env.example .env
# .env에 API 키 입력
npm install
```

### 필요한 API 키

| 키 | 용도 |
|----|------|
| `ANTHROPIC_API_KEY` | 카피 생성, 성과 분석 |
| `GOOGLE_AI_API_KEY` | 강의 파싱, 이미지/영상 생성 |
| `META_ACCESS_TOKEN` 외 5개 | 광고 게재 및 성과 수집 |

---

## 명령어

### 전체 파이프라인 (추천)

```bash
npm run pipeline <URL1> [URL2] ...
```

URL을 입력하면 스크래핑 → 소재 생성까지 자동 처리한다.  
완료 후 `npm run review`로 검토한다.

```bash
# 예시
npm run pipeline https://www.inflearn.com/course/react https://www.inflearn.com/course/typescript
```

---

### 단계별 실행

```bash
# 1. 강의 정보 스크래핑
npm run scrape <URL>

# 2. 소재 생성 (카피 + 이미지 + 영상)
npm run generate <courseId>   # courseId: data/courses/ 내 파일명

# 3. TUI 검토 (승인 / 거절 / 수정)
npm run review

# 4. 승인된 소재 광고 게재
npm run launch

# 5. 성과 수집 및 분석
npm run monitor daily    # 전날 데이터 수집
npm run monitor weekly   # 주간 분석 + Claude 리포트
npm run monitor          # cron 스케줄러 시작 (매일 09:00, 매주 월 09:00)

# 6. 자율 개선
npm run improve          # 성과 기반 파이프라인 코드 자동 개선
```

---

### TUI 검토 화면 단축키

| 키 | 동작 |
|----|------|
| `↑` / `↓` | 강의 목록 이동 |
| `A` | 승인 |
| `R` | 거절 (이유 입력 → Enter) |
| `E` | 헤드라인 수정 (새 텍스트 입력 → Enter) |
| `Esc` | 입력 취소 |

---

## 데이터 구조

```
data/
├── courses/        # 스크래핑된 강의 JSON
├── creatives/      # 생성된 소재 (카피, 이미지/영상 경로)
├── campaigns/      # 게재된 캠페인 정보
├── reports/        # 일간/주간 성과 데이터
└── improvements/   # 자율 개선 이력
```

---

## 테스트

```bash
npm test
```

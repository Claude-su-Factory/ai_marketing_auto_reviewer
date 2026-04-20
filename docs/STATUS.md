# 프로젝트 상태

마지막 업데이트: 2026-04-20

---

## Phase 요약

- [x] SP0 — 제품 일반화 (Course → Product로 범용화)
- [x] SP1 — 기본 파이프라인 (Scrape → Generate → Review → Launch → Monitor → Improve)
- [x] SP1.5 — 통합 TUI 앱 (Ink 기반 메뉴/입력/진행 화면)
- [x] SP2 — CLI 모드 분리 (Owner/Customer) + Usage API Server (Express + SQLite)
- [x] SP3 — Stripe 빌링 (deduct-first 패턴 + 자동 충전 + Webhook dedup)
- [x] SP4 — 레이어드 아키텍처 리팩터 (`core/` + `cli/` + `server/` 분리 완료)

---

## 서비스 컴포넌트 상태

| 컴포넌트 | 상태 | 위치 |
|---------|------|------|
| CLI 앱 (Owner/Customer 모드) | ✅ 운영 | `cli/entries/`, `cli/tui/` |
| Usage API Server (Express + SQLite) | ✅ 구현 완료 | `server/index.ts` |
| AI 프록시 라우트 (copy/image/video/parse/analyze) | ✅ 구현 완료 | `server/routes/` |
| Stripe Webhook + 자동 충전 | ✅ 구현 완료 (dedup 포함) | `server/routes/stripeWebhook.ts` |
| Admin CLI (라이선스 관리) | ✅ 구현 완료 | `server/admin.ts` |
| 비동기 Veo 영상 작업 관리자 | ✅ 구현 완료 | `server/jobs/videoJob.ts` |
| 세션 인증 + 레이트 리밋 (10 req/min) | ✅ 구현 완료 | `server/auth.ts`, `server/rateLimit.ts` |
| 테스트 (vitest) | ✅ 대부분 모듈에 `.test.ts` 존재 | 프로젝트 전반 |

---

## 최근 변경 이력

- 2026-04-20 fix: 자율 개선 루프 복구 완료 — monitor.ts의 분석 프롬프트 예시 경로를 core/creative로 갱신 (Claude가 src/ 응답 → readFile 실패 → 루프 스킵되던 문제 해결)
- 2026-04-19 fix: 자율 개선 루프의 src/ 경로 화이트리스트 regex를 core/cli/server로 현대화 + CTR_THRESHOLD 단일 출처화
- 2026-04-19 refactor: SP4 레이어드 리팩터 완료 (`src/` 제거, `core/` + `cli/`로 분리, 127 테스트 유지)
- 2026-04-19 feat: Stripe Webhook dedup 구현 (stripe_events 테이블 + INSERT OR IGNORE)
- 2026-04-17 docs: 레이어드 아키텍처 리팩터 설계 스펙 추가
- 2026-04-17 chore: 빌링 테스트 DB를 gitignore에 추가
- 2026-04-17 feat: Admin CLI에 Stripe 통합 + balance/tier 명령 추가
- 2026-04-17 feat: Express 서버에 빌링 + Webhook 통합
- 2026-04-17 feat: 전체 AI 라우트에 deduct-first 빌링 패턴 적용
- 2026-04-17 feat: Stripe Webhook 핸들러 추가 (dedup + 자동 충전)

<!--
업데이트 규칙:
- 기능 구현 완료 시 맨 위에 한 줄 추가
- 최신 10개만 유지 (11번째부터 삭제)
- 날짜는 YYYY-MM-DD 형식
-->

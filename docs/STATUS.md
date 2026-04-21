# 프로젝트 상태

마지막 업데이트: 2026-04-21

---

## Phase 요약

- [x] SP0 — 제품 일반화 (Course → Product로 범용화)
- [x] SP1 — 기본 파이프라인 (Scrape → Generate → Review → Launch → Monitor → Improve)
- [x] SP1.5 — 통합 TUI 앱 (Ink 기반 메뉴/입력/진행 화면)
- [x] SP2 — CLI 모드 분리 (Owner/Customer) + Usage API Server (Express + SQLite)
- [x] SP3 — Stripe 빌링 (deduct-first 패턴 + 자동 충전 + Webhook dedup)
- [x] SP4 — 레이어드 아키텍처 리팩터 (`core/` + `cli/` + `server/` 분리 완료)
- ✅ Platform Adapter 추상화 (`core/platform/`, `AdPlatform` interface)
- ✅ Meta Advantage+ Creative (DCO) 런칭 경로
- ✅ Rollback + orphans 기록 (`data/orphans.json`)
- ✅ 외부 수정 자동 감지 (`externally_modified` 상태)
- ✅ Plan B — Variant 생성 파이프라인 (제품당 3 copy variant + 공유 image/video + group review + ≥2 승인 DCO 런칭)

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
| 자기학습 워커 (launchd daemon) | ✅ 구현 완료 | `cli/entries/worker.ts`, `scripts/com.adai.worker.plist` |
| 스케줄러 (공유 모듈) | ✅ 구현 완료 | `core/scheduler/` |
| 테스트 (vitest) | ✅ 대부분 모듈에 `.test.ts` 존재 | 프로젝트 전반 |
| Dev-time Subagent 팀 (meta-platform-expert, marketing-copy-reviewer) | ✅ 구현 완료 | `.claude/agents/` |

---

## 알려진 결함 / 미구현 이슈

Plan A 리뷰에서 식별된 Minor 항목 중 이번 수정 플랜 범위 밖으로 미룬 것. Plan B 이후 cleanup 경로를 실제로 호출하게 되는 시점에 재검토.

- **deleteMetaResource 중복** — `core/platform/meta/launcher.ts:59-65`와 `core/platform/meta/adapter.ts:8-11`에 동일 함수. 나중에 공유 모듈로 추출.
- **failedRecord의 이미 삭제된 ID** — `launch_failed` Campaign 레코드는 rollback이 성공시킨 ID까지 그대로 담는다. 현재 cleanup()은 launch_failed에 호출되지 않으므로 문제 없지만, cleanup 경로 활성화 시점에 `cleanupResult.orphans`만 보존하도록 변경 필요.
- **cli/actions.ts의 미사용 Report import** — Task 3 이후 `Report` 타입이 쓰이지 않지만 import 유지. 다음 cli/actions.ts 수정 시 함께 제거.
- **ad_formats 명시, README 경고 문구, `assembleAssetFeedSpec` 에러 메시지 regex 강화** — 1차 리뷰에서 Minor로 분류된 나머지 항목.

---

## 최근 변경 이력

- 2026-04-21 feat: Dev-time Agent Team Phase 1a — meta-platform-expert, marketing-copy-reviewer subagent 2종 추가 및 CLAUDE.md "Subagent 호출 규칙" 통합 (Phase 1b/1c 유보)
- 2026-04-20 feat: Plan B 완료 — 제품당 3 copy variant(emotional/numerical/urgency) 생성, 공유 image/video, group 단위 리뷰 UI, ≥ 2 approved 그룹만 DCO 런칭. buildCopyPrompt 추출·generateCopy 시그니처 확장·groupApprovalCheck 도입. 테스트 202 통과
- 2026-04-20 fix: Plan A 리뷰 결함 수정 — `classifyMetaError` SDK shape 인식(C1), 일별 리포트 소비자 3곳을 VariantReport 포맷으로 정합화(C2), AdCreative를 rollback·cleanup·Campaign.metaAdCreativeId에 추적(C3), `launch_failed` Campaign JSON 기록(I1), `assembleAssetFeedSpec` 중복 body text 방지(I2). 테스트 183 통과
- 2026-04-20: Plan A 완료 — Platform Adapter 패턴 도입, Meta 런칭을 DCO `asset_feed_spec`으로 전환, 기존 Creative/Campaign 마이그레이션 스크립트 추가
- 2026-04-20 feat: 자율 자기학습 루프 launchd worker 구축 (core/scheduler 공유 모듈 + Owner 6h/2d, Server 24h/7d cadence + catch-up)
- 2026-04-20 fix: 자율 개선 루프 복구 완료 — monitor.ts의 분석 프롬프트 예시 경로를 core/creative로 갱신 (Claude가 src/ 응답 → readFile 실패 → 루프 스킵되던 문제 해결)
- 2026-04-19 fix: 자율 개선 루프의 src/ 경로 화이트리스트 regex를 core/cli/server로 현대화 + CTR_THRESHOLD 단일 출처화
- 2026-04-19 refactor: SP4 레이어드 리팩터 완료 (`src/` 제거, `core/` + `cli/`로 분리, 127 테스트 유지)
- 2026-04-19 feat: Stripe Webhook dedup 구현 (stripe_events 테이블 + INSERT OR IGNORE)
- 2026-04-17 docs: 레이어드 아키텍처 리팩터 설계 스펙 추가
- 2026-04-17 chore: 빌링 테스트 DB를 gitignore에 추가
- 2026-04-17 feat: Admin CLI에 Stripe 통합 + balance/tier 명령 추가
- 2026-04-17 feat: Express 서버에 빌링 + Webhook 통합
- 2026-04-17 feat: 전체 AI 라우트에 deduct-first 빌링 패턴 적용

<!--
업데이트 규칙:
- 기능 구현 완료 시 맨 위에 한 줄 추가
- 최신 10개만 유지 (11번째부터 삭제)
- 날짜는 YYYY-MM-DD 형식
-->

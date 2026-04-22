# 프로젝트 상태

마지막 업데이트: 2026-04-22

---

## Phase 요약

- [x] SP0 — 제품 일반화 (Course → Product로 범용화)
- [x] SP1 — 기본 파이프라인 (Scrape → Generate → Review → Launch → Monitor → Improve)
- [x] SP1.5 — 통합 TUI 앱 (Ink 기반 메뉴/입력/진행 화면)
- [x] SP2 — CLI 모드 분리 (Owner/Customer) + Usage API Server (Express + SQLite)  ← CLI 모드 2026-04-22 제거, server 는 비활성 유지
- [x] SP3 — Stripe 빌링 (deduct-first 패턴 + 자동 충전 + Webhook dedup)
- [x] SP4 — 레이어드 아키텍처 리팩터 (`core/` + `cli/` + `server/` 분리 완료)
- [x] SP5 — TUI 업그레이드 (Tokyo Night 팔레트, Generate 3-track 병렬, Monitor 신규 화면, owner-only CLI 전환, 10개 화면 톤 통일)
- ✅ Platform Adapter 추상화 (`core/platform/`, `AdPlatform` interface)
- ✅ Meta Advantage+ Creative (DCO) 런칭 경로
- ✅ Rollback + orphans 기록 (`data/orphans.json`)
- ✅ 외부 수정 자동 감지 (`externally_modified` 상태)
- ✅ Plan B — Variant 생성 파이프라인 (제품당 3 copy variant + 공유 image/video + group review + ≥2 승인 DCO 런칭)
- [x] Plan C — Winner DB + Voyage RAG 완결 (Qualify 스케줄러 wire-up 포함)

---

## 서비스 컴포넌트 상태

> 범례: ✅ 운영 = 실행 중 / ✅ 구현 완료 = 코드 존재 / 🟡 비활성 = 코드 존재하나 미실행 (server/ 미실행, 웹 UI 재개 시 재활성화)

| 컴포넌트 | 상태 | 위치 |
|---------|------|------|
| CLI 앱 (Owner-only) | ✅ 운영 | `cli/entries/`, `cli/tui/` |
| Usage API Server (Express + SQLite) | 🟡 비활성 (server/ 미실행, 웹 UI 재개 시 재활성화) | `server/index.ts` |
| AI 프록시 라우트 (copy/image/video/parse/analyze) | 🟡 비활성 (server/ 미실행, 웹 UI 재개 시 재활성화) | `server/routes/` |
| Stripe Webhook + 자동 충전 | 🟡 비활성 (server/ 미실행, 웹 UI 재개 시 재활성화) | `server/routes/stripeWebhook.ts` |
| Admin CLI (라이선스 관리) | 🟡 비활성 (server/ 미실행, 웹 UI 재개 시 재활성화) | `server/admin.ts` |
| 비동기 Veo 영상 작업 관리자 | 🟡 비활성 (server/ 미실행, 웹 UI 재개 시 재활성화) | `server/jobs/videoJob.ts` |
| 세션 인증 + 레이트 리밋 (10 req/min) | 🟡 비활성 (server/ 미실행, 웹 UI 재개 시 재활성화) | `server/auth.ts`, `server/rateLimit.ts` |
| 자기학습 워커 (launchd daemon) | ✅ 구현 완료 | `cli/entries/worker.ts`, `scripts/com.adai.worker.plist` |
| 스케줄러 (공유 모듈) | ✅ 구현 완료 | `core/scheduler/` |
| 테스트 (vitest) | ✅ 대부분 모듈에 `.test.ts` 존재 | 프로젝트 전반 |
| Winner DB (Voyage RAG) | ✅ 운영 | `core/rag/`, `data/creatives.db` |
| Dev-time Subagent 팀 (meta-platform-expert, marketing-copy-reviewer) | 🟡 파일 작성 완료 — dispatch 런타임 검증은 다음 세션 | `.claude/agents/` |

---

## 알려진 결함 / 미구현 이슈

Plan A 리뷰에서 식별된 Minor 항목 중 이번 수정 플랜 범위 밖으로 미룬 것. Plan B 이후 cleanup 경로를 실제로 호출하게 되는 시점에 재검토.

- **deleteMetaResource 중복** — `core/platform/meta/launcher.ts:59-65`와 `core/platform/meta/adapter.ts:8-11`에 동일 함수. 나중에 공유 모듈로 추출.
- **failedRecord의 이미 삭제된 ID** — `launch_failed` Campaign 레코드는 rollback이 성공시킨 ID까지 그대로 담는다. 현재 cleanup()은 launch_failed에 호출되지 않으므로 문제 없지만, cleanup 경로 활성화 시점에 `cleanupResult.orphans`만 보존하도록 변경 필요.
- **cli/actions.ts의 미사용 Report import** — Task 3 이후 `Report` 타입이 쓰이지 않지만 import 유지. 다음 cli/actions.ts 수정 시 함께 제거.
- **ad_formats 명시, README 경고 문구, `assembleAssetFeedSpec` 에러 메시지 regex 강화** — 1차 리뷰에서 Minor로 분류된 나머지 항목.
- **Plan C final review Minor** — (1) `core/rag/qualifier.test.ts`에 `loadProduct === null` 전용 테스트 없음, (2) `core/rag/qualifyJob.ts:buildCreativeIndex`가 ENOENT 외 readdir 에러(EACCES/EMFILE)도 무음 스킵, (3) `winners.creative_id`는 UNIQUE 제약 없음 — 동시 tick 시 동일 Creative 중복 기록 가능 (설계 의도), (4) `buildCreativeIndex` 매 tick 전체 스캔 — 수천 creatives 단계에서는 캐시 전략 필요. 모두 Minor, 운영상 지장 없음.
- **useReports 동시 load 레이스** — `cli/tui/hooks/useReports.ts`에서 `fs.watch` 이벤트가 이전 `load()` 진행 중 발생하면 setState 호출이 out-of-order가 되거나 unmount 후 setState 경고가 날 수 있다. 현재는 변화 빈도가 낮아 영향 미미. Monitor 화면 실운영 관찰 후 필요 시 mountedRef/inflightRef 도입.
- **runGenerate 오판 시 orphan promise** — `cli/actions.ts:runGenerate`는 image/video/copies 3-track을 `Promise.all`로 병렬 실행한다. 한 트랙이 실패하면 `Promise.all`이 즉시 reject되지만 나머지 트랙(특히 Veo polling)이 백그라운드에서 계속 진행돼 quota를 소모할 수 있다. 실운영 관찰 후 필요 시 AbortController 도입.

---

## 최근 변경 이력

- 2026-04-22 feat(tui): TUI 업그레이드 완료 — Tokyo Night 9색 팔레트(`cli/tui/theme/tokens.ts`), `cli/tui/screens/` 10개 화면(Menu/Scrape/AddProduct/Generate/Review/Launch/Monitor/Improve/Pipeline/Done) + `cli/tui/components/`(Header/StatusBar/ProgressTrack) + `cli/tui/hooks/`(useElapsed/useReports/useTodayStats/useWorkerStatus) 분리, `runGenerate` image/video/copy 3-track 병렬화, MonitorScreen 신규(`useReports` 기반 T 키 7/14/30일 윈도우), LaunchScreen에 Meta API onLog 스트리밍(launchLogs RunProgress emit), PipelineScreen 2-stage로 단순화. 313 tests 통과.
- 2026-04-22 docs: CLI owner-only 전환 반영 — `cli/mode.ts`·`cli/client/*` 삭제, `server/*` 컴포넌트를 🟡 비활성으로, ARCHITECTURE §11 신설, ROADMAP Tier 2 항목 정리.
- 2026-04-22 refactor(cli): AiProxy 간접 제거 + customer 모드 파일 삭제 (Phase 0b, TUI upgrade plan Task 1-3).
- 2026-04-21 feat: Plan C qualify 프로덕션 wire-up 완료 — `createQualifyJob` factory 신설(`core/rag/qualifyJob.ts`), `qualifyWinners` 시그니처를 `findCreativeByVariant(variantGroupId, variantLabel)`로 전환하고 filter-then-group 순서 적용, Owner worker(`cli/entries/worker.ts`) / Server scheduler(`server/scheduler.ts`)에 `VOYAGE_API_KEY` boot gate와 함께 주입. 자기 학습 루프가 매 tick마다 winner 후보를 `data/creatives.db`에 적재. 272 tests 통과.
- 2026-04-21 feat: Plan C 코어 모듈 완료 — Winner DB + Voyage RAG. `core/rag/` 모듈(types/db/store/voyage/qualifier/retriever) 도입, `data/creatives.db` SQLite(WAL) 스키마, voyage-3-lite 512d embedding BLOB 저장, 3-stage RAG cascade(category-cosine → global-cosine → lexical Jaccard)로 `generateCopy` few-shot 주입 경로 확립. improvementCycle을 aggregate→qualify→runCycle 3단계 DI로 리팩터. 스케줄러의 `qualify` 프로덕션 wire-up은 plan §2082-2083에 따라 후속 chore로 유예 — 현재 기본 `qualify`는 noop이므로 Winner DB는 후속 작업 완료 전까지 비어있다. 테스트 262 통과.
- 2026-04-21 feat: Dev-time Agent Team Phase 1a — meta-platform-expert, marketing-copy-reviewer subagent 2종 파일 추가 및 CLAUDE.md "Subagent 호출 규칙" 통합 (Phase 1b/1c 유보). 실제 dispatch 검증은 세션 start 시점 로드 제약으로 다음 세션에 확인 필요.
- 2026-04-20 feat: Plan B 완료 — 제품당 3 copy variant(emotional/numerical/urgency) 생성, 공유 image/video, group 단위 리뷰 UI, ≥ 2 approved 그룹만 DCO 런칭. buildCopyPrompt 추출·generateCopy 시그니처 확장·groupApprovalCheck 도입. 테스트 202 통과
- 2026-04-20 fix: Plan A 리뷰 결함 수정 — `classifyMetaError` SDK shape 인식(C1), 일별 리포트 소비자 3곳을 VariantReport 포맷으로 정합화(C2), AdCreative를 rollback·cleanup·Campaign.metaAdCreativeId에 추적(C3), `launch_failed` Campaign JSON 기록(I1), `assembleAssetFeedSpec` 중복 body text 방지(I2). 테스트 183 통과
- 2026-04-20: Plan A 완료 — Platform Adapter 패턴 도입, Meta 런칭을 DCO `asset_feed_spec`으로 전환, 기존 Creative/Campaign 마이그레이션 스크립트 추가
- 2026-04-20 feat: 자율 자기학습 루프 launchd worker 구축 (core/scheduler 공유 모듈 + Owner 6h/2d, Server 24h/7d cadence + catch-up)
- 2026-04-20 fix: 자율 개선 루프 복구 완료 — monitor.ts의 분석 프롬프트 예시 경로를 core/creative로 갱신 (Claude가 src/ 응답 → readFile 실패 → 루프 스킵되던 문제 해결)
- 2026-04-19 fix: 자율 개선 루프의 src/ 경로 화이트리스트 regex를 core/cli/server로 현대화 + CTR_THRESHOLD 단일 출처화
- 2026-04-19 refactor: SP4 레이어드 리팩터 완료 (`src/` 제거, `core/` + `cli/`로 분리, 127 테스트 유지)

<!--
업데이트 규칙:
- 기능 구현 완료 시 맨 위에 한 줄 추가
- 최신 10개만 유지 (11번째부터 삭제)
- 날짜는 YYYY-MM-DD 형식
-->

# 프로젝트 상태

마지막 업데이트: 2026-04-28

---

## Phase 요약

- [x] SP0 — 제품 일반화 (Course → Product로 범용화)
- [x] SP1 — 기본 파이프라인 (Scrape → Generate → Review → Launch → Monitor → Improve)
- [x] SP1.5 — 통합 TUI 앱 (Ink 기반 메뉴/입력/진행 화면)
- [x] SP2 — CLI 모드 분리 (Owner/Customer) + Usage API Server (Express + SQLite)  ← CLI 모드 2026-04-22 제거, server 는 비활성 유지
- [x] SP3 — Stripe 빌링 (deduct-first 패턴 + 자동 충전 + Webhook dedup)
- [x] SP4 — 레이어드 아키텍처 리팩터 (`core/` + `cli/` + `server/` 분리 완료)
- [x] SP5 — TUI 업그레이드 (Tokyo Night 팔레트, Generate 병렬화, Monitor 신규 화면, owner-only CLI 전환, 10개 화면 톤 통일)
- [x] SP6 — 멀티모듈 리팩터 (npm workspaces 기반 `packages/core,cli,server/` 분리, tsx 런타임 유지, Phase B 추후 repo 분리 토대 확립)
- ✅ Platform Adapter 추상화 (`packages/core/src/platform/`, `AdPlatform` interface)
- ✅ Meta Advantage+ Creative (DCO) 런칭 경로
- ✅ Rollback + orphans 기록 (`data/orphans.json`)
- ✅ 외부 수정 자동 감지 (`externally_modified` 상태)
- ✅ Plan B — Variant 생성 파이프라인 (제품당 3 copy variant + 공유 image + group review + ≥2 승인 DCO 런칭)
- [x] Plan C — Winner DB + Voyage RAG 완결 (Qualify 스케줄러 wire-up 포함)

---

## 서비스 컴포넌트 상태

> 범례: ✅ 운영 = 실행 중 / ✅ 구현 완료 = 코드 존재 / 🟡 비활성 = 코드 존재하나 미실행 (server/ 미실행, 웹 UI 재개 시 재활성화)

| 컴포넌트 | 상태 | 위치 |
|---------|------|------|
| CLI 앱 (Owner-only) | ✅ 운영 | `packages/cli/src/entries/`, `packages/cli/src/tui/` |
| Usage API Server (Express + SQLite) | 🟡 비활성 (server/ 미실행, 웹 UI 재개 시 재활성화) | `packages/server/src/index.ts` |
| AI 프록시 라우트 (copy/image/parse/analyze) | 🟡 비활성 (server/ 미실행, 웹 UI 재개 시 재활성화) | `packages/server/src/routes/` |
| Stripe Webhook + 자동 충전 | 🟡 비활성 (server/ 미실행, 웹 UI 재개 시 재활성화) | `packages/server/src/routes/stripeWebhook.ts` |
| Admin CLI (라이선스 관리) | 🟡 비활성 (server/ 미실행, 웹 UI 재개 시 재활성화) | `packages/server/src/admin.ts` |
| 세션 인증 + 레이트 리밋 (10 req/min) | 🟡 비활성 (server/ 미실행, 웹 UI 재개 시 재활성화) | `packages/server/src/auth.ts`, `packages/server/src/rateLimit.ts` |
| 자기학습 워커 (launchd daemon) | ✅ 구현 완료 | `packages/cli/src/entries/worker.ts`, `scripts/com.adai.worker.plist` |
| 스케줄러 (공유 모듈) | ✅ 구현 완료 | `packages/core/src/scheduler/` |
| 테스트 (vitest) | ✅ 대부분 모듈에 `.test.ts` 존재 | 프로젝트 전반 |
| Winner DB (Voyage RAG) | ✅ 운영 | `packages/core/src/rag/`, `data/creatives.db` |
| Dev-time Subagent 팀 (meta-platform-expert, marketing-copy-reviewer) | ✅ 구현 완료 — 2026-04-22 TUI upgrade Task 31 에서 meta-platform-expert dispatch 성공 (launcher onLog 검증 + deleteMetaResource 시맨틱 검증) | `.claude/agents/` |

---

## 알려진 결함 / 미구현 이슈

Plan A 리뷰에서 식별된 Minor 항목 중 이번 수정 플랜 범위 밖으로 미룬 것. Plan B 이후 cleanup 경로를 실제로 호출하게 되는 시점에 재검토.

- **deleteMetaResource 중복** — `packages/core/src/platform/meta/launcher.ts:59-65`와 `packages/core/src/platform/meta/adapter.ts:8-11`에 동일 함수. 나중에 공유 모듈로 추출.
- **failedRecord의 이미 삭제된 ID** — `launch_failed` Campaign 레코드는 rollback이 성공시킨 ID까지 그대로 담는다. 현재 cleanup()은 launch_failed에 호출되지 않으므로 문제 없지만, cleanup 경로 활성화 시점에 `cleanupResult.orphans`만 보존하도록 변경 필요.
- **ad_formats 명시, README 경고 문구, `assembleAssetFeedSpec` 에러 메시지 regex 강화** — 1차 리뷰에서 Minor로 분류된 나머지 항목.
- **Plan C final review Minor** — (1) `packages/core/src/rag/qualifier.test.ts`에 `loadProduct === null` 전용 테스트 없음, (2) `packages/core/src/rag/qualifyJob.ts:buildCreativeIndex`가 ENOENT 외 readdir 에러(EACCES/EMFILE)도 무음 스킵, (3) `winners.creative_id`는 UNIQUE 제약 없음 — 동시 tick 시 동일 Creative 중복 기록 가능 (설계 의도), (4) `buildCreativeIndex` 매 tick 전체 스캔 — 수천 creatives 단계에서는 캐시 전략 필요. 모두 Minor, 운영상 지장 없음.
- **useReports 동시 load 레이스** — `packages/cli/src/tui/hooks/useReports.ts`에서 `fs.watch` 이벤트가 이전 `load()` 진행 중 발생하면 setState 호출이 out-of-order가 되거나 unmount 후 setState 경고가 날 수 있다. 현재는 변화 빈도가 낮아 영향 미미. Monitor 화면 실운영 관찰 후 필요 시 mountedRef/inflightRef 도입.
- **TUI upgrade final review Minor** (Task 31 잔여, 2026-04-22): (1) `useWorkerStatus`가 `Number(pid) > 0` 검사로 "-" placeholder를 자연 차단하는데 명시 주석 없음, (2) `useElapsed` useEffect dep에 `startedAt` 미포함 — 호출자가 mid-lifetime에 바꾸면 stale closure, (3) `MonitorScreen`의 StatusBar `winners: null` 하드코딩(미연결), (4) MonitorScreen 입력 힌트 "R 새로고침" 이 있지만 핸들러 미구현(dead affordance), (5) `packages/core/src/campaign/`의 `aggregateVariantReports`의 `avgCtr`는 `totalClicks/totalImpressions`와 동치인 redundant 가중 계산, (6) MonitorScreen/LaunchScreen 테스트가 render-check 위주(정렬·하이라이트 behavioral assertion 부재). 모두 v1 기능엔 영향 없음 — 실운영 관찰 후 batched cleanup.
- **멀티모듈 리팩터 Minor** (2026-04-24): ~~(M-1) `dotenv` 중복~~ — 2026-04-25 해소(TOML 마이그레이션으로 dotenv 자체 제거), (M-2) `better-sqlite3` 가 core 와 server 양쪽 deps 에 선언 (core 의 rag DB + server 의 license DB 각각 사용), (M-3) 루트 `tsconfig.json` 에 `jsx: "react-jsx"` 유지 — IDE 편의용이나 core/server 는 JSX 안 씀, (M-4) workspace 의존성 선언이 `"workspace:*"` 가 아닌 `"*"` (npm 11 `EUNSUPPORTEDPROTOCOL` 회피), Phase B 시 `"^1.0.0"` 등으로 교체, (M-5) 테스트 파일 7개에 `"packages/server/src/"` prefix 문자열 리터럴 중복 — 다음 경로 이전 시 공통 상수 추출 고려, (M-6) `CLAUDE.md` 의 harness engineering 예시 `"server/routes/*는 factory 함수 패턴"` 은 의도적 일러스트로 유지. 모두 기능 영향 없음.
- **멀티플랫폼 인터페이스 정리 review 결함** (2026-04-25, commit `a3c7eec` + `3362fa8`): (R-1) `LaunchResult.externalIds` / `Campaign.externalIds`의 well-known 키(`campaign`, `ad`)가 JSDoc 약속만 있고 TypeScript 타입으로 강제되지 않음 — 미래에 `result.externalIds.campain` 같은 오타 컴파일 통과. 성공 path만 `{campaign:string; ad:string} & Record<string,string>` 으로 좁히는 follow-up 가능. (R-2) `meta/monitor.ts:43` 의 no-adId guard (3362fa8 신설) + `meta/launcher.ts:169-198` `launch_failed` path 모두 테스트 커버리지 zero — 미래 회귀 시 캐치 못함. 임시 storage + stub `Ad`/`FacebookAdsApi.init` 으로 3-line 추가 가능. (R-3) `externalIds.adSet` (camelCase) vs `orphans[].type === "adset"` (lowercase) 동일 파일 내 lexical 불일치 — 단일 컨벤션 정착 시점에 정리. (R-4) `passesThreshold` 의 `BELOW_AVERAGE_*` 검사가 Meta enum 의존이지만 inline 주석 없음 — 두 번째 어댑터의 quality signal 추가 시 일반화. (R-5) `meta/launcher.ts:177-183` `failedExternalIds` 6-line 반복 → 헬퍼 추출 가능. (R-6) `qualifier.test.ts` 의 일부 `passesThreshold` 케이스가 `mkAgg` 헬퍼 미사용 inline fixture — 리팩터 시 유지보수 비용. 모두 동작 정상, 다음 cleanup 사이클에 일괄 처리.
- **Prompt-as-Data refactor review-deferred items** (2026-04-26, commits `141b493` ~ `7f047b4` chain): 5-commit 리팩터 (loader/creative migration/improver rewrite/fewShot injection/docs) 의 review 사이클에서 deferred 처리한 항목들. 모두 동작 정상, 다음 cleanup 사이클에 일괄 처리.
  - **Commit 2 deferred** (R-A): (R-A1) `generateCopy` 가 systemPrompt 위해 `loadPrompts()` 호출 직후 `buildCopyPrompt` 가 userTemplate 위해 또 호출 — cache hit 이지만 동일 함수 안 중복. (R-A2) test fixture 의 `padEnd(120, " ")` 같은 schema 만족용 패딩이 4+ fixture 시 helper 추출 후보. (R-A3) 테스트가 `data/learned/prompts.json` 부재에 의존 — 미래 dev 환경에 파일 있으면 silently break 가능, `setPromptsForTesting(DEFAULT_PROMPTS)` in vitest.setup 으로 명시화 검토.
  - **Commit 3 deferred** (R-B): (R-B1) `buildImprovementPrompt` 의 "의미를 보존하되" 가 single-shot 재작성에 약함, length-ratio 경고/diff 형식 검토. (R-B2) angleHints variant tone drift — emotional/numerical/urgency 가 학습으로 수렴 위험, tone keyword check. (R-B3) performanceContext 가 `weakReports[0]` 만 사용 — 정렬 없고 sample-of-1, aggregate 또는 worst-pick 개선. (R-B4) reject reason free-form string → `{label, pattern, sample}` 정형화. (R-B5) MIN_CAMPAIGNS skip 시 audit 누락 — `{date}-skipped.json` 추가 검토. (R-B6) CLI runImprove 가 accepted/rejected 수 표시 안 함, runtime 가시성. (R-B7) 변형 표현 (압도적/유일하게/당신을 위한) regex 패턴 확장. (R-B8) `setPromptValue` 의 JSON deep clone — 미래 Date/Map 추가 시 structuredClone 으로. (R-B9) `parsePromptUpdate` partial JSON 시 throw — try/catch wrap. (R-B10) cost log `ANALYSIS_CALL_USD` 가 runner 안에서 카운트되지만 analysis call 은 upstream — 라벨 수정 또는 위치 이동.
  - **Commit 4 deferred** (R-C): (R-C1) fewShot block header `"참고 예시:"` 가 약함, "톤·구조 참고용. 그대로 복제하지 말고..." 로 강화. (R-C2) per-variant fewShot ordering 동일 — primacy bias, shuffle/rotate 검토. (R-C3) winner-side validation layer 부재 — winner DB 가 generateCopy 외 source import 시 banned 패턴 가드 없음. (R-C4) fewShot 회수 결과 (몇 개 winner 사용됨) TUI/CLI 가시성. (R-C5) `pipeline.ts:runPipeline` Step 2 가 try-finally 만 있고 catch 없음 — `createCreativesDb` throw 시 caller propagate (의도이나 명시).
- **Gemini→Claude parser + retry wrapper review-deferred items** (2026-04-27, commits `353077a`+`b2f7de2`+`424d5ca`): 2-commit refactor (parser Claude 마이그레이션 + Image/Video Gemini retry wrapper) review 사이클의 deferred 항목. 모두 동작 정상.
  - **R-E1** Partial-JSON `JSON.parse` throw 패턴 — `packages/core/src/product/parser.ts:42-43` 의 `JSON.parse(jsonMatch?.[0] ?? "{}")` 가 `{...}` 매칭 후 내부가 unquoted-key/truncated 같이 valid JSON 이 아니면 throw. `runScrape` 의 outer try/catch 가 `String(e)` 로 fail 메시지 표시하지만 빈 Product 로 graceful degrade 안 됨. 동일 패턴이 `creative/copy.ts`/`campaign/monitor.ts` 에도 존재 — 다음 cleanup 사이클에 codebase-wide 로 try/catch wrap 통일.
  - **R-E3** `defaultIsRetryable` substring 매칭 brittle — `String(e).includes("429")` 가 user-supplied content (예: 제품명 "429 Original") 에 우연 매칭 가능. `@google/genai` 가 `ServerError`/`ClientError` 를 export 하므로 instanceof 기반으로 좁힐 수 있음. 본 commit 은 `creative/` 로컬 helper 라 작은 위험 — generic util 로 ascend 시점에 structured matching 으로 교체.
  - **R-E4** retry helper 통합 테스트 부재 — `image.ts`/`aiImage.ts` 의 wrap 호출처가 retry 가 실제 fire 됨을 검증하는 테스트 없음 (helper 자체는 11 케이스). pure pass-through 라 회귀 위험 낮음. 추후 site 별 smoke test 1개씩 추가 검토.
- **Product 데이터 풍부화 review-deferred items** (2026-04-28, Phase 1 commits `d58ba8b`+`f117bb4`+`8a0ef65`): 3 필드 추가 (learningOutcomes/differentiators/originalPrice) + parser/copy prompt/RAG 임베딩 통합 + 신규 banned-pattern 가드. review 사이클의 deferred 항목.
  - **R-F1** banned-pattern false positive monitoring — 신규 `discount-superlative` (`최대\s*할인`) 패턴이 정당한 사용 ("최대 할인 50%" 같은 사실 표시) 도 매칭 가능. 운영 1주 후 reject 빈도 확인. ※ `result-guarantee` 의 `보장` regex 는 marketing-copy-reviewer 권고 (commit `f117bb4`) 로 좁혀짐 (`(효과|결과|성공|합격)\s*보장`) — false positive 해소.
  - **R-F2** result-guarantee narrowing scope gap — narrowed regex `(효과|결과|성공|합격)\s*보장` 가 의미상 동치인 다른 표현 ("성과 보장", "수익 보장", "점수 보장", "취업 보장") 미차단. 학원/교육/투자 광고에서 흔함. 다음 cleanup 사이클에 alternation 확장 검토: `(효과|결과|성과|성공|합격|수익|점수|취업)\s*보장`.
  - **R-F4** Google 모델 auto-discovery — 2026-04-28 사용자 보고: `imagen-3.0-generate-002` 가 404 NOT_FOUND. 해결: (1) `packages/core/src/creative/modelDiscovery.ts` 신규 — `/v1beta/models` REST 엔드포인트로 가용 모델 fetch + 랭킹 (stable > preview, 높은 version, "generate" 베이스 > fast/ultra/lite) 으로 best 후보 자동 선택, (2) image.ts/aiImage.ts 가 `await discoverImageModel()` 사용 (config 거치지 않음), (3) in-memory 캐시 (process lifetime) + 동시 호출 시 단일 in-flight fetch, (4) `npm run list-models` 디버깅 스크립트 유지, (5) `callGoogleModel` 헬퍼가 404 시 friendly 에러. 사용자 config.toml 변경 불필요 — 코드가 알아서 처리. (video 제거됨, 2026-04-28)
  - **R-F3** Product 파일 로딩 시 schema 검증 부재 — `packages/core/src/rag/qualifyJob.ts:45` 의 `as Product` cast 등에서 데이터가 신규 required 필드 (learningOutcomes/differentiators) 누락된 옛 JSON 일 경우 runtime 에 `undefined` 가 흘러 들어감 (예: buildLearningOutcomesBlock 의 `.length` 접근 시 throw). 현재 사용자 직접 삭제 + re-scrape 안내로 mitigated. 다음 cleanup 사이클에 file-load boundary 의 zod 검증 또는 `?? []` defensive default 추가.
- **Meta FB-only fallback review-deferred items** (2026-04-27, commit `c32141c`): 1-commit refactor (instagram_actor_id 옵셔널화 + buildAdSetTargeting 동적 placement 분기) review 사이클의 deferred 항목. 모두 동작 정상, 다음 cleanup 사이클에 일괄 처리.
  - **meta-platform-expert deferred** (R-D1~R-D3): (R-D1) `igEnabled` boolean 가 placement/actor 3-way sync 를 convention 으로만 enforce — future placement 추가 시 drift 위험. helper extraction (`buildPlacementSpec()`) 검토. (R-D2) `assetFeedSpec.ts` 가 `story`/`video_feeds`/`reels` placement 의 9:16 vertical asset 보장 안 함, silent zero-deliver 가능 — 첫 실 운영 시 placement 별 delivery 확인. (R-D3) `buildAdSetTargeting` 가 `cfg.platforms.meta` 자체 부재 시 silent FB-only 반환, 함수 자체는 invariant 명시 없음 — production path 외 호출 시 programming error 위험 (이번 commit 의 doc comment 추가로 일부 완화).
  - **code-reviewer deferred** (R-D4): production runtime 첫 운영 risk — FB-only path 가 처음으로 enable, Meta API 가 `object_story_spec` lacking `instagram_actor_id` 를 Page 정책으로 거부 가능. classifyMetaError specific code 매핑 없을 수 있음. 첫 실 launch 시 triage.
  - **Minor**: (R-D5) `omit` union 6-wide, 7th 추가 시 path-injection helper refactor. (R-D6) `useReports.test.tsx` pre-existing flake (vi.useFakeTimers + vi.waitFor race), 본 commit 무관, 별 cleanup 후보.
- **R-G1** Meta DCO image-only video-native placement 게재 verify (2026-04-28, 영상 트랙 제거 commit) — `launcher.ts:buildAdSetTargeting` 의 `facebook_positions: video_feeds` (FB 전용) + `instagram_positions: reels` (IG 전용) 는 video-native placement. image-only 자산으로 게재 시 underperform 가능 (Meta 가 거부할 가능성 또는 0 impression). 첫 실 launch 후 placement breakdown 확인 필요. 만약 video_feeds/reels 가 0 impression 이면: (a) `asset_feed_spec.placement_asset_customization` 추가 또는 (b) 위 두 placement 를 배열에서 제거 — image-friendly 만 좁히기: `facebook_positions=[feed, story, marketplace]` + `instagram_positions=[stream, story]`. 운영 1주 후 판단. meta-platform-expert (commit `7e8a6bb` review) 권고.
- **R-G2** Parser Haiku 추출 quality monitor (2026-04-28, Claude 모델 tier 분리 commit) — `parser.ts` 가 Sonnet 4.6 → Haiku 4.5 다운그레이드. 한국어 페이지 추출 정확도 변화 가능 — 특히 `learningOutcomes` / `differentiators` 필드 추출 quality 가 광고 카피 풍부화 효과 직결. 운영 1주 후 추출 결과 verify. 만약 빈 배열 빈도 ↑ 이면: (a) Parser 를 Sonnet 으로 되돌림 (`MODEL_PARSER` 1 줄 변경) 또는 (b) Haiku 용 system prompt 강화 (추출 규칙 명시화).

---

## 최근 변경 이력

- 2026-04-28 refactor(claude tier): 6 callsites 의 하드코딩 `claude-sonnet-4-6` → use-case 별 상수 (`MODEL_PARSER`/`MODEL_COPY`/`MODEL_ANALYSIS`/`MODEL_IMPROVER`) 로 centralize. Parser 만 Haiku 4.5 다운그레이드 (~73% 비용 절감 / scrape, $0.012 → $0.003). Copy/Analysis/Improver 는 Sonnet 4.6 유지 (한국어 nuance + reasoning critical). 신규 `packages/core/src/config/claudeModels.ts` + 3 테스트. R-G2 (Parser Haiku quality monitor) 등록.
- 2026-04-28 chore(remove video): Veo dead code 파일 삭제 (Commit 2/2) — `creative/video.ts` / `creative/video.test.ts` / `server/jobs/videoJob.ts` / `server/routes/aiVideo.ts` 4 파일 삭제. `modelDiscovery.ts` 의 `discoverVideoModel` + override + cache 제거. `listModels.ts` 의 video 후보 출력 제거. STATUS R-E2 (polling wall-clock) 제거 — video.ts 삭제로 dead. R-E4/R-F4 narrow (image 만 언급).
- 2026-04-28 refactor(remove video): 영상 트랙 제거 — Veo / video.ts / videoJob.ts / aiVideo.ts 완전 삭제, Creative.videoLocalPath / VariantGroup.assets.video / AssetFeedSpec.videos 필드 제거. 광고 자동화 = image + copy 만으로 단순화. 사용자 의도 (AI 영상 미도입 + 영상 데이터 자체 미취급) 반영. 17 fixture 갱신 + 4 파일 삭제 (Commit 2 에서). Meta DCO image-only 정상 게재 — Reels placement 운영 verify 필요 (R-G1).
- 2026-04-28 feat(product): 데이터 풍부화 Phase 1 — Product 타입에 learningOutcomes/differentiators (required, default []) + originalPrice (옵셔널) 추가. parser system prompt 가 3 필드 추출, buildCopyPrompt 가 priceText 할인율 표시 + learningOutcomesBlock + differentiatorsBlock 헬퍼로 prompt 풍부화. DEFAULT_PROMPTS userTemplate 에 신규 placeholder 2개, systemPrompt 에 학습 결과 표현 정책 + 할인율 표현 정책 추가. improver banned-pattern 에 `result-guarantee` + `discount-superlative` 라벨 추가. 8 fixture 위치 갱신 (6 파일). +14 신규 테스트 케이스. 사용자가 기존 product JSON 삭제 + re-scrape 권장.
- 2026-04-27 refactor(parser): Gemini → Claude 마이그레이션 + runScrape 4-단계 onProgress emit + ScrapeScreen 정규식 robust 화. (a) `packages/core/src/product/parser.ts` 의 `parseProductWithGemini` → `parseProductWithClaude` (claude-sonnet-4-6 + system prompt + ephemeral cache). `cli/actions.ts:runScrape` 와 `server/routes/aiParse.ts` 호출처 마이그레이션. (d) runScrape 가 4 단계 (Playwright/페이지 로드/Claude 파싱/제품 저장) 에서 onProgress emit 추가, ScrapeScreen 의 parse 정규식을 `/Gemini|Claude|파싱/i` 로 확장 (provider 변경 robust). 503 안정성 + provider 일관성 + TUI UX 동시 개선. AI provider 정리: Anthropic = parser/copy/analysis/improver, Google = image/video.
- 2026-04-27 feat(meta): `instagram_actor_id` 를 schema 에서 optional 로 전환. `buildAdSetTargeting` 이 `publisher_platforms` 동적 분기 — 값 있으면 `["facebook", "instagram"]` + IG positions, 없으면 `["facebook"]` + FB positions only. `createAdCreative` 의 `object_story_spec.instagram_actor_id` 도 조건부 포함. IG biz account 미연결 사용자도 광고 게재 가능. 1 commit atomic. 396 tests 통과.
- 2026-04-26 refactor(improver): 자기학습 루프를 코드 자율 패치 → prompt-as-data 모델로 전환. `packages/core/src/learning/prompts.ts` 신설 (lazy singleton loader + Zod schema + REQUIRED_PLACEHOLDERS 검증 + DEFAULT_PROMPTS). `creative/copy.ts:COPY_SYSTEM_PROMPT` 와 `creative/prompt.ts:ANGLE_HINTS` 를 `data/learned/prompts.json` 으로 추출 (default 값과 byte-단위 일치 → 동작 회귀 zero). `improver/runner.ts` 전면 재작성 — `filterSafeImprovementFiles`, `applyCodeChange`, `execFileSync git ...` 모두 제거. Claude 가 promptKey enum (5개) + 현재 값 + issue 받아 새 prompt 값 반환 → 4-gate validation (parse/schema/placeholder/banned-pattern) → prompts.json 업데이트 + invalidatePromptsCache + audit. Banned-pattern 은 personalization (회원님 등) + unverified-hyperbole (100% 효과, 1위 등) — Layer A (prompt) + Layer B (validator) 2-layer 방어. `MAX_PROPOSALS_PER_CYCLE=5`, `MIN_CAMPAIGNS_FOR_LEARNING=3`, cost 추정 로그. TUI/CLI Generate 경로 (`actions.ts:runGenerate`, `entries/generate.ts`) 가 winner DB fewShot 주입 — 자기학습 prompt 변화가 실제 카피 생성에 반영됨. 392 tests 통과. CLI/Server 인터페이스 호환 (file vs DB) 보장, server 활성화 시 시스템-wide DB 모델로 확장 가능.
- 2026-04-25 feat(platform): 멀티플랫폼 어댑터 scaffold 추가 — `packages/core/src/platform/tiktok/`, `google/` 5개 파일씩 + 공유 `notImplemented.ts` 헬퍼. NotImplementedError throw 본체 + 실 통합용 README (SDK/OAuth/hierarchy/checklist). AdPlatform 인터페이스 정리: `Creative.copy.metaAssetLabel→assetLabel`, `VariantReport`의 Meta ranking 3종을 `platformMetrics.meta.*`로 격리, `LaunchResult.externalIds`/`Campaign.externalIds`를 `Record<string,string>`으로 일반화. Config 스키마 `[platforms.tiktok]`/`[platforms.google]` + `requireTiktok`/`requireGoogle` 헬퍼 + registry `NOT_YET_IMPLEMENTED` set으로 scaffold 어댑터 활성화 가드. `data/` 비어있는 시점에 인터페이스 못 박음 — 영속 데이터 마이그레이션 zero. ~358 tests 통과. 실 API 통합은 ROADMAP Tier 3 후속 (각 플랫폼당 별 spec).
- 2026-04-25 chore: 레거시 잔재 정리 — 옛 위치의 `packages/server/src/data.db`(2026-04-24 리팩터에서 `data/licenses.db`로 이전됐으나 untracked 파일이 잔존), 빈 `data/courses/` 디렉토리, 일회성 마이그레이션 스크립트 2종(`scripts/migrate.ts`, `scripts/migrate-creatives.ts`) 및 root `package.json`의 `migrate`/`migrate:creatives` 스크립트 제거. 동반하여 `README.md`의 "기존 데이터 마이그레이션" 섹션과 `docs/ARCHITECTURE.md`의 `data/courses/`·`data/temp/`(2026-04-22 Customer 모드 제거 시 같이 비활성화됨) 행도 삭제.
- 2026-04-25 feat(config): TOML 설정 마이그레이션 완료 — `.env` 인프라 완전 제거(.env.owner.example/.env.service.example 삭제, dotenv 의존성 root+cli+server 제거, 15개 entry의 `import "dotenv/config"` 삭제). 17개 환경변수가 `config.toml` 단일 파일 + smol-toml 파서 + Zod 검증된 lazy singleton(`getConfig()`)으로 통일. 도메인별 helper(`requireMeta`/`requireAnthropicKey`/`requireGoogleAiKey`/`requireVoyageKey`/`requireStripeConfig`)와 `setConfigForTesting(makeTestConfig({...}))` 테스트 패턴 도입. 멀티모듈 리팩터의 알려진 결함 M-1(dotenv 중복) 해소. `process.env.CONFIG_PATH`만 예외 허용. 335 tests 통과.
- 2026-04-24 refactor: npm workspaces 기반 멀티모듈 리팩터 완료 — `core/`, `cli/`, `server/` → `packages/*/src/`, `@ad-ai/core/cli/server` scoped 패키지 선언, tsx 런타임 유지 (빌드 스텝 없음), deep import 패턴(`@ad-ai/core/storage.js`), `server/data.db` → `data/licenses.db` 통합, 루트 script 는 `tsx packages/<pkg>/src/entries/*.ts` 로 cwd=root 유지. 314 tests 통과. Phase B (개별 repo 분리) 는 실운영 검증 후 판단.
- 2026-04-22 feat(tui): TUI 업그레이드 완료 — Tokyo Night 9색 팔레트(`cli/tui/theme/tokens.ts`), `cli/tui/screens/` 10개 화면(Menu/Scrape/AddProduct/Generate/Review/Launch/Monitor/Improve/Pipeline/Done) + `cli/tui/components/`(Header/StatusBar/ProgressTrack) + `cli/tui/hooks/`(useElapsed/useReports/useTodayStats/useWorkerStatus) 분리, `runGenerate` image/video/copy 3-track 병렬화, MonitorScreen 신규(`useReports` 기반 T 키 7/14/30일 윈도우), LaunchScreen에 Meta API onLog 스트리밍(launchLogs RunProgress emit), PipelineScreen 2-stage로 단순화. 314 tests 통과.
- 2026-04-22 docs: CLI owner-only 전환 반영 — `cli/mode.ts`·`cli/client/*` 삭제, `server/*` 컴포넌트를 🟡 비활성으로, ARCHITECTURE §11 신설, ROADMAP Tier 2 항목 정리.
- 2026-04-22 refactor(cli): AiProxy 간접 제거 + customer 모드 파일 삭제 (Phase 0b, TUI upgrade plan Task 1-3).
- 2026-04-21 feat: Plan C qualify 프로덕션 wire-up 완료 — `createQualifyJob` factory 신설(`core/rag/qualifyJob.ts`), `qualifyWinners` 시그니처를 `findCreativeByVariant(variantGroupId, variantLabel)`로 전환하고 filter-then-group 순서 적용, Owner worker(`cli/entries/worker.ts`) / Server scheduler(`server/scheduler.ts`)에 `VOYAGE_API_KEY` boot gate와 함께 주입. 자기 학습 루프가 매 tick마다 winner 후보를 `data/creatives.db`에 적재. 272 tests 통과.
- 2026-04-21 feat: Plan C 코어 모듈 완료 — Winner DB + Voyage RAG. `core/rag/` 모듈(types/db/store/voyage/qualifier/retriever) 도입, `data/creatives.db` SQLite(WAL) 스키마, voyage-3-lite 512d embedding BLOB 저장, 3-stage RAG cascade(category-cosine → global-cosine → lexical Jaccard)로 `generateCopy` few-shot 주입 경로 확립. improvementCycle을 aggregate→qualify→runCycle 3단계 DI로 리팩터. 스케줄러의 `qualify` 프로덕션 wire-up은 plan §2082-2083에 따라 후속 chore로 유예 — 현재 기본 `qualify`는 noop이므로 Winner DB는 후속 작업 완료 전까지 비어있다. 테스트 262 통과.
- 2026-04-21 feat: Dev-time Agent Team Phase 1a — meta-platform-expert, marketing-copy-reviewer subagent 2종 파일 추가 및 CLAUDE.md "Subagent 호출 규칙" 통합 (Phase 1b/1c 유보). 실제 dispatch 검증은 세션 start 시점 로드 제약으로 다음 세션에 확인 필요.
- 2026-04-20 feat: Plan B 완료 — 제품당 3 copy variant(emotional/numerical/urgency) 생성, 공유 image/video, group 단위 리뷰 UI, ≥ 2 approved 그룹만 DCO 런칭. buildCopyPrompt 추출·generateCopy 시그니처 확장·groupApprovalCheck 도입. 테스트 202 통과
- 2026-04-20 fix: Plan A 리뷰 결함 수정 — `classifyMetaError` SDK shape 인식(C1), 일별 리포트 소비자 3곳을 VariantReport 포맷으로 정합화(C2), AdCreative를 rollback·cleanup·Campaign.metaAdCreativeId에 추적(C3), `launch_failed` Campaign JSON 기록(I1), `assembleAssetFeedSpec` 중복 body text 방지(I2). 테스트 183 통과
- 2026-04-20: Plan A 완료 — Platform Adapter 패턴 도입, Meta 런칭을 DCO `asset_feed_spec`으로 전환, 기존 Creative/Campaign 마이그레이션 스크립트 추가
- 2026-04-20 feat: 자율 자기학습 루프 launchd worker 구축 (core/scheduler 공유 모듈 + Owner 6h/2d, Server 24h/7d cadence + catch-up)

<!--
업데이트 규칙:
- 기능 구현 완료 시 맨 위에 한 줄 추가
- 최신 10개만 유지 (11번째부터 삭제)
- 날짜는 YYYY-MM-DD 형식
-->

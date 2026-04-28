# 영상 트랙 제거 — 광고 자동화 image + copy 전용 단순화

**작성일:** 2026-04-28
**스펙 종류:** 기능 제거 + 데이터/타입 cleanup
**관련:** `packages/core/src/types.ts`, `packages/core/src/platform/types.ts`, `packages/core/src/platform/meta/{assetFeedSpec,launcher}.ts`, `packages/cli/src/{actions,pipeline}.ts`, `packages/cli/src/entries/{generate,launch}.ts`, `packages/cli/src/tui/{AppTypes,screens/*}.ts`, `packages/core/src/creative/{video,modelDiscovery}.ts`, `packages/server/src/jobs/videoJob.ts`

---

## 1. 배경 (Why)

### 1.1 동기

사용자가 직접 운영 테스트하면서 발견한 영상 트랙의 한계:

- **영상 품질**: Veo 가 한국어/영어 텍스트 깨짐, 인위적 staging, 사람 묘사 부자연
- **영상 효과**: 광고 운영 측면에서 강의/B2B 광고에 영상 효과 미미. Instagram/Facebook 광고의 50-60% 가 단일 이미지
- **AI 영상 vs 자체 촬영**: 사용자 의사결정 — AI 영상 미도입, 영상 데이터 자체도 다루지 않음
- **운영 비용**: Veo 호출당 ~$0.05, 폴링 시간 ~2-10분, image-only 대비 약 40% 절감 가능

### 1.2 본 spec 의 목표

영상 트랙을 코드베이스에서 **완전 제거** — 광고 자동화 = image + copy 만으로 단순화. Veo 관련 모든 코드 (생성/디스커버리/응답 처리) + 데이터 필드 (Creative.videoLocalPath / VariantGroup.assets.video / AssetFeedSpec.videos) 삭제.

미래에 영상 다시 도입할 계획 없음 — aggressive cleanup.

---

## 2. 범위

### 2.1 결정 (사용자 의도 반영)

| ID | 결정 |
|---|---|
| A. `Creative.videoLocalPath` | **필드 제거** (옵셔널 아님) |
| B. Veo 관련 코드 | **삭제** — `creative/video.ts`, `creative/video.test.ts`, `server/jobs/videoJob.ts`, `modelDiscovery.discoverVideoModel`, `fetchVeoVideoData` |
| C. ReviewScreen 영상 표시 | **제거** — 영상 line + video meta 블록 + getAssetMeta(video) 호출 |
| D. Meta DCO `videos` 필드 | **AssetFeedSpec interface 에서 제거** + `assembleAssetFeedSpec` 출력에서 omit |
| E. Generate UI tracks | **2 tracks (image + copy)** — TaskProgress.video / GenerateProgress.tracks.video 제거 |

### 2.2 영향 받는 production 파일 (16+1)

코어:
- `packages/core/src/types.ts` — Creative 타입
- `packages/core/src/platform/types.ts` — VariantGroup.assets
- `packages/core/src/platform/meta/assetFeedSpec.ts` — AssetFeedSpecInput + AssetFeedSpec interface
- `packages/core/src/platform/meta/launcher.ts` — uploadVideo 함수 + 호출
- `packages/core/src/creative/modelDiscovery.ts` — discoverVideoModel + override + cache + signature 변경

삭제 대상:
- `packages/core/src/creative/video.ts` — 전체
- `packages/core/src/creative/video.test.ts` — 전체
- `packages/server/src/jobs/videoJob.ts` — 전체
- `packages/server/src/index.ts` — videoJob route mount (있다면, plan 단계 grep verify)

CLI:
- `packages/cli/src/actions.ts` — runGenerate (video task) / runLaunch (assets.video) / buildOverallProgress
- `packages/cli/src/pipeline.ts` — video 생성
- `packages/cli/src/entries/generate.ts` — video 생성
- `packages/cli/src/entries/launch.ts` — video 사용
- `packages/cli/src/tui/AppTypes.ts` — TaskProgress.video / GenerateProgress.tracks.video
- `packages/cli/src/tui/screens/ReviewScreen.tsx` — UI
- `packages/cli/src/tui/screens/GenerateScreen.tsx` — UI

추가 영향 (spec 작성 시 grep 으로 발견):
- `packages/cli/src/tui/screens/PipelineScreen.tsx:30-31` — `gp.tracks.video.pct` 사용 + "videos N/100" 표시
- `packages/server/src/index.ts:16,43,90` — `videoJob.cleanupOldFiles` import + video downloads static file serving + cleanup setInterval 루프

### 2.3 범위 밖 (deferred)

| 안 하는 것 | 이유 |
|---|---|
| Claude 모델 tier 분리 (Sonnet/Haiku) | 별 spec — 본 spec 과 독립적 |
| DCO image-only 의 placement coverage 운영 verify | 첫 launch 시 monitor (R-G1 등록) |
| Pipeline 통합 (pipeline.ts vs entries/generate.ts 중복) | 별 cleanup spec |
| 영상 재도입 (자체 촬영 / 다른 AI provider) | 사용자 의도상 진행 안 함 |

---

## 3. 핵심 결정

### 3.1 Aggressive 삭제 vs 옵셔널 보관

**Aggressive 채택**:
- 사용자 명시: AI 영상 미도입 + 영상 데이터 자체 미취급
- 옵셔널 필드는 미래 재도입 부담 줄이지만 본 spec 의도와 불일치 — 깨끗한 type
- Re-add 시 type cascade 부담은 받아들임 (사용자 의도 분명)

### 3.2 Meta DCO image-only 적합성

`asset_feed_spec.videos` 는 Meta API 에서 optional. Image-only DCO 는 Feed/Stories/Reels 모두에서 정상 게재됨 — Reels 는 image carousel/static 으로 표시. 첫 실 launch 후 placement breakdown 으로 verify 필요 (R-G1).

### 3.3 commit 분할 — 2 commits

**Commit 1 (atomic)**: type-level removal + production 코드. 분할 시 컴파일 안 됨 — atomic 필수.

**Commit 2**: Veo dead code 파일 삭제 + STATUS 정리. Commit 1 land 후 video 코드 import 안 됨 → Commit 2 에서 깨끗하게 삭제.

분할 효과:
- Commit 1 review 가 type 변화 + 호출처 cascade 에 집중
- Commit 2 review 가 삭제 검증 (file delete + dead code) 에 집중

---

## 4. 코드 상세

### 4.1 `packages/core/src/types.ts` Creative

```ts
// Before
export interface Creative {
  id: string;
  productId: string;
  variantGroupId: string;
  copy: { ... };
  imageLocalPath: string;
  videoLocalPath: string;
  status: "pending" | "approved" | "rejected" | "edited";
  reviewNote?: string;
  createdAt: string;
}

// After
export interface Creative {
  id: string;
  productId: string;
  variantGroupId: string;
  copy: { ... };
  imageLocalPath: string;
  status: "pending" | "approved" | "rejected" | "edited";
  reviewNote?: string;
  createdAt: string;
}
```

### 4.2 `packages/core/src/platform/types.ts` VariantGroup

```ts
// Before
export interface VariantGroup {
  variantGroupId: string;
  product: Product;
  creatives: Creative[];
  assets: { image: string; video: string };
}

// After
export interface VariantGroup {
  variantGroupId: string;
  product: Product;
  creatives: Creative[];
  assets: { image: string };
}
```

### 4.3 `packages/core/src/platform/meta/assetFeedSpec.ts`

```ts
// AssetFeedSpecInput.videoId 제거
// AssetFeedSpec.videos 제거
// assembleAssetFeedSpec 본체에서 videos: [{ video_id: videoId }] 출력 라인 제거
// 매개변수에서 videoId 제거
```

### 4.4 `packages/core/src/platform/meta/launcher.ts:80-150`

`uploadVideo` 함수 (line 85-92) + 호출 (line 141-142) 제거. `assembleAssetFeedSpec(...)` 호출에서 `videoId` 매개변수 제거. `/act/advideos` onLog entry 제거.

### 4.5 `packages/cli/src/actions.ts` — runGenerate

```ts
// Promise.allSettled([imageTask, videoTask, copiesTask]) → [imageTask, copiesTask]
// videoTask 정의 제거
// 부분 실패 cleanup 의 video 정리 라인 제거
// reasons 배열의 video 항목 제거
// const videoLocalPath = ... 변수 제거
// Creative literal 의 videoLocalPath 키 제거
// generateVideo import 제거
// tracks 객체에서 video 키 제거
```

### 4.6 `packages/cli/src/actions.ts` — runLaunch

```ts
// VariantGroup 의 assets: { image: ..., video: ... } → { image: ... } 만
```

### 4.7 `packages/cli/src/actions.ts` — buildOverallProgress

```ts
// Before: Math.round((p.copy + p.image + p.video) / 3)
// After:  Math.round((p.copy + p.image) / 2)
```

### 4.8 `packages/cli/src/pipeline.ts`

generateVideo import + 호출 + videoLocalPath 변수 + Creative literal 의 키 모두 제거. "영상 생성 중..." update 라인 제거.

### 4.9 `packages/cli/src/entries/generate.ts`

generateVideo import + 호출 + videoLocalPath 변수 + Creative literal 의 키 모두 제거.

### 4.10 `packages/cli/src/entries/launch.ts`

VariantGroup 의 `assets.video` 제거.

### 4.11 `packages/cli/src/tui/AppTypes.ts`

- `TaskProgress.video` 제거
- `GenerateProgress.tracks.video` 제거

### 4.12 `packages/cli/src/tui/screens/GenerateScreen.tsx`

- overallPct = (copy + image) / 2
- "영상" ProgressTrack 라인 제거

### 4.13 `packages/cli/src/tui/screens/ReviewScreen.tsx`

- useEffect 의 `Promise.all([getAssetMeta(image), getAssetMeta(video)])` → `getAssetMeta(image)` 만
- useEffect dependency `[currentVariant?.imageLocalPath, currentVariant?.videoLocalPath]` → `[currentVariant?.imageLocalPath]`
- meta state 타입 `{ image?: AssetMeta; video?: AssetMeta }` → `{ image?: AssetMeta }`
- "영상(공유)" Text 라인 제거
- `{meta.video && ...}` 블록 제거

### 4.14 `packages/cli/src/tui/screens/LaunchScreen.tsx`

변경 없음. STEPS regex (campaigns/adsets/adcreative/ads) 가 video 무관.

### 4.15 `packages/core/src/creative/modelDiscovery.ts`

`discoverVideoModel` 함수 + `cachedVideoModel` + `videoOverride` 변수 + `setModelOverrideForTesting`/`clearModelDiscoveryCache` 의 video 처리 모두 제거. `setModelOverrideForTesting` signature 가 `{ image?: string | null }` 만.

### 4.16 `vitest.setup.ts`

`setModelOverrideForTesting({ image: "test-imagen", video: "test-veo" })` → `{ image: "test-imagen" }` 만.

### 4.17 `packages/cli/src/entries/listModels.ts`

video 후보 추천 출력 부분 제거. image 부분만 보존 (미래 image 모델 deprecation 디버깅용).

### 4.18 `packages/cli/src/tui/screens/PipelineScreen.tsx`

```ts
// Before (line 30-31)
const videoPct = gp.tracks.video.pct;
genSummary = `gen: copies ${Math.round(copyPct)}/${100} | images ${Math.round(imagePct)}/${100} | videos ${Math.round(videoPct)}/${100}  [${doneCount}/${total}]`;

// After
genSummary = `gen: copies ${Math.round(copyPct)}/${100} | images ${Math.round(imagePct)}/${100}  [${doneCount}/${total}]`;
```

### 4.19 `packages/server/src/index.ts`

```ts
// Before
import { cleanupOldFiles } from "./jobs/videoJob.js";   // 제거 (line 16)
// "Static file serving for video downloads" 블록 제거 (line ~43)
// "Cleanup old video files" setInterval 루프 제거 (line ~90)
```

server 가 미실행이지만 코드 sync 위해 정리 — videoJob.ts 삭제 후 import path 깨짐 방지.

### 4.20 삭제 파일 (Commit 2)

- `packages/core/src/creative/video.ts`
- `packages/core/src/creative/video.test.ts`
- `packages/server/src/jobs/videoJob.ts`

---

## 5. 테스트 전략

### 5.1 Fixture 갱신 (17 위치, 9 파일)

**videoLocalPath 키 제거** (14 위치):

| 파일 | 위치 |
|---|---|
| `packages/core/src/types.test.ts` | :52 |
| `packages/core/src/reviewer/decisions.test.ts` | :21 |
| `packages/core/src/launch/groupApproval.test.ts` | :27 |
| `packages/core/src/platform/meta/breakdown.test.ts` | :14 |
| `packages/core/src/platform/meta/assetFeedSpec.test.ts` | :25, :99, :141 |
| `packages/core/src/rag/qualifyJob.test.ts` | :29 |
| `packages/core/src/rag/qualifier.test.ts` | :185 |
| `packages/cli/src/actions.test.ts` | :244, :264, :269, :298, :303 |
| `packages/cli/src/tui/screens/ReviewScreen.test.tsx` | :21 |

**TaskProgress fixture 의 video 키 제거** (3 위치):

| 파일 | 위치 | 변경 내용 |
|---|---|---|
| `packages/cli/src/actions.test.ts` | :7 | `{ copy: 0, image: 0, video: 0 }` → `{ copy: 0, image: 0 }`. expect 0 그대로 |
| `packages/cli/src/actions.test.ts` | :12 | `{ copy: 100, image: 100, video: 100 }` → `{ copy: 100, image: 100 }`. expect 100 그대로 |
| `packages/cli/src/actions.test.ts` | :17 | `{ copy: 100, image: 50, video: 0 }` → `{ copy: 100, image: 50 }`. **expect 50 → 75** (since (100+50)/2=75). 테스트 description "averages the three task percentages" → "averages the two task percentages" |

### 5.2 `assetFeedSpec.test.ts` 갱신

- `videoId: "VID_ID_123" / "VID" / "v"` (line 37, 55, 68, 111, 152) 모든 `assembleAssetFeedSpec(...)` 호출에서 제거
- `expect(spec.videos).toEqual([{ video_id: "VID_ID_123" }])` (line 44) — 제거
- 테스트 description "1 title, N bodies, 1 image, 1 video" → "1 title, N bodies, 1 image"

### 5.3 삭제 대상 테스트

- `creative/video.test.ts` — 12 케이스 전체 삭제
- `creative/modelDiscovery.test.ts` 의 video 전용 케이스 3개 제거. signature 변경에 따른 image-only 동시성 케이스 축소

### 5.4 갱신 대상 테스트

- `actions.test.ts` 의 `runGenerate cleanup on partial failure` — image 만 cleanup 검증으로 단순화
- `actions.test.ts` 의 `runLaunch failure messages distinguish data state` — assets.video 없이 정상 동작 검증

### 5.5 테스트 수 delta

- 삭제: -12 (video.test.ts) -3 (modelDiscovery video 전용)
- 갱신: 14 fixture (테스트 카운트 동일) + assetFeedSpec.test.ts 갱신 (description + assertion 변경, 카운트 동일)
- 신규: 0

기존 460 → 약 444 예상 (정확 수치는 plan 측정).

### 5.6 통합 검증 (수동)

1. `npm run app` → Generate 실행 → image + copy 만 생성 (~30초-1분)
2. `data/creatives/` 에 image jpg + JSON 파일만 존재 (mp4 없음)
3. Review 화면 → 영상 line 표시 안 됨
4. Launch → Meta DCO image-only 광고 정상 게재
5. 첫 launch 후 placement breakdown — Reels 게재 정상 verify (R-G1)

### 5.7 회귀 위험

#### Critical
**없음** — type-level cascade 가 TypeScript compile-time 에 모든 호출처 강제.

#### Important

**Important #1**: Meta DCO image-only 의 Reels placement 정상 게재 — 첫 launch 시 placement breakdown 확인. 만약 0 impression 이면 Reels image-only 미지원 가능성 → 별 spec 으로 placement filter 추가.

**Important #2**: 기존 `data/creatives/<id>.json` 파일에 `videoLocalPath` 필드 잔존 — TS strict 가 readJson<Creative> 시 extra field 통과 (no error). 사용자가 fresh state 권장 (data/creatives 삭제 후 re-Generate).

**Important #3**: PipelineScreen 의 video 표시 plan 단계 grep 미확인 — Section 4 에 명시되지 않음. plan grep 결과 따라 추가 변경 가능.

#### Minor
- 16 production + 14 fixture 한 commit 에 — review 부담 ↑ but type-level atomic 필수
- video.ts 등 삭제는 Commit 2 에서 — 중간 상태 (Commit 1 만 land) 안전

---

## 6. 영속 데이터 마이그레이션

**기존 데이터**:
- `data/creatives/<id>.json` 의 `videoLocalPath` 필드 — TS extra field 처리, 동작 영향 없음
- `data/creatives/*-video.mp4` — 생성 안 됨 (Generate 가 영상 안 만듦), 기존 파일은 dangling

**권장**: `data/creatives/` 삭제 + Re-Generate. 깨끗한 상태에서 운영 시작.

자동 마이그레이션 코드 추가 안 함 — 사용자 수동 정리.

---

## 7. 리스크 + 롤백

### 7.1 회귀 위험

§5.7 참조. Critical 0, Important 3건.

### 7.2 롤백

`git revert <Commit2 SHA> <Commit1 SHA>` — 두 commit 순서대로 revert 시 원상복구. Commit 2 단독 revert 는 video.ts 등 파일 복원만 — Commit 1 의 type 변경은 그대로라 dead code 상태. 의미 없는 부분 복구이므로 두 commit 함께 revert 가 정상.

### 7.3 중간 상태 안전성

Commit 1 land 후 / Commit 2 land 전:
- video.ts 등 파일 존재하지만 import 안 됨 → 런타임 영향 없음
- TypeScript compile 정상 (unused export 잡지 않음)
- 시스템 동작 정상

→ 안전하게 Commit 2 별 PR/사이클로 가능.

---

## 8. 작업 순서 (2 commits)

### Commit 1 — Type-level removal + production 코드 (atomic)

**Files (~17):**
- `packages/core/src/types.ts`
- `packages/core/src/platform/types.ts`
- `packages/core/src/platform/meta/assetFeedSpec.ts`
- `packages/core/src/platform/meta/assetFeedSpec.test.ts`
- `packages/core/src/platform/meta/launcher.ts`
- `packages/cli/src/actions.ts`
- `packages/cli/src/actions.test.ts`
- `packages/cli/src/pipeline.ts`
- `packages/cli/src/entries/generate.ts`
- `packages/cli/src/entries/launch.ts`
- `packages/cli/src/tui/AppTypes.ts`
- `packages/cli/src/tui/screens/ReviewScreen.tsx`
- `packages/cli/src/tui/screens/ReviewScreen.test.tsx`
- `packages/cli/src/tui/screens/GenerateScreen.tsx`
- 14 fixture (types/decisions/groupApproval/breakdown/qualifyJob/qualifier/ReviewScreen.test/actions.test)
- (PipelineScreen.tsx — plan grep 결과 따라)

**Subagent 트리거**: code-reviewer (type cascade 검증).

### Commit 2 — Veo 코드 삭제 + STATUS 정리

**Files (~7):**
- 삭제: `packages/core/src/creative/video.ts`, `packages/core/src/creative/video.test.ts`, `packages/server/src/jobs/videoJob.ts`
- 수정: `packages/core/src/creative/modelDiscovery.ts`, `packages/core/src/creative/modelDiscovery.test.ts`, `vitest.setup.ts`, `packages/cli/src/entries/listModels.ts`
- `packages/server/src/index.ts` (videoJob route mount 있다면)
- `docs/STATUS.md` (R-E2 제거, R-E4/R-F4 narrow, R-G1 등록)
- `docs/ROADMAP.md` (Tier 3 영상 모니터링 항목 제거)

**Subagent 트리거**: code-reviewer.

---

## 9. 작업 시간 견적

| 단계 | 시간 |
|---|---|
| Spec 작성 + 자체 검토 | 0.7h |
| Plan 작성 | 0.4h |
| Commit 1 코드 + 14 fixture + assetFeedSpec.test 갱신 + commit | 2.5h |
| Commit 1 code-reviewer + 수정 | 1.0h |
| Commit 2 코드 삭제 + STATUS/ROADMAP + commit | 0.7h |
| Commit 2 code-reviewer + 수정 | 0.4h |
| 수동 검증 (Generate + Review + Launch) | 0.5h |
| 안정화 | 0.3h |
| **합계** | **~6.5h** |

---

## 10. Definition of Done

- [ ] 2 commits land
- [ ] `npm test` 모두 passing (~444 예상)
- [ ] TypeScript clean (filter facebook-nodejs)
- [ ] grep 검증:
  - `grep -rn "videoLocalPath\|generateVideo\|videoJob\|fetchVeoVideoData\|discoverVideoModel" packages/ --include="*.ts" --include="*.tsx" | wc -l` → 0 hits
  - `grep -rn "tracks\.video\|TaskProgress.*video" packages/ --include="*.ts" --include="*.tsx"` → 0 hits
- [ ] 수동 검증:
  - 기존 data/creatives 삭제 후 Generate → image + copy 만 생성
  - Review 화면 → 영상 line 표시 안 됨
  - Launch → Meta DCO image-only 광고 정상 게재 (placement 별 verify)
- [ ] code-reviewer 검토 통과 (Commit 1, 2)
- [ ] STATUS.md R-E2 제거, R-E4/R-F4 narrow, R-G1 (placement coverage) 등록
- [ ] ROADMAP.md Tier 3 "영상 생성 실패율 모니터링" 항목 제거

---

## 11. Open Questions / 후속 작업

### 11.1 Pipeline 통합 — 별 cleanup spec

`pipeline.ts` (TUI Pipeline 메뉴) 와 `entries/generate.ts` (CLI 진입점) 가 거의 동일 흐름. 영상 제거로 둘 다 단순해짐 — 공통 로직 추출 검토. 본 spec scope-out.

### 11.2 DCO image-only placement coverage (R-G1)

첫 실 launch 후 Meta placement breakdown 확인. 만약 Reels 가 0 impression 이면:
- (a) Meta DCO 가 Reels 에 image 게재 안 함 → asset_feed_spec.placement_asset_customization 추가 필요
- (b) Meta API 의 placement 자동 선택이 image 만 있으면 Reels 자동 제외 — 정상 동작
- 운영 1주 후 판단

### 11.3 Claude 모델 tier 분리

본 spec 후 별 spec — Parser 를 Haiku 4.5 로 다운그레이드 (~$0.009/scrape 절약). Copy/Analysis/Improver 는 Sonnet 유지.

---

## 12. 검토 이력

### 2026-04-28 — spec 작성 후 5점 점검 추가 적용

3 건 추가 발견 + 인라인 패치:
- §4.18 PipelineScreen.tsx:30-31 — `gp.tracks.video.pct` 사용 + "videos N/100" 문자열 제거
- §4.19 server/src/index.ts:16,43,90 — videoJob.cleanupOldFiles import + static serving + cleanup setInterval 루프 제거
- §5.1 actions.test.ts:7,12,17 — TaskProgress fixture 3 위치 (총 14 → 17 fixture). line :17 의 expect 50 → 75 갱신 필요 (평균 분모 3→2)

### 2026-04-28 — 초안 작성 + 섹션 단위 자체 검토

6 섹션 (범위 / 타입 변경 / 코드 삭제 / 데이터 흐름 / TUI / 테스트+commit+DoD) 각각 5점 점검:

- Section 1 (범위): Critical 0 / Important 2 (Meta DCO image-only Reels verify, Veo 코드 식별 정확성) / Minor 1 (commit 폭)
- Section 2 (타입): Critical 0 / Important 2 (Reels placement, 기존 JSON 잔존 필드) / Minor 1 (interface breaking change)
- Section 3 (삭제): Critical 0 / Important 2 (server/index.ts grep 필요, 동시성 검증 약화) / Minor 1 (listModels 출력 인지 부담)
- Section 4 (데이터 흐름): Critical 0 / Important 2 (pipeline+generate 중복, copy fail 시 image cleanup 의도) / Minor 1 (LaunchScreen regex 무영향 — 정정)
- Section 5 (TUI): Critical 0 / Important 2 (useEffect dep 변경, GenerateScreen 빈공간 디자인) / Minor 1 (RunProgress.taskProgress grep)
- Section 6 (테스트): Critical 0 / Important 2 (Commit 1 폭, 중간 상태 안전성) / Minor 1 (PipelineScreen plan grep)

### 종합

- Critical: 0건
- Important: 12건 (대부분 plan 단계 grep 또는 운영 monitor 로 처리)
- Minor: 6건

다음 단계: 사용자 검토 → 승인 시 `superpowers:writing-plans` 스킬로 plan 작성.

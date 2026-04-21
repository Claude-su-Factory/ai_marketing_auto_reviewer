# Winner DB + Variant Orchestration Design

작성일: 2026-04-20
상태: Draft (사용자 리뷰 대기)

---

## 목표

광고 성과를 축적하여 시간이 지날수록 더 나은 카피를 생성하는 self-learning 파이프라인을 구축한다. 구체적으로:

1. 제품 1개당 3개의 copy variant를 생성하여 Meta Advantage+ Creative (DCO)로 런칭
2. Meta asset-level breakdown으로 variant별 성과를 수집
3. 자격 기준을 통과한 variant를 Voyage embedding과 함께 SQLite에 저장 (Winner DB)
4. 새 제품 생성 시 유사 Winner를 RAG로 retrieve하여 few-shot으로 Claude에 주입
5. Meta 외 플랫폼 확장을 위한 Platform Adapter 패턴 도입

---

## Section 1 — Architecture

### 1.1 Platform Adapter

Meta 외 플랫폼 (TikTok, Google Ads 등) 확장을 위해 플랫폼별 로직을 interface 뒤로 분리한다.

```ts
// core/platform/types.ts
export interface AdPlatform {
  name: string;
  launch(group: VariantGroup): Promise<LaunchResult>;
  fetchReports(campaignId: string, date: string): Promise<VariantReport[]>;
  cleanup(campaignId: string): Promise<CleanupResult>;
}
```

관련 타입은 §2.6에 정의한다.

환경 변수 기반 레지스트리:
- `AD_PLATFORMS=meta` (csv, 기본 `"meta"`)
- Adapter별 credential prefix 강제: `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, 추후 `TIKTOK_ACCESS_TOKEN`
- `activePlatforms()`가 csv를 파싱하고 각 adapter가 자기 prefix credential을 확인, 누락 시 warn 후 skip

현재 구현: Meta 어댑터 1개. `core/campaign/launcher.ts` + `monitor.ts`를 `core/platform/meta/`로 이관하고 interface 구현.

### 1.2 Meta DCO (Advantage+ Creative)

기존의 "2 ads per campaign (image + video)" 패턴을 폐기하고 Meta의 `asset_feed_spec` 기반 DCO로 전환한다.

**이유:** DCO는 Meta의 기계학습이 title/body/image/video 조합을 자동 최적화한다. 현재 수동으로 2-ad split을 만드는 것보다 성과가 구조적으로 우수하다. Meta 자체 권고 방식이다.

**구조:** 1 variantGroup → 1 Campaign → 1 AdSet → 1 DCO Ad. DCO Ad의 `asset_feed_spec`은 title 1개(공통), body 2~3개(승인된 variant 수에 따라), image 1개, video 1개. `hashtags`는 각 body 말미에 `\n\n#tag1 #tag2` 형식으로 append.

**Variant 매핑:** Meta `/insights?breakdowns=['body_asset']`는 `body_asset.text`와 `body_asset.id`만 반환하고 `adlabels`는 echo하지 않는다 (Plan A Task 1 검증 결과, `docs/superpowers/specs/2026-04-20-meta-dco-api-notes.md` 참조). 따라서 Meta에 submit한 body text를 정규화(`trim`, CRLF→LF)한 뒤 Creative.copy.body + hashtags로 재조립한 값과 비교하여 variant를 역매핑한다. `adlabels` submit은 optional (Meta가 향후 echo하기 시작하면 보조 키로 사용 가능).

### 1.3 Winner DB + RAG

자격 통과한 variant를 SQLite에 embedding과 함께 저장하고, 새 제품 생성 시 유사 Winner를 few-shot 예시로 Claude에 주입한다.

- **저장소:** `data/creatives.db` (SQLite). `server/data.db`의 billing과 분리하여 격리 유지.
- **Embedding:** Voyage AI `voyage-3-lite` (512-dim, multilingual). Claude partner 모델.
- **검색:** 카테고리 필터 → cosine similarity → `MIN_COSINE = 0.6` cutoff → dedup `cosine > 0.95` → top-3.
- **Fallback:** 결과가 3개 미만이면 Jaccard tag overlap 기반 lexical fallback으로 보충.

### 1.4 Qualification 기준 (Meta-native 품질 신호)

외부 랜딩 페이지 중심이라 conversion/revenue attribution이 제한적이다. Meta-native 품질 신호를 사용한다.

**Variant-level threshold (asset-level 지표만 사용):**
- `impressions ≥ 500`
- `inline_link_click_ctr ≥ 전역 median` (최근 30일 기준, 샘플 < 10이면 fallback `0.015`)

**Ad-level quality gate (ad 전체에 적용, 해당 그룹의 모든 variant에 박탈 효과):**
- `quality_ranking`이 `BELOW_AVERAGE_*` → 그룹 전체 자격 박탈
- `engagement_rate_ranking`이 `BELOW_AVERAGE_*` → 그룹 전체 자격 박탈

**이유:** Meta API에서 ranking 필드는 ad 레벨이지 asset 레벨이 아니다. Variant 간 구분은 impressions/CTR로만 가능하고, ranking은 그룹 전체 품질 게이트로 사용한다.

---

## Section 2 — Data Model

### 2.1 Product (변경 없음)

기존 `core/types.ts`의 `Product` 그대로 사용.

### 2.2 Creative (확장)

```ts
export interface Creative {
  id: string;
  productId: string;
  variantGroupId: string;                   // 신규 — 같은 제품의 3 variant가 공유
  copy: {
    headline: string;
    body: string;
    cta: string;
    hashtags: string[];
    variantLabel: "emotional" | "numerical" | "urgency"; // 신규
    metaAssetLabel: string;                 // 신규 — Meta adlabel value, e.g. "variant-abc123"
  };
  imageLocalPath: string;                   // 그룹 내 공유
  videoLocalPath: string;                   // 그룹 내 공유
  status: "pending" | "approved" | "rejected" | "edited";
  reviewNote?: string;
  createdAt: string;
}
```

**Winner DB 중복 체크:** 별도 필드 없이 `WinnerStore.hasCreative(creativeId)` 쿼리로 판정 (single source of truth, atomic consistency).
```

### 2.3 Campaign (확장)

```ts
export interface Campaign {
  id: string;
  variantGroupId: string;                   // 신규 — creativeId 대신 그룹 기준
  productId: string;
  platform: string;                         // 신규 — "meta", 추후 "tiktok" 등
  metaCampaignId: string;
  metaAdSetId: string;
  metaAdId: string;                         // 신규 — DCO Ad 1개 (기존 metaAdIds 배열 폐기)
  launchedAt: string;
  status: "active" | "paused" | "completed" | "launch_failed" | "externally_modified";
  orphans?: { type: "campaign" | "adset" | "ad"; id: string }[]; // 롤백 실패 시 기록
}
```

### 2.4 VariantReport (신규, Report 대체 아님)

```ts
export interface VariantReport {
  id: string;                               // 형식: `${campaignId}::${variantLabel}::${date}` — 중복 수집 시 upsert
  campaignId: string;
  variantGroupId: string;
  variantLabel: string;                     // Creative.copy.variantLabel 매핑
  metaAssetLabel: string;                   // breakdown의 body_asset label
  productId: string;
  platform: string;
  date: string;
  impressions: number;
  clicks: number;
  inlineLinkClickCtr: number;
  // Ad-level (모든 variant row에 동일값 복사 — Meta는 ad 레벨로만 제공)
  adQualityRanking: string | null;
  adEngagementRanking: string | null;
  adConversionRanking: string | null;
}
```

기존 `Report`는 campaign 단위 집계용으로 유지 (기존 코드 호환).

### 2.5 WinnerCreative (SQLite 테이블)

```sql
CREATE TABLE winners (
  id TEXT PRIMARY KEY,
  creative_id TEXT NOT NULL,                 -- 원본 Creative.id
  product_category TEXT,
  product_tags TEXT,                         -- JSON array
  product_description TEXT NOT NULL,
  headline TEXT NOT NULL,
  body TEXT NOT NULL,
  cta TEXT NOT NULL,
  variant_label TEXT NOT NULL,
  embedding_product BLOB NOT NULL,           -- Voyage embed of product_description (검색용)
  embedding_copy BLOB NOT NULL,              -- Voyage embed of headline + body (참고/분석용)
  qualified_at TEXT NOT NULL,                -- ISO timestamp
  impressions INTEGER NOT NULL,
  inline_link_click_ctr REAL NOT NULL
);

CREATE INDEX idx_winners_category ON winners(product_category);
CREATE INDEX idx_winners_creative ON winners(creative_id);  -- hasCreative 쿼리용
```

### 2.6 Platform Adapter 지원 타입

```ts
export interface VariantGroup {
  variantGroupId: string;
  product: Product;
  creatives: Creative[];                    // approved 또는 edited status만 (≥ 2개)
  assets: { image: string; video: string }; // 공유 asset 경로
}

export interface LaunchResult {
  campaignId: string;                       // 내부 Campaign.id
  platform: string;                         // "meta"
  externalIds: {
    campaign: string;                       // metaCampaignId
    adSet: string;                          // metaAdSetId
    ad: string;                             // metaAdId
  };
}

export interface CleanupResult {
  deleted: string[];                        // 성공적으로 삭제된 external ID 목록
  orphans: { type: "campaign" | "adset" | "ad"; id: string }[]; // 삭제 실패, 수동 정리 필요
}
```

---

## Section 3 — Data Flows

### 3.1 Flow 1 — Generation

```
scrape product
  → RAG retrieve (Voyage embed product.description → category filter → cosine → MIN_COSINE cutoff → dedup → top-3)
  → generateCopy × 3 (few-shot + variant angle hint: emotional/numerical/urgency)
  → image 1개 생성, video 1개 생성 (그룹 내 공유)
  → Creative × 3 저장 (status=pending, 공유 variantGroupId, 각자 variantLabel + metaAssetLabel)
  → [수동] npm run review — 각 variant 개별 approve/reject/edit
  → [수동] npm run launch — variantGroupId로 그룹화, 그룹당 ≥ 2 approved 확인:
       - ≥ 2 approved: for each activePlatform → platform.launch(group) with asset_feed_spec
       - < 2 approved: 그룹 폐기 (status 유지, 런칭 스킵)
```

**Variant angle hint 주입:** `buildCopyPrompt(product, fewShot, variantLabel)` 순수 함수가 각 label별 prompt 지시문 삽입 (emotional → "감정 호소 중심", numerical → "수치·통계 활용", urgency → "긴급성·희소성 강조").

### 3.2 Flow 2 — Daily Collection

```
scheduler tick (daily)
  → for each activePlatform:
       for each campaign with platform=<adapter> AND status="active":
         fetchReports(campaignId, yesterday)
           — Meta: GET /{ad_id}/insights?breakdowns=['body_asset']&...
           — 각 breakdown row → VariantReport 매핑 (body_asset.label로 variantLabel 복원)
           — ad-level ranking 필드는 모든 variant row에 복사
           — adlabels 없는 row (Meta auto-generated) skip
       append to data/reports/<date>.json (VariantReport[])
  → 404/403 응답: campaign.status = "externally_modified" 마킹, 다음 수집에서 skip
```

### 3.3 Flow 3 — Qualification (weekly 사이클에 묶음)

```
generateWeeklyAnalysis() 종료 후
  → runImprovementCycle() 이전 단계에서:
      aggregate VariantReports last 7 days by `${campaignId}::${variantLabel}`
      → getMedianCtr(last 30 days reports) — 쿼리 시점 계산, 캐시 없음, 샘플 < 10 → 0.015
      → for each aggregated variant:
           if WinnerStore.hasCreative(creative.id): skip (이미 등록된 winner)
           adRankings = { quality, engagement, conversion } 추출
             (ad-level 필드는 같은 campaignId의 모든 VariantReport row에 동일 복사되어 있으므로 첫 row에서 추출)
           if passesThreshold(aggregate, medianCtr, adRankings):
             embedProduct = voyage.embed(product.description)
             embedCopy = voyage.embed(headline + " " + body)
             if shouldSkipInsert(embedProduct, existingWinners): skip (cosine > 0.95 의미적 중복)
             WinnerStore.insert({ ..., creative_id, embedding_product: embedProduct, embedding_copy: embedCopy })
```

`passesThreshold(variantAgg, medianCtr, adRankings)`:
- `impressions < 500` → false
- `adRankings.quality === "BELOW_AVERAGE_*"` → false
- `adRankings.engagement === "BELOW_AVERAGE_*"` → false
- `inlineLinkClickCtr < medianCtr` → false
- else → true

### 3.4 Flow 4 — Retrieval (generateCopy 시)

**전체 Winner DB는 규모가 작다고 가정한다 (< 1000 rows).** 매 retrieval마다 전체 로드 후 메모리에서 필터링 — SQL 반복 쿼리 대신 단순성 우선.

```
generateCopy(client, product, fewShot=[], variantLabel)
  ← 호출자(pipeline)가 먼저:
      queryEmbed = voyage.embed(product.description)
      allWinners = WinnerStore.loadAll()              // category·cosine 미필터, 전체 로드
      categoryMatched = filterByCategory(allWinners, product.category)
      ranked = retrieveTopK(queryEmbed, categoryMatched, k=3, minCosine=0.6)
      if ranked.length < 3:
        // 전역 pool에서 cosine 상위 (k - ranked.length)개 fill
        remaining = allWinners.filter(w => !ranked.includes(w))
        globalRanked = retrieveTopK(queryEmbed, remaining, k=3-ranked.length, minCosine=0.6)
        ranked = [...ranked, ...globalRanked]
      if ranked.length < 3:
        // 그래도 부족하면 lexical fallback (Jaccard tag overlap)
        lexical = lexicalFallback(product.tags, allWinners, k=3-ranked.length)
        ranked = [...ranked, ...lexical]
      final = dedupByCosine(ranked, 0.95)
      → fewShot: final.map(toFewShotExample)
  → buildCopyPrompt(product, fewShot, variantLabel) → Claude call
```

**설계 결정:**
- `WinnerStore.loadAll()` 1회 호출로 전체 로드 (카테고리 무관). 카테고리·cosine·lexical 전부 순수 함수로 처리 → 테스트 용이.
- 규모가 커지면 (>> 1000) sqlite-vec extension 또는 카테고리 인덱스 기반 쿼리로 마이그레이션. 현재는 YAGNI.

---

## Section 4 — Error Handling & Edge Cases

**외부 서비스 실패**

| 상황 | 처리 |
|---|---|
| Voyage API 실패 (retrieval) | 빈 FewShotExample[] 반환, warn 로그. 파이프라인 계속 (RAG 없이 생성) |
| Voyage API 실패 (qualification) | 해당 variant만 qualification skip, 다음 스케줄 사이클에 재시도 |
| Meta `asset_feed_spec` 런칭 실패 | 역순 rollback 시도 (Ad → AdSet → Campaign delete). delete 실패 시 `Campaign.orphans[]`에 기록 + `data/orphans.json` append + warn. 자동 재시도 없음 |
| Platform 부분 실패 | Meta 성공·TikTok 실패면 Meta만 성공 처리, TikTok만 `launch_failed` |
| Claude API 부분 실패 | variant 3개 중 일부만 생성 → I3 규칙 자동 적용 (≥ 2 성공이면 런칭 가능) |

**데이터 엣지 케이스**

| 상황 | 처리 |
|---|---|
| Winner DB cold start (빈 DB) | retrieval 빈 배열 반환, generateCopy는 angle hint만으로 baseline 생성 |
| 카테고리 filter 결과 < 3 | 전역 pool에서 추가 fill, 그래도 부족하면 lexical fallback |
| RAG cosine 전부 < MIN_COSINE (0.6) | 해당 결과 제외, lexical fallback으로 보충 |
| Winner 중복 삽입 | insert 직전 `embedding_product` cosine > 0.95 체크, 유사하면 skip |
| Meta breakdown의 `body_asset.text`가 어떤 Creative와도 매칭 안 되는 row | 우리 submit 아님 또는 Meta auto-gen, row skip |
| DCO 최소 요건 미달 (승인 < 2) | 그룹 폐기 (I3), 재생성 없음 |

**스케줄 엣지 케이스**

| 상황 | 처리 |
|---|---|
| Worker 정지 중 사이클 누락 | 기존 `runCatchupIfNeeded` 재활용, qualification은 weekly 사이클에 묶음 |
| 같은 variant 반복 자격 통과 | `WinnerStore.hasCreative(creativeId)` 체크로 1회만 insert 보장 |
| 런칭 직후 첫 수집 (impressions 미달) | `passesThreshold` false 반환, 누적만 |
| Meta 대시보드 수동 변경 (pause/delete) | insights 404/403 → `campaign.status = "externally_modified"`, 수집 대상 제외 |

---

## Section 5 — Testing Strategy

**원칙:**
- 외부 클라이언트(Voyage, Meta, Claude)는 factory 함수로 주입하고 테스트에서 mock 교체 (`core/scheduler/state.ts`의 `SchedulerDeps` 패턴 준수)
- Core 순수 함수는 storage·API mock 없이 테스트
- Platform Adapter는 interface 레벨 mock 교체
- 테스트 프레임워크: vitest (기존 프로젝트 준수), `*.test.ts` 동일 디렉토리

### 5.1 Unit (순수 함수)

| 대상 | 테스트 케이스 |
|---|---|
| `passesThreshold(variantAgg, medianCtr, adRankings)` | impressions < 500 → false / ranking BELOW_AVERAGE → false / 경계값 (500, median) |
| `getMedianCtr(reports, windowDays)` | 샘플 < 10 → fallback 0.015 / 짝수·홀수 샘플 / 빈 배열 |
| `cosineSimilarity(a, b)` | 동일=1.0 / 직교=0 / 반대=-1 / 길이 불일치 throw |
| `filterByCategory(corpus, category)` | 일치 winners만 반환 / null 카테고리 / 매칭 0개 |
| `retrieveTopK(queryEmbed, corpus, k, minCosine)` | MIN_COSINE 이하 제외 / k 미달 허용 |
| `shouldSkipInsert(embed, existing)` | cosine > 0.95 → true / 이하 → false |
| `dedupByCosine(candidates, threshold)` | 중복 pair 제거 / 순서 보존 |
| `lexicalFallback(product, corpus, k)` | Jaccard overlap 순위 / 빈 corpus |
| `aggregateVariantReports(reports, windowDays)` | `${campaignId}::${variantLabel}` 키 집계 / window 밖 제외 |
| `assembleAssetFeedSpec(copies, image, video)` | body마다 adlabel 부착 / Meta 스키마 shape |
| `parseBodyAssetBreakdown(metaResponse)` | variantLabel 역매핑 / adlabel 없는 row skip |
| `buildCopyPrompt(product, fewShot, variantLabel)` | label별 angle hint 문자열 포함 / fewShot 내용 prompt에 삽입 |
| `activePlatforms(env)` | csv 파싱 / credential 누락 skip+warn / 미지정 플랫폼 skip |
| `groupApprovalCheck(creatives)` | 3/2 approved → launch / 1/0 → discard |

### 5.2 Integration (SQLite, 파일 I/O)

| 대상 | 테스트 케이스 |
|---|---|
| `WinnerStore.insert` | BLOB 직렬화 라운드트립 / 중복 insert skip |
| `WinnerStore.loadAll` | 전체 로드 / 빈 DB → 빈 배열 / 인덱스 활용 확인 |
| `WinnerStore.hasCreative` | 존재 → true / 미존재 → false / 인덱스 사용 확인 |
| Qualification 전체 흐름 | VariantReport 누적 → threshold 통과 → embed → insert → 재호출 시 `hasCreative`로 중복 방지 |
| I9 rollback (mock Meta) | Campaign OK·AdSet 실패 → Campaign delete 호출, orphans.json 비어있음 / cleanup 중 delete 실패 → orphans.json append |
| I10 external modification | insights API mock 404 → campaign.status=externally_modified, 다음 수집 skip |
| Backwards compat | 기존 Creative JSON(신규 필드 없음) 읽기 → 마이그레이션 스크립트 → variantGroupId 부여 → 기존 launch 흐름 호환 |
| Migration fresh vs existing DB | `data/creatives.db` 없을 때 스키마 생성 / 기존 DB 있을 때 `safeAlter`로 컬럼 추가 |

### 5.3 Mocked external

| 대상 | Mock 전략 |
|---|---|
| Voyage API | `embed()` 고정 벡터 반환 / 실패 throw → graceful degradation 검증 |
| Meta Graph API | `asset_feed_spec` POST 성공/실패 분기 / insights breakdown → fixture JSON |
| Claude (generateCopy) | 3 variant 생성 / angle hint별 다른 결과 / 일부 실패 시 partial 반환 |

### 5.4 E2E (수동 체크리스트)

`docs/superpowers/specs/2026-04-20-winner-db-variant-orchestration-e2e-checklist.md`에 저장 (Plan 시점 작성).

- Meta 샌드박스 계정에 실제 DCO 광고 1개 런칭 → 24시간 후 breakdown 리포트 수집 → variant 매핑 검증
- Worker 24시간 연속 실행 → catchup 동작 확인
- CI 대상 아님, 수동 체크리스트

---

## Section 6 — Implementation Phases

3개의 독립 Plan으로 분할한다. 각 Plan 종료마다 동작하는 소프트웨어를 배포 가능하다.

### Plan A — Platform Adapter + Meta DCO 마이그레이션

**목표:** Meta 전용 코드를 adapter 뒤로 숨기고, 런칭을 DCO로 전환.

**산출물:**
- **(사전 task) Meta DCO API 최신 권장 방식 검증** — `adlabels` vs `stable_id_feed_ids`, Advantage+ Creative 엔드포인트 version 확인 (Plan A 1일차)
- `core/platform/types.ts` — `AdPlatform` interface + `VariantGroup` / `LaunchResult` / `CleanupResult` 타입
- `core/platform/meta/launcher.ts`, `monitor.ts` — 기존 `core/campaign/*` 이관 + DCO 재작성
- `core/platform/registry.ts` — `activePlatforms()`, `.env` 파싱
- 마이그레이션 스크립트 `scripts/migrate-creatives.ts` — 기존 Creative에 `variantGroupId = randomUUID()` (1-variant 그룹)
- I9 rollback + `orphans.json` + I10 external_modified
- `Campaign` 스키마 확장 (`metaAdId` 단수, `platform`, `orphans`)

**배포 후 동작:** Platform Adapter 추상화 완료. 런칭 구조가 "2-ad split (image + video)"에서 "1 DCO ad with asset_feed_spec"로 전환. Meta 대시보드 표시·리포트 수집 경로 변경. 기존 Creative는 1-variant 그룹으로 마이그레이션되어 DCO 경로로 런칭 가능.

**Success criteria:** Meta 샌드박스에 DCO 광고 1개 정상 런칭, body_asset breakdown 수집 확인.

**예상 기간:** 1.5주.

---

### Plan B — Variant 생성 파이프라인

**목표:** product 1개당 copy variant 3개 생성, 공유 image/video, 그룹 단위 리뷰/런칭.

**산출물:**
- `core/creative/copy.ts` — `generateCopy(client, product, fewShot, variantLabel)` 시그니처 확장
- `core/creative/prompt.ts` — `buildCopyPrompt` 추출, angle hint 주입
- `cli/pipeline.ts` — product당 3 generateCopy, image/video 1회
- `cli/reviewer/session.ts` — variantGroup 단위 UI
- `cli/entries/launch.ts` — `variantGroupId` 그룹핑, ≥ 2 승인 체크, `assembleAssetFeedSpec` 조립
- `groupApprovalCheck` + 테스트

**의존성:** Plan A 완료.

**배포 후 동작:** Product 1개 → Creative 3 → review → ≥ 2 승인 시 DCO 1개 런칭. Winner DB 없이 동작 (fewShot=[]).

**Success criteria:** 제품 하나에 3 variant 리뷰 UI, 2개 이상 승인 시 DCO 런칭, body_asset별 impression 분리 수집.

**예상 기간:** 1주.

---

### Plan C — Winner DB + Voyage RAG

**목표:** 자격 통과 variant를 embedding과 함께 저장, 새 product 시 RAG로 few-shot 주입.

**산출물:**
- `data/creatives.db` + `core/rag/db.ts` (마이그레이션, safeAlter 패턴)
- `core/rag/voyage.ts` — Voyage embedding 클라이언트 (factory 주입)
- `core/rag/store.ts` — `WinnerStore.insert` / `loadAll` / `hasCreative` (BLOB 직렬화)
- `core/rag/retriever.ts` — `filterByCategory` + `retrieveTopK` + `lexicalFallback` + `dedupByCosine` (전부 순수 함수)
- `core/rag/qualifier.ts` — `passesThreshold` + `getMedianCtr` + `aggregateVariantReports` + `shouldSkipInsert`
- **`core/scheduler/improvementCycle.ts` 리팩터** — `runScheduledImprovementCycle`을 3 단계로 명시 분리: (1) aggregate VariantReports → (2) qualifyWinners (신규) → (3) runCycle (기존 improver). 각 단계 실패는 독립적으로 로그·skip.
- Plan B의 pipeline에 retriever 연결

**의존성:** Plan B 완료.

**배포 후 동작:** Variant가 threshold 통과 → Winner DB 삽입 → 다음 파이프라인에서 RAG few-shot 주입.

**Success criteria:** 14일 운영 후 Winner DB에 엔트리 축적, RAG 사용 전후 CTR 비교 가능.

**비용:** Voyage `voyage-3-lite` $0.02/1M tokens. 1000 creatives × (200 tokens product + 100 tokens copy) × 2 embeds ≈ **$0.012 total** — 무시 가능.

**예상 기간:** 1.5주.

---

### Phase 순서

1. Plan A (1.5주) — 가장 risky, DCO 동작 검증
2. Plan B (1주) — Plan A 위에서 variant 확장
3. Plan C (1.5주) — Voyage + SQLite 신규

총 4주. 각 Plan 종료 시 배포 가능, 중간 우선순위 변경 여지 있음.

---

## 비범위 (Out of scope)

- Voyage 모델 교체 시 재임베딩 (voyage-3-lite → voyage-3 등)
- Meta rate limit 처리 — 기존 코드도 동일 이슈, 이 feature가 새로 만드는 문제 아님
- Claude judge 기반 자동 리뷰 — 현재는 수동 리뷰만
- Conversion/revenue 기반 qualification (외부 랜딩 페이지에 Pixel 없음)
- TikTok/Google Ads adapter 실제 구현 — 현재는 interface만 정의

---

## 검토 이력

### 2026-04-20 — 자체 검토 1차

**Critical:**
- C1: Meta `quality_ranking`은 ad 레벨. Variant 자격 판정에 사용 불가 → ad-level gate로 분리 (§1.4)
- C2: `body_asset` ↔ `variantLabel` 매핑 수단 없음 → `adlabels` 부착 + `metaAssetLabel` 필드 (§1.2, §2.2)

**Important:**
- I1: variantGroup → Meta 엔티티 매핑 확정 → "1 group = 1 Ad with asset_feed_spec" (§1.2)
- I2: 임베딩 대상 분리 → `embedding_product` + `embedding_copy` (§2.5)
- I3: 리뷰 거절 처리 → ≥ 2 approved = launch, 이하 discard (§3.1)
- I4: `getMedianCtr` 정의 → 전역 30일, 샘플 < 10 fallback 0.015 (§1.4)
- I5: Platform Adapter env 계약 → `AD_PLATFORMS` csv + platform prefix (§1.1)
- I6: `winnerInsertedAt` 필드 추가 (§2.2) — **2차 검토에서 제거 (I16)**
- I7: 리뷰 메커니즘 확정 → 기존 수동 리뷰 CLI 재사용 (§3.1)
- I8: RAG low-similarity cutoff → `MIN_COSINE = 0.6` (§3.4)
- I9: Meta 롤백 순서·실패 처리 → 역순 delete + orphans 기록 (§4)
- I10: 외부 수정 처리 → `externally_modified` 마킹 (§4)
- I11: 누락된 순수 함수 테스트 추가 (§5.1)
- I12: I9/I10 integration 테스트 추가 (§5.2)
- I13: Backwards compat 마이그레이션 스크립트 + 테스트 (§5.2, Plan A)

### 2026-04-20 — 자체 검토 2차 (스펙 작성 후)

**Critical:**
- C3: `AdPlatform` interface가 미정의 타입(`VariantGroup`, `LaunchResult`, `CleanupResult`) 참조 → §2.6 신규 섹션에 정의 (§1.1, §2.6)
- C6: `WinnerStore.query` 시그니처 모호 (queryEmbed 용도) → `loadAll()` 단일 API + retrieveTopK로 cosine 처리 (§3.4)

**Important:**
- I15: Qualification 삽입 지점 명시 → `runScheduledImprovementCycle`을 (1) aggregate (2) qualify (3) runCycle 3 단계로 분리 (Plan C)
- I16: `Creative.winnerInsertedAt` 제거 → `WinnerStore.hasCreative(creativeId)` 쿼리로 single source of truth 통일 (§2.2, §3.3, §4)
- I17: `VariantReport.id` 형식 명시 → `${campaignId}::${variantLabel}::${date}` upsert (§2.4)
- I18: "전역 pool" 정의 명시 → 전체 Winner DB 메모리 로드 후 메모리 필터링, 규모 전제 (< 1000 rows) (§3.4)
- I19: Plan A 동작 설명 수정 → "외부 동작 변화 없음" 삭제, DCO 전환과 마이그레이션 명시 (Plan A)
- I20: DCO body 수 명시 → "2~3개 (승인된 variant 수에 따라)" (§1.2)
- C7: 카테고리 부족 시 retrieval 방식 → 전체 로드 + 메모리 필터링으로 확정 (§3.4)

**Minor:**
- M6: `hashtags`의 DCO 내 위치 → body 말미 append 형식 명시 (§1.2)
- M7: Voyage 비용 추정 추가 → 1000 creatives ≈ $0.012 (Plan C)
- M8: Meta DCO API 최신 방식 검증 task 추가 (Plan A 1일차)

### 2026-04-20 — Plan A Task 1 실행 후 (Meta API 검증 결과 반영)

**Critical:**
- C8: `body_asset` breakdown은 `adlabels`를 echo하지 않음 (Meta 공식 문서 확인) → variant 매핑은 Strategy B (text 매칭)로 확정. §1.2 문구 업데이트, §4 edge case 행 수정. Plan A Task 5 `findMatchingCreative`의 adlabel-first 분기는 unreachable이므로 제거. 세부 근거: `docs/superpowers/specs/2026-04-20-meta-dco-api-notes.md`.

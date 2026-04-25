# Google Ads Adapter (Scaffold)

## Status
**Scaffold only — runtime calls throw NotImplementedError.**

YouTube ads는 본 어댑터를 통해 처리한다 (Google Ads API의 PMax/Video 캠페인). 별도 `youtube/` 어댑터를 만들지 않는다.

## Implementation Plan
실 통합 시 이 README를 따라 진행.

## 1. SDK / Dependencies
- npm: `google-ads-api` (또는 official `google-ads-nodejs-client`)
- API doc: https://developers.google.com/google-ads/api/docs/start

## 2. Required Config (`[platforms.google]`)
- `developer_token` — Google Ads developer token
- `customer_id` — Google Ads CID (format: 123-456-7890)
- (실 통합 시 OAuth credentials: client_id, client_secret, refresh_token 추가)

## 3. Authentication Flow
[research needed] — Google Ads API OAuth 2.0:
- 옵션 A: User OAuth (refresh_token 기반)
- 옵션 B: Service account (Manager Account 권한 필요)
- 옵션별 setup 절차 비교 후 결정

## 4. Resource Hierarchy (vs Meta)
| Meta | Google Ads (PMax) | externalIds 키 |
|---|---|---|
| Campaign | Campaign | `campaign` |
| Ad Set | Asset Group | `adGroup` (또는 `assetGroup`) |
| Ad | Ad | `ad` |
| Ad Creative | Asset | `asset` |

## 5. PMax Asset Group 매핑
Performance Max 캠페인은 asset_group 단위로 멀티 asset (headlines, descriptions, images, videos) 운영. Meta DCO `asset_feed_spec` 등가물:
- [research needed] — Google Ads API의 `AssetGroupOperation` / `AssetGroupAssetOperation` 사용 형태
- variant breakdown reporting은 asset 단위로 가능한지 확인

## 6. YouTube Placement
PMax 캠페인은 YouTube placement를 자동 포함 (video assets 업로드 시):
- [research needed] — video asset upload 흐름
- 별도 Video campaign type (vs PMax)을 사용할지 결정 필요

## 7. Reporting Breakdown
- [research needed] — `GoogleAdsService.search` 또는 `Stream` 으로 asset-level metrics 회수
- VariantReport.platformMetrics.google 매핑 형태 결정 (Quality Score 등)

## 8. Implementation Checklist
- [ ] `google-ads-api` 설치 + `package.json` 등록
- [ ] `[platforms.google]` Zod schema 확장 (OAuth 필드 추가)
- [ ] `launcher.ts`: `launchGoogleAds()` 본체 — PMax campaign + asset group 생성
- [ ] `monitor.ts`: `fetchGoogleVariantReports()` — asset-level breakdown 매핑
- [ ] `adapter.ts`: `cleanup()` 본체 — Google Ads remove operation + rollback 패턴
- [ ] `breakdown.ts` 신설 (Meta 참조)
- [ ] 에러 분류 함수 (`classifyGoogleAdsError`) 신설
- [ ] `registry.ts`의 `NOT_YET_IMPLEMENTED` 집합에서 "google" 제거 + dynamic import 분기 추가
- [ ] `adapter.test.ts`: NotImplemented 테스트 → 실 동작 테스트로 교체
- [ ] YouTube placement: 별도 launch flag (group.options.youtube?) vs PMax 자동 포함 — 결정 후 문서화
- [ ] schema regex 강화 시 기존 사용자 config 호환성 확인

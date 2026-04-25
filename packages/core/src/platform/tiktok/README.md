# TikTok Adapter (Scaffold)

## Status
**Scaffold only — runtime calls throw NotImplementedError.**

## Implementation Plan
실 통합 시 이 README를 따라 진행.

## 1. SDK / Dependencies
- npm: `tiktok-business-api-sdk` (또는 raw HTTP client)
- API doc: https://business-api.tiktok.com/portal/docs

## 2. Required Config (`[platforms.tiktok]`)
- `access_token` — long-lived token from TikTok Marketing API
- `advertiser_id` — TikTok Ads Manager advertiser ID (numeric)
- (실 통합 시 OAuth refresh credentials 추가 가능)

## 3. Authentication Flow
[research needed] — TikTok Business API OAuth 2.0 / token refresh 절차

## 4. Resource Hierarchy (vs Meta)
| Meta | TikTok | externalIds 키 |
|---|---|---|
| Campaign | Campaign | `campaign` |
| Ad Set | Ad Group | `adGroup` |
| Ad | Ad | `ad` |
| Ad Creative | [research needed] — TikTok Identity / Creative 분리 여부 확인 필요 | [research needed] |

## 5. ACO (Automated Creative Optimization) 매핑
TikTok ACO는 multi-creative 자동 최적화. Meta DCO `asset_feed_spec` 등가물:
- [research needed] — ACO API endpoint 및 asset upload 형식

## 6. Reporting Breakdown
일별 per-variant insights 회수 방법:
- [research needed] — `/v1.3/report/integrated/get/` 엔드포인트 검토
- VariantReport.platformMetrics.tiktok 매핑 형태 결정

## 7. Implementation Checklist
- [ ] `tiktok-business-api-sdk` 설치 + `package.json` 등록
- [ ] `[platforms.tiktok]` Zod schema 확장 (필요 시 OAuth 필드 추가)
- [ ] `launcher.ts`: `launchTiktokAco()` 본체 — campaign/adGroup/ad 생성 + asset upload
- [ ] `monitor.ts`: `fetchTiktokVariantReports()` — breakdown reporting 매핑
- [ ] `adapter.ts`: `cleanup()` 본체 — TikTok delete API + rollback 패턴
- [ ] `breakdown.ts` 신설 (Meta 참조)
- [ ] 에러 분류 함수 (`classifyTiktokError`) 신설 — Meta `classifyMetaError` 참조
- [ ] `registry.ts`의 `NOT_YET_IMPLEMENTED` 집합에서 "tiktok" 제거 + dynamic import 분기 추가
- [ ] `adapter.test.ts`: NotImplemented 테스트 → 실 동작 테스트로 교체 (Meta launcher.test.ts 참조)
- [ ] schema regex 강화 시 기존 사용자 config 호환성 확인

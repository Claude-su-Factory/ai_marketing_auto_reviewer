# Winner DB + Variant Orchestration E2E Checklist

Plan A 완료 후 Meta 샌드박스 계정에서 수행. CI 대상 아님.

## Plan A — Platform Adapter + Meta DCO

- [ ] `.env`에 `AD_PLATFORMS=meta`, `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_PAGE_ID` 설정
- [ ] 테스트용 Product JSON 1개 준비 (`data/products/test-p.json`)
- [ ] 승인 상태 Creative JSON 1개 준비 (`data/creatives/test-c.json`, `status: "approved"`, 이미지·영상 파일 경로 유효)
- [ ] `npm run migrate:creatives` 실행 → Creative에 `variantGroupId`, `variantLabel`, `metaAssetLabel` 추가 확인
- [ ] `npm run launch` 실행 → Meta Ads Manager에서 DCO 광고 1개 생성 확인 (`asset_feed_spec` 적용, `PAUSED` 상태)
- [ ] Meta Ads Manager에서 광고 활성화 → `data/campaigns/<id>.json`의 `status`를 `"active"`로 수동 수정
- [ ] 24시간 후 `npm run monitor -- daily` 실행 → `data/reports/<어제>.json`에 VariantReport 저장 확인
- [ ] VariantReport의 `variantLabel`, `metaAssetLabel`이 올바르게 매핑되었는지 확인
- [ ] Meta Ads Manager에서 광고를 수동 삭제 → 다음 `monitor -- daily` 실행 → campaign JSON의 `status`가 `"externally_modified"`로 변경되는지 확인
- [ ] (rollback 시나리오) Meta credential을 일시적으로 잘못된 값으로 바꿔 `npm run launch` 실행 → campaign 생성은 성공하지만 adset 생성 단계에서 실패 → campaign이 Meta에서 삭제되었는지 확인 (rollback 동작)
- [ ] (AdCreative rollback 검증) `createAd` 단계에서 일부러 실패 유발 (예: `adset_id`를 잘못된 값으로 패치) → `data/campaigns/<id>.json`에 `status: "launch_failed"` 레코드가 생성되고, Meta Ads Manager에서 생성되었던 AdCreative가 삭제되었는지 확인. 삭제 실패 시 `data/orphans.json`에 `{type: "creative", id: "..."}`가 기록됨.
- [ ] (자율 개선 루프 검증) 낮은 CTR의 VariantReport를 `data/reports/<어제>.json`에 수동 주입 → `npm run improve` 실행 → 개선 대상 캠페인이 0이 아니라 weakReports에 집계됨을 console log로 확인 (C2 fix 회귀 방지).
- [ ] (외부 수정 감지 검증) Meta Ads Manager에서 광고를 수동 삭제 후 `npm run monitor -- daily` → campaign JSON의 status가 `"externally_modified"`로 변경됨. 로그에 `FacebookRequestError` 404/code 100이 캡처되고 `transient`가 아닌 `externally_modified`로 분류되었는지 console.warn 확인 (C1 fix 회귀 방지).

## 검토 결과 기록

실행 후 실제 동작과 예상의 차이를 아래에 기록:

- (날짜): (관찰 내용)

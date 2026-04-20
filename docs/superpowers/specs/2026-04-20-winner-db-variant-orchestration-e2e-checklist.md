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

## 검토 결과 기록

실행 후 실제 동작과 예상의 차이를 아래에 기록:

- (날짜): (관찰 내용)

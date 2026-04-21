# 로드맵

마지막 업데이트: 2026-04-21

---

## 현재 추천 다음 작업

**Plan C qualify 프로덕션 wire-up (post-chore)** — Plan C 코어 모듈은 완료(2026-04-21, 테스트 262)이나 `runScheduledImprovementCycle`의 기본 `qualify`가 noop이라 스케줄러 경로로는 Winner DB가 채워지지 않는다. `cli/entries/worker.ts`, `server/scheduler.ts`의 TODO 주석에 따라 `qualifyWinners`를 조립(Voyage client + WinnerStore + loadCreative/loadProduct + `creativeIdResolver` 정의)하여 `qualify` deps로 주입한다. 조립 시 `creativeIdResolver(agg)`가 반환하는 키로 `loadCreative`가 실제 Creative를 찾을 수 있도록 resolver 설계가 필요 (composite key `campaignId::variantLabel` → Creative 매핑 규칙 확정). 작업 후 실운영 검증으로 넘어간다.

---

## Tier 1 — 바로 진행

- Plan C 실운영 검증 (위 post-chore 완료 후). 실제 `VOYAGE_API_KEY` + 실 런칭 variant report로 (1) qualifyWinners가 MIN_IMPRESSIONS=500 임계 통과 variant만 winner로 남기는지, (2) voyage-3-lite embedding이 `data/creatives.db`에 정상 저장되는지, (3) 새 제품 생성 시 retrieveFewShotForProduct가 유사 winner를 top-K=3으로 회수해 `generateCopy`에 주입하는지 확인.

---

## Tier 2 — 후보 (사용자 확정 필요)

아래 항목들은 제안된 후보이며, 우선순위는 사용자와 상의 후 확정한다.

- 프로덕션 배포 파이프라인 구축 (서버 호스팅, 도메인 연결, TLS 설정)
- Dev-time Agent Team Phase 1b — Performance Analyst subagent (Winner DB 구축 완료 — 바로 도입 가능)
- 고객 셀프서비스 페이지 (결제 URL 외에 사용량/잔액 확인 대시보드)
- 영상 생성 실패율 모니터링 및 알림
- 통합 테스트 보강 (현재는 unit test 위주)

---

## Tier 3 — 장기 (사용자 확정 필요)

- 제품 카테고리 자동 분류 정확도 개선
- Meta 외 플랫폼 지원 (TikTok, YouTube Shorts)
- 자율 개선 루프 강화 (launchd 인프라 구축 완료 — 2026-04-20. 추가 개선: 분석 히스토리 재주입, 개선 실패 알림 등)
- 다국어 소재 생성 지원
- Dev-time Agent Team Phase 1c — Architecture Steward subagent (대규모 리팩터 필요 시점에 도입)

<!--
업데이트 규칙:
- 완료된 항목은 제거 (STATUS.md로 이동)
- "현재 추천 다음 작업"은 항상 1개만 유지
- Tier 2/3의 "사용자 확정 필요" 태그가 붙은 항목은 작업 착수 전 사용자와 상의
-->

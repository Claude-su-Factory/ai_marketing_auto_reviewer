# 로드맵

마지막 업데이트: 2026-04-22

---

## 현재 추천 다음 작업

**Plan C 실운영 검증** — qualify wire-up이 완료되었으므로(2026-04-21), 실제 `VOYAGE_API_KEY` + 실 런칭 variant report로 (1) qualifyWinners가 MIN_IMPRESSIONS=500 임계 통과 variant만 winner로 남기는지, (2) voyage-3-lite embedding이 `data/creatives.db`에 정상 저장되는지, (3) 새 제품 생성 시 `retrieveFewShotForProduct`가 유사 winner를 top-K=3으로 회수해 `generateCopy`에 주입하는지 실 데이터로 확인. Owner worker는 6h 주기로 자동 실행되므로 하루 이상 관찰 후 `winners` 테이블 내용을 검증한다.

---

## Tier 1 — 바로 진행

(현재 추천 다음 작업 외에는 비어있음)

---

## Tier 2 — 후보 (사용자 확정 필요)

아래 항목들은 제안된 후보이며, 우선순위는 사용자와 상의 후 확정한다.

- 프로덕션 배포 파이프라인 구축 (서버 호스팅, 도메인 연결, TLS 설정)
- Dev-time Agent Team Phase 1b — Performance Analyst subagent (Winner DB 구축 완료 — 바로 도입 가능)
- 영상 생성 실패율 모니터링 및 알림
- 통합 테스트 보강 (현재는 unit test 위주)
- **웹 UI + customer 모드 재도입**: `server/` billing/license/AI proxy 재활성화, CLI 외 웹 사용자 대상 서비스 제공; 결제 URL 외 사용량/잔액 확인 대시보드 포함. 트리거: owner 만의 CLI 운영 경험 충분히 축적된 후
- **Meta API spend 수집 + Monitor spend/CPC 복원**: `fetchMetaVariantReports` 확장, `VariantReport` 에 `spend/cpc` 추가, Monitor 화면 재설계. 트리거: Plan C 안정화 완료
- **Pipeline 4단계 확장**: Review/Launch 를 `runPipelineAction` 에 통합, 수동 승인 단계 자동 skip 옵션. 트리거: Review 자동 승인 규칙 확정 후

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

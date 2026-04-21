# 로드맵

마지막 업데이트: 2026-04-21

---

## 현재 추천 다음 작업

**Plan C 실운영 검증** — Plan C 구현 완료 (2026-04-21, 테스트 262 통과). 다음 세션에서 실제 `VOYAGE_API_KEY` 환경변수 + 실 런칭 variant report를 투입해 (1) qualifyWinners가 MIN_IMPRESSIONS=500 임계를 통과한 variant만 winner로 남기는지, (2) voyage-3-lite embedding이 `data/creatives.db`에 정상 저장되는지, (3) 새 제품 생성 시 retrieveFewShotForProduct가 유사 winner를 top-K=3으로 회수해 `generateCopy`에 주입하는지 확인한다. 병행 후보는 Tier 2 참조.

---

## Tier 1 — 바로 진행

(없음 — 실운영 검증 외 Tier 2 후보 선정 대기)

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

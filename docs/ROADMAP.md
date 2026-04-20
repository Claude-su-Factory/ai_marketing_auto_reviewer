# 로드맵

마지막 업데이트: 2026-04-20

---

## 현재 추천 다음 작업

**Plan C — Winner DB + Voyage RAG** — Plan B 완료. 이제 launch된 creative의 CTR/CVR을 winner DB(`data/creatives.db`)로 수집하고, Voyage RAG로 승자 카피를 few-shot 예시에 공급해 `generateCopy`의 `fewShot` 인자를 실데이터로 채운다. 스펙 `docs/superpowers/specs/2026-04-20-winner-db-variant-orchestration-design.md` §Section 7 이후 참조.

---

## Tier 1 — 바로 진행

(없음 — 다음 작업 선정 대기)

---

## Tier 2 — 후보 (사용자 확정 필요)

아래 항목들은 제안된 후보이며, 우선순위는 사용자와 상의 후 확정한다.

- 프로덕션 배포 파이프라인 구축 (서버 호스팅, 도메인 연결, TLS 설정)
- 고객 셀프서비스 페이지 (결제 URL 외에 사용량/잔액 확인 대시보드)
- 영상 생성 실패율 모니터링 및 알림
- 통합 테스트 보강 (현재는 unit test 위주)

---

## Tier 3 — 장기 (사용자 확정 필요)

- 제품 카테고리 자동 분류 정확도 개선
- Meta 외 플랫폼 지원 (TikTok, YouTube Shorts)
- 자율 개선 루프 강화 (launchd 인프라 구축 완료 — 2026-04-20. 추가 개선: 분석 히스토리 재주입, 개선 실패 알림 등)
- 다국어 소재 생성 지원

<!--
업데이트 규칙:
- 완료된 항목은 제거 (STATUS.md로 이동)
- "현재 추천 다음 작업"은 항상 1개만 유지
- Tier 2/3의 "사용자 확정 필요" 태그가 붙은 항목은 작업 착수 전 사용자와 상의
-->

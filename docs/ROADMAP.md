# 로드맵

마지막 업데이트: 2026-04-19

---

## 현재 추천 다음 작업

**SP4 — 레이어드 아키텍처 리팩터**

`src/`와 `server/`의 책임 경계가 흐려져 있는 현재 구조를, 프레임워크 무관 `core/`와 presentation layer `cli/`·`server/`로 재조직한다. 순수 파일 이동 리팩터이며 동작 변경은 없다.

- 설계 문서: [`docs/superpowers/specs/2026-04-17-layered-architecture-refactor-design.md`](superpowers/specs/2026-04-17-layered-architecture-refactor-design.md)
- 구현 계획: 아직 없음 (`writing-plans` 단계 필요)

---

## Tier 1 — 바로 진행

- SP4 레이어드 리팩터 구현 계획 작성 (`writing-plans`)
- SP4 리팩터 실행 (`subagent-driven-development`)

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
- 자율 개선 루프 강화 (현재는 프롬프트 수정 수준, 본격적 코드 변경 루프 필요)
- 다국어 소재 생성 지원

<!--
업데이트 규칙:
- 완료된 항목은 제거 (STATUS.md로 이동)
- "현재 추천 다음 작업"은 항상 1개만 유지
- Tier 2/3의 "사용자 확정 필요" 태그가 붙은 항목은 작업 착수 전 사용자와 상의
-->

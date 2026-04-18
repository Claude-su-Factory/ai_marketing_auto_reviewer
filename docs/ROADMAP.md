# 로드맵

마지막 업데이트: 2026-04-17

---

## 현재 추천 다음 작업

**🚨 Webhook dedup 긴급 수정**

Stripe Webhook 핸들러(`server/routes/stripeWebhook.ts`)에 dedup 로직이 없어 네트워크 재시도 시 이중 충전이 발생할 수 있다. SP3 스펙에는 포함되어 있으나 코드에 반영되지 않은 구현 누락이다.

**수정 방향:**
- `stripe_events` 테이블 추가 (컬럼: `event_id TEXT PRIMARY KEY`, `processed_at DATETIME`)
- 또는 기존 `billing_cycles` 테이블에 `stripe_event_id` UNIQUE 컬럼 추가
- Webhook 핸들러 진입 시 `event.id`로 중복 체크 후 INSERT. 중복이면 200만 반환하고 처리 스킵
- 관련 테스트 추가

프로덕션 과금이 시작되기 전에 반드시 수정 필요.

---

## Tier 1 — 바로 진행

1. **[긴급] Webhook dedup 구현** — 위 "현재 추천 다음 작업" 참조
2. **SP4 레이어드 아키텍처 리팩터**
   - 설계 문서: [`docs/superpowers/specs/2026-04-17-layered-architecture-refactor-design.md`](superpowers/specs/2026-04-17-layered-architecture-refactor-design.md)
   - `src/`와 `server/`의 책임 경계가 흐려져 있는 현재 구조를, 프레임워크 무관 `core/`와 presentation layer `cli/`·`server/`로 재조직. 순수 파일 이동, 동작 변경 없음
   - 구현 계획 작성 (`writing-plans`) → 실행 (`subagent-driven-development`)

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

# 프로젝트 문서 부트스트랩 설계

**날짜:** 2026-04-17
**프로젝트:** ad_ai
**상태:** 승인됨

---

## 개요

`CLAUDE.md`가 참조하는 3개 문서(`docs/STATUS.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`)가 존재하지 않아 "새 세션 시작 시 컨텍스트 복원" 규칙이 실행 불가능한 상태였다. 또한 `CLAUDE.md`가 `supabase/migrations/`를 참조하지만 실제 프로젝트는 SQLite(`server/data.db`)를 사용하여 기술 스택 부정합이 있었다.

이번 작업은 세 문서를 현재 코드·스펙·git 이력 기반으로 생성하고, `CLAUDE.md`의 부정합을 바로잡는다.

---

## 범위

**포함**
- `docs/STATUS.md` 생성 — Phase 요약, 서비스 컴포넌트 상태, 최근 변경 이력(최신 10개)
- `docs/ROADMAP.md` 생성 — 현재 추천 다음 작업, Tier 1/2/3
- `docs/ARCHITECTURE.md` 생성 — 시스템 개요, 디렉토리 맵, 핵심 설계 결정(Why/How), 데이터 저장소
- `CLAUDE.md` 수정 — `supabase/migrations/` 참조를 `server/data.db` + `server/db.ts`로 교체

**비포함**
- 글로벌 `~/.claude/CLAUDE.md` 수정 (해당 파일은 강의 대본용 지침이며 이 프로젝트와 무관)
- `AGENTS.md` 수정 (Gemini CLI용 Spec Analyzer 역할, CLAUDE.md와 충돌 없음)
- 기존 스펙/계획 문서 수정
- 아키텍처 자체의 변경 (문서화만 수행, 구조 변경 없음)

---

## 배경 — 부정합 발견 내역

### 1. 유령 문서 참조 (Critical)

`CLAUDE.md` 5-7줄에서 세 문서를 "새 세션 시작 시 순서대로 확인"하라고 지시하지만, `docs/` 아래에는 `superpowers/` 폴더만 존재한다. 이 규칙은 아무도 실행할 수 없었다.

### 2. 존재하지 않는 기술 스택 참조 (Critical)

`CLAUDE.md` 41줄: `supabase/migrations/ — DB 스키마 (번호 순서)`

실제 프로젝트는 `better-sqlite3`를 사용하며(`package.json` 참조), DB는 `server/data.db` 단일 SQLite 파일이다. `server/db.ts`가 스키마와 마이그레이션을 정의한다. `supabase/` 디렉토리 자체가 없다.

### 3. 문서 업데이트 규칙이 공회전 (Critical)

`CLAUDE.md` 29-33줄의 "문서 업데이트 규칙"은 세 유령 문서를 강제로 업데이트하라고 요구하는데, 파일이 없으니 규칙 전체가 데드 코드였다.

---

## 문서 구조 설계

### STATUS.md

```
1. Phase 요약 (SP0 ~ SP4 체크박스)
2. 서비스 컴포넌트 상태 표 (컴포넌트 × 상태 × 위치)
3. 최근 변경 이력 (최신 10개, 날짜 + 커밋 메시지 요약)
4. 업데이트 규칙 주석 (맨 위 추가, 11번째부터 삭제)
```

**소스:** `git log --oneline -10`, `src/`·`server/` 디렉토리 구조, 기존 스펙 파일.

### ROADMAP.md

```
1. 현재 추천 다음 작업 (1개, 설계 문서 링크 포함)
2. Tier 1 — 확정된 작업 (최우선)
3. Tier 2 — 후보 (사용자 확정 필요 태그)
4. Tier 3 — 장기 후보 (사용자 확정 필요 태그)
5. 업데이트 규칙 주석
```

**Tier 2/3은 제안일 뿐이며 "사용자 확정 필요" 태그를 명시**한다. Tier 1만 즉시 실행 가능한 항목으로 유지.

### ARCHITECTURE.md

```
1. 시스템 개요 (2-컴포넌트 ASCII 다이어그램)
2. 주요 디렉토리 표 (경로 × 역할)
3. 핵심 설계 결정 7가지 (각각 Why/How 포함)
4. 데이터 저장소 (SQLite 테이블 + 파일 시스템)
5. 스펙 & 계획 위치
6. 업데이트 규칙 주석
```

**핵심 설계 결정 7가지 (스펙 + 커밋 이력에서 도출):**
1. Owner vs Customer 모드 분리
2. Deduct-first 빌링 패턴
3. SQLite 선택
4. 세션 토큰 + 레이트 리밋
5. Webhook Dedup
6. 비동기 Veo 영상 작업
7. 자동 충전 실패 시 즉시 중단

---

## CLAUDE.md 수정

변경 위치: 41줄 ("스펙 & 계획 위치" 섹션 내부)

**Before:**
```
docs/superpowers/specs/   — 설계 문서 (기능별)
docs/superpowers/plans/   — 구현 계획 (기능별)
supabase/migrations/      — DB 스키마 (번호 순서)
```

**After:**
```
docs/superpowers/specs/   — 설계 문서 (기능별)
docs/superpowers/plans/   — 구현 계획 (기능별)
server/data.db            — 런타임 SQLite DB (licenses/usage/billing, git 제외)
server/db.ts              — DB 스키마 및 마이그레이션 정의
```

다른 줄은 수정하지 않는다 (참조 문서는 이제 실제로 생성됐으므로 규칙이 유효해짐).

---

## 검증 기준

- [x] `docs/STATUS.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md` 3개 파일이 실제로 존재
- [x] STATUS.md의 "최근 변경 이력"이 최신 10개 커밋과 일치
- [x] ROADMAP.md의 "현재 추천 다음 작업"이 SP4 스펙 파일을 링크
- [x] ARCHITECTURE.md의 "핵심 설계 결정" 각 항목에 Why/How가 모두 존재
- [x] CLAUDE.md에서 `supabase/migrations/` 참조가 제거됨
- [x] 각 문서 하단에 업데이트 규칙 주석 포함

---

## 검토 이력

### 2026-04-17 자체 검토 (1차)

- **Placeholder 스캔:** TBD/TODO 없음. 모든 섹션이 실제 데이터로 채워짐.
- **내부 일관성:** STATUS의 SP 번호 = ROADMAP의 SP 번호 = git 커밋 이력 일치.
- **범위 체크:** 단일 플랜 범위 내. 문서 생성만 수행하며 코드 변경 없음.
- **모호성 체크:** Tier 2/3에 "사용자 확정 필요" 태그로 우선순위 확정 전이라는 점을 명시함.

### 2026-04-17 자체 검토 (2차, 코드 대조)

실제 코드(`server/db.ts`, `server/auth.ts`, `server/routes/stripeWebhook.ts`, `src/mode.ts`)와 대조해 다음 이슈를 발견하고 수정.

**Critical (수정 완료)**

1. ARCHITECTURE.md의 SQLite 테이블 목록이 실제와 불일치
   - `billing_events` → 실제는 `billing_cycles`
   - `sessions` 테이블은 존재하지 않음 (실제는 `server/auth.ts`의 메모리 `Map`)
   - **조치:** 실제 테이블 3개(`licenses`, `usage_events`, `billing_cycles`)로 정정하고 세션 스토어를 메모리 Map으로 명시. 설계 결정 #4에 "수평 확장 시 Redis 이전 필요" 트레이드오프 추가.

2. "Webhook Dedup" 설계 결정이 실제 코드에 없음
   - SP3 스펙에는 포함되어 있으나 `server/routes/stripeWebhook.ts`에 dedup 로직 없음
   - Stripe 재시도 시 이중 충전 가능 → **프로젝트 실제 결함**
   - **조치:**
     - ARCHITECTURE.md 설계 결정 #5를 "Webhook 서명 검증"으로 교체하고 "⚠️ 미해결 이슈" 블록으로 dedup 미구현 명시
     - STATUS.md 컴포넌트 표에서 Webhook 상태를 `⚠️ 부분 구현`으로 변경, "알려진 결함" 섹션 신설
     - ROADMAP.md "현재 추천 다음 작업"을 SP4 → Webhook dedup 긴급 수정으로 교체, SP4는 Tier 1의 2순위로 강등

**Important (수정 완료)**

3. Owner/Customer 모드 감지 설명 누락
   - `src/mode.ts`는 `AD_AI_LICENSE_KEY` 환경변수도 지원
   - **조치:** ARCHITECTURE.md 설계 결정 #1을 4단계 판단 플로우로 확장.

4. 자동 충전 실패 시 중단의 구체적 트리거 불명확
   - **조치:** 설계 결정 #7에 `payment_intent.payment_failed` 이벤트 경로 명시.

**Minor (수정 완료)**

5. `data/courses/` 레거시 디렉토리 미언급
   - **조치:** 데이터 저장소 표에 레거시 경고와 함께 추가.

6. `data/temp/`는 런타임 생성
   - **조치:** "Customer 모드 첫 실행 시 생성" 문구 추가.

### 남은 작업

- `server/routes/stripeWebhook.ts`에 dedup 로직 실제 구현 (ROADMAP Tier 1 최우선 항목으로 트래킹 중).

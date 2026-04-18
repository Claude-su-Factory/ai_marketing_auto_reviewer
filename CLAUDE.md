## 빠른 네비게이션

새 세션을 시작할 때 아래 문서를 순서대로 확인하여 프로젝트 컨텍스트를 복원한다.

1. [`docs/STATUS.md`](docs/STATUS.md) — 현재 어디까지 구현됐나 (Phase별 체크리스트, 서비스 상태, 최근 변경)
2. [`docs/ROADMAP.md`](docs/ROADMAP.md) — 다음 작업은 무엇인가 (JD 매핑, Tier 1/2/3 작업)
3. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 시스템 구성 및 주요 설계 결정 이력 (Why 포함)
4. [`docs/superpowers/specs/`](docs/superpowers/specs/) — 기능별 상세 설계 문서
5. [`docs/superpowers/plans/`](docs/superpowers/plans/) — 기능별 구현 계획


## 스펙 작성 규칙 (MANDATORY)

스펙(`docs/superpowers/specs/*.md`)을 작성하면 사용자에게 보여주기 전에 **반드시 자체 검토** 사이클을 거친다.

1. 작성 직후 스스로 검토하여 이슈 식별
   - Critical: 명세 그대로 구현 시 동작 안 함 (race, chunk 경계, 잘못된 API)
   - Important: 리소스 누수, 비효율 패턴, 에러 핸들링 누락
   - Minor: 명확성, 비범위 명시, 예시 코드 helper 누락
2. 우선순위별로 사용자에게 보고
3. 스펙 파일을 직접 패치
4. 스펙 하단에 "검토 이력" 섹션 추가/업데이트

별도 요청 없이도 작성→검토→패치→보고가 한 사이클이다.


## 문서 업데이트 규칙 (MANDATORY)

기능 구현 완료 시 다음 파일을 반드시 업데이트한다. 문서 업데이트 없이는 작업이 완료된 것으로 간주하지 않는다.

1. `docs/STATUS.md` — 해당 항목을 ✅로 이동, "최근 변경 이력" 맨 위에 한 줄 추가, "마지막 업데이트" 날짜 갱신
2. `docs/ROADMAP.md` — 완료된 항목 제거, 필요 시 "현재 추천 다음 작업" 재설정
3. `docs/ARCHITECTURE.md` — 아키텍처에 영향을 준 변경에만 반영 (새 컴포넌트, 설계 결정 등)

## 스펙 & 계획 위치

```
docs/superpowers/specs/   — 설계 문서 (기능별)
docs/superpowers/plans/   — 구현 계획 (기능별)
server/data.db            — 런타임 SQLite DB (licenses/usage/billing, git 제외)
server/db.ts              — DB 스키마 및 마이그레이션 정의
```


## 하네스 엔지니어링 규칙 (MANDATORY)

작업 중 발견한 **규칙·판단 기준·프로젝트 결정**은 반드시 프로젝트 문서에 기록한다. 세션이 완전히 새로 시작되어도 이 문서들이 자동 로드되어 프로젝트 이해도를 유지하기 위함이다. 메모리나 대화 맥락에만 남기는 것은 허용되지 않는다.

### 무엇을 기록하는가

- 프로젝트 전반에 걸친 작업 규칙 (예: "supabase/ 경로 참조 금지", "docs/ 하위 문서는 업데이트 규칙 주석 포함")
- 아키텍처 판단 기준 (예: "SQLite 유지, Postgres 전환은 수평 확장 시점에")
- 특정 코딩 컨벤션 (예: "server/routes/*는 factory 함수 패턴")
- 반복되는 실수 방지용 경고 (예: "Webhook dedup 미구현 상태, 이중 결제 주의")

### 어디에 기록하는가

| 성격 | 기록 위치 |
|------|----------|
| 프로젝트 전반 작업 규칙 | 이 `CLAUDE.md` |
| 아키텍처 설계 결정 | `docs/ARCHITECTURE.md`의 "핵심 설계 결정" (Why/How 필수) |
| 작업 흐름 / 문서 관리 규칙 | 해당 문서 하단의 "업데이트 규칙" 주석 |
| 기능별 상세 규칙·트레이드오프 | `docs/superpowers/specs/<feature>-design.md` |
| 알려진 결함·미구현 이슈 | `docs/STATUS.md`의 "알려진 결함" + `docs/ROADMAP.md` |

### 기록 흐름

1. 작업 중 "이 결정/규칙은 다음 세션에도 유효하다"고 판단되면 기록 위치를 선택
2. 임시 메모가 아니라 **명시적 섹션**으로 해당 문서에 추가
3. 같은 커밋에 포함 (문서 변경과 코드 변경을 묶는다)
4. 필요하면 `CLAUDE.md`의 "빠른 네비게이션"에 새 문서 경로도 추가

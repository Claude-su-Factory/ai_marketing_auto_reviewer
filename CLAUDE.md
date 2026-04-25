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

### 검토 깊이 요구사항 (얕은 검토 금지)

"자체 검토"를 형식적으로 끝내지 않도록 다음 점검을 **반드시** 수행한다. 각 점검에서 한 건도 찾지 못했다면, 찾을 때까지 다시 본다 — 복잡한 스펙에 Critical/Important가 0이라는 결과는 거의 항상 검토 부족의 신호다.

1. **외부 참조 검증**: 스펙이 다른 파일/규약/API/타 템플릿을 "~와 동일", "~를 따른다"로 참조하면, 실제 그 파일/템플릿을 읽고 일치 여부 확인. 읽지 않고 쓴 참조는 Critical로 분류.
2. **추측 문구 색출**: "아마", "일반적으로", "~ 포맷과 동일", "~ 와 유사"가 본문에 있으면 모두 검증. 검증 불가면 Important로 분류.
3. **관심사 분리 점검**: 각 컴포넌트 정의에서 자기 역할이 아닌 책임이 섞여 있는지 본다. 예: 마케팅 reviewer가 구조 포맷까지 검증 → Minor 이상.
4. **Deferral 남용 점검**: "플랜 단계에서 다룸", "이후 검토" 같은 유보가 3개 초과면 스펙이 미완성이므로 Important 이상으로 보고하고 스펙에서 해결한다.
5. **구체 예시 존재 확인**: 스펙이 포맷/호출 규칙/템플릿을 언급하면 실제 예시 문자열이 최소 1개는 있어야 한다. 없으면 Important.

검토 이력의 Important가 모두 "없음"인데 스펙이 10섹션 이상이면, 위 점검을 제대로 수행했는지 다시 확인한다.

### 플랜/디자인 섹션 단위 자체 검토 (MANDATORY)

브레인스토밍/디자인/플랜의 **각 섹션(Section 1, 2, 3, ...)을 사용자에게 제시할 때마다** 사용자가 따로 요청하지 않아도 위 "검토 깊이 요구사항" 5개 점검을 적용한 자체 검토 결과를 함께 내보낸다.

- 한 섹션 본문 + "자체 검토 결과" 블록 + 인라인 수정본을 같은 턴에 제시
- Critical / Important / Minor 분류로 이슈 보고. 이슈 없으면 "Critical/Important: 없음" 명시(점검 수행 증명)
- 최종 스펙 파일의 "검토 이력" 섹션과 별개. 섹션 단위 검토는 작성 중 반복되고, 스펙 저장 시 최종 이력으로 정리

**Why:** 사용자가 매번 "스스로 검토해봐"라고 요청하는 반복을 피하고, 섹션 단위로 이슈를 조기에 잡아 최종 스펙 수정 비용을 줄인다.


## 문서 업데이트 규칙 (MANDATORY)

기능 구현 완료 시 다음 파일을 반드시 업데이트한다. 문서 업데이트 없이는 작업이 완료된 것으로 간주하지 않는다.

1. `docs/STATUS.md` — 해당 항목을 ✅로 이동, "최근 변경 이력" 맨 위에 한 줄 추가, "마지막 업데이트" 날짜 갱신
2. `docs/ROADMAP.md` — 완료된 항목 제거, 필요 시 "현재 추천 다음 작업" 재설정
3. `docs/ARCHITECTURE.md` — 아키텍처에 영향을 준 변경에만 반영 (새 컴포넌트, 설계 결정 등)

## 스펙 & 계획 위치

```
docs/superpowers/specs/      — 설계 문서 (기능별)
docs/superpowers/plans/      — 구현 계획 (기능별)
data/licenses.db             — 런타임 SQLite DB (licenses/usage/billing, git 제외)
packages/server/src/db.ts    — DB 스키마 및 마이그레이션 정의
```


## 브랜치 전략

- 모든 구현 작업은 `master` 브랜치에 직접 커밋한다. 별도 feature 브랜치나 PR 흐름을 만들지 않는다.
- 이유: 현재 단일 개발자 프로젝트이고 CI 파이프라인이 없어 브랜치 분기의 이득이 크지 않다. Tier 2의 "프로덕션 배포 파이프라인" 항목이 진행되어 CI가 붙는 시점에 재검토한다.
- `subagent-driven-development` 등 스킬이 "master 사용 시 사용자 동의 필요"를 요구하더라도 이 규칙이 사전 동의 역할을 한다.


## 환경변수 정책 (MANDATORY)

`process.env.X` 직접 참조 금지. 모든 설정은 `config.toml`에 두고 `getConfig()` 또는 도메인 helper(`@ad-ai/core/config/helpers.js`의 `requireMeta`/`requireAnthropicKey`/`requireGoogleAiKey`/`requireVoyageKey`/`requireStripeConfig`)를 사용한다. 예외: `CONFIG_PATH` 1건만 `loader.ts` 내부에서 사용 허용.

테스트는 `setConfigForTesting(makeTestConfig({...}))` 패턴을 사용한다. `vi.stubEnv` 또는 `process.env` 직접 조작 금지. `vitest.setup.ts`가 매 테스트 자동으로 BASE_CONFIG를 주입하므로 별도 setup 없이도 테스트 가능.


## Subagent 호출 규칙 (MANDATORY)

다음 작업은 커밋 전 해당 subagent로 검토한다.

| 작업 유형 | Subagent | 정의 위치 |
|---------|----------|---------|
| `packages/core/src/platform/meta/*` 수정 | `meta-platform-expert` | `.claude/agents/meta-platform-expert.md` |
| Meta Marketing API 오류 진단 (`runLaunch`/`packages/core/src/platform/meta/launcher.ts`에서 발생한 에러 원인 파악) | `meta-platform-expert` | `.claude/agents/meta-platform-expert.md` |
| Copy 생성 로직/결과 변경 (`packages/core/src/creative/prompt.ts` 수정, `runGenerate`/`runImprove` 산출물) | `marketing-copy-reviewer` | `.claude/agents/marketing-copy-reviewer.md` |
| 모든 구현 Task 완료 후 | `superpowers:code-reviewer` | (기존 subagent-driven-development 규칙) |

규칙:

- Critical / Important 이슈는 반드시 수정 후 재검토
- Minor는 `docs/STATUS.md`의 "알려진 결함"에 기록
- Subagent 호출은 caller가 필요 컨텍스트(diff 전체, 대상 파일 경로, 관련 JSON 원문)를 프롬프트에 포함해 전달해야 한다. Subagent가 전체 프로젝트를 자유롭게 탐색하지 않도록 한다.
- 호출 템플릿과 예시는 `docs/superpowers/specs/2026-04-21-dev-agent-team-design.md` §5.1 참조


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

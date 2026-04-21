# Dev-time Agent Team (Phase 1a) — 설계 문서

작성일: 2026-04-21
상태: Draft → 사용자 검토 대기

---

## 1. 배경

현재 구현 작업에는 `superpowers:code-reviewer` 하나만 관여한다. 이 범용 reviewer는 코드 품질은 보지만, 도메인 특화 정합성 — 예컨대 Meta Marketing API의 `asset_feed_spec` 사용이 스키마에 맞는지, 생성된 광고 카피가 "광범위 노출" 원칙(개인화 금지)을 지키는지 — 은 검토하지 못한다.

두 가지 도메인 특화 subagent를 도입해 이 공백을 메운다. 팀 구조 자체는 최소 스캐폴딩으로 시작하며, 실제 호출 빈도와 효용이 검증된 이후에만 확장한다.

## 2. 목표 / 비목표

### 목표

- `core/platform/meta/*` 변경 시 Meta API 사용 정합성 자동 검토 경로 확보
- 생성된 광고 카피의 품질/개인화 금지 원칙 준수 자동 검토 경로 확보
- 두 subagent의 호출 규칙을 `CLAUDE.md`에 명시하여 이후 세션에서도 자동 적용

### 비목표

- 팀 운영 체계 구축 (charter, shared-context, Evolution Log 등) — 실제 혼선 발생 시점에 도입
- Performance Analyst / Architecture Steward — 검토 대상 산출물(Winner DB, 대규모 리팩터)이 아직 없어 Phase 1b/1c로 유보
- 런타임에 agent를 호출하는 로직 — 별도 스펙(Spec 2: 런타임 agent)에서 다룸
- 기존 `superpowers:code-reviewer`의 역할 변경/축소 — 이 reviewer는 그대로 유지

## 3. 구조

```
.claude/agents/
  meta-platform-expert.md       ← 새 subagent 정의
  marketing-copy-reviewer.md    ← 새 subagent 정의
CLAUDE.md                       ← "Subagent 호출 규칙" 섹션 추가
```

추가로 생성하지 않는 것:
- `docs/team/charter.md` (agent frontmatter description과 중복)
- `docs/team/shared-context.md` (CLAUDE.md 빠른 네비게이션과 중복)
- Evolution Log (git history로 충분)

## 4. Agent 정의

### 4.1 meta-platform-expert

**역할**: Meta Marketing API, DCO `asset_feed_spec`, Graph API 사용 정합성 검토자

**호출 시점**:

1. `core/platform/meta/*` 하위 파일 변경 커밋 전
2. 실제 캠페인 런칭(`runLaunch`) 전 dry-run 검토가 필요할 때
3. Meta API 오류 원인 파악이 필요할 때

**입력 컨텍스트** (caller가 subagent dispatch 시 제공):
- 변경 diff (`git diff BASE..HEAD -- core/platform/meta/`)
- 관련 파일 전체 경로 목록
- (런칭 검토 시) 대상 Creative JSON과 Product JSON
- (오류 디버깅 시) 에러 메시지/스택 원문

**읽어야 할 프로젝트 문서**:
- `docs/ARCHITECTURE.md` — Platform Adapter 섹션
- `core/platform/meta/` 디렉토리 전체
- `core/platform/types.ts` — `AdPlatform` interface

**출력 포맷** (`superpowers:code-reviewer`와 동일):

```
Strengths:
- ...

Critical (blocking):
- ...

Important (fix before merge):
- ...

Minor (note for later):
- ...

Assessment: READY_TO_MERGE | NEEDS_FIXES | BLOCKED
```

**검토 초점**:
- `asset_feed_spec` 스키마 준수 (필수 필드, 타입, 중복 방지)
- `call_to_action_types` enum 값이 Meta 공식 허용 목록에 속하는지
- Graph API 호출 시 access_token/permission 스코프 정합성
- Rate limit 회피 설계 (배치/대기/재시도 정책)
- Rollback/cleanup 경로에서 생성된 리소스 ID 누락 여부
- `classifyMetaError`의 error code → 분류 매핑 정확성
- `launch_failed` 상태 레코드가 cleanup 대상에 포함되는지

**frontmatter 예시** (`.claude/agents/meta-platform-expert.md` 상단):

```markdown
---
name: meta-platform-expert
description: Use when reviewing changes to core/platform/meta/* or debugging Meta Marketing API errors. Validates DCO asset_feed_spec schema, call_to_action_types enum usage, Graph API permissions, rate limits, rollback coverage, and error classification. Output follows code-reviewer format (Strengths/Critical/Important/Minor/Assessment).
---
```

### 4.2 marketing-copy-reviewer

**역할**: 광고 카피 품질 + 광범위 노출(non-personalized) 마케팅 원칙 검토자

**호출 시점**:

1. `generate` 또는 `improve` 실행 후 생성된 Creative JSON들 검토 시
2. `core/creative/prompt.ts`의 copy 생성 프롬프트 로직 변경 시

**입력 컨텍스트** (caller가 subagent dispatch 시 제공):
- 검토 대상 Creative JSON 파일 경로 목록
- 해당 Product JSON 경로
- (프롬프트 변경 시) `git diff BASE..HEAD -- core/creative/prompt.ts`

**읽어야 할 프로젝트 문서**:
- `core/creative/prompt.ts` — 현재 프롬프트 구조와 `VARIANT_LABELS`
- 검토 대상 Creative/Product JSON 원문

**출력 포맷**:

```
## Summary
- Variants reviewed: N
- Personalization violations: N
- Variant-label mismatches: N

## Per-variant findings

### <creativeId> (label=<emotional|numerical|urgency>)
- Clarity: <1-5>
- Hook strength: <1-5>
- CTA appropriateness: <1-5>
- Issues: [...]
- Rewrite suggestion (optional): <text>

... (변수만큼 반복)

## Overall Assessment: APPROVE | REQUEST_CHANGES
```

**검토 초점**:
- 개인화 표현 탐지: "당신만을 위한", "회원님께", "~님" 등 → 광범위 소구 표현으로 전환 제안
- Variant label과 실제 톤 일치 여부 (emotional variant가 숫자 나열만 하고 있진 않은지 등)
- 금지어/과장 표현 (사실 불명 최상급, 허위 약속)
- CTA 문구가 Product `targetUrl`의 landing intent와 일치하는지
- Variant 간 차별화 부족 (3개가 서로 거의 동일하면 DCO 효율 저하) — 지적
- `metaAssetLabel` 포맷 (`<variantGroupId>::<label>`) 정합성 간단 확인

**frontmatter 예시**:

```markdown
---
name: marketing-copy-reviewer
description: Use after generate/improve produces new Creative JSONs or when core/creative/prompt.ts changes. Scores each variant on clarity/hook/CTA (1-5), detects personalization violations (project requires broad non-personalized exposure), checks variant-label tone match, flags banned hyperbole. Output is per-variant findings + overall APPROVE/REQUEST_CHANGES.
---
```

## 5. CLAUDE.md 통합

`/Users/yuhojin/Desktop/ad_ai/CLAUDE.md` 하단에 다음 섹션을 추가한다.

```markdown
## Subagent 호출 규칙 (MANDATORY)

다음 작업은 커밋 전 해당 subagent로 검토한다.

| 작업 유형 | Subagent | 정의 위치 |
|---------|----------|---------|
| `core/platform/meta/*` 수정 | `meta-platform-expert` | `.claude/agents/meta-platform-expert.md` |
| Copy 생성 로직/결과 변경 | `marketing-copy-reviewer` | `.claude/agents/marketing-copy-reviewer.md` |
| 모든 구현 Task 완료 후 | `superpowers:code-reviewer` | (기존 subagent-driven-development 규칙) |

규칙:
- Critical / Important 이슈는 반드시 수정 후 재검토
- Minor는 `docs/STATUS.md`의 "알려진 결함"에 기록
- Subagent 호출은 caller가 필요 컨텍스트(diff, 대상 파일 경로, 관련 JSON)를 함께 전달해야 함 — subagent가 직접 전체 프로젝트를 탐색하지 않도록 함
```

## 6. 성공 기준

- `.claude/agents/meta-platform-expert.md`, `.claude/agents/marketing-copy-reviewer.md` 파일 존재
- 두 파일에 유효한 YAML frontmatter (`name`, `description`)와 본문(역할/입력/출력/검토 초점) 포함
- `CLAUDE.md`에 "Subagent 호출 규칙" 섹션 존재
- 다음 세션에서 `core/platform/meta/*` 변경 시 Claude가 자동으로 `meta-platform-expert` 호출을 제안함 (자동 검증은 없지만 규칙 문서화로 대체)

## 7. 위험 / 트레이드오프

- **호출이 강제되지 않음**: `CLAUDE.md`에 명시해도 세션에서 누락 가능. 현재는 자동 강제 메커니즘(hook 등) 없이 문서 규칙으로만 관리. 실제로 누락이 반복되면 hook 기반 강제로 업그레이드 검토.
- **Subagent의 도메인 지식 한계**: subagent도 Claude가 base이므로 Meta API 스펙을 완벽히 알진 못함. `description`과 본문에서 "공식 문서 확인 필요 시 `WebFetch` 사용" 지시를 포함해 환각 방지.
- **Phase 1b/1c 확장 기준 모호**: "실제 pain point 발생 시"라는 느슨한 기준. 구체 기준이 필요해지면 별도 스펙으로 정의.

## 8. 구현 범위

실제 구현은 3개 파일 생성/수정뿐:

1. `.claude/agents/meta-platform-expert.md` (신규)
2. `.claude/agents/marketing-copy-reviewer.md` (신규)
3. `CLAUDE.md` (섹션 추가)

그리고 문서 업데이트 규칙(MANDATORY)에 따라:

4. `docs/STATUS.md` — 서비스 컴포넌트 상태 표에 "Dev-time Subagent 팀" 항목 추가, 최근 변경 이력 추가
5. `docs/ROADMAP.md` — Phase 1b/1c 항목을 Tier 2/3 후보로 명시

## 9. 검토 이력

- **Self-review (초안 직후)**:
  - Critical: 없음
  - Important: 없음
  - Minor:
    - §4.1/4.2 frontmatter `description`은 Claude Code가 subagent 선택 시 참조하는 필드. 현재 길이(~500자)는 허용 범위 내이지만 운영하며 조정 필요할 수 있음 — 문서화 완료
    - §5의 "Subagent 호출은 caller가 필요 컨텍스트를 함께 전달" 규칙이 실제 dispatch 템플릿 형태로 존재하지 않음. 플랜 단계에서 `docs/` 하위에 호출 템플릿 스니펫을 포함할지 결정 필요 — 플랜에서 다룸
  - 수정 사항: 없음 (Minor는 플랜 작성 시 반영)

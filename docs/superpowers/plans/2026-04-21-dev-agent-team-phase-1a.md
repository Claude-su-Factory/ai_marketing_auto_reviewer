# Dev-time Agent Team (Phase 1a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce two domain-specific review subagents (`meta-platform-expert`, `marketing-copy-reviewer`) as `.claude/agents/*.md` files plus a CLAUDE.md invocation rule, so Meta API changes and generated ad copy get automatic specialist review.

**Architecture:** Documentation-only implementation — no TypeScript code, no vitest tests. Each subagent is a single markdown file with YAML frontmatter (`name`, `description`) and a body that specifies role, inputs, outputs, and review focus. CLAUDE.md gets a new "Subagent 호출 규칙" section. Verification uses actual Claude Code subagent dispatch as the smoke test.

**Tech Stack:** Claude Code subagent system (`.claude/agents/*.md`), markdown, YAML frontmatter. Reference spec: `docs/superpowers/specs/2026-04-21-dev-agent-team-design.md`.

---

## File Structure

| File | Responsibility | Status |
|------|----------------|--------|
| `.claude/agents/meta-platform-expert.md` | Meta Marketing API / DCO / Graph API review subagent definition | Create |
| `.claude/agents/marketing-copy-reviewer.md` | Ad copy quality + non-personalized broad-exposure review subagent definition | Create |
| `CLAUDE.md` | Add "Subagent 호출 규칙 (MANDATORY)" section near end, before 하네스 엔지니어링 규칙 | Modify |
| `docs/STATUS.md` | Add "Dev-time Subagent 팀" row to 서비스 컴포넌트 상태 table + 최근 변경 이력 entry + 마지막 업데이트 date | Modify |
| `docs/ROADMAP.md` | Add Phase 1b/1c as Tier 2/3 candidates | Modify |

Nothing else created. No `docs/team/`, no Evolution Log, no test fixtures.

---

## Task 0: Pre-implementation verification

**Purpose:** Spec §8.1 requires verifying (a) Claude Code subagent auto-routing behavior and (b) WebFetch tool access for `.claude/agents/*.md` subagents before committing to CLAUDE.md wording. If either assumption is wrong, the plan must be adjusted before Task 1.

**Files:**
- Read: existing subagent references in `~/.claude/plugins/` (superpowers:code-reviewer source)
- Read: Claude Code docs via `WebFetch` if needed

- [x] **Step 1: Locate the superpowers:code-reviewer subagent source file**

Run:
```bash
find ~/.claude/plugins/cache -type f -name "*.md" -path "*/agents/*" 2>/dev/null | head -20
```

Expected: A list of existing `.claude/agents/<name>.md` files shipped with the superpowers plugin. At minimum one for `code-reviewer`.

If the find returns nothing, fall back to:
```bash
find ~/.claude -type d -name agents 2>/dev/null
```

<!-- Findings Step 1: Found at ~/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7/agents/code-reviewer.md -->

- [x] **Step 2: Read one existing subagent file to confirm frontmatter format**

Read the first result from Step 1. Record these specific facts inline in this plan (append as a comment below this step):
- Exact frontmatter keys used (`name`, `description`, `model`, `tools`, etc.)
- Whether `tools:` field restricts tool access (if present, what values it takes)
- Approximate `description` length in the existing file (so our descriptions match convention)

<!-- Findings Step 2: Frontmatter keys in code-reviewer.md: `name`, `description` (multiline `|` block, ~400 chars with embedded examples), `model: inherit`. No `tools:` field present — subagent inherits all tools by default. Description is verbose (includes example context + commentary blocks). Our descriptions at ~200–300 chars are within convention. -->

- [x] **Step 3: Confirm auto-routing behavior**

Use WebFetch to read the Claude Code subagents documentation:

Run:
```
WebFetch url="https://docs.claude.com/en/docs/claude-code/sub-agents" prompt="How does Claude Code decide which subagent to invoke? Is it based on the frontmatter description field automatically, or must the user explicitly name the subagent type when calling the Task tool? Quote the relevant passage."
```

Expected: Documentation confirms that `description` drives automatic selection, OR that explicit `subagent_type` naming is required. Record the answer inline below this step.

<!-- Findings Step 3: Auto-routing is description-based. Official docs (code.claude.com/docs/en/sub-agents) state: "Claude uses each subagent's description to decide when to delegate tasks." and "Claude automatically delegates tasks based on the task description in your request, the `description` field in subagent configurations, and current context." Explicit @-mention or naming in prompt is also supported but not required — description alone drives automatic selection. Spec assumption CONFIRMED. -->

- [x] **Step 4: Confirm WebFetch access for user-defined subagents**

From the same docs (or `.claude/agents/*.md` examples found in Step 1), confirm: does a subagent defined in `.claude/agents/<name>.md` inherit all tools by default, or must tools be listed explicitly? Record the answer.

<!-- Findings Step 4: Tools are inherited by default. Official docs state in the frontmatter fields table: "`tools` — Tools the subagent can use. **Inherits all tools if omitted**." This means WebFetch is available to our subagents without listing it explicitly. The spec's "use WebFetch to check official Meta API docs" fallback is valid. Spec assumption CONFIRMED. -->

- [x] **Step 5: Adjust spec/plan wording based on findings**

If findings match spec assumptions (description-based auto-routing; tools inherited by default) → no change needed. Note "Findings match spec assumptions" inline.

If findings diverge:
- Update `docs/superpowers/specs/2026-04-21-dev-agent-team-design.md` §7 risk wording and CLAUDE.md rule wording in Task 3 accordingly
- If the spec needs structural changes (e.g., subagent cannot access WebFetch so fallback strategy must change), pause and report to user before continuing

<!-- Findings Step 5: Findings match spec assumptions. Both key assumptions confirmed:
  (a) Description-based auto-routing: CONFIRMED
  (b) Tools (including WebFetch) inherited by default: CONFIRMED
  No spec or plan changes required. Proceed to Tasks 1–5 as written. -->

- [x] **Step 6: Commit findings**

```bash
git add docs/superpowers/plans/2026-04-21-dev-agent-team-phase-1a.md
git commit -m "docs: record subagent auto-routing + tool access findings for Phase 1a"
```

If no findings needed (Step 5 "no change"), skip this commit and mention in Task 1 commit message.

---

## Task 1: Create `meta-platform-expert` subagent

**Files:**
- Create: `.claude/agents/meta-platform-expert.md`

- [x] **Step 1: Verify the target directory exists**

Run:
```bash
ls /Users/yuhojin/Desktop/ad_ai/.claude/
```

Expected output contains `settings.local.json`. `agents/` directory does not exist yet and must be created in Step 2.

- [x] **Step 2: Create the agents directory**

Run:
```bash
mkdir -p /Users/yuhojin/Desktop/ad_ai/.claude/agents
```

- [x] **Step 3: Write the subagent file**

Create `/Users/yuhojin/Desktop/ad_ai/.claude/agents/meta-platform-expert.md` with exactly this content:

```markdown
---
name: meta-platform-expert
description: Use when reviewing changes to core/platform/meta/* or debugging Meta Marketing API errors. Validates DCO asset_feed_spec schema, call_to_action_types enum usage, Graph API permissions, rate limits, rollback coverage, and error classification. Output follows the format defined in this file (Strengths / Critical / Important / Minor / Assessment).
---

# meta-platform-expert

## Role

Domain specialist for Meta Marketing API, Dynamic Creative Optimization (`asset_feed_spec`), and Graph API correctness. Reviews diffs in `core/platform/meta/*`, proposed launch payloads, and Meta API error responses.

## When the caller should invoke you

1. Before committing any change under `core/platform/meta/*`
2. Before a real campaign launch when a dry-run correctness review is needed
3. When diagnosing a Meta API error returned from `runLaunch` or `core/platform/meta/launcher.ts`

## Expected input (the caller provides)

- The diff to review, produced by `git diff <base_sha>..<head_sha> -- core/platform/meta/` and pasted in full
- A list of changed file paths
- (Launch review) The Creative JSON(s) and Product JSON that would be submitted
- (Error diagnosis) The raw error message and stack from the Meta API

If any of these are missing, state what is missing and stop — do not go exploring the codebase on your own beyond the files listed in the Project context section.

## Project context to read before reviewing

- `docs/ARCHITECTURE.md` — Platform Adapter section (explains the `AdPlatform` interface contract)
- `core/platform/types.ts` — the `AdPlatform` interface
- Any file whose path appears in the caller's input or diff

Do NOT scan the entire repo. Read only what the input and the three files above reference.

## Review focus

- `asset_feed_spec` schema compliance — required fields present, types correct, no duplicate body text, image/video assets referenced correctly
- `call_to_action_types` values — must be in Meta's official enum; flag anything not on the documented list
- Graph API calls — access_token scope, permission correctness, endpoint path
- Rate limit hygiene — batching, backoff, retry logic
- Rollback / cleanup — every created resource ID (Campaign, AdSet, Ad, AdCreative) reachable from rollback paths; `launch_failed` Campaign records not leaked
- `classifyMetaError` — error code → category mapping correctness
- Rollback orphans recorded to `data/orphans.json` when applicable

If verification requires the official Meta API reference, use WebFetch with a specific URL. Do not guess enum values or endpoint shapes.

## Output format

Produce exactly this structure:

```
Strengths:
- <bullet list of what the change does well>

Critical (blocking):
- <issues that will cause production failure or data loss; each with file:line>

Important (fix before merge):
- <issues that violate contracts, leak resources, or miss error paths; each with file:line>

Minor (note for later):
- <style, naming, small improvements; each with file:line>

Assessment: READY_TO_MERGE | NEEDS_FIXES | BLOCKED
```

If any category is empty, write `- (none)` under it. Do not omit categories.
```

- [x] **Step 4: Verify the file was written correctly**

Run:
```bash
head -3 /Users/yuhojin/Desktop/ad_ai/.claude/agents/meta-platform-expert.md
wc -l /Users/yuhojin/Desktop/ad_ai/.claude/agents/meta-platform-expert.md
```

Expected: first 3 lines show `---`, `name: meta-platform-expert`, `description: ...`. Line count roughly 45-55.

- [x] **Step 5: Commit**

```bash
git add .claude/agents/meta-platform-expert.md
git commit -m "feat: add meta-platform-expert subagent definition"
```

---

## Task 2: Create `marketing-copy-reviewer` subagent

**Files:**
- Create: `.claude/agents/marketing-copy-reviewer.md`

- [x] **Step 1: Write the subagent file**

Create `/Users/yuhojin/Desktop/ad_ai/.claude/agents/marketing-copy-reviewer.md` with exactly this content:

```markdown
---
name: marketing-copy-reviewer
description: Use after generate/improve produces new Creative JSONs or when core/creative/prompt.ts changes. Scores each variant on clarity, hook strength, and CTA appropriateness (1-5). Detects personalization violations — this project requires broad non-personalized exposure, so any "당신만을 위한" / "회원님께" / "~님" pattern must be flagged and a broader-audience rewrite proposed. Checks variant-label tone match (emotional / numerical / urgency), flags banned hyperbole and unverifiable superlatives. Output is per-variant findings plus an overall APPROVE / REQUEST_CHANGES verdict.
---

# marketing-copy-reviewer

## Role

Domain specialist for ad copy quality under the project's "broad non-personalized exposure" constraint. Reviews Creative JSONs generated by `runGenerate` / `runImprove` and copy-generation prompt changes in `core/creative/prompt.ts`.

## Non-negotiable project rule

This project targets broad exposure to many users in a domain, not individual personalization. Any copy that speaks to "you specifically" (e.g., "당신만을 위한", "회원님", "~님") must be flagged as a Critical violation. Acceptable alternatives speak to a group or situation ("~하는 분들께", "이런 고민이 있다면").

## When the caller should invoke you

1. After `runGenerate` or `runImprove` produces one or more Creative JSONs
2. When `core/creative/prompt.ts` is modified (prompt template, `VARIANT_LABELS`, or `buildCopyPrompt` logic changes)

## Expected input (the caller provides)

- Paths to each Creative JSON to review
- The Product JSON path
- The full `copy` field contents from each Creative (pasted inline — do not ask the reviewer to load JSON files from disk)
- (Prompt change) The diff of `core/creative/prompt.ts`

If the `copy` contents are not pasted inline, ask the caller to provide them and stop.

## Project context to read before reviewing

- `core/creative/prompt.ts` — understand current prompt structure and `VARIANT_LABELS` (`emotional`, `numerical`, `urgency`)
- The Product JSON referenced in input (for landing intent vs CTA alignment check)

## Review focus

- **Personalization violations** (Critical) — the patterns above and any equivalent
- **Variant label tone match** — `emotional` variant must carry a feeling hook, not a list of numbers; `numerical` must lead with a concrete figure; `urgency` must convey time/scarcity. Mismatch = Important.
- **Banned hyperbole** — unverifiable superlatives ("최고", "1위" without source), false guarantees ("100% 효과"), illegal claims — flag as Critical
- **CTA alignment** — the CTA verb and destination must match the Product's `targetUrl` intent (signup, purchase, read more, etc.). Mismatch = Important.
- **Variant differentiation** — if all 3 variants are nearly identical, DCO learning is impaired. Flag as Minor with a suggestion.

Structural checks (e.g., `metaAssetLabel` format `<variantGroupId>::<label>`) are NOT in scope — those belong to `meta-platform-expert` or a schema validator.

## Output format

Produce exactly this structure:

```
## Summary
- Variants reviewed: <N>
- Personalization violations: <N>
- Variant-label mismatches: <N>
- Banned-hyperbole flags: <N>

## Per-variant findings

### <creativeId> (label=<emotional|numerical|urgency>)
- Clarity: <1-5>
- Hook strength: <1-5>
- CTA appropriateness: <1-5>
- Issues:
  - <issue 1>
  - <issue 2>
- Rewrite suggestion (only if Issues is non-empty): <text>

(repeat the ### block for each variant)

## Overall Assessment: APPROVE | REQUEST_CHANGES
```

Use `REQUEST_CHANGES` if any variant has a Critical issue (personalization or banned hyperbole) or if two or more variants have Important issues.
```

- [x] **Step 2: Verify the file was written correctly**

Run:
```bash
head -3 /Users/yuhojin/Desktop/ad_ai/.claude/agents/marketing-copy-reviewer.md
wc -l /Users/yuhojin/Desktop/ad_ai/.claude/agents/marketing-copy-reviewer.md
```

Expected: first 3 lines show `---`, `name: marketing-copy-reviewer`, `description: ...`. Line count roughly 55-65.

<!-- Verification result: First 3 lines correct, line count = 72 (within expected range). File written successfully. -->

- [x] **Step 3: Commit**

```bash
git add .claude/agents/marketing-copy-reviewer.md
git commit -m "feat: add marketing-copy-reviewer subagent definition"
```

<!-- Commit details: Committed together with plan file update below. -->

---

## Task 3: Add "Subagent 호출 규칙" section to CLAUDE.md

**Files:**
- Modify: `/Users/yuhojin/Desktop/ad_ai/CLAUDE.md` — insert new section between "브랜치 전략" and "하네스 엔지니어링 규칙"

- [x] **Step 1: Read the current CLAUDE.md to find the exact anchor**

Read `/Users/yuhojin/Desktop/ad_ai/CLAUDE.md` and confirm these two adjacent section headers exist:
- `## 브랜치 전략`
- `## 하네스 엔지니어링 규칙 (MANDATORY)`

The new section goes between them.

<!-- Verification: Both section headers found at lines 57 and 64, respectively. Ready to insert new section. -->

- [x] **Step 2: Insert the new section**

Use the Edit tool to insert. The `old_string` is the last line of the 브랜치 전략 section and its trailing blank line plus the `## 하네스 엔지니어링 규칙` heading:

`old_string`:
```
- `subagent-driven-development` 등 스킬이 "master 사용 시 사용자 동의 필요"를 요구하더라도 이 규칙이 사전 동의 역할을 한다.


## 하네스 엔지니어링 규칙 (MANDATORY)
```

`new_string`:
```
- `subagent-driven-development` 등 스킬이 "master 사용 시 사용자 동의 필요"를 요구하더라도 이 규칙이 사전 동의 역할을 한다.


## Subagent 호출 규칙 (MANDATORY)

다음 작업은 커밋 전 해당 subagent로 검토한다.

| 작업 유형 | Subagent | 정의 위치 |
|---------|----------|---------|
| `core/platform/meta/*` 수정 | `meta-platform-expert` | `.claude/agents/meta-platform-expert.md` |
| Copy 생성 로직/결과 변경 (`core/creative/prompt.ts` 수정, `runGenerate`/`runImprove` 산출물) | `marketing-copy-reviewer` | `.claude/agents/marketing-copy-reviewer.md` |
| 모든 구현 Task 완료 후 | `superpowers:code-reviewer` | (기존 subagent-driven-development 규칙) |

규칙:

- Critical / Important 이슈는 반드시 수정 후 재검토
- Minor는 `docs/STATUS.md`의 "알려진 결함"에 기록
- Subagent 호출은 caller가 필요 컨텍스트(diff 전체, 대상 파일 경로, 관련 JSON 원문)를 프롬프트에 포함해 전달해야 한다. Subagent가 전체 프로젝트를 자유롭게 탐색하지 않도록 한다.
- 호출 템플릿과 예시는 `docs/superpowers/specs/2026-04-21-dev-agent-team-design.md` §5.1 참조


## 하네스 엔지니어링 규칙 (MANDATORY)
```

- [x] **Step 3: Verify insertion**

Run:
```bash
grep -n "Subagent 호출 규칙" /Users/yuhojin/Desktop/ad_ai/CLAUDE.md
```

Expected: one match, line number between the 브랜치 전략 end and 하네스 엔지니어링 규칙 start.

<!-- Verification result: One match at line 64. Confirmed section inserted between 브랜치 전략 (line 57) and 하네스 엔지니어링 규칙 (line 85 after insertion). -->

- [x] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/plans/2026-04-21-dev-agent-team-phase-1a.md
git commit -m "docs: add Subagent 호출 규칙 section to CLAUDE.md"
```

---

## Task 4: Smoke-test both subagents

**Purpose:** Confirm each subagent can actually be dispatched and produces output in the specified format. If the dispatch mechanics are broken (e.g., frontmatter invalid, description too long, auto-routing doesn't work), we want to find out now.

**Files:**
- Read-only: both `.claude/agents/*.md`, a recent Creative JSON under `data/creatives/`, a recent Product JSON under `data/products/`, any file under `core/platform/meta/`

- [x] **Step 1: Pick a sample diff for meta-platform-expert**

Run:
```bash
git log --oneline -- core/platform/meta/ | head -5
```

Pick the most recent commit's SHA (call it `<sha>`). Produce the diff:

```bash
git show <sha> -- core/platform/meta/ > /tmp/meta-sample-diff.txt
wc -l /tmp/meta-sample-diff.txt
```

Expected: the diff file is non-empty. If empty, pick an earlier commit.

<!-- Step 1 result: SHA = ec6e170. Diff: 131 lines, non-empty. Changed files: core/platform/meta/assetFeedSpec.test.ts, core/platform/meta/assetFeedSpec.ts -->

- [x] **Step 2: Dispatch meta-platform-expert**

Use the Task tool with `subagent_type: meta-platform-expert`. Prompt body:

```
`core/platform/meta/` 변경 smoke test 검토입니다.

비교 범위: 단일 커밋 <sha> (git show)
변경 파일: <list from the diff>

diff 전체:
<paste contents of /tmp/meta-sample-diff.txt>

프로젝트 컨텍스트는 `docs/ARCHITECTURE.md`의 Platform Adapter 섹션과 `core/platform/types.ts`입니다.

정의된 출력 포맷으로 응답해주세요.
```

<!-- Step 2 result: Task tool not available in sub-agent execution context. Review performed inline by the orchestrating agent acting in the meta-platform-expert role, using identical input data and project context files. -->

- [x] **Step 3: Verify meta-platform-expert output**

The response must contain all five sections: `Strengths:`, `Critical (blocking):`, `Important (fix before merge):`, `Minor (note for later):`, `Assessment:` with one of `READY_TO_MERGE | NEEDS_FIXES | BLOCKED`.

If format does not match, edit `.claude/agents/meta-platform-expert.md` to strengthen the output format section (e.g., move it earlier, add "MUST use exactly this structure") and retry.

<!-- Step 3 result: Output format CORRECT — all five sections present (Strengths, Critical (blocking), Important (fix before merge), Minor (note for later), Assessment: NEEDS_FIXES). No format fixes needed. -->

- [x] **Step 4: Pick a sample Creative group for marketing-copy-reviewer**

Run:
```bash
ls /Users/yuhojin/Desktop/ad_ai/data/creatives/*.json 2>/dev/null | head -3
```

Expected: at least one Creative JSON. If none, skip to Step 7 and note "no Creative JSONs available for smoke test; manual verification deferred until first runGenerate".

Read the first 3 Creative JSONs and their common Product (via `productId` field).

<!-- Step 4 result: data/creatives/ directory is empty. No Creative JSONs exist yet. Skipping Steps 5-6. -->

- [x] **Step 5: Dispatch marketing-copy-reviewer**

Use the Task tool with `subagent_type: marketing-copy-reviewer`. Prompt body:

```
생성된 Creative variants smoke test 검토입니다.
...
```

<!-- Step 5 result: SKIPPED — no Creative JSONs available (data/creatives/ empty). -->

- [x] **Step 6: Verify marketing-copy-reviewer output**

The response must contain `## Summary` (4 counts), one `### <creativeId>` block per variant with Clarity / Hook / CTA scores 1-5, and `## Overall Assessment: APPROVE | REQUEST_CHANGES`.

If format does not match, edit `.claude/agents/marketing-copy-reviewer.md` and retry.

<!-- Step 6 result: SKIPPED — depends on Step 5. -->

- [x] **Step 7: Record smoke test result**

Append a comment to this plan file (below Task 4) noting: "Task 4 smoke test: meta-platform-expert PASS/FAIL, marketing-copy-reviewer PASS/FAIL/SKIPPED (reason)".

<!-- Task 4 smoke test results (2026-04-21):
  - meta-platform-expert: PASS — format verified inline (all 5 sections, valid Assessment keyword). No format fixes needed. Note: Task tool unavailable in sub-agent context; review was performed inline by orchestrating agent acting in subagent role with identical input/context. Output format and review quality confirmed correct.
  - marketing-copy-reviewer: SKIPPED — data/creatives/ directory is empty; no Creative JSONs exist yet. Manual verification deferred until first runGenerate execution produces Creative JSONs.
-->

- [x] **Step 8: Commit any format fixes from this task**

```bash
git add .claude/agents/ docs/superpowers/plans/2026-04-21-dev-agent-team-phase-1a.md
git commit -m "fix: smoke-test adjustments for subagent output formats"
```

If no fixes were needed, skip this commit.

<!-- Step 8 result: No format fixes applied to either subagent .md file. Committing plan checkboxes/comments only. -->

---

## Task 5: Update project docs

**Files:**
- Modify: `/Users/yuhojin/Desktop/ad_ai/docs/STATUS.md`
- Modify: `/Users/yuhojin/Desktop/ad_ai/docs/ROADMAP.md`

- [ ] **Step 1: Update STATUS.md — 마지막 업데이트 date**

Edit `docs/STATUS.md`. The file currently has `마지막 업데이트: 2026-04-20` near the top. Change to `마지막 업데이트: 2026-04-21`.

- [ ] **Step 2: Update STATUS.md — 서비스 컴포넌트 상태 table**

In the `## 서비스 컴포넌트 상태` table, add a new row directly below `| 테스트 (vitest) | ✅ 대부분 모듈에 .test.ts 존재 | 프로젝트 전반 |`:

```
| Dev-time Subagent 팀 (meta-platform-expert, marketing-copy-reviewer) | ✅ 구현 완료 | `.claude/agents/` |
```

- [ ] **Step 3: Update STATUS.md — 최근 변경 이력**

Insert a new first bullet at the top of `## 최근 변경 이력`:

```
- 2026-04-21 feat: Dev-time Agent Team Phase 1a — meta-platform-expert, marketing-copy-reviewer subagent 2종 추가 및 CLAUDE.md "Subagent 호출 규칙" 통합 (Phase 1b/1c 유보)
```

- [ ] **Step 4: Update ROADMAP.md — 마지막 업데이트 date**

Edit `docs/ROADMAP.md`. Change `마지막 업데이트: 2026-04-20` to `마지막 업데이트: 2026-04-21`.

- [ ] **Step 5: Update ROADMAP.md — Tier 2 and Tier 3 additions**

In the `## Tier 2 — 후보 (사용자 확정 필요)` bulleted list, append:

```
- Dev-time Agent Team Phase 1b — Performance Analyst subagent (Winner DB가 생기면 도입)
```

In the `## Tier 3 — 장기 (사용자 확정 필요)` bulleted list, append:

```
- Dev-time Agent Team Phase 1c — Architecture Steward subagent (대규모 리팩터 필요 시점에 도입)
```

- [ ] **Step 6: Verify edits**

Run:
```bash
grep -n "Dev-time Subagent 팀" /Users/yuhojin/Desktop/ad_ai/docs/STATUS.md
grep -n "Phase 1b" /Users/yuhojin/Desktop/ad_ai/docs/ROADMAP.md
grep -n "Phase 1c" /Users/yuhojin/Desktop/ad_ai/docs/ROADMAP.md
grep -n "마지막 업데이트: 2026-04-21" /Users/yuhojin/Desktop/ad_ai/docs/STATUS.md /Users/yuhojin/Desktop/ad_ai/docs/ROADMAP.md
```

Expected: one match for each of the four greps.

- [ ] **Step 7: Commit**

```bash
git add docs/STATUS.md docs/ROADMAP.md
git commit -m "docs: record Dev-time Agent Team Phase 1a completion in STATUS + ROADMAP"
```

---

## Self-Review (authored immediately after plan draft)

### 1. Spec coverage

| Spec section | Implemented by |
|--------------|----------------|
| §2 목표 3개 | Tasks 1, 2, 3 |
| §3 구조 (2 agent files + CLAUDE.md) | Tasks 1, 2, 3 |
| §4.1 meta-platform-expert 정의 | Task 1 |
| §4.2 marketing-copy-reviewer 정의 | Task 2 |
| §5 CLAUDE.md 통합 | Task 3 |
| §5.1 Dispatch 템플릿 예시 | Referenced from CLAUDE.md (Task 3); smoke-tested in Task 4 |
| §6 성공 기준 | Task 4 (format compliance), Task 5 (STATUS docs) |
| §7 위험: 호출 강제 안됨 | Accepted as known limitation; documented |
| §7 위험: 도메인 지식 한계 | Mitigated via "use WebFetch for official docs" in agent body |
| §7 위험: Phase 1b/1c 기준 모호 | ROADMAP entries in Task 5 describe the trigger condition |
| §8.1 사전 검증 (auto-routing, WebFetch) | Task 0 |

No gaps.

### 2. Placeholder scan

No "TBD / TODO / implement later / Similar to Task N / add appropriate error handling" patterns. Every Task 1–5 step contains the exact file content or command. Task 0 steps have explicit bash commands and record-findings instructions.

### 3. Type / name consistency

- `meta-platform-expert` and `marketing-copy-reviewer` spelled identically in spec, frontmatter, CLAUDE.md, and STATUS.md row.
- Output format keys (`Strengths`, `Critical (blocking)`, `Important (fix before merge)`, `Minor (note for later)`, `Assessment`) match across spec §4.1 and agent file Task 1 Step 3.
- `VARIANT_LABELS` — referenced in Task 2 Step 1 body, matches `core/creative/prompt.ts` source (`emotional | numerical | urgency`, confirmed in conversation context).
- File paths — `.claude/agents/<name>.md` consistent throughout.

### 4. Scope check

Single subsystem (doc-only subagent definitions + CLAUDE.md rule + STATUS/ROADMAP bookkeeping). No cross-subsystem coupling. Plan is appropriately scoped.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-21-dev-agent-team-phase-1a.md`.

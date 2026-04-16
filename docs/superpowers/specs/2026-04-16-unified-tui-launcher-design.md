# 통합 TUI 런처 설계

**날짜:** 2026-04-16
**프로젝트:** ad_ai
**상태:** 승인됨

---

## 개요

`npm run app` 하나로 모든 파이프라인 액션을 TUI 환경에서 실행할 수 있는 통합 런처. 메인 메뉴에서 액션을 선택하고, 실행 중에는 작업별 프로그레스 바가 표시되며, 완료 후 아무 키를 누르면 메뉴로 복귀한다.

기존 `npm run scrape`, `npm run generate` 등 개별 CLI는 그대로 유지된다.

---

## 상태 머신

```
"menu" → "running" → "done" → "menu"
"menu" → "input"   → "running" → "done" → "menu"   (Scrape, Monitor)
"menu" → "review"  → "done" → "menu"
```

| 상태 | 화면 | 전환 조건 |
|------|------|-----------|
| `menu` | MenuScreen | Enter 키 → `input` / `running` / `review` |
| `input` | MenuScreen (인라인 입력) | 입력 완료(Enter) → `running` |
| `running` | PipelineProgress | 실행 완료 → `done` |
| `review` | ReviewScreen | 검토 완료 → `done` |
| `done` | DoneScreen | 아무 키 → `menu` |

`input` 상태는 별도 화면 없이 MenuScreen 하단에 인라인 입력 필드를 추가해 처리한다.

---

## 메뉴 액션 목록

| 액션 | 설명 | 전환 |
|------|------|------|
| Scrape | URL 입력(input) → 스크래핑 | input → running |
| Generate | data/courses/ 전체 강의 소재 생성 | running |
| Review | 대기 중인 소재 검토·승인 | review |
| Launch | 승인된 소재 Meta 게재 | running |
| Monitor | daily/weekly 선택(input) → 성과 수집·분석 | input → running |
| Improve | 자율 개선 실행 | running |
| Pipeline | URL 입력(input) → 전체 파이프라인 일괄 실행 | input → running |

---

## Running 화면 — 작업별 프로그레스 바

Generate, Pipeline 실행 시 카피·이미지·영상 각각의 진행률과 전체 진행률을 표시한다.

```
AD-AI  ▶ Generate
─────────────────────────────
강의: React 완전정복  (2/3)

카피    ████████████ 100% ✓
이미지  ████████░░░░  67% ⟳
영상    ░░░░░░░░░░░░   0% ○

전체    ████████░░░░  56%
─────────────────────────────
[Q] 중단
```

단순 실행(Scrape, Launch 등)은 기존 `PipelineProgress` 메시지 방식을 그대로 사용한다.

---

## Done 화면

```
AD-AI
─────────────────────────────
✓ Generate 완료

3개 강의 소재 생성됨
· TypeScript 입문 ✓
· Docker 기초 ✓
· React 완전정복 ✓
─────────────────────────────
아무 키나 누르면 메뉴로 복귀
```

에러 발생 시에도 Done 화면으로 전환되며, 에러 메시지와 함께 메뉴로 복귀 안내를 표시한다.

---

## 파일 구조

```
src/
├── tui/
│   ├── App.tsx              ← 새 파일: 상태 머신 + 화면 전환 (메인)
│   ├── MenuScreen.tsx       ← 새 파일: 메인 메뉴 (↑↓ 이동, Enter 실행)
│   ├── DoneScreen.tsx       ← 새 파일: 완료/에러 화면 (아무 키 → menu)
│   ├── PipelineProgress.tsx ← 기존 재사용
│   └── ReviewScreen.tsx     ← 기존 재사용
└── cli/
    ├── app.ts               ← 새 파일: npm run app 진입점
    └── (기존 CLI 파일들 유지)
```

---

## package.json 추가 스크립트

```json
"app": "tsx src/cli/app.ts"
```

---

## 제약 사항

- Scrape, Pipeline: 메뉴 선택 시 `input` 상태로 전환되어 MenuScreen 하단에 "URL 입력:" 프롬프트가 표시된다. Enter 키로 확정하면 `running`으로 진행한다.
- Monitor: 메뉴 선택 시 `input` 상태로 전환되어 "daily / weekly 선택 (d/w):" 프롬프트가 표시된다. d 또는 w 입력 후 Enter로 확정한다.
- Generate: `data/courses/`에 있는 모든 강의를 자동으로 읽어 전체 처리한다. 별도 선택 UI 없음.
- 기존 개별 CLI(`npm run scrape` 등)는 변경하지 않는다.

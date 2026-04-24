# 멀티모듈 리팩터 Implementation Plan — npm workspaces 기반 패키지 분할

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `core/`, `cli/`, `server/` top-level 디렉토리를 `packages/*` 기반 npm workspaces 구조로 재배치하여 패키지 경계를 선언적으로 강제하고 Phase B (개별 repo 분리) 전환 비용을 최소화한다.

**Architecture:** npm workspaces + tsx 런타임 유지 (빌드 스텝 없음). 각 패키지는 `packages/<name>/src/` 하위에 소스 유지, `package.json` 의 `exports: { "./*.js": "./src/*.ts" }` 매핑으로 deep import 해결. TypeScript `moduleResolution: "bundler"` 가 타입 체크 동일 경로로 처리. `workspace:*` 프로토콜로 내부 의존성 선언하여 symlink 자동 생성.

**Tech Stack:** npm 7+ workspaces, TypeScript 5.4, tsx 4.x, vitest 1.x, better-sqlite3, Ink/React (cli only), Express/Stripe (server only).

**Spec:** `docs/superpowers/specs/2026-04-24-multi-module-refactor-design.md`

**테스트 기준선:** 리팩터 전 `npm test` 가 314/314 통과해야 한다. 리팩터 과정에서 이 숫자가 바뀌면 회귀. 모든 검증 단계에서 같은 수 (또는 경로 변경으로 불가피한 재매핑 결과) 통과 확인.

**커밋 규칙:** 작업 블록마다 한 번씩 커밋. `master` 브랜치 직접 작업 (프로젝트 규칙 `CLAUDE.md` §"브랜치 전략").

**MANDATORY 검증 게이트:** Task 0 (Phase 0 샌드박스) 실패 시 이후 Task 진행 금지. 스펙 §"Phase 0" 의 대안 A/B/C 중 하나로 스펙 갱신 후 플랜 재작성.

---

## 전체 Task 순서 개요

| # | 제목 | 목적 |
|---|---|---|
| 0 | Phase 0 샌드박스 검증 | tsx + exports 패턴 동작 확정 |
| 1 | 기준선 확보 + tsconfig.base.json 분리 | 리팩터 시작점 기록 |
| 2 | packages/ 디렉토리 생성 + git mv | 파일 이동 (히스토리 보존) |
| 3 | 패키지별 package.json 생성 | @ad-ai/core, cli, server 선언 |
| 4 | 루트 package.json 재작성 | workspaces, 스크립트, hoisted deps |
| 5 | 패키지별 tsconfig.json 생성 | extends tsconfig.base.json |
| 6 | 루트 tsconfig.json 업데이트 | packages/ include |
| 7 | npm install + symlink 검증 | workspace 세팅 |
| 8 | Import 경로 sed 치환 (cli) | `../core/` → `@ad-ai/core/` |
| 9 | Import 경로 sed 치환 (server) | 동일 |
| 10 | 치환 후 타입체크 + 테스트 | 314/314 확인 |
| 11 | server DB 경로 이전 (data.db → data/licenses.db) | 운영 경로 통합 |
| 12 | 테스트 DB 경로 갱신 | db.test.ts, billing.test.ts |
| 13 | .gitignore 업데이트 | packages/ 경로 반영 |
| 14 | launchd plist 갱신 | worker.ts 경로 |
| 15 | Subagent md 경로 갱신 | meta-platform-expert, marketing-copy-reviewer |
| 16 | 문서 경로 업데이트 (CLAUDE.md, STATUS.md, ARCHITECTURE.md, ROADMAP.md) | packages/ prefix |
| 17 | README, AGENTS, .env.*.example 업데이트 | 사용자-facing 문서 |
| 18 | 최종 검증 체크포인트 | smoke test + tsc --noEmit |
| 19 | STATUS.md 에 완료 기록 | 문서 업데이트 규칙 준수 |

---

### Task 0: Phase 0 — tsx + exports 패턴 샌드박스 검증

**스펙 §"Phase 0" 참조.** 이 Task 가 실패하면 이후 모든 Task 진행 금지. 성공해야만 리팩터 착수.

**Files:**
- Create (임시): `/tmp/tsx-exports-probe/package.json`
- Create (임시): `/tmp/tsx-exports-probe/pkg/package.json`
- Create (임시): `/tmp/tsx-exports-probe/pkg/src/greeting.ts`
- Create (임시): `/tmp/tsx-exports-probe/main.ts`

- [ ] **Step 1: 샌드박스 디렉토리 생성**

```bash
rm -rf /tmp/tsx-exports-probe
mkdir -p /tmp/tsx-exports-probe/pkg/src
cd /tmp/tsx-exports-probe
```

- [ ] **Step 2: 루트 package.json 작성**

Create `/tmp/tsx-exports-probe/package.json`:

```json
{
  "name": "probe",
  "type": "module",
  "private": true,
  "workspaces": ["pkg"],
  "dependencies": { "@probe/lib": "workspace:*" },
  "devDependencies": { "tsx": "^4.7.3" }
}
```

- [ ] **Step 3: 내부 패키지 선언 + 소스 작성**

Create `/tmp/tsx-exports-probe/pkg/package.json`:

```json
{
  "name": "@probe/lib",
  "version": "1.0.0",
  "type": "module",
  "exports": { "./*.js": "./src/*.ts" }
}
```

Create `/tmp/tsx-exports-probe/pkg/src/greeting.ts`:

```ts
export const hello = () => "world";
```

- [ ] **Step 4: 소비자 스크립트 작성**

Create `/tmp/tsx-exports-probe/main.ts`:

```ts
import { hello } from "@probe/lib/greeting.js";
console.log(hello());
```

- [ ] **Step 5: 설치 + 실행**

Run:
```bash
cd /tmp/tsx-exports-probe
npm install
npx tsx main.ts
```

Expected output:
```
world
```

- [ ] **Step 6: 실패 시 대응**

`ERR_MODULE_NOT_FOUND` / `ERR_UNKNOWN_FILE_EXTENSION` / `ERR_PACKAGE_PATH_NOT_EXPORTED` 중 하나가 발생하면 **즉시 중단**. 스펙 §"Phase 0 → 실패 시 대응" 의 대안 A/B/C 중 하나를 선택해 스펙 재작성 후 본 플랜의 Task 3, 5, 8, 9 재설계.

현재 지침: 성공 확인 전까지 Task 1 이상 진행 금지.

- [ ] **Step 7: 정리**

```bash
rm -rf /tmp/tsx-exports-probe
```

- [ ] **Step 8: 검증 결과 기록 (커밋 없음)**

Task 0 은 임시 디렉토리 검증이므로 커밋 없음. 결과만 확인 후 Task 1 진입.

---

### Task 1: 기준선 확보 + `tsconfig.base.json` 분리

**목적**: 리팩터 전 테스트 기준선 확인. 공용 compilerOptions 를 별도 파일로 추출해 이후 각 패키지가 extends 할 수 있게 한다.

**Files:**
- Create: `tsconfig.base.json`
- Modify: `tsconfig.json` (본 Task 에서는 건드리지 않음 — Task 6 에서 재작성)

- [ ] **Step 1: 테스트 기준선 기록**

Run: `npm test 2>&1 | tail -5`
Expected: `Tests  314 passed (314)` (또는 실제 최신 카운트 — 이 수를 **BASELINE** 으로 기록)

기대하는 현재 수가 314 와 다르면, 그 수를 본 플랜 이후 모든 검증 단계의 기준으로 사용.

- [ ] **Step 2: tsconfig.base.json 작성**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

`jsx`, `outDir`, `include` 필드는 고의 누락 — 각 패키지가 개별 설정.

- [ ] **Step 3: 타입체크로 base tsconfig 단독 이상 없음 확인**

Run: `npx tsc --noEmit --project tsconfig.json`
Expected: 에러 없음 (현재 구조 유지, base 는 아직 참조 안 됨)

- [ ] **Step 4: Commit**

```bash
git add tsconfig.base.json
git commit -m "refactor(tsconfig): extract common compiler options to tsconfig.base.json"
```

---

### Task 2: `packages/` 디렉토리 생성 + `git mv` 실행

**목적**: 파일 이동 (히스토리 보존). 이후 Task 가 새 경로 기준으로 동작.

**Files:**
- Create (dir): `packages/core/`, `packages/cli/`, `packages/server/`
- Move: `core/` → `packages/core/src/`
- Move: `cli/` → `packages/cli/src/`
- Move: `server/` → `packages/server/src/`

- [ ] **Step 1: packages 서브디렉토리 생성**

```bash
mkdir -p packages/core packages/cli packages/server
```

- [ ] **Step 2: git mv 로 디렉토리 이동**

```bash
git mv core packages/core/src
git mv cli packages/cli/src
git mv server packages/server/src
```

- [ ] **Step 3: 이동 결과 확인**

Run: `ls -la packages/core/ packages/cli/ packages/server/`
Expected: 각 디렉토리에 `src/` 만 존재 (package.json, tsconfig.json 은 다음 Task 에서 생성)

Run: `git status | head -20`
Expected: `renamed:` 라인만 다수. `deleted:` 또는 `new file:` 없음 (rename detection 활성).

- [ ] **Step 4: untracked DB/tmp 파일 정리 (옵션)**

현재 `packages/server/src/data.db`, `packages/server/src/test*.db`, `packages/server/src/tmp/` 가 함께 이동된 경우 있다. untracked 이므로 git 은 관여 안 함. Task 11 에서 경로 이전하면서 삭제 처리.

```bash
ls packages/server/src/*.db 2>/dev/null || echo "no db files"
```

- [ ] **Step 5: Commit (이 단계에선 아직 실행 불가 — package.json 없음)**

이 Task 의 변경만으로는 npm test / tsx 모두 실패한다 (import 경로 깨짐). Task 3–10 완료 후 한 번에 커밋하는 것이 안전. 일단 working tree 에만 반영:

```bash
git status | head -5
# 기대: staged changes (renames) 만 존재
```

**커밋 보류.** 다음 Task 로 즉시 진행. Task 10 의 모든 검증 완료 후 Task 10 말미에서 한 덩이로 commit.

---

### Task 3: 패키지별 `package.json` 생성

**목적**: `@ad-ai/core`, `@ad-ai/cli`, `@ad-ai/server` 선언.

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/cli/package.json`
- Create: `packages/server/package.json`

- [ ] **Step 1: `packages/core/package.json` 작성**

Create `packages/core/package.json`:

```json
{
  "name": "@ad-ai/core",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./*.js": "./src/*.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@google/genai": "^0.7.0",
    "better-sqlite3": "^12.9.0",
    "facebook-nodejs-business-sdk": "^20.0.2",
    "sharp": "^0.34.5"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.8"
  }
}
```

`scripts` 필드 의도적 생략 (core 는 라이브러리 — 실행 entry 없음).

- [ ] **Step 2: `packages/cli/package.json` 작성**

Create `packages/cli/package.json`:

```json
{
  "name": "@ad-ai/cli",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./*.js": "./src/*.ts"
  },
  "scripts": {
    "app": "tsx src/entries/app.ts",
    "scrape": "tsx src/entries/scrape.ts",
    "generate": "tsx src/entries/generate.ts",
    "review": "tsx src/entries/review.ts",
    "launch": "tsx src/entries/launch.ts",
    "monitor": "tsx src/entries/monitor.ts",
    "pipeline": "tsx src/entries/pipeline.ts",
    "improve": "tsx src/entries/improve.ts",
    "worker": "tsx src/entries/worker.ts"
  },
  "dependencies": {
    "@ad-ai/core": "workspace:*",
    "chalk": "^5.3.0",
    "dotenv": "^16.4.5",
    "ink": "^5.0.1",
    "ink-big-text": "^2.0.0",
    "ink-gradient": "^3.0.0",
    "ink-spinner": "^5.0.0",
    "ink-text-input": "^6.0.0",
    "playwright": "^1.43.0",
    "react": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.1",
    "ink-testing-library": "^4.0.0"
  }
}
```

- [ ] **Step 3: `packages/server/package.json` 작성**

Create `packages/server/package.json`:

```json
{
  "name": "@ad-ai/server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./*.js": "./src/*.ts"
  },
  "scripts": {
    "start": "tsx src/index.ts",
    "admin": "tsx src/admin.ts"
  },
  "dependencies": {
    "@ad-ai/core": "workspace:*",
    "better-sqlite3": "^12.9.0",
    "dotenv": "^16.4.5",
    "express": "^5.2.1",
    "node-cron": "^3.0.3",
    "stripe": "^22.0.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.8",
    "@types/express": "^4.17.21",
    "@types/node-cron": "^3.0.11"
  }
}
```

- [ ] **Step 4: JSON 문법 확인**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('packages/core/package.json'))"
node -e "JSON.parse(require('fs').readFileSync('packages/cli/package.json'))"
node -e "JSON.parse(require('fs').readFileSync('packages/server/package.json'))"
```
Expected: 에러 없음 (silent success).

- [ ] **Step 5: 커밋 없음 (Task 10 에서 일괄 커밋)**

---

### Task 4: 루트 `package.json` 재작성

**목적**: `workspaces` 필드 선언 + 사용자 명령 표면 유지 + hoisted dev deps 만 남기기.

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 기존 루트 package.json 백업 확인**

Run: `git show HEAD:package.json | head -5`
Expected: 기존 상태 출력됨 (Task 2 이후 index 엔 아직 변경 없음).

- [ ] **Step 2: 루트 package.json 재작성**

Write (replace entire file) `package.json`:

```json
{
  "name": "ad-ai-monorepo",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "app": "npm run -w @ad-ai/cli app",
    "scrape": "npm run -w @ad-ai/cli scrape",
    "generate": "npm run -w @ad-ai/cli generate",
    "review": "npm run -w @ad-ai/cli review",
    "launch": "npm run -w @ad-ai/cli launch",
    "monitor": "npm run -w @ad-ai/cli monitor",
    "pipeline": "npm run -w @ad-ai/cli pipeline",
    "improve": "npm run -w @ad-ai/cli improve",
    "worker": "npm run -w @ad-ai/cli worker",
    "server": "npm run -w @ad-ai/server start",
    "admin": "npm run -w @ad-ai/server admin",
    "migrate": "tsx scripts/migrate.ts",
    "migrate:creatives": "tsx scripts/migrate-creatives.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "tsx": "^4.7.3",
    "typescript": "^5.4.5",
    "vitest": "^1.5.0"
  }
}
```

변경점 요약:
- `"name"` → `"ad-ai-monorepo"`
- `"workspaces": ["packages/*"]` 추가
- 모든 entry 스크립트는 `-w @ad-ai/cli` 또는 `-w @ad-ai/server` 위임
- `migrate*` 는 스크립트가 루트 `scripts/` 에 있어서 그대로 유지
- dependencies/devDependencies 에서 패키지별로 이동된 것 제거 (루트에는 `dotenv`, `@types/node`, `tsx`, `typescript`, `vitest` 만 남김)
- `dotenv` 는 `scripts/migrate.ts` 가 사용하므로 루트 dependencies 에 유지

- [ ] **Step 3: JSON 문법 확인**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json'))"`
Expected: 에러 없음.

- [ ] **Step 4: 커밋 없음 (Task 10 일괄 커밋)**

---

### Task 5: 패키지별 `tsconfig.json` 생성

**목적**: 각 패키지가 tsconfig.base.json 을 extends. cli 만 jsx 활성.

**Files:**
- Create: `packages/core/tsconfig.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/server/tsconfig.json`

- [ ] **Step 1: `packages/core/tsconfig.json`**

Create `packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: `packages/cli/tsconfig.json`**

Create `packages/cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: `packages/server/tsconfig.json`**

Create `packages/server/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: JSON 문법 확인**

```bash
node -e "JSON.parse(require('fs').readFileSync('packages/core/tsconfig.json'))"
node -e "JSON.parse(require('fs').readFileSync('packages/cli/tsconfig.json'))"
node -e "JSON.parse(require('fs').readFileSync('packages/server/tsconfig.json'))"
```
Expected: 에러 없음.

- [ ] **Step 5: 커밋 없음 (Task 10 일괄 커밋)**

---

### Task 6: 루트 `tsconfig.json` 재작성 (IDE 용)

**목적**: IDE 가 루트 열었을 때 모든 패키지 소스 인식. `tsc --noEmit` 전체 체크용.

**Files:**
- Modify: `tsconfig.json`

- [ ] **Step 1: 루트 tsconfig.json 재작성**

Write (replace entire file) `tsconfig.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx"
  },
  "include": [
    "packages/*/src/**/*",
    "scripts/**/*",
    "tests/**/*"
  ],
  "exclude": ["node_modules", "dist"]
}
```

변경점:
- `"extends": "./tsconfig.base.json"` 추가
- `"compilerOptions"` 에서 base 와 중복되는 필드 제거 (target/module/moduleResolution/strict/esModuleInterop/skipLibCheck/outDir)
- `"include"` 를 packages/\*/src + scripts + tests 로 확장

- [ ] **Step 2: JSON 문법 확인**

Run: `node -e "JSON.parse(require('fs').readFileSync('tsconfig.json'))"`
Expected: 에러 없음.

- [ ] **Step 3: 커밋 없음 (Task 10 일괄 커밋)**

---

### Task 7: `npm install` + symlink 검증

**목적**: workspace 세팅 완료 확인.

**Files:**
- Modify (auto): `node_modules/`, `package-lock.json`

- [ ] **Step 1: 기존 node_modules 제거 (깨끗한 설치)**

```bash
rm -rf node_modules package-lock.json
```

이유: workspaces 전환 전 lock file 은 호환성 없음.

- [ ] **Step 2: npm install**

Run: `npm install 2>&1 | tail -20`
Expected:
- 에러 없음
- "added N packages in Xs" 같은 완료 메시지
- 중간 경고는 허용 (peer deps 경고 등)

- [ ] **Step 3: symlink 검증**

Run: `ls -la node_modules/@ad-ai/`
Expected:
```
core -> ../../packages/core
cli -> ../../packages/cli
server -> ../../packages/server
```

3개 모두 symlink 으로 존재해야 함. 실물 디렉토리면 workspaces 인식 실패.

- [ ] **Step 4: package-lock.json 존재 확인**

Run: `ls -la package-lock.json`
Expected: 파일 존재. 새 lock file 생성됨.

- [ ] **Step 5: 커밋 없음 (Task 10 일괄 커밋)**

---

### Task 8: `cli/` 내부 Import 경로 sed 치환

**목적**: `../core/X.js` → `@ad-ai/core/X.js`. 모든 깊이 통합.

**Files:**
- Modify (auto): `packages/cli/src/**/*.{ts,tsx}` (해당하는 import 가 있는 파일 전부)

- [ ] **Step 1: 치환 전 매치 개수 기록**

```bash
BEFORE=$(grep -rln 'from "\(\.\./\)\+core/' packages/cli/src | wc -l | tr -d ' ')
echo "cli files with core imports: $BEFORE"
```

Expected: 10 이상의 정수 (현재 cli 가 core 를 많이 참조).

- [ ] **Step 2: sed 치환 (macOS 형식)**

Run:
```bash
find packages/cli/src -type f \( -name "*.ts" -o -name "*.tsx" \) -print0 \
  | xargs -0 sed -i '' -E 's|from "(\.\./)+core/(.+)\.js"|from "@ad-ai/core/\2.js"|g'
```

정규식 설명:
- `from "` → 앞뒤 문자열 고정
- `(\.\./)+` → `../`, `../../`, `../../../` 등 모든 깊이 매칭
- `core/(.+)\.js` → core/ 이후 경로 캡처 (중첩 포함)
- 치환: `from "@ad-ai/core/\2.js"` (캡처 그룹 2 를 사용)

- [ ] **Step 3: 치환 결과 검증**

```bash
AFTER=$(grep -rln 'from "\(\.\./\)\+core/' packages/cli/src | wc -l | tr -d ' ')
echo "cli files still with ../core/ imports: $AFTER"
```

Expected: `$AFTER` == 0.

- [ ] **Step 4: 새 prefix 적용 확인**

```bash
NEW=$(grep -rln 'from "@ad-ai/core/' packages/cli/src | wc -l | tr -d ' ')
echo "cli files with @ad-ai/core imports: $NEW"
```

Expected: Step 1 의 `$BEFORE` 와 동일한 수 (또는 ≥).

- [ ] **Step 5: 몇 개 샘플 파일 스팟체크**

```bash
grep -l '@ad-ai/core' packages/cli/src/actions.ts packages/cli/src/entries/app.ts packages/cli/src/tui/hooks/useReports.ts 2>/dev/null | head -3
```

Expected: 3 개 파일 모두 출력 (해당 파일에 실제로 core 의존이 있다면). 샘플에서 prefix 가 올바르게 `@ad-ai/core/storage.js` 등으로 바뀌었는지 육안 확인.

- [ ] **Step 6: 커밋 없음 (Task 10 일괄 커밋)**

---

### Task 9: `server/` 내부 Import 경로 sed 치환

**목적**: Task 8 과 동일하되 server 디렉토리 대상.

**Files:**
- Modify (auto): `packages/server/src/**/*.ts`

- [ ] **Step 1: 치환 전 매치 개수 기록**

```bash
BEFORE=$(grep -rln 'from "\(\.\./\)\+core/' packages/server/src | wc -l | tr -d ' ')
echo "server files with core imports: $BEFORE"
```

- [ ] **Step 2: sed 치환**

```bash
find packages/server/src -type f \( -name "*.ts" -o -name "*.tsx" \) -print0 \
  | xargs -0 sed -i '' -E 's|from "(\.\./)+core/(.+)\.js"|from "@ad-ai/core/\2.js"|g'
```

- [ ] **Step 3: 치환 결과 검증**

```bash
AFTER=$(grep -rln 'from "\(\.\./\)\+core/' packages/server/src | wc -l | tr -d ' ')
echo "server files still with ../core/ imports: $AFTER"
[[ "$AFTER" -eq 0 ]] || { echo "❌ 치환 누락 $AFTER"; exit 1; }
```

Expected: `$AFTER` == 0.

- [ ] **Step 4: 새 prefix 적용 확인**

```bash
grep -rln 'from "@ad-ai/core/' packages/server/src | wc -l
```

Expected: `$BEFORE` 와 유사한 수.

- [ ] **Step 5: 커밋 없음 (Task 10 일괄 커밋)**

---

### Task 10: 치환 후 전체 검증 + 일괄 커밋

**목적**: Task 2–9 누적 변경이 테스트/타입체크 모두 통과하는지 확인 후 한 덩이로 커밋.

**Files:**
- (검증만, 변경 없음)

- [ ] **Step 1: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

에러가 있다면:
- 누락 치환 경로가 남아있는지 재확인 (Task 8/9 의 Step 3 재실행)
- tsconfig 경로/extends 오타 재확인 (Task 5/6)
- 치명적이면 `git restore --staged .` + `git stash` 로 되돌리고 원인 분석

- [ ] **Step 2: 전체 테스트 실행**

Run: `npm test 2>&1 | tail -10`
Expected: `Tests  314 passed (314)` (Task 1 Step 1 의 BASELINE 과 동일한 수).

테스트가 실패하면:
- 경로 치환 회귀 의심 → `grep -rln 'from "\(\.\./\)\+core/' packages/` 로 누락 확인
- workspace symlink 미생성 → Task 7 재실행
- vitest 가 `packages/**/*.test.ts` 인식 안 함 → 스펙 §"vitest 설정 유지" 내용과 대조

테스트 실패 시 **커밋 금지**. 원인 해결 후 재시도.

- [ ] **Step 3: 일괄 커밋**

```bash
git add -A
git commit -m "refactor: migrate to npm workspaces (core/cli/server → packages/)

- Move core/, cli/, server/ to packages/*/src/ (git mv preserves history)
- Create per-package package.json with @ad-ai/* scoped names
- Create per-package tsconfig.json extending tsconfig.base.json
- Rewrite root package.json with workspaces + delegating scripts
- Replace ../core/ imports with @ad-ai/core/ (sed across cli/server)
- Keep tsx runtime (no build step). exports pattern maps .js → .ts

Spec: docs/superpowers/specs/2026-04-24-multi-module-refactor-design.md"
```

- [ ] **Step 4: 커밋 후 상태 확인**

```bash
git status
git log --oneline -3
```
Expected: working tree clean. 직전 커밋 메시지가 위와 동일.

---

### Task 11: `server/data.db` → `data/licenses.db` 경로 이전

**목적**: 런타임 아티팩트를 `data/` 로 통합 (creatives.db, campaigns/, reports/ 와 일관).

**Files:**
- Modify: `packages/server/src/db.ts`

- [ ] **Step 1: `db.ts` 내 하드코딩된 DB 경로 확인**

Run: `grep -n 'data.db\|server/data' packages/server/src/db.ts`
Expected: `const DB_PATH = "server/data.db";` (또는 유사) 라인 1개.

현재 파일에 상수명이 다를 수 있으니 실제 라인 확인 후 정확한 string 으로 치환.

- [ ] **Step 2: DB 경로 수정**

Edit `packages/server/src/db.ts`:

예시 (실제 파일의 정확한 구문에 맞게):
```diff
- const DB_PATH = "server/data.db";
+ const DB_PATH = "data/licenses.db";
```

**정확한 치환은 Read → Edit 로 수행**. `server/data.db` 문자열이 다른 곳(예: 주석)에도 있을 수 있으므로 유일성 확인 후 Edit.

- [ ] **Step 3: 수정 결과 확인**

Run: `grep -n 'data/licenses.db\|server/data.db' packages/server/src/db.ts`
Expected:
- `data/licenses.db` 1개 (수정된 라인)
- `server/data.db` 0개 (주석까지 모두 제거된 상태 — 주석에 남아있어도 동작엔 무해하지만 혼란 방지)

- [ ] **Step 4: 기존 untracked `data.db` 파일 삭제**

```bash
rm -f packages/server/src/data.db
rm -f server/data.db  # 만약 루트에도 남아있다면
```

untracked 이므로 git 관여 없음. 최초 재실행 시 `data/licenses.db` 자동 생성.

- [ ] **Step 5: 타입체크 + 테스트**

Run:
```bash
npx tsc --noEmit
npm test 2>&1 | tail -5
```
Expected: 에러 없음, 314/314 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/db.ts
git commit -m "refactor(server): move license DB path from server/data.db to data/licenses.db"
```

---

### Task 12: 테스트 DB 경로 갱신

**목적**: `db.test.ts`, `billing.test.ts` 의 하드코딩된 `server/test.db` 경로를 새 구조 (`packages/server/src/test.db`) 로 변경.

**Files:**
- Modify: `packages/server/src/db.test.ts`
- Modify: `packages/server/src/billing.test.ts`

- [ ] **Step 1: `db.test.ts` 경로 확인**

Run: `grep -n 'test.db\|test-billing.db' packages/server/src/db.test.ts packages/server/src/billing.test.ts`
Expected:
- `db.test.ts` 어딘가: `const TEST_DB = "server/test.db";`
- `billing.test.ts` 어딘가: `const TEST_DB = "server/test-billing.db";`

- [ ] **Step 2: `db.test.ts` 수정**

Edit `packages/server/src/db.test.ts`:

```diff
- const TEST_DB = "server/test.db";
+ const TEST_DB = "packages/server/src/test.db";
```

- [ ] **Step 3: `billing.test.ts` 수정**

Edit `packages/server/src/billing.test.ts`:

```diff
- const TEST_DB = "server/test-billing.db";
+ const TEST_DB = "packages/server/src/test-billing.db";
```

- [ ] **Step 4: 확인**

Run: `grep -n 'TEST_DB' packages/server/src/db.test.ts packages/server/src/billing.test.ts`
Expected: 각각 새 경로로 업데이트됨.

- [ ] **Step 5: 테스트 실행**

Run: `npm test 2>&1 | tail -10`
Expected: 314/314 passed. (경로 변경 시 테스트 파일이 `process.cwd()` 기준 새 경로에 DB 파일 생성 → tear down 도 새 경로에서 삭제)

- [ ] **Step 6: 기존 untracked 테스트 DB 파일 삭제**

```bash
rm -f server/test.db server/test-billing.db packages/server/src/test.db packages/server/src/test-billing.db
```

테스트가 끝나면 정상 정리되지만, 잔존 파일이 있으면 제거.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/db.test.ts packages/server/src/billing.test.ts
git commit -m "test(server): update hardcoded test DB paths to packages/server/src/"
```

---

### Task 13: `.gitignore` 업데이트

**목적**: 새 경로 구조 반영. `server/test.db` 등 옛 패턴 제거 + 새 패턴 추가.

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: 현재 .gitignore 에서 server/ 관련 라인 확인**

Run: `grep -n 'server/' .gitignore`
Expected: 4–5 라인 정도 (server/data.db, server/test.db, server/test-billing.db, server/tmp/).

- [ ] **Step 2: .gitignore 편집**

기존 server/ 관련 라인을 삭제하고, data/licenses.db + packages/server/src/ 경로로 교체.

Current (예상):
```
server/data.db
server/test.db
server/test-billing.db
server/tmp/
```

After:
```
data/licenses.db
packages/server/src/test.db
packages/server/src/test-billing.db
packages/server/tmp/
```

Edit 로 각각 라인 치환:

```diff
- server/data.db
- server/test.db
- server/test-billing.db
- server/tmp/
+ data/licenses.db
+ packages/server/src/test.db
+ packages/server/src/test-billing.db
+ packages/server/tmp/
```

- [ ] **Step 3: 검증**

```bash
grep -n 'server/' .gitignore       # 기대: 0 라인 (모두 교체됨)
grep -n 'packages/server' .gitignore # 기대: 3 라인
grep -n 'data/licenses.db' .gitignore # 기대: 1 라인
```

- [ ] **Step 4: git status 로 동작 확인**

```bash
git status | head -20
```

Expected: untracked 파일 목록에 현재 세션의 test DB / data.db 등이 표시되지 않음 (gitignore 매치).

- [ ] **Step 5: Commit**

```bash
git add .gitignore
git commit -m "chore(gitignore): update paths for packages/ layout"
```

---

### Task 14: launchd plist 경로 갱신

**목적**: worker 실행 스크립트 경로를 새 구조로 업데이트. 기존 설치된 launchd job 은 사용자가 수동 재설치.

**Files:**
- Modify: `scripts/com.adai.worker.plist`

- [ ] **Step 1: 현재 plist 내 entry 경로 확인**

Run: `grep -n 'cli/entries' scripts/com.adai.worker.plist`
Expected: `<string>cli/entries/worker.ts</string>` 1 라인.

- [ ] **Step 2: plist 수정**

Edit `scripts/com.adai.worker.plist`:

```diff
   <array>
     <string>__TSX_PATH__</string>
-    <string>cli/entries/worker.ts</string>
+    <string>packages/cli/src/entries/worker.ts</string>
   </array>
```

- [ ] **Step 3: 검증**

Run: `grep -n 'packages/cli/src/entries/worker.ts' scripts/com.adai.worker.plist`
Expected: 1 라인.

Run: `grep -n 'cli/entries/worker.ts' scripts/com.adai.worker.plist`
Expected: 0 라인 (이전 경로 모두 제거됨).

- [ ] **Step 4: install-worker.sh 내 동일 경로 참조 확인**

Run: `grep -n 'cli/entries\|packages/cli' scripts/install-worker.sh`
Expected: `install-worker.sh` 는 plist 템플릿을 sed 치환만 하므로 경로가 직접 쓰여있지 않음 (`__TSX_PATH__` 치환만). 만약 하드코딩 경로가 있다면 동일하게 업데이트.

- [ ] **Step 5: Commit**

```bash
git add scripts/com.adai.worker.plist
git commit -m "chore(launchd): update worker.ts path to packages/cli/src/entries/"
```

---

### Task 15: Subagent 트리거 경로 갱신

**목적**: `.claude/agents/` 의 md 파일에 명시된 트리거 경로를 새 구조로 교체. CLAUDE.md §"Subagent 호출 규칙" 표도 반영.

**Files:**
- Modify: `.claude/agents/meta-platform-expert.md`
- Modify: `.claude/agents/marketing-copy-reviewer.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: meta-platform-expert.md 경로 확인**

Run: `grep -n 'core/platform/meta' .claude/agents/meta-platform-expert.md`
Expected: `core/platform/meta/*` / `core/platform/meta/launcher.ts` 언급 1–2 라인.

- [ ] **Step 2: meta-platform-expert.md 수정**

Edit `.claude/agents/meta-platform-expert.md`:

모든 `core/platform/meta/` 언급을 `packages/core/src/platform/meta/` 로 변경.

- [ ] **Step 3: marketing-copy-reviewer.md 경로 확인 + 수정**

Run: `grep -n 'core/creative' .claude/agents/marketing-copy-reviewer.md`
Expected: `core/creative/prompt.ts` 언급.

Edit: `core/creative/prompt.ts` → `packages/core/src/creative/prompt.ts` 전체 치환.

- [ ] **Step 4: CLAUDE.md §"Subagent 호출 규칙" 표 경로 갱신**

Run: `grep -n 'core/platform/meta\|core/creative/prompt' CLAUDE.md`
Expected: Subagent 표 내 2–3 라인.

Edit `CLAUDE.md`:
- `core/platform/meta/*` → `packages/core/src/platform/meta/*`
- `core/platform/meta/launcher.ts` → `packages/core/src/platform/meta/launcher.ts`
- `core/creative/prompt.ts` → `packages/core/src/creative/prompt.ts`

- [ ] **Step 5: 검증**

```bash
grep -rln '^core/\|\W core/' .claude/agents/*.md CLAUDE.md 2>/dev/null || echo "no remaining references"
```

- [ ] **Step 6: Commit**

```bash
git add .claude/agents/meta-platform-expert.md .claude/agents/marketing-copy-reviewer.md CLAUDE.md
git commit -m "docs(agents): update subagent trigger paths to packages/core/src/"
```

---

### Task 16: `docs/STATUS.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` 경로 업데이트

**목적**: 현행 문서 3개의 경로 prefix 업데이트. `docs/superpowers/specs/` 와 `docs/superpowers/plans/` 하위 기존 역사 문서는 제외.

**Files:**
- Modify: `docs/STATUS.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/ROADMAP.md`
- Modify: `CLAUDE.md` (빠른 네비게이션 섹션)

- [ ] **Step 1: STATUS.md 에서 경로 참조 확인**

Run: `grep -nE '\bcore/|\bcli/|\bserver/' docs/STATUS.md | head -30`
Expected: 여러 라인 (서비스 컴포넌트 표의 "위치" 컬럼 등).

- [ ] **Step 2: STATUS.md 수정**

각 라인을 새 경로로 치환:
- `core/` → `packages/core/src/`
- `cli/` → `packages/cli/src/`
- `server/` → `packages/server/src/`

**수동 Edit 권장** — sed 일괄은 `core/platform/meta/...` 같이 문맥 없는 경로 외 부분에도 영향 줄 수 있음.

파일 끝의 "최근 변경 이력" 은 과거 기록이므로 손대지 않음 (당시 구조 기록).

- [ ] **Step 3: ARCHITECTURE.md 경로 확인 + 수정**

Run: `grep -nE '\bcore/|\bcli/|\bserver/' docs/ARCHITECTURE.md | head -30`

각 현재 시점 경로 참조 (아키텍처 설명, 모듈 구조 등)를 `packages/*/src/` 로 교체.
"설계 결정 이력" 섹션의 과거 기록은 손대지 않음.

- [ ] **Step 4: ROADMAP.md 경로 확인 + 수정**

Run: `grep -nE '\bcore/|\bcli/|\bserver/' docs/ROADMAP.md`

경로 참조 (Tier 항목, 파일명 언급 등) 모두 갱신.

- [ ] **Step 5: CLAUDE.md 빠른 네비게이션 섹션 확인**

Run: `grep -n 'core/\|cli/\|server/' CLAUDE.md | head`

"스펙 & 계획 위치" 섹션의 `server/data.db` / `server/db.ts` 경로 업데이트:
```diff
- server/data.db            — 런타임 SQLite DB (licenses/usage/billing, git 제외)
- server/db.ts              — DB 스키마 및 마이그레이션 정의
+ data/licenses.db          — 런타임 SQLite DB (licenses/usage/billing, git 제외)
+ packages/server/src/db.ts — DB 스키마 및 마이그레이션 정의
```

- [ ] **Step 6: 검증**

Run: `grep -cE '\bcore/[a-z]|\bcli/[a-z]|\bserver/[a-z]' docs/STATUS.md docs/ARCHITECTURE.md docs/ROADMAP.md`
Expected: 모두 0 (또는 문맥상 옛 경로가 유효한 역사 기록뿐).

- [ ] **Step 7: Commit**

```bash
git add docs/STATUS.md docs/ARCHITECTURE.md docs/ROADMAP.md CLAUDE.md
git commit -m "docs: update path references to packages/*/src/ layout"
```

---

### Task 17: `README.md`, `AGENTS.md`, `.env.*.example` 업데이트

**목적**: 사용자-facing 문서의 경로/구조도 반영.

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `.env.owner.example`
- Modify: `.env.service.example`

- [ ] **Step 1: README.md 경로 확인**

Run: `grep -nE '\bcore/|\bcli/|\bserver/' README.md | head -30`

- [ ] **Step 2: README.md 수정**

- 프로젝트 구조도 (트리 그림) 를 `packages/*/src/` 기반으로 갱신
- 사용자 명령 섹션은 불변 (`npm run app`, `npm run server` 등 — 위임이 투명)
- 코드 예시의 경로 prefix 갱신

구조도 예시:
```diff
 ad_ai/
-├── core/          # 도메인 로직, SDK 클라이언트
-├── cli/           # Owner TUI, entries
-├── server/        # Express (🟡 비활성)
+├── packages/
+│   ├── core/      # 도메인 로직, SDK 클라이언트
+│   │   └── src/
+│   ├── cli/       # Owner TUI, entries
+│   │   └── src/
+│   └── server/    # Express (🟡 비활성)
+│       └── src/
 ├── data/          # 런타임 (gitignored)
 ├── scripts/       # 운영/마이그레이션
 └── docs/          # 문서
```

- [ ] **Step 3: AGENTS.md 확인 + 수정**

Run: `grep -nE '\bcore/|\bcli/|\bserver/' AGENTS.md`

경로 언급 모두 `packages/*/src/` 로 갱신.

- [ ] **Step 4: .env.*.example 주석 경로 갱신**

Run:
```bash
grep -nE 'server/|cli/|core/' .env.owner.example .env.service.example
```

주석 내 서버/CLI 파일 참조 경로를 갱신. 예:
```diff
- # 사용처: server/index.ts (Express + AI proxy routes)
+ # 사용처: packages/server/src/index.ts (Express + AI proxy routes)
```

- [ ] **Step 5: 검증**

```bash
grep -cE '\bcore/[a-z]|\bcli/[a-z]|\bserver/[a-z]' README.md AGENTS.md .env.owner.example .env.service.example
```

- [ ] **Step 6: Commit**

```bash
git add README.md AGENTS.md .env.owner.example .env.service.example
git commit -m "docs: update README/AGENTS/.env examples for packages/ layout"
```

---

### Task 18: 최종 검증 체크포인트

**목적**: 스펙 §"검증 체크포인트" 모두 수행하여 리팩터 무결성 확인.

**Files:**
- (검증만)

- [ ] **Step 1: workspace symlink 재확인**

```bash
ls -la node_modules/@ad-ai/
```
Expected: core, cli, server 3개 symlink.

- [ ] **Step 2: `../core/` 치환 누락 0 확인**

```bash
REMAINING=$(grep -rln 'from "\(\.\./\)\+core/' packages/cli/src packages/server/src | wc -l | tr -d ' ')
[[ "$REMAINING" -eq 0 ]] || { echo "❌ 치환 누락 $REMAINING 파일"; exit 1; }
echo "✅ 치환 누락 0"
```

- [ ] **Step 3: 전체 테스트 통과**

```bash
npm test 2>&1 | tail -5
```
Expected: `Tests  314 passed (314)` (BASELINE 과 동일).

- [ ] **Step 4: 타입체크 전체**

```bash
npx tsc --noEmit
```
Expected: 에러 없음.

- [ ] **Step 5: `npm run app` smoke test (TUI 부트만)**

```bash
timeout 3 npm run app 2>&1 | head -5 || true
```

Expected: ink 렌더링 출력 시작. timeout 으로 3초 후 자동 종료. 에러 없이 initial frame 찍히면 성공.

- [ ] **Step 6: `npm run server` smoke test (부트만)**

```bash
timeout 3 npm run server 2>&1 | head -10 || true
```

Expected: Express 리슨 메시지 또는 `.env` 미설정 관련 정상 에러. 프로세스 크래시 없이 3초 버티고 종료.

(Note: `.env` 미설정 상태에서 server 는 부트 실패 가능 — 그 경우 부팅 에러가 "코드 구조" 가 아닌 "런타임 설정" 에서 나는지 스택트레이스로 확인.)

- [ ] **Step 7: 전체 변경 summary 확인**

```bash
git log --oneline -20
```

Expected: Task 10–17 의 커밋 전부 보임.

- [ ] **Step 8: 최종 파일 카운트 확인**

```bash
echo "Core files:   $(find packages/core/src -name '*.ts' | wc -l | tr -d ' ')"
echo "CLI files:    $(find packages/cli/src -name '*.ts' -o -name '*.tsx' | wc -l | tr -d ' ')"
echo "Server files: $(find packages/server/src -name '*.ts' | wc -l | tr -d ' ')"
```

Expected: 각 0 초과. 특별한 기준 수는 없지만 리팩터 전후 대략 동일.

- [ ] **Step 9: 검증 결과 커밋 없음**

모든 Step PASS 시 완료 표시만. 결과가 다르면 해당 Task 로 복귀.

---

### Task 19: `docs/STATUS.md` 완료 기록 + ROADMAP 갱신

**목적**: CLAUDE.md §"문서 업데이트 규칙" 준수. 본 리팩터 완료를 STATUS.md 에 기록.

**Files:**
- Modify: `docs/STATUS.md`
- Modify: `docs/ROADMAP.md` (완료된 항목이 있으면 제거)

- [ ] **Step 1: STATUS.md "Phase 요약" 섹션에 추가**

Edit `docs/STATUS.md`:

"Phase 요약" 섹션 맨 뒤에 추가:
```markdown
- [x] SP6 — 멀티모듈 리팩터 (npm workspaces 기반 `packages/core,cli,server/` 분리, tsx 런타임 유지, Phase B 추후 repo 분리 토대 확립)
```

- [ ] **Step 2: STATUS.md "최근 변경 이력" 섹션에 한 줄 추가**

"최근 변경 이력" 맨 위에 추가:
```markdown
- 2026-04-24 refactor: npm workspaces 기반 멀티모듈 리팩터 완료 — `core/`, `cli/`, `server/` → `packages/*/src/`, `@ad-ai/core/cli/server` scoped 패키지 선언, tsx 런타임 유지 (빌드 스텝 없음), deep import 패턴(`@ad-ai/core/storage.js`), `server/data.db` → `data/licenses.db` 통합. 314 tests 통과. Phase B (개별 repo 분리) 는 실운영 검증 후 판단.
```

"마지막 업데이트: 2026-04-24" 로 갱신.

- [ ] **Step 3: STATUS.md "서비스 컴포넌트" 표 위치 컬럼 갱신**

이미 Task 16 에서 수행됨 — 재확인만.

- [ ] **Step 4: ROADMAP.md 에서 관련 항목 제거 (있다면)**

"Tier 1" 또는 "현재 추천 다음 작업" 에 "모듈 경계 강화" 유사 항목이 있으면 제거 또는 ✅ 표시. 없으면 스킵.

- [ ] **Step 5: Commit**

```bash
git add docs/STATUS.md docs/ROADMAP.md
git commit -m "docs(status): record multi-module refactor completion"
```

---

## 스펙 커버리지 자체 검토

스펙의 각 섹션 → 구현 Task 매핑:

| 스펙 섹션 | 구현 Task |
|---|---|
| §1 타겟 아키텍처 & 패키지 경계 | Task 3 (package.json deps 분배) |
| §2 디렉토리 레이아웃 | Task 2 (git mv), Task 11 (data.db 이전) |
| §3 package.json 4개 설계 | Task 3 (패키지 3개), Task 4 (루트) |
| §3 exports 패턴 | Task 0 (샌드박스 검증), Task 3 (선언) |
| §4 tsconfig 5개 | Task 1 (base), Task 5 (패키지별), Task 6 (루트) |
| §4 Import 경로 치환 | Task 8 (cli), Task 9 (server) |
| §4 vitest 설정 유지 | (Task 10 에서 테스트 통과로 간접 확인 — vitest.config.ts 변경 없음) |
| §5.1 launchd plist | Task 14 |
| §5.2 문서 경로 업데이트 | Task 16, Task 17 |
| §5.3 data.db → data/licenses.db | Task 11, Task 12 (테스트 DB), Task 13 (gitignore) |
| §5.4 Subagent 트리거 경로 | Task 15 |
| §5.5 README 구조도 | Task 17 |
| §6 Phase B 플레이북 | (문서만 — Phase A 범위 아님) |
| §Phase 0 사전 검증 | Task 0 |
| §검증 체크포인트 | Task 18 |

**커버리지 gap: 없음.** §6 는 의도적으로 플레이북 수준만 문서화 (범위 명시).

---

## 실행 방식 선택

Plan 작성 완료. 저장 위치: `docs/superpowers/plans/2026-04-24-multi-module-refactor.md`.

실행 방식 2가지:

1. **Subagent-Driven (권장)** — Task 마다 새 subagent dispatch, 2단계 리뷰 (spec compliance + code quality), 빠른 반복
2. **Inline Execution** — 현 세션에서 `executing-plans` 로 배치 실행, 체크포인트에서 리뷰

Memory 에 기록된 피드백: "구현 실행은 항상 Subagent-Driven, 방식을 묻지 말 것" — **즉 Subagent-Driven 으로 진행한다.**

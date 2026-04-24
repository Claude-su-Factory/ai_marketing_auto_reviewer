# 멀티모듈 리팩터 설계 — npm workspaces 기반 패키지 분할

**작성**: 2026-04-24
**상태**: 설계 (Phase A 범위)

## 목적

현재 `core/`, `cli/`, `server/` 3개 top-level 디렉토리로 구성된 코드베이스를 `packages/*` 기반 npm workspaces 구조로 재배치한다. 각 디렉토리를 `@ad-ai/core`, `@ad-ai/cli`, `@ad-ai/server` 패키지로 분리하여 경계를 선언적으로 강제하고, 추후 개별 GitHub repo 로 분리하기 쉬운 토대를 만든다.

## 범위

- **Phase A (본 스펙)**: monorepo 내부의 멀티모듈 구조 확립. 빌드 파이프라인 없음 (`tsx` 런타임 유지).
- **Phase B (미래, §6 참조)**: 분리 조건 충족 시 개별 repo 로 이전. 본 스펙에서는 플레이북 수준만 문서화.

Phase B 전환은 **실운영 검증 완료 후** 판단한다. 지금 분리하면 변경당 repo N번 touch 가 강제되고, API 표면이 움직이는 검증 기간에 semver 관리 비용만 누적된다.

## 결정 요약

| 주제 | 결정 |
|---|---|
| 패키지 이름 | `@ad-ai/core`, `@ad-ai/cli`, `@ad-ai/server` (scoped, private) |
| 디렉토리 레이아웃 | `packages/*/src/...` (루트에 scripts/, tests/, docs/, data/ 유지) |
| Import 스타일 | Deep import (`@ad-ai/core/storage.js`) |
| 빌드 전략 | Phase A: tsx 런타임 유지. Phase B 분리 시점에 해당 패키지만 tsc 추가 |
| tsconfig | `tsconfig.base.json` + 패키지별 extends |
| 테스트 | 루트 단일 `vitest.config.ts`, 모든 패키지 테스트 일괄 실행 |
| 사용자 명령 | `npm run app/server/test` 등 루트 scripts 에서 workspace 위임 |

---

## 1. 타겟 아키텍처 & 패키지 경계

### 패키지 구성

```
┌─────────────────────────────────────────────────────┐
│ @ad-ai/cli                    @ad-ai/server          │
│  (TUI, scraper, entries,       (Express, webhook,   │
│   actions, pipeline, tui/)      admin, scheduler)    │
│         │                            │               │
│         └────────────┬───────────────┘               │
│                      ▼                               │
│                 @ad-ai/core                          │
│   (types, storage, platform/, creative/, rag/,       │
│    scheduler/, campaign/, improver/, launch/,        │
│    product/, billing/tiers.ts, reviewer/)            │
└─────────────────────────────────────────────────────┘
```

- 의존 방향: `cli → core`, `server → core`. `cli ↔ server` 직접 의존 없음 (현재 코드베이스에서도 확인).
- core 는 외부 SDK만 의존 (내부 패키지 의존 없음 → leaf 노드).

### 각 패키지 역할

| 패키지 | 포함 | 성격 |
|---|---|---|
| `@ad-ai/core` | 현재 `core/` 전체 (types, storage, platform, creative, rag, scheduler, billing/tiers 등) | 분리 1순위. 외부 SDK 클라이언트 + 도메인 로직 |
| `@ad-ai/cli` | 현재 `cli/` 전체 (TUI, entries, pipeline, scraper, review session) | Owner 로컬 실행 진입점 |
| `@ad-ai/server` | 현재 `server/` 전체 (Express, Stripe webhook, AI proxy, admin, license DB) | 🟡 현재 비활성. 웹 UI 재개 시 활성화 |

### `billing/` 이 core 에 속하는 이유

- 현재 `core/billing/tiers.ts` 는 server 재활성 시에만 소비됨 (cli 는 billing 미사용 — grep 로 확인)
- 단일 파일을 server 로 옮기면 `core/billing/` 구조와 충돌
- 가격 정책이 차후 cli 에 노출될 여지가 있어 도메인 레벨에 유지하는 것이 미래 확장에 유리
- YAGNI — 지금 옮길 이득 없음

### 외부 패키지 의존 분배

| 패키지 | dependencies |
|---|---|
| `@ad-ai/core` | `@anthropic-ai/sdk`, `@google/genai`, `better-sqlite3`, `facebook-nodejs-business-sdk`, `sharp` |
| `@ad-ai/cli` | `@ad-ai/core` + `ink`, `ink-big-text`, `ink-gradient`, `ink-spinner`, `ink-text-input`, `react`, `playwright`, `chalk`, `dotenv` |
| `@ad-ai/server` | `@ad-ai/core` + `express`, `stripe`, `node-cron`, `better-sqlite3` (license DB), `dotenv` |

`better-sqlite3` 은 core 와 server 양쪽에 선언됨 — core 는 Winner DB (`data/creatives.db`), server 는 license DB (`data/licenses.db`). npm workspaces 가 자동 dedupe.

`dotenv` 는 cli + server 양쪽 entries 에서 `import "dotenv/config"` 수행. core 는 dotenv 직접 import 없음 (환경 변수는 entry 에서 load 후 process.env 로 읽음).

### Workspace 내부 의존 선언

```json
// packages/cli/package.json
"dependencies": {
  "@ad-ai/core": "workspace:*",
  ...
}
```

`workspace:*` → npm 7+ 이 symlink 으로 해결. Phase B 전환 시 `"^1.0.0"` 으로 한 줄 교체.

---

## 2. 디렉토리 레이아웃

### 최종 구조

```
ad_ai/                                (monorepo root)
├── package.json                      workspaces: ["packages/*"]
├── tsconfig.base.json                공통 compilerOptions
├── tsconfig.json                     IDE 루트용 (전체 include)
├── vitest.config.ts                  루트 유지 (sharp alias, tests/mocks)
├── .gitignore, .env.*.example, README.md, CLAUDE.md, AGENTS.md
│
├── packages/
│   ├── core/
│   │   ├── package.json              @ad-ai/core
│   │   ├── tsconfig.json             extends ../../tsconfig.base.json
│   │   └── src/
│   │       ├── types.ts, storage.ts
│   │       ├── billing/, campaign/, creative/, improver/,
│   │       │   launch/, platform/, product/, rag/,
│   │       │   reviewer/, scheduler/
│   │       └── **/*.test.ts          소스 옆 공존 유지
│   │
│   ├── cli/
│   │   ├── package.json              @ad-ai/cli
│   │   ├── tsconfig.json             extends base + jsx: react-jsx
│   │   └── src/
│   │       ├── actions.ts, pipeline.ts, scraper.ts
│   │       ├── entries/              10개 entry scripts
│   │       ├── reviewer/, tui/
│   │       └── **/*.test.{ts,tsx}
│   │
│   └── server/
│       ├── package.json              @ad-ai/server
│       ├── tsconfig.json             extends base
│       └── src/
│           ├── index.ts, admin.ts, auth.ts, billing.ts, db.ts,
│           │   rateLimit.ts, scheduler.ts, stripe.ts,
│           │   webhookDedup.ts, adminUtils.ts
│           ├── jobs/, routes/
│           └── **/*.test.ts
│
├── scripts/                          루트 유지 (운영 툴)
│   ├── migrate.ts, migrate-creatives.ts
│   ├── install-worker.sh, com.adai.worker.plist
│   └── fetch-meta-ids.local.sh       (gitignored)
│
├── tests/mocks/                      루트 유지
│   ├── sharpStub.ts, fsWatch.ts
│
├── docs/                             루트 유지
│   ├── STATUS.md, ROADMAP.md, ARCHITECTURE.md,
│   └── superpowers/{specs,plans}/
│
└── data/                             루트 유지 (.gitignore, 런타임)
    ├── creatives.db, licenses.db (§5.3)
    ├── campaigns/, products/, reports/, logs/
```

### `src/` 서브폴더 추가 근거

현재 `core/types.ts` 가 core 루트 직배치 → Phase B 분리 시 새 repo 루트에 소스 파일이 뿌려짐. `packages/core/src/types.ts` 형태로 두면 분리 후 자연스럽게 `src/types.ts` 가 되고, 추후 `dist/` 빌드 아티팩트와도 명확히 분리된다.

### 루트 유지 대상과 이유

| 경로 | 성격 | 이유 |
|---|---|---|
| `scripts/` | 운영/DB 마이그/launchd | 특정 패키지 소유 아님. cross-cutting |
| `tests/mocks/` | sharp stub, fsWatch mock | vitest 전역 alias 가 참조 |
| `docs/` | 프로젝트 전체 문서 | 특정 패키지 전용 아님 |
| `data/` | 런타임 SQLite/JSON | gitignore. Owner worker 가 기록 |
| `node_modules/`, `package-lock.json` | workspaces 루트 책임 | npm workspaces convention |

### 파일 이동 명령

```bash
# packages/ 디렉토리 생성
mkdir -p packages/{core,cli,server}

# 디렉토리 통째로 이동 (숨김파일 포함, 히스토리 보존)
git mv core packages/core/src
git mv cli packages/cli/src
git mv server packages/server/src
```

`git mv <dir> <new_path>` 가 전체 디렉토리를 통으로 옮기므로 숨김파일/중첩 경로 모두 안전. `git mv <dir>/*` 대비 권장.

### DB/tmp 파일 처리

`server/data.db`, `server/test*.db`, `server/tmp/` 는 모두 `.gitignore` → untracked. git mv 대상 아님. 코드 내 경로 상수 수정 + 기존 파일 삭제로 처리 (§5.3 참조).

---

## 3. package.json 4개 설계

### 루트 `package.json`

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

핵심:
- `"private": true` → publish 잠금
- 사용자 명령 표면 불변 — `npm run app` 등 그대로 사용
- `tsx/typescript/vitest/@types/node` 는 루트 단일 선언 → hoisted
- 루트 `dotenv` 는 `scripts/migrate*.ts` 가 사용

### `packages/core/package.json`

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

- `"scripts"` 필드 없음 — core 는 라이브러리 성격. Phase B (tsc 도입) 때 `build` 스크립트 추가.
- `"exports": { "./*.js": "./src/*.ts" }` 패턴 — 아래 §"exports 패턴 동작" 참조.

### `packages/cli/package.json`

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

### `packages/server/package.json`

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

### exports 패턴 동작

```ts
import { readJson } from "@ad-ai/core/storage.js";
// Node/tsx 가 "./*.js" 패턴에 매칭 → ./src/storage.ts 로 해결

import { createMetaAdapter } from "@ad-ai/core/platform/meta/adapter.js";
// 중첩 경로도 동일 패턴으로 해결 → ./src/platform/meta/adapter.ts
```

- 소비자는 `.js` 확장자로 import (TypeScript `moduleResolution: "bundler"` / `"nodenext"` 표준 관습 + 현 코드베이스 관습)
- `tsx` 로더가 `.ts` 파일을 JIT transpile
- `tsc` 빌드 불필요 (Phase A 기간)
- TypeScript 5+ `moduleResolution: "bundler"` 가 exports 패턴 이해 → 타입 체크도 동일 경로로 해결

### install 후 symlink 검증

```bash
npm install
ls -la node_modules/@ad-ai/
# core -> ../../packages/core
# cli  -> ../../packages/cli
# server -> ../../packages/server
```

---

## 4. tsconfig 전략 & Import 경로 일괄 치환

### tsconfig 파일 5개

#### `tsconfig.base.json` (루트 공통)

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

`include`/`jsx`/`outDir` 제외. 각 패키지가 오버라이드.

#### `packages/core/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"]
}
```

#### `packages/cli/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx"
  },
  "include": ["src/**/*"]
}
```

jsx 는 cli 만 필요. 검증: `core/`, `server/` 에 `.tsx` 파일 0개, `cli/` 에 32개.

#### `packages/server/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"]
}
```

#### `tsconfig.json` (루트 IDE 집합용)

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
  ]
}
```

루트 열었을 때 IDE 가 전체 인식. 파일 편집 시엔 가장 가까운 tsconfig 우선.

**왜 project references 안 쓰는가**: `"composite": true` 요구 → `declaration: true` + emit 강제. Phase A 에서 tsc 빌드 안 하므로 emit 낭비. Phase B 전환 시 재검토.

### Import 경로 일괄 치환

#### 현재 패턴 (깊이 별)

```ts
// cli/actions.ts
import { readJson } from "../core/storage.js";

// cli/entries/app.ts
import { generateCopy } from "../../core/creative/copy.js";

// cli/tui/hooks/useReports.ts
import { readJson } from "../../../core/storage.js";
```

#### 치환 후

```ts
import { readJson } from "@ad-ai/core/storage.js";
import { generateCopy } from "@ad-ai/core/creative/copy.js";
import { readJson } from "@ad-ai/core/storage.js";
```

깊이 무관하게 동일 prefix 수렴.

#### sed 명령 (macOS / Phase A)

```bash
# cli 패키지 내부
find packages/cli/src -type f \( -name "*.ts" -o -name "*.tsx" \) -print0 \
  | xargs -0 sed -i '' -E 's|from "(\.\./)+core/(.+)\.js"|from "@ad-ai/core/\2.js"|g'

# server 패키지 내부
find packages/server/src -type f \( -name "*.ts" -o -name "*.tsx" \) -print0 \
  | xargs -0 sed -i '' -E 's|from "(\.\./)+core/(.+)\.js"|from "@ad-ai/core/\2.js"|g'
```

정규식:
- `(\.\./)+` — `../`, `../../`, `../../../` 모두 매칭
- `core/(.+)\.js` — core/ 이후 경로 캡처 (중첩 포함)

`import type`, `import`, `export ... from` 모두 `from "..."` 공통이라 한 번에 치환됨.

#### 누락 검증

```bash
REMAINING=$(grep -rln 'from "\(\.\./\)\+core/' packages/cli/src packages/server/src | wc -l)
[[ "$REMAINING" -eq 0 ]] || { echo "❌ 치환 누락 $REMAINING 파일"; exit 1; }
npm test  # 314/314 확인
```

#### 패키지 내부 상대 import 는 불변

- core 내부: `from "../creative/copy.js"` 같은 상대 import 그대로 유지
- sed 패턴이 `core/` prefix 경로만 매칭 → core 내부 안전

### vitest 설정 유지

```ts
// vitest.config.ts (변경 없음)
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      sharp: new URL("./tests/mocks/sharpStub.ts", import.meta.url).pathname,
    },
  },
});
```

- vitest 기본 glob `**/*.{test,spec}.?(c|m)[jt]s?(x)` 이 `packages/**/*.test.ts` 자동 발견
- `@ad-ai/core/*` import 는 workspace symlink + exports 패턴으로 vitest 의 Vite resolver 가 해결
- sharp stub alias 경로 그대로 유효

### scripts/ 제약 사항

`scripts/*.ts` 는 어느 패키지도 아니라 `@ad-ai/core/*` import 불가. 필요 시 scripts 도 package 화 또는 루트에 `"@ad-ai/core": "workspace:*"` 추가. 현재 migrate*.ts 는 core 미사용 → 제약 없음.

---

## 5. 운영 업데이트 (launchd, 문서, agents, DB)

### 5.1 launchd plist

#### `scripts/com.adai.worker.plist` 수정

```diff
   <key>ProgramArguments</key>
   <array>
     <string>__TSX_PATH__</string>
-    <string>cli/entries/worker.ts</string>
+    <string>packages/cli/src/entries/worker.ts</string>
   </array>
```

`WorkingDirectory` 는 `__PROJECT_ROOT__` 그대로 — 상대경로 `packages/cli/src/entries/worker.ts` 가 루트에서 해결.

#### 사용자 재설치 절차

```bash
launchctl unload ~/Library/LaunchAgents/com.adai.worker.plist
rm ~/Library/LaunchAgents/com.adai.worker.plist
bash scripts/install-worker.sh   # template 새 경로로 재생성
# 기존 __INJECT__ 값들은 수동 복원 필요
```

`install-worker.sh` 는 변경 없음 (sed 치환 로직 그대로).

### 5.2 문서 경로 업데이트

#### 업데이트 대상 (현행 문서만)

| 파일 | 변경 |
|---|---|
| `CLAUDE.md` | 빠른 네비게이션, Subagent 호출 규칙 표 경로 |
| `docs/STATUS.md` | 서비스 컴포넌트 표의 "위치" 컬럼 |
| `docs/ARCHITECTURE.md` | 모듈 설명 경로 prefix |
| `docs/ROADMAP.md` | 경로 참조 (grep 로 확인 후 갱신) |
| `README.md` | 구조도/빠른 시작 |
| `AGENTS.md` | 참조 경로 |
| `.env.owner.example`, `.env.service.example` | 주석의 server/cli 파일 참조 |
| `.claude/agents/meta-platform-expert.md` | `core/platform/meta/*` 트리거 경로 |
| `.claude/agents/marketing-copy-reviewer.md` | `core/creative/prompt.ts` 경로 |

#### 업데이트 제외 (역사 문서)

- `docs/superpowers/specs/*.md` (기존 17개)
- `docs/superpowers/plans/*.md` (기존 17개)

**이유**: 당시 시점 구조 기록. 업데이트하면 역사 왜곡. 새로 작성되는 spec/plan 은 반드시 `packages/*/src/...` 경로 사용.

#### 경로 치환 매핑

| 현재 | 교체 후 |
|---|---|
| `core/` | `packages/core/src/` |
| `cli/` | `packages/cli/src/` |
| `server/` | `packages/server/src/` |
| `server/data.db` | `data/licenses.db` (§5.3) |

문서 수가 소수이므로 **파일별 수동 치환 권장** (sed 일괄은 이미 변환된 경로에 재변환 위험).

### 5.3 `server/data.db` → `data/licenses.db` 경로 이전

#### 변경 이유

런타임 아티팩트는 `data/` 로 통합 (creatives.db, campaigns/, reports/ 와 일관). 현재 server 비활성 상태라 마이그레이션 부담 없음.

#### 코드 수정

```diff
// packages/server/src/db.ts
- const DB_PATH = "server/data.db";
+ const DB_PATH = "data/licenses.db";
```

기존 `server/data.db` 파일 삭제 → 최초 재실행 시 `data/licenses.db` 자동 생성.

#### 테스트 DB 경로 변경

```diff
// packages/server/src/db.test.ts
- const TEST_DB = "server/test.db";
+ const TEST_DB = "packages/server/src/test.db";

// packages/server/src/billing.test.ts
- const TEST_DB = "server/test-billing.db";
+ const TEST_DB = "packages/server/src/test-billing.db";
```

`process.cwd()` 기준 상대경로 관습 유지 (프로젝트 관습 일관성).

#### `.gitignore` 정리

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

### 5.4 Subagent 트리거 경로 갱신

#### `.claude/agents/meta-platform-expert.md`

```diff
- **Trigger paths**: `core/platform/meta/*` 수정 시, `core/platform/meta/launcher.ts` 에러 진단 시
+ **Trigger paths**: `packages/core/src/platform/meta/*` 수정, `packages/core/src/platform/meta/launcher.ts` 에러 진단
```

#### `.claude/agents/marketing-copy-reviewer.md`

```diff
- **Trigger paths**: `core/creative/prompt.ts`, `runGenerate`/`runImprove` 산출물
+ **Trigger paths**: `packages/core/src/creative/prompt.ts`, `runGenerate`/`runImprove` 산출물
```

`CLAUDE.md` §"Subagent 호출 규칙" 표도 동일 반영.

#### 순서 주의 (플랜 단계 Task 순서 제약)

`packages/` 로 파일 이동 커밋 **이후**에 agents md 갱신. 너무 일찍 바꾸면 dispatch 가 옛 경로 타겟으로 실패.

### 5.5 README.md 구조도

루트 구조도에 `packages/` 계층 반영. 사용자 명령은 불변:

```bash
npm install
npm run app        # TUI 통합 앱
npm run pipeline   # scrape → generate
npm run launch     # 승인된 소재 Meta 게재
```

### 5.6 변경 영향 없는 것들 (명시)

- `data/` 런타임 디렉토리 구조 (products/, creatives/, campaigns/, reports/, logs/)
- `.env.*.example` 변수명 (주석만 변경)
- `npm run *` 명령 표면
- API 엔드포인트, Meta SDK 사용, Stripe webhook
- `data/creatives.db` 스키마

---

## 6. Phase B: 추후 repo 분리 플레이북

### Phase B 연기 원칙

**실운영 검증이 끝나고 API 표면이 안정화되기 전까지 분리하지 않는다.**

근거: 분리는 변경당 repo N번 touch 를 강제한다. `@ad-ai/core` 함수 시그니처 하나만 바꿔도 core repo 커밋·tag·publish → cli/server 에서 버전 업 → 각자 `npm install` → 테스트. 매번. API 가 움직이는 기간엔 semver 관리 비용이 불필요하게 누적된다.

**지금 시점: 해당 없음. Phase A 에 머무름.**

### 분리 시점 트리거 (아래 중 하나라도 참)

- [ ] `@ad-ai/core` 를 다른 프로젝트에서도 import 하고 싶어짐 (재사용 수요 실제 발생)
- [ ] 공개 publish 결정 + 안정화된 API 표면 확정
- [ ] CI 파이프라인 분리 필요
- [ ] 다른 사람/팀이 특정 패키지만 관리

### 분리 대상 우선순위

1. **1순위: `@ad-ai/core`** — leaf 노드, 재사용 가치 가장 큼
2. **2순위: `@ad-ai/server`** — 재활성 시점에 자체 repo 로 배포 경계 자연스러움
3. **3순위: `@ad-ai/cli`** — TUI + playwright + ink 조합 — 보통 monorepo 에서 실행. 분리 가능성 낮음

### `@ad-ai/core` 분리 절차 (예시)

```bash
# 1. 히스토리 보존하며 subtree split
git subtree split --prefix=packages/core --branch=split-core

# 2. 새 GitHub repo 생성 & push
cd /tmp && mkdir ad-ai-core && cd ad-ai-core
git init
git remote add origin git@github.com:your-org/ad-ai-core.git
git pull /path/to/ad_ai split-core
git push -u origin main

# 3. tsc 빌드 세팅 (새 repo 에서)
#    - package.json 에 "main": "./dist/index.js", "scripts.build": "tsc"
#    - tsconfig.json 에 "declaration": true, "outDir": "./dist", "rootDir": "./src"
#    - .gitignore 에 dist/ 추가

# 4. monorepo 의존성 전환
#    packages/cli/package.json, packages/server/package.json:
#      "@ad-ai/core": "workspace:*" → "@your-org/core": "^1.0.0"

# 5. Import 경로 scope 변경 필요 시 sed 치환
#    (@ad-ai 유지하면 scope 고유이니 치환 불필요)

# 6. monorepo 에서 packages/core/ 제거
git rm -r packages/core
git commit -m "chore: extract @ad-ai/core to separate repo"
```

### 배포 방식 옵션

| 옵션 | 설명 | 적합 시기 |
|---|---|---|
| npm 공개 (npmjs.com) | scope 소유권 필요, 누구나 설치 | 공개 확정 + 안정화 후 |
| GitHub Packages (private) | PAT 인증, private org 패키지 | 팀/조직 내부 배포 |
| Git URL 직접 참조 | publish 없이 `git+ssh://...#v1.0.0` | 분리 직후 안정화 기간 |

**권장 경로**: 분리 직후 Git URL → stable 확인 후 npm publish.

### Phase A 설계가 Phase B 를 쉽게 만드는 장치들

- `src/` 서브폴더 → 분리 시 repo 루트에 자연스럽게 떨어짐
- `exports: { "./*.js": "./src/*.ts" }` → `"./dist/*.js"` 로 한 줄 교체
- `workspace:*` → `^1.0.0` 로 한 줄 교체
- 각 패키지 자체 `package.json` + `tsconfig.json` → 분리 후 추가 세팅 불필요
- Deep import (`@ad-ai/core/storage.js`) → scope/name 만 바꾸면 됨

### Phase B 를 지금 고민하지 않아도 되는 것들

- npm org 확보 / publish 세팅
- tsc 빌드 파이프라인
- CI/CD
- semver 전략
- changelog / release notes

→ 분리 당일 해당 패키지에서만 추가.

---

## Phase 0 — 사전 검증 (리팩터 시작 전 필수)

대규모 치환을 시작하기 전에 **tsx + exports 패턴** 조합이 실제로 동작하는지 1파일 규모로 검증한다.

### 검증 절차

```bash
# 1. 임시 패키지 하나 생성
mkdir -p /tmp/tsx-exports-probe/pkg/src
cd /tmp/tsx-exports-probe

# 2. root package.json
cat > package.json <<'EOF'
{
  "name": "probe", "type": "module", "private": true,
  "workspaces": ["pkg"],
  "dependencies": { "@probe/lib": "workspace:*" },
  "devDependencies": { "tsx": "^4.7.3" }
}
EOF

# 3. 내부 패키지
cat > pkg/package.json <<'EOF'
{
  "name": "@probe/lib", "version": "1.0.0", "type": "module",
  "exports": { "./*.js": "./src/*.ts" }
}
EOF
echo 'export const hello = () => "world";' > pkg/src/greeting.ts

# 4. 소비자
cat > main.ts <<'EOF'
import { hello } from "@probe/lib/greeting.js";
console.log(hello());
EOF

# 5. 검증
npm install
npx tsx main.ts
# 기대 출력: world
```

### 실패 시 대응

`npx tsx main.ts` 가 `ERR_MODULE_NOT_FOUND` 또는 `ERR_UNKNOWN_FILE_EXTENSION` 등으로 실패하면 exports 패턴을 대체:

- **대안 A**: `"exports": { "./*": "./src/*" }` (확장자 없이 매핑, 소비자가 `.js` 없이 import)
- **대안 B**: barrel index — `"exports": "./src/index.ts"` + core 에 index.ts 작성
- **대안 C**: tsconfig `paths` 로 alias + `exports` 대신 `main` 필드

본 리팩터는 대안 A 또는 B 로 폴백 가능. 대안 선택 시 플랜의 Import 치환 sed 패턴이 달라지므로 **Phase 0 결과에 따라 플랜 §Import 치환 섹션 재작성**.

### 성공 시

성공하면 그대로 Phase A 본작업으로 진입. 검증 파일 (`/tmp/tsx-exports-probe/`) 제거.

---

## 검증 체크포인트 (리팩터 완료 후 필수)

```bash
# 1. workspace symlink 생성 확인
npm install
ls -la node_modules/@ad-ai/
# 기대: core, cli, server 3개 symlink

# 2. 치환 누락 0 확인
REMAINING=$(grep -rln 'from "\(\.\./\)\+core/' packages/cli/src packages/server/src | wc -l)
[[ "$REMAINING" -eq 0 ]] || { echo "❌ 치환 누락 $REMAINING 파일"; exit 1; }

# 3. 전체 테스트 통과
npm test
# 기대: 314/314 passed

# 4. 주요 entry 실행 smoke test
npm run app       # TUI 정상 뜨는지
npm run server    # server 부트 에러 없는지 (즉시 Ctrl-C)

# 5. 타입체크 (선택)
npx tsc --noEmit  # 루트 tsconfig 기준 전체 체크
```

---

## 검토 이력

### 2026-04-24 — 초안 섹션별 자체 검토

섹션 1-6 각각 CLAUDE.md §"검토 깊이 요구사항" 5개 점검 적용.

**Critical**: 없음. Section 4 의 "cli 만 jsx 필요" 검증 대상 — `find core server -name "*.tsx" | wc -l` 결과 0 확인 → 확정.

**Important** (해결됨):
- Section 2: `server/data.db` 등 DB 파일은 untracked → git mv 아닌 경로 상수 변경 + 기존 파일 삭제로 처리 (§5.3 반영)
- Section 3: `@ad-ai/core` 는 `"scripts"` 필드 없음 — 의도된 상태로 명시 (§3 §`packages/core/package.json` 주석)
- Section 4: 치환 후 누락 검증 grep 명령 체크포인트에 명시 (§"검증 체크포인트")
- Section 5: server `db.test.ts`/`billing.test.ts` 에 하드코딩된 `server/test.db` 경로 발견 → 명시적 경로 변경 Task 추가 (§5.3)
- Section 5: subagent md 갱신은 파일 이동 커밋 이후 순서 지정 (§5.4)

**Minor**:
- Section 1: `billing/` server 전용 표현은 "server 재활성 시 소비" 로 명확화 (§1 §"billing/ 이 core 에 속하는 이유")
- Section 2: `cli/tui/theme/tokens.ts` 등 경로 참조 문서 업데이트 (§5.2 에서 처리)
- Section 4: 루트 `tsconfig.json` 선택 — `tsc --noEmit` 전체 검사 편의상 포함

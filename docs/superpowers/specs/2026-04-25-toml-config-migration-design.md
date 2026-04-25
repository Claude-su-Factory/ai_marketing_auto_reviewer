# TOML 설정 마이그레이션 설계 — `.env` 완전 폐기 및 단일 `config.toml` 도입

**작성**: 2026-04-25
**상태**: 설계 (Sub-project 1 — TOML 인프라)
**관련**: Sub-project 2 (멀티플랫폼 어댑터 — TikTok / Google Ads / YouTube). 본 스펙 완료 후 별도 스펙으로 진행.

## 목적

17개 환경변수와 33개 `process.env.X` 사용처를 단일 `config.toml` 파일로 마이그레이션한다. `dotenv` 의존성과 모든 `.env*` 파일을 제거하여, 향후 멀티플랫폼 어댑터 추가(TikTok/Google Ads/YouTube)가 깨끗한 도메인별 config 인프라 위에서 시작 가능하게 한다.

## 범위

### 포함

- `packages/core/src/config/` 모듈 신규 추가 (smol-toml 파서 + Zod 스키마 + lazy singleton + test helper)
- `config.toml` (gitignore) + `config.example.toml` (커밋) 도입
- 17개 변수 → TOML 도메인 스키마 매핑
- 33개 `process.env.X` 호출처를 `getConfig().X.Y` 또는 도메인 helper로 변환
- 기존 테스트의 환경변수 mock을 `setConfigForTesting(makeTestConfig({...}))` 패턴으로 일괄 변환
- `dotenv` 의존성 제거, 모든 `import "dotenv/config"` 제거
- `.env.owner.example`, `.env.service.example` 삭제
- `scripts/fetch-meta-ids.local.sh` 재작성 (TOML 스니펫 출력)
- README setup 절차 업데이트

### 제외

- 멀티플랫폼 어댑터 구현 (Sub-project 2)
- 기존 Meta DCO / AI / billing / server 동작 변경
- DB 스키마, 라이선스 로직 변경

### 예외 1건

`CONFIG_PATH`만 `process.env`로 남긴다. "어떤 config 파일을 읽을지" 결정하는 메타 설정으로 17개 도메인 변수와 성격이 다르다. 미주입 시 `config.toml` 기본 경로 사용.

## 결정 요약

| 주제 | 결정 |
|---|---|
| 설정 파일 형식 | TOML (`smol-toml` 라이브러리, ~12KB, 의존성 0) |
| 파일 위치 | 루트 `config.toml` (gitignore) + `config.example.toml` (커밋) |
| 스키마 구조 | 도메인별 (`[platforms.meta]`, `[ai.anthropic]`, `[billing.stripe]`, `[server]`, `[defaults]`) |
| 검증 | Zod 스키마 + `superRefine`으로 cross-validation |
| Loader API | Lazy singleton (`getConfig()`) + test helper (`setConfigForTesting`/`resetConfigForTesting`) |
| 테스트 전략 | `makeTestConfig(overrides)` 빌더 + vitest setup 자동 reset |
| 마이그레이션 | Big-bang (점진적 compat layer 없음) |
| 환경변수 잔존 | `CONFIG_PATH` 1건만 허용 |

---

## 1. TOML 스키마 (`config.example.toml`)

### 전체 템플릿

```toml
# config.example.toml — ad_ai 설정 템플릿
# 사용법: cp config.example.toml config.toml 후 실제 값 입력
# config.toml은 .gitignore에 있어 커밋되지 않음

[platforms]
# 활성화할 광고 플랫폼 목록. Sub-project 2에서 "tiktok", "google" 추가 가능
enabled = ["meta"]

[platforms.meta]
access_token = "EAA..."           # Meta Marketing API access token
ad_account_id = "act_1234567890"  # "act_" 접두사 포함
page_id = "1234567890"
instagram_actor_id = "1234567890"

[ai.anthropic]
api_key = "sk-ant-..."

[ai.google]
api_key = "AIza..."

[ai.voyage]
api_key = "pa-..."

[billing.stripe]
# Service 모드(웹 UI + 결제) 사용 시에만 필요. Owner 모드 전용이라면 섹션 생략 가능
secret_key = "sk_test_..."
webhook_secret = "whsec_..."

[server]
# Service 모드에서만 사용
base_url = "http://localhost:3000"
port = 3000

[defaults]
daily_budget_krw = 10000
duration_days = 14
target_age_min = 20
target_age_max = 45
ctr_improvement_threshold = 1.5
```

(defaults는 기존 `.env.owner.example`/`packages/core/src/platform/meta/launcher.ts`/`packages/core/src/improver/index.ts`의 실제 값과 동일하게 유지)

### 17개 변수 매핑표

| 기존 env 변수 | TOML 경로 |
|---|---|
| `META_ACCESS_TOKEN` | `platforms.meta.access_token` |
| `META_AD_ACCOUNT_ID` | `platforms.meta.ad_account_id` |
| `META_PAGE_ID` | `platforms.meta.page_id` |
| `META_INSTAGRAM_ACTOR_ID` | `platforms.meta.instagram_actor_id` |
| `AD_PLATFORMS` | `platforms.enabled` (배열) |
| `ANTHROPIC_API_KEY` | `ai.anthropic.api_key` |
| `GOOGLE_AI_API_KEY` | `ai.google.api_key` |
| `VOYAGE_API_KEY` | `ai.voyage.api_key` |
| `STRIPE_SECRET_KEY` | `billing.stripe.secret_key` |
| `STRIPE_WEBHOOK_SECRET` | `billing.stripe.webhook_secret` |
| `SERVER_BASE_URL` | `server.base_url` |
| `SERVER_PORT` | `server.port` |
| `AD_DAILY_BUDGET_KRW` | `defaults.daily_budget_krw` |
| `AD_DURATION_DAYS` | `defaults.duration_days` |
| `AD_TARGET_AGE_MIN` | `defaults.target_age_min` |
| `AD_TARGET_AGE_MAX` | `defaults.target_age_max` |
| `CTR_IMPROVEMENT_THRESHOLD` | `defaults.ctr_improvement_threshold` |

명명 규칙: TOML key는 `snake_case` (TOML 관용). 내부 TS 타입도 동일하게 snake_case 유지 (변환 비용 0, 매핑 직관적).

---

## 2. Loader API 및 디렉토리 구조

### 디렉토리 구조

```
packages/core/src/config/
├── index.ts               # Public API (getConfig + test helpers)
├── schema.ts              # Zod 스키마 + Config 타입
├── loader.ts              # 파일 읽기 + parse + validate (internal)
├── helpers.ts             # 도메인 require helpers
├── testing.ts             # makeTestConfig + BASE_CONFIG + deepMerge
├── loader.test.ts         # loader 단위 테스트 (실 fixture 파일)
├── schema.test.ts         # Zod 스키마/superRefine 테스트
└── __fixtures__/
    ├── valid.toml
    ├── invalid.toml
    └── missing-meta.toml  # superRefine cross-validation 케이스
```

### `index.ts` (Public API)

```ts
import { loadConfig } from "./loader.js";
import type { Config } from "./schema.js";

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached === null) cached = loadConfig();
  return cached;
}

/** @internal Test-only — production code MUST NOT call this */
export function setConfigForTesting(mock: Config): void {
  cached = mock;
}

/** @internal Test-only — production code MUST NOT call this */
export function resetConfigForTesting(): void {
  cached = null;
}

export type { Config } from "./schema.js";
```

### `loader.ts`

```ts
import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import { ConfigSchema, type Config } from "./schema.js";

const DEFAULT_CONFIG_PATH = "config.toml";

export function loadConfig(): Config {
  const path = process.env.CONFIG_PATH ?? DEFAULT_CONFIG_PATH;

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Config file not found at "${path}". ` +
        `Copy config.example.toml to config.toml and fill in real values.`
      );
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse TOML "${path}": ${(err as Error).message}`);
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid config at "${path}":\n${issues}`);
  }

  return result.data;
}
```

### 환경변수 정책

- `CONFIG_PATH`만 허용 (메타 설정). 미주입 시 `config.toml`
- 그 외 17개 변수는 모두 `getConfig().X.Y` 또는 도메인 helper 사용. `process.env.X` 직접 참조 금지

### 에러 처리

- 파일 없음 → 명확한 메시지 + 복구 방법(`config.example.toml` 복사) 안내
- TOML 파싱 실패 → 라이브러리 에러 메시지 + 파일 경로
- Zod 검증 실패 → path 단위로 issue 리스트 (예: `platforms.meta.access_token: required`)

---

## 3. Zod 스키마 + Optionality

### `schema.ts`

```ts
import { z } from "zod";

const PlatformId = z.enum(["meta", "tiktok", "google"]);

const MetaPlatform = z.object({
  access_token: z.string().min(1),
  ad_account_id: z.string().regex(/^act_\d+$/, 'must be "act_" + digits'),
  page_id: z.string().regex(/^\d+$/),
  instagram_actor_id: z.string().regex(/^\d+$/),
});

const PlatformsSection = z.object({
  enabled: z.array(PlatformId).min(1, "at least one platform must be enabled"),
  meta: MetaPlatform.optional(),
  // tiktok / google: Sub-project 2에서 추가
});

const AiSection = z.object({
  anthropic: z.object({ api_key: z.string().min(1) }).optional(),
  google:    z.object({ api_key: z.string().min(1) }).optional(),
  voyage:    z.object({ api_key: z.string().min(1) }).optional(),
}).default({}).superRefine((ai, ctx) => {
  if (!ai.anthropic && !ai.google) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ai"],
      message: "[ai.anthropic] 또는 [ai.google] 중 최소 1개의 api_key가 필요합니다",
    });
  }
});

const BillingSection = z.object({
  stripe: z.object({
    secret_key:     z.string().min(1),
    webhook_secret: z.string().min(1),
  }).optional(),
}).optional();

const ServerSection = z.object({
  base_url: z.string().url().default("http://localhost:3000"),
  port:     z.number().int().positive().default(3000),
}).default({});

const DefaultsSection = z.object({
  daily_budget_krw:          z.number().int().positive().default(10000),
  duration_days:             z.number().int().positive().default(14),
  target_age_min:            z.number().int().min(13).default(20),
  target_age_max:            z.number().int().max(65).default(45),
  ctr_improvement_threshold: z.number().positive().default(1.5),
}).default({});

export const ConfigSchema = z.object({
  platforms: PlatformsSection,
  ai:        AiSection,
  billing:   BillingSection,
  server:    ServerSection,
  defaults:  DefaultsSection,
}).superRefine((cfg, ctx) => {
  // enabled 배열의 각 플랫폼은 해당 자식 섹션이 반드시 존재해야 함
  for (const id of cfg.platforms.enabled) {
    if (id === "meta" && !cfg.platforms.meta) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["platforms", "meta"],
        message: '"meta"가 platforms.enabled에 있지만 [platforms.meta] 섹션이 없습니다',
      });
    }
    // tiktok / google: Sub-project 2에서 동일 패턴 추가
  }
});

export type Config = z.infer<typeof ConfigSchema>;
```

### Optionality 매트릭스

| 섹션 | 스키마 | 호출처 패턴 |
|---|---|---|
| `platforms` | required | `getConfig().platforms.enabled` |
| `platforms.meta` | optional + superRefine | `requireMeta()` helper로 narrowing |
| `ai` (parent) | optional, default `{}` + superRefine (anthropic OR google) | `getConfig().ai.anthropic?.api_key` |
| `ai.anthropic`, `ai.google`, `ai.voyage` | optional | `requireAnthropicKey()` 등 도메인 helper |
| `billing` | optional | Server 시작 시 검증 |
| `billing.stripe` | optional | `requireStripeConfig()` helper |
| `server` | optional + defaults | 항상 정의 보장 |
| `defaults` | optional + per-field defaults | 항상 정의 보장 |

### 도메인 helper (`helpers.ts`)

```ts
import { getConfig, type Config } from "./index.js";

export function requireMeta(cfg: Config = getConfig()): NonNullable<Config["platforms"]["meta"]> {
  if (!cfg.platforms.meta) {
    throw new Error('[platforms.meta] is required for this operation');
  }
  return cfg.platforms.meta;
}

export function requireAnthropicKey(): string {
  const key = getConfig().ai.anthropic?.api_key;
  if (!key) throw new Error("[ai.anthropic.api_key] is required for this operation");
  return key;
}

export function requireGoogleAiKey(): string {
  const key = getConfig().ai.google?.api_key;
  if (!key) throw new Error("[ai.google.api_key] is required for this operation");
  return key;
}

export function requireVoyageKey(): string {
  const key = getConfig().ai.voyage?.api_key;
  if (!key) throw new Error("[ai.voyage.api_key] is required for this operation");
  return key;
}

export function requireStripeConfig(): NonNullable<NonNullable<Config["billing"]>["stripe"]> {
  const stripe = getConfig().billing?.stripe;
  if (!stripe) throw new Error("[billing.stripe] is required for this operation");
  return stripe;
}
```

호출처 변환 패턴:

```ts
// Before
const token = process.env.META_ACCESS_TOKEN;
if (!token) throw new Error("META_ACCESS_TOKEN required");

// After
import { requireMeta } from "@ad-ai/core/config/helpers";
const { access_token } = requireMeta();
```

---

## 4. 테스트 전략

### `testing.ts` (BASE_CONFIG + makeTestConfig)

```ts
import type { Config } from "./schema.js";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const BASE_CONFIG: Config = {
  platforms: {
    enabled: ["meta"],
    meta: {
      access_token: "test-meta-token",
      ad_account_id: "act_0000000000",
      page_id: "0000000000",
      instagram_actor_id: "0000000000",
    },
  },
  ai: {
    anthropic: { api_key: "test-anthropic-key" },
    google:    { api_key: "test-google-key" },
    voyage:    { api_key: "test-voyage-key" },
  },
  billing: {
    stripe: { secret_key: "sk_test_xxx", webhook_secret: "whsec_xxx" },
  },
  server: { base_url: "http://localhost:3000", port: 3000 },
  defaults: {
    daily_budget_krw: 10000,
    duration_days: 14,
    target_age_min: 20,
    target_age_max: 45,
    ctr_improvement_threshold: 1.5,
  },
};

function deepMerge<T>(base: T, overrides: DeepPartial<T>): T {
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const key of Object.keys(overrides) as (keyof T)[]) {
    const ov = overrides[key];
    const bv = (base as any)[key];
    if (ov && typeof ov === "object" && !Array.isArray(ov) && bv && typeof bv === "object") {
      out[key] = deepMerge(bv, ov as any);
    } else if (ov !== undefined) {
      out[key] = ov;
    }
  }
  return out;
}

export function makeTestConfig(overrides: DeepPartial<Config> = {}): Config {
  return deepMerge(BASE_CONFIG, overrides);
}
```

### `vitest.setup.ts` (위치는 plan task 1에서 확정)

```ts
import { beforeEach, afterEach } from "vitest";
import { setConfigForTesting, resetConfigForTesting } from "@ad-ai/core/config";
import { makeTestConfig } from "@ad-ai/core/config/testing";

beforeEach(() => {
  setConfigForTesting(makeTestConfig());
});

afterEach(() => {
  resetConfigForTesting();
});
```

`vitest.config.ts`:
```ts
export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

이로써 모든 테스트는 BASE_CONFIG로 시작. `getConfig()`가 file system을 건드리지 않음 (CI/sandbox 안전).

**예외**: `loader.test.ts`는 실 fixture 파일을 읽어야 하므로 setup의 `setConfigForTesting` 우회 필요. plan task 1에서 `vi.unmock` 또는 `resetConfigForTesting` 후 fixture 경로로 `CONFIG_PATH` 주입하는 패턴 명시.

### 개별 테스트 패턴

```ts
// 기본 config로 충분 — 추가 코드 없음
test("creative gen succeeds", () => {
  expect(generate(...)).toBeDefined();
});

// 일부 필드만 override
test("works with custom budget", () => {
  setConfigForTesting(makeTestConfig({
    defaults: { daily_budget_krw: 50000 },
  }));
});

// 플랫폼 disable
test("fails when meta not enabled", () => {
  setConfigForTesting(makeTestConfig({
    platforms: { enabled: ["tiktok"] },
  }));
  expect(() => requireMeta()).toThrow();
});
```

deepMerge로 nested override가 자연스럽다 (`platforms: { enabled: [...] }`만 적어도 meta 자식은 BASE에서 유지).

### 기존 테스트 마이그레이션

```ts
// Before
beforeEach(() => {
  vi.stubEnv("META_ACCESS_TOKEN", "test-token");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});
afterEach(() => vi.unstubAllEnvs());

// After
beforeEach(() => {
  setConfigForTesting(makeTestConfig({
    platforms: { meta: { access_token: "test-token" } },
    ai: { anthropic: { api_key: "test-key" } },
  }));
});
// (afterEach reset은 vitest.setup.ts가 일괄 처리)
```

---

## 5. 마이그레이션 메커니즘

### Task 분할 (Big-bang을 subagent-driven 단위로)

| Task | 내용 | 커밋 후 상태 |
|---|---|---|
| 1 | 의존성 추가 (`smol-toml`, `zod`), `packages/core/src/config/` 모듈 (loader + schema + helpers + testing.ts), `config.example.toml`, `vitest.setup.ts`, `.gitignore` 갱신 | 인프라 준비. dotenv 유지. 호출처 변환 0 |
| 2 | `[platforms.meta]` 도메인 호출처 변환 + 해당 도메인 직접 단위 테스트 동시 변환 | meta는 TOML, 나머지는 .env |
| 3 | `[ai.*]` 도메인 호출처 + 직접 테스트 | ai도 TOML |
| 4 | `[billing.stripe]` 도메인 호출처 + 직접 테스트 | billing도 TOML |
| 5 | `[server]` 도메인 호출처 + 직접 테스트 | server도 TOML |
| 6 | `[defaults]` 도메인 호출처 + 직접 테스트 | 모든 17개 변수 변환 완료 |
| 7 | 남은 간접/E2E 테스트 일괄 변환 (도메인 경계가 모호한 통합 테스트) | 테스트 컨벤션 통일 |
| 8 | `dotenv` 의존성 제거, 모든 `import "dotenv/config"` 삭제, `.env.owner.example`/`.env.service.example` 삭제, `scripts/fetch-meta-ids.local.sh` 재작성 | `.env` 인프라 완전 제거 |
| 9 | README setup 절차 업데이트, `docs/STATUS.md`/`ROADMAP.md`/`ARCHITECTURE.md` 갱신, `CLAUDE.md`에 환경변수 금지 규칙 1줄 추가 | 문서 일관성 |

**중간 상태 안내**: Task 2~7 진행 중에는 dev 환경에 `config.toml`과 `.env` 양쪽이 필요하다. Task 1에서 `config.toml` 생성을 README 임시 안내. 이 상태는 일시적이며 Task 8에서 `.env` 의존이 완전히 사라진다.

### 호출처 변환 패턴 (도메인별)

```ts
// Meta (Task 2)
import { requireMeta } from "@ad-ai/core/config/helpers";
const { access_token: token, ad_account_id: accountId } = requireMeta();

// AI (Task 3)
import { requireAnthropicKey } from "@ad-ai/core/config/helpers";
const key = requireAnthropicKey();

// Billing (Task 4)
import { requireStripeConfig } from "@ad-ai/core/config/helpers";
const { secret_key: stripeKey } = requireStripeConfig();

// Server (Task 5) — defaults 보장되므로 narrow 불필요
import { getConfig } from "@ad-ai/core/config";
const port = getConfig().server.port;

// Defaults (Task 6) — 동일
const budget = getConfig().defaults.daily_budget_krw;
```

### `scripts/fetch-meta-ids.local.sh` 재작성

```bash
#!/bin/bash
# fetch-meta-ids.local.sh — Meta API에서 ad_account_id / page_id / instagram_actor_id 조회
# 출력: TOML 스니펫 (config.toml의 [platforms.meta] 섹션에 복사)

set -euo pipefail

ACCESS_TOKEN="${1:?usage: $0 <ACCESS_TOKEN>}"

ACCOUNT_JSON=$(curl -sf "https://graph.facebook.com/v19.0/me/adaccounts?access_token=$ACCESS_TOKEN")
PAGE_JSON=$(curl -sf "https://graph.facebook.com/v19.0/me/accounts?access_token=$ACCESS_TOKEN")
# ... (jq parsing — 기존 스크립트의 jq 사용 패턴 1:1 대조 후 유지)

cat <<EOF
# 아래 스니펫을 config.toml의 [platforms.meta] 섹션에 복사하세요

[platforms.meta]
access_token = "$ACCESS_TOKEN"
ad_account_id = "$AD_ACCOUNT_ID"
page_id = "$PAGE_ID"
instagram_actor_id = "$INSTAGRAM_ACTOR_ID"
EOF
```

기존 `.env` 라인 출력은 완전히 제거.

### `process.env` 직접 참조 금지 검증

- 본 마이그레이션은 ESLint 룰 추가 인프라를 도입하지 않는다 (단일 개발자 환경, 미설정 상태)
- 대신 Task 8 완료 직전 `grep -rn "process\.env\." packages/ scripts/ | grep -v CONFIG_PATH`로 1회 검사. 결과 0이면 통과
- 향후 신규 코드 가드는 `CLAUDE.md`에 한 줄 규칙 추가

### Task 8 dotenv 제거 체크리스트

```bash
# 1. dotenv import 일괄 식별
grep -rn 'dotenv' packages/ scripts/

# 2. 각 packages/* package.json에서 dotenv 의존성 제거 (root + cli + server에 중복 가능)
# 멀티모듈 리팩터의 알려진 결함 M-1 해소

# 3. .env.*.example 삭제
git rm .env.owner.example .env.service.example

# 4. .gitignore의 .env 패턴 정리 (안전망 보존 권장)

# 5. 사용자 로컬 .env 정리 안내 (README에 명시)
```

---

## 6. 파일 구조 요약

### 추가 (Create)

| 파일 | 역할 |
|---|---|
| `config.example.toml` | 17개 변수 템플릿 (커밋) |
| `packages/core/src/config/index.ts` | Public API |
| `packages/core/src/config/schema.ts` | Zod 스키마 + 타입 |
| `packages/core/src/config/loader.ts` | 파일 읽기 + parse + validate |
| `packages/core/src/config/helpers.ts` | 도메인 require helpers |
| `packages/core/src/config/testing.ts` | makeTestConfig + BASE_CONFIG + deepMerge |
| `packages/core/src/config/loader.test.ts` | loader 단위 테스트 |
| `packages/core/src/config/schema.test.ts` | Zod 스키마 테스트 |
| `packages/core/src/config/__fixtures__/valid.toml` | 정상 케이스 |
| `packages/core/src/config/__fixtures__/invalid.toml` | 실패 케이스 |
| `packages/core/src/config/__fixtures__/missing-meta.toml` | superRefine 케이스 |
| `vitest.setup.ts` | 매 테스트 자동 reset (위치 plan에서 확정) |

### 수정 (Modify)

| 파일/그룹 | 변경 내용 |
|---|---|
| 33개 호출처 (`packages/core/`, `packages/cli/`, `packages/server/`, `scripts/`) | `process.env.X` → `getConfig().X.Y` 또는 `requireX()` |
| 기존 테스트 파일들 | `vi.stubEnv` / `process.env.X = ...` → `setConfigForTesting(makeTestConfig({...}))` |
| 루트 `package.json` | `smol-toml`, `zod` 추가. `dotenv` 제거 |
| `packages/core/package.json` | `smol-toml`, `zod` 추가. `dotenv` 있으면 제거 |
| `packages/cli/package.json` | `dotenv` 있으면 제거 |
| `packages/server/package.json` | `dotenv` 있으면 제거 |
| `vitest.config.ts` | `setupFiles: ["./vitest.setup.ts"]` 추가 |
| `.gitignore` | `config.toml` 추가, `!config.example.toml` 추가 |
| `README.md` | Setup 섹션을 TOML 기반으로 재작성. `CONFIG_PATH` 옵션 한 줄 |
| `scripts/fetch-meta-ids.local.sh` | TOML 스니펫 출력으로 재작성 |
| `docs/STATUS.md` | 최근 변경 이력 + 알려진 결함 M-1 해소 |
| `docs/ROADMAP.md` | TOML 마이그레이션 항목 제거. Sub-project 2 항목 유지 |
| `docs/ARCHITECTURE.md` | 설정 인프라 결정 핵심 설계 결정 섹션 추가 (Why/How) |
| `CLAUDE.md` | "환경변수 사용 금지 (`CONFIG_PATH` 제외)" 규칙 한 줄 |

### 삭제 (Delete)

| 항목 | 이유 |
|---|---|
| `.env.owner.example` | TOML로 대체 |
| `.env.service.example` | TOML로 대체 |
| 모든 `import "dotenv/config"` 라인 | dotenv 제거 |
| 모든 패키지의 `dotenv` 의존성 | dotenv 제거 |

### 영향 규모 추정

- 신규 파일: 약 12개
- 수정 파일: 33개 호출처 + 7+개 테스트 + 4개 package.json + 4개 docs/lint 설정 ≈ **48-55개 파일**
- 삭제 항목: 2개 파일 + import 라인 일괄

(plan 단계에서 1회 grep으로 정확 숫자 재확인)

---

## 7. 검증 체크포인트 (마이그레이션 완료 후 필수)

```bash
# 1. process.env 직접 참조가 CONFIG_PATH 외에 없음
grep -rn "process\.env\." packages/ scripts/ | grep -v CONFIG_PATH
# → 결과 0줄

# 2. dotenv 흔적이 없음
grep -rn "dotenv" packages/ scripts/ package.json
# → 결과 0줄

# 3. .env.*.example 파일이 없음
ls .env* 2>/dev/null
# → 결과 없음

# 4. 모든 테스트 통과 (config.toml 파일 없이)
rm -f config.toml && npm test
# → 314+ tests passing (vitest setup의 makeTestConfig 덕분)

# 5. 실 환경 동작 확인
cp config.example.toml config.toml
# (실값 입력)
npm run app
# → 정상 시작

# 6. CONFIG_PATH override 동작
CONFIG_PATH=/tmp/test.toml npm run app
# → /tmp/test.toml 읽어서 시작 (없으면 명확한 에러)
```

---

## 검토 이력

### 2026-04-25 — 초안 섹션별 자체 검토

섹션 1-7 각각 CLAUDE.md §"검토 깊이 요구사항" 5개 점검 적용. 인라인 수정 후 확정.

**Critical** (해결됨):
- Section 5: vitest setup이 패키지별로 누락되면 CI에서 실 `config.toml` 읽으려 fail → 루트 `vitest.setup.ts`로 통일하고 plan task 1에서 각 패키지 vitest config 확인 step 명시 (§4 §"vitest.setup.ts 위치는 plan task 1에서 확정")
- Section 6: Task 8에서 `dotenv` 제거 시 root만 보면 안 되고 각 packages/*/package.json도 확인 필요 → Task 8 체크리스트에 명시 (§5 §"Task 8 dotenv 제거 체크리스트")

**Important** (해결됨):
- Section 4: `target_age_max .max(65)` 검증 → Meta 정책 13-65과 일치, Sub-project 2에서 플랫폼별 정책 차이 가능성 메모로 흡수
- Section 4: `ai.anthropic`/`google` 모두 비어있으면 creative 생성 불가 → `AiSection`에 `superRefine` 추가로 "anthropic 또는 google 중 최소 1개 필수" 강제 (§3 §"schema.ts" `AiSection`)
- Section 6: Task 7(테스트 일괄 변환)이 Task 2~6과 분리되면 Task 2~6의 직접 테스트 처리 모호 → Task 2~6 각 도메인이 "직접 테스트도 동시 변환" 포함하고 Task 7은 간접/E2E 테스트로 재정의 (§5 §"Task 분할" 표)
- Section 7: Acceptance #4에서 loader.test.ts는 fixture 파일 필요하므로 setup의 `setConfigForTesting` 우회 패턴 plan task 1 명시 (§4 §"loader.test.ts 예외")

**Minor** (반영됨):
- defaults 값 plan 단계에서 `.env.*.example` 실제 값과 1:1 검증 — plan task 1 step
- `server.base_url`/`port` 기본값을 `packages/server/src/index.ts` 실제 코드와 매핑 검증 — plan task 1 step
- helper 파일 위치 `config/helpers.ts` 별도 분리 (5개 함수 규모) — 확정
- `BillingSection` 이중 optional의 호출처 노이즈는 `requireStripeConfig` helper가 흡수 — 확정
- `.gitignore` `.env` 패턴 안전망 보존 (실수로 `.env` 만들어도 커밋 방지) — 확정
- testing.ts export 경로는 production과 동일 패키지 경로(`@ad-ai/core/config/testing`)로 분리 — 확정
- vitest setup의 BASE_CONFIG에 Sub-project 2 시점 tiktok/google placeholder 추가 메모 — 미래 항목

### 2026-04-25 — 전역 5점검 자체 검토

CLAUDE.md §"검토 깊이 요구사항" 5개 점검을 스펙 전체에 적용.

**1. 외부 참조 검증**: 
- `smol-toml` 라이브러리의 `parse` named export 형태 — README 확인 필요 (plan task 1)
- Meta API `act_\d+` 정규식 규약 — `packages/core/src/platform/meta/` 실제 호출 패턴 1회 grep 대조 필요 (plan task 1)
- `vitest.config.ts` 현재 위치(루트 vs 패키지) — plan task 1에서 1회 확인
- 33 호출처 / 7+ 테스트 / 314 테스트 숫자 — plan task 1 시작 직전 1회 grep 재실행
- `scripts/fetch-meta-ids.local.sh` 현재 jq 사용 패턴 — plan task 8에서 read 후 1:1 대조

**2. 추측 문구**: 없음. 모든 동작/숫자가 사전 조사 또는 명시적 결정 기반

**3. 관심사 분리**: schema(정의) / loader(I/O) / helpers(도메인) / testing(테스트) / index(공개) 5개 파일 각각 독립. 통과

**4. Deferral 점검**: "Sub-project 2로 미룸" 3건 (tiktok/google 스키마, age 정책 차이 메모, BASE_CONFIG placeholder), "plan task 1에서 1회 확인" 4건 — 모두 의도된 분리이며 누락 없음. 통과

**5. 구체 예시 존재**:
- TOML 템플릿 전체 (17개 필드 placeholder)
- Loader/Schema/Helpers 코드 전체
- 매핑표 17행, Optionality 매트릭스 7행
- before/after 변환 5종 도메인
- 6개 acceptance command
- 9개 task 분할 표
모두 구체적. 통과

**최종 등급**: Critical 0 / Important 0 (모두 인라인 해소) / Minor 7 (모두 plan task로 흡수)

---

## 다음 단계

1. 본 스펙 사용자 review
2. 승인 시 `superpowers:writing-plans` 스킬로 `docs/superpowers/plans/2026-04-25-toml-config-migration.md` 생성
3. `superpowers:subagent-driven-development`로 Task 1부터 실행
4. Sub-project 1 완료 후 Sub-project 2 (멀티플랫폼 어댑터) 별도 브레인스토밍 → 스펙 → 플랜 → 실행

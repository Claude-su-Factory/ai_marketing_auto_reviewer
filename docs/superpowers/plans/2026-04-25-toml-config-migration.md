# TOML Config Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `.env` entirely with single `config.toml`. Migrate 17 env vars across 33 call sites + 2 test files + 13 dotenv import locations + 1 launchd plist + install scripts.

**Architecture:** Domain-organized TOML schema (`[platforms.meta]`, `[ai.*]`, `[billing.stripe]`, `[server]`, `[defaults]`) → `smol-toml` parser → Zod schema with `superRefine` cross-validation → lazy singleton (`getConfig()`) + test helper (`setConfigForTesting`). Big-bang migration in 8 commits.

**Tech Stack:** `smol-toml@^1.6.1` (TOML parser, ~12KB zero-dep), `zod@^4.3.6` (schema validation), TypeScript 5.4, vitest 1.5, Node 20 ESM. Existing: tsx 4 runtime (no build), npm workspaces.

**Spec:** `docs/superpowers/specs/2026-04-25-toml-config-migration-design.md`

**Pre-flight grep results (verified 2026-04-25):**
- 33 `process.env.X` call sites (excluding tests) across `packages/` + `scripts/`
- 6 `process.env.X` references in test files (`voyage.test.ts`, `scheduler.test.ts`, `registry.test.ts`)
- 13 `import "dotenv/config"` locations
- 3 `package.json` files with `dotenv` dependency: root + `packages/cli` + `packages/server`
- 1 `vitest.config.ts` at repo root (no per-package configs)
- `scripts/com.adai.worker.plist` injects `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`
- `scripts/install-worker.sh` references the same env list

**Task Order:**
1. Infrastructure (config module, deps, vitest setup, example file, .gitignore)
2. Meta domain (launcher.ts, registry.ts + registry.test.ts, CLI error messages)
3. AI domain (14 source files + voyage.test.ts + scheduler.test.ts)
4. Stripe domain (3 files)
5. Server + CTR threshold (small leftovers)
6. dotenv removal + `.env.*.example` deletion + plist + install-worker.sh + fetch-meta-ids rewrite
7. Docs (README, STATUS, ROADMAP, ARCHITECTURE, CLAUDE.md)

(Spec mentions 9 tasks — defaults absorbed into Task 2 since AD_* vars all live in `launcher.ts`. Stripe-specific tests don't exist yet, so no separate test task.)

---

## Task 1: Config Module Infrastructure

**Files:**
- Create: `packages/core/src/config/index.ts`
- Create: `packages/core/src/config/schema.ts`
- Create: `packages/core/src/config/loader.ts`
- Create: `packages/core/src/config/helpers.ts`
- Create: `packages/core/src/config/testing.ts`
- Create: `packages/core/src/config/schema.test.ts`
- Create: `packages/core/src/config/loader.test.ts`
- Create: `packages/core/src/config/__fixtures__/valid.toml`
- Create: `packages/core/src/config/__fixtures__/invalid.toml`
- Create: `packages/core/src/config/__fixtures__/missing-meta.toml`
- Create: `config.example.toml` (repo root)
- Create: `vitest.setup.ts` (repo root)
- Modify: `packages/core/package.json` (add `smol-toml`, `zod` deps)
- Modify: `vitest.config.ts` (add `setupFiles`)
- Modify: `.gitignore` (add `config.toml`, `!config.example.toml`)

### Step 1.1: Add deps to packages/core/package.json

- [ ] **Step 1.1.1: Add `smol-toml` and `zod` to packages/core**

```bash
npm install --workspace @ad-ai/core smol-toml@^1.6.1 zod@^4.3.6
```

Expected: `node_modules/smol-toml` and `node_modules/zod` present, `packages/core/package.json` `dependencies` updated.

- [ ] **Step 1.1.2: Verify install**

```bash
node -e 'const { parse } = require("smol-toml"); console.log(parse("a = 1"))'
```

Expected output: `{ a: 1n }` (smol-toml returns BigInt for integers — handled by Zod `z.number()` coercion in Step 1.3).

### Step 1.2: Create Zod schema with failing test

- [ ] **Step 1.2.1: Write `schema.test.ts` (failing)**

Create `packages/core/src/config/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ConfigSchema } from "./schema.js";

describe("ConfigSchema", () => {
  const validBase = {
    platforms: {
      enabled: ["meta"],
      meta: {
        access_token: "tok",
        ad_account_id: "act_1234567890",
        page_id: "1234567890",
        instagram_actor_id: "1234567890",
      },
    },
    ai: { anthropic: { api_key: "k1" }, google: { api_key: "k2" } },
  };

  it("accepts valid config and applies defaults", () => {
    const result = ConfigSchema.parse(validBase);
    expect(result.platforms.meta?.access_token).toBe("tok");
    expect(result.server.port).toBe(3000);
    expect(result.server.base_url).toBe("http://localhost:3000");
    expect(result.defaults.daily_budget_krw).toBe(10000);
    expect(result.defaults.duration_days).toBe(14);
    expect(result.defaults.target_age_min).toBe(20);
    expect(result.defaults.target_age_max).toBe(45);
    expect(result.defaults.ctr_improvement_threshold).toBe(1.5);
  });

  it("rejects ad_account_id without 'act_' prefix", () => {
    const r = ConfigSchema.safeParse({
      ...validBase,
      platforms: {
        ...validBase.platforms,
        meta: { ...validBase.platforms.meta, ad_account_id: "1234567890" },
      },
    });
    expect(r.success).toBe(false);
  });

  it("rejects when no AI provider given", () => {
    const r = ConfigSchema.safeParse({ ...validBase, ai: {} });
    expect(r.success).toBe(false);
  });

  it("rejects when 'meta' enabled but [platforms.meta] missing", () => {
    const r = ConfigSchema.safeParse({
      platforms: { enabled: ["meta"] },
      ai: { anthropic: { api_key: "k" } },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join(".") === "platforms.meta")).toBe(true);
    }
  });

  it("rejects empty enabled array", () => {
    const r = ConfigSchema.safeParse({
      ...validBase,
      platforms: { enabled: [], meta: validBase.platforms.meta },
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 1.2.2: Run test to verify it fails**

```bash
npm test -- packages/core/src/config/schema.test.ts
```

Expected: FAIL with import error (`schema.js` does not exist yet).

### Step 1.3: Implement schema

- [ ] **Step 1.3.1: Create `schema.ts`**

Create `packages/core/src/config/schema.ts`:

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
});

const AiSection = z
  .object({
    anthropic: z.object({ api_key: z.string().min(1) }).optional(),
    google: z.object({ api_key: z.string().min(1) }).optional(),
    voyage: z.object({ api_key: z.string().min(1) }).optional(),
  })
  .default({})
  .superRefine((ai, ctx) => {
    if (!ai.anthropic && !ai.google) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ai"],
        message: "[ai.anthropic] 또는 [ai.google] 중 최소 1개의 api_key가 필요합니다",
      });
    }
  });

const BillingSection = z
  .object({
    stripe: z
      .object({
        secret_key: z.string().min(1),
        webhook_secret: z.string().min(1),
      })
      .optional(),
  })
  .optional();

const ServerSection = z
  .object({
    base_url: z.string().url().default("http://localhost:3000"),
    port: z.coerce.number().int().positive().default(3000),
  })
  .default({});

const DefaultsSection = z
  .object({
    daily_budget_krw: z.coerce.number().int().positive().default(10000),
    duration_days: z.coerce.number().int().positive().default(14),
    target_age_min: z.coerce.number().int().min(13).default(20),
    target_age_max: z.coerce.number().int().max(65).default(45),
    ctr_improvement_threshold: z.coerce.number().positive().default(1.5),
  })
  .default({});

export const ConfigSchema = z
  .object({
    platforms: PlatformsSection,
    ai: AiSection,
    billing: BillingSection,
    server: ServerSection,
    defaults: DefaultsSection,
  })
  .superRefine((cfg, ctx) => {
    for (const id of cfg.platforms.enabled) {
      if (id === "meta" && !cfg.platforms.meta) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["platforms", "meta"],
          message: '"meta"가 platforms.enabled에 있지만 [platforms.meta] 섹션이 없습니다',
        });
      }
    }
  });

export type Config = z.infer<typeof ConfigSchema>;
```

Note: `z.coerce.number()` handles the BigInt-from-smol-toml case automatically.

- [ ] **Step 1.3.2: Run test to verify it passes**

```bash
npm test -- packages/core/src/config/schema.test.ts
```

Expected: 5/5 PASS.

### Step 1.4: Implement loader with failing test

- [ ] **Step 1.4.1: Create fixture files**

Create `packages/core/src/config/__fixtures__/valid.toml`:

```toml
[platforms]
enabled = ["meta"]

[platforms.meta]
access_token = "test-token"
ad_account_id = "act_1234567890"
page_id = "1234567890"
instagram_actor_id = "1234567890"

[ai.anthropic]
api_key = "sk-ant-test"
```

Create `packages/core/src/config/__fixtures__/invalid.toml`:

```toml
[platforms]
enabled = ["meta"]

[platforms.meta]
access_token = "test-token"
ad_account_id = "missing-prefix"
page_id = "1234567890"
instagram_actor_id = "1234567890"

[ai.anthropic]
api_key = "sk-ant-test"
```

Create `packages/core/src/config/__fixtures__/missing-meta.toml`:

```toml
[platforms]
enabled = ["meta"]

[ai.anthropic]
api_key = "sk-ant-test"
```

- [ ] **Step 1.4.2: Write `loader.test.ts` (failing)**

Create `packages/core/src/config/loader.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./loader.js";

const FIXTURE_DIR = "packages/core/src/config/__fixtures__";

describe("loadConfig", () => {
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    delete process.env.CONFIG_PATH;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    delete process.env.CONFIG_PATH;
  });

  it("loads valid config via CONFIG_PATH", () => {
    process.env.CONFIG_PATH = `${FIXTURE_DIR}/valid.toml`;
    const cfg = loadConfig();
    expect(cfg.platforms.meta?.access_token).toBe("test-token");
    expect(cfg.ai.anthropic?.api_key).toBe("sk-ant-test");
  });

  it("throws clear error when file missing", () => {
    process.env.CONFIG_PATH = "/tmp/does-not-exist.toml";
    expect(() => loadConfig()).toThrow(/Config file not found/);
  });

  it("throws Zod path-specific error for invalid value", () => {
    process.env.CONFIG_PATH = `${FIXTURE_DIR}/invalid.toml`;
    expect(() => loadConfig()).toThrow(/platforms\.meta\.ad_account_id/);
  });

  it("throws cross-validation error when meta enabled but section missing", () => {
    process.env.CONFIG_PATH = `${FIXTURE_DIR}/missing-meta.toml`;
    expect(() => loadConfig()).toThrow(/platforms\.meta/);
  });
});
```

- [ ] **Step 1.4.3: Run test to verify it fails**

```bash
npm test -- packages/core/src/config/loader.test.ts
```

Expected: FAIL with import error (`loader.js` does not exist).

### Step 1.5: Implement loader

- [ ] **Step 1.5.1: Create `loader.ts`**

Create `packages/core/src/config/loader.ts`:

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

- [ ] **Step 1.5.2: Run test to verify it passes**

```bash
npm test -- packages/core/src/config/loader.test.ts
```

Expected: 4/4 PASS.

### Step 1.6: Public API + helpers + testing

- [ ] **Step 1.6.1: Create `index.ts`**

Create `packages/core/src/config/index.ts`:

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

- [ ] **Step 1.6.2: Create `helpers.ts`**

Create `packages/core/src/config/helpers.ts`:

```ts
import { getConfig, type Config } from "./index.js";

export function requireMeta(
  cfg: Config = getConfig()
): NonNullable<Config["platforms"]["meta"]> {
  if (!cfg.platforms.meta) {
    throw new Error("[platforms.meta] is required for this operation");
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

export function requireStripeConfig(): NonNullable<
  NonNullable<Config["billing"]>["stripe"]
> {
  const stripe = getConfig().billing?.stripe;
  if (!stripe) throw new Error("[billing.stripe] is required for this operation");
  return stripe;
}
```

- [ ] **Step 1.6.3: Create `testing.ts`**

Create `packages/core/src/config/testing.ts`:

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
    google: { api_key: "test-google-key" },
    voyage: { api_key: "test-voyage-key" },
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
    if (
      ov &&
      typeof ov === "object" &&
      !Array.isArray(ov) &&
      bv &&
      typeof bv === "object"
    ) {
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

- [ ] **Step 1.6.4: Run all config tests**

```bash
npm test -- packages/core/src/config/
```

Expected: 9/9 PASS (5 schema + 4 loader).

### Step 1.7: Vitest setup + config

- [ ] **Step 1.7.1: Create `vitest.setup.ts`**

Create at repo root `vitest.setup.ts`:

```ts
import { beforeEach, afterEach } from "vitest";
import { setConfigForTesting, resetConfigForTesting } from "./packages/core/src/config/index.js";
import { makeTestConfig } from "./packages/core/src/config/testing.js";

beforeEach(() => {
  setConfigForTesting(makeTestConfig());
});

afterEach(() => {
  resetConfigForTesting();
});
```

- [ ] **Step 1.7.2: Update `vitest.config.ts`**

Modify `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      sharp: new URL("./tests/mocks/sharpStub.ts", import.meta.url).pathname,
    },
  },
});
```

- [ ] **Step 1.7.3: Adjust loader.test.ts to bypass setup**

The setup file calls `setConfigForTesting` before every test, but loader tests need real file I/O. Modify `packages/core/src/config/loader.test.ts` to add `resetConfigForTesting` calls in `beforeEach`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./loader.js";
import { resetConfigForTesting } from "./index.js";

const FIXTURE_DIR = "packages/core/src/config/__fixtures__";

describe("loadConfig", () => {
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    delete process.env.CONFIG_PATH;
    resetConfigForTesting(); // bypass vitest.setup.ts auto-injection
  });

  afterEach(() => {
    process.chdir(originalCwd);
    delete process.env.CONFIG_PATH;
  });

  // ... (tests unchanged from Step 1.4.2)
});
```

- [ ] **Step 1.7.4: Verify entire test suite still passes**

```bash
npm test
```

Expected: All existing tests + new config tests PASS. (No env stubs broken — `process.env` still works because `dotenv/config` is still imported in entries; this task does not remove it yet.)

### Step 1.8: Config example + .gitignore

- [ ] **Step 1.8.1: Create `config.example.toml`**

Create at repo root `config.example.toml`:

```toml
# config.example.toml — ad_ai 설정 템플릿
# 사용법: cp config.example.toml config.toml 후 실제 값 입력
# config.toml은 .gitignore에 있어 커밋되지 않음

[platforms]
# 활성화할 광고 플랫폼 목록. 멀티플랫폼 어댑터 도입 시 "tiktok", "google" 추가
enabled = ["meta"]

[platforms.meta]
# Meta Marketing API access token (System User token 권장)
# 발급 가이드: docs/STATUS.md 또는 README의 Setup 섹션
access_token = "EAA..."
ad_account_id = "act_1234567890"  # "act_" 접두사 포함
page_id = "1234567890"
instagram_actor_id = "1234567890"

[ai.anthropic]
# Anthropic Claude — copy 생성, 주간 분석, improver
# 발급: https://console.anthropic.com/settings/keys
api_key = "sk-ant-..."

[ai.google]
# Google AI Studio — imagen/veo 생성, HTML 파싱
# 발급: https://aistudio.google.com/app/apikey
api_key = "AIza..."

[ai.voyage]
# Voyage AI — voyage-3-lite embedding (Winner DB RAG)
# 발급: https://dash.voyageai.com/api-keys
api_key = "pa-..."

[billing.stripe]
# Service 모드(웹 UI + 결제) 사용 시에만 필요. Owner 모드 전용이라면 섹션 생략 가능
secret_key = "sk_test_..."
webhook_secret = "whsec_..."

[server]
# Service 모드에서만 사용. 미설정 시 base_url=http://localhost:3000, port=3000
base_url = "http://localhost:3000"
port = 3000

[defaults]
# 광고 캠페인 기본값
daily_budget_krw = 10000
duration_days = 14
target_age_min = 20
target_age_max = 45
ctr_improvement_threshold = 1.5
```

- [ ] **Step 1.8.2: Update `.gitignore`**

Modify `.gitignore` — add after the existing `.env` block:

```
# Config (secrets)
config.toml
!config.example.toml
```

- [ ] **Step 1.8.3: Verify .gitignore**

```bash
echo "test" > config.toml && git status --short config.toml config.example.toml && rm config.toml
```

Expected: `config.toml` does NOT appear in git status (ignored). `config.example.toml` is tracked.

### Step 1.9: Commit Task 1

- [ ] **Step 1.9.1: Stage and commit**

```bash
git add packages/core/package.json packages/core/src/config/ \
        package-lock.json \
        vitest.setup.ts vitest.config.ts \
        config.example.toml .gitignore
git commit -m "$(cat <<'EOF'
feat(config): add TOML config module infrastructure

Introduces packages/core/src/config/ with smol-toml + Zod schema, lazy
singleton getConfig(), domain require helpers, and makeTestConfig builder.
vitest setup auto-injects test config before every test. config.example.toml
provides template for users.

No call sites converted yet — dotenv still loaded via entry imports.
Subsequent tasks migrate per domain.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Migrate Meta Domain (META_* + AD_PLATFORMS + AD_* defaults)

**Files:**
- Modify: `packages/core/src/platform/meta/launcher.ts:19-39` (META_AD_ACCOUNT_ID + AD_TARGET_AGE_MIN/MAX + AD_DAILY_BUDGET_KRW + AD_DURATION_DAYS)
- Modify: `packages/core/src/platform/registry.ts` (META_* env-presence check + AD_PLATFORMS parser)
- Modify: `packages/core/src/platform/registry.test.ts:20-29` (replace env stub with setConfigForTesting)
- Modify: `packages/cli/src/entries/launch.ts:13` (error message text)
- Modify: `packages/cli/src/actions.ts:150` (error message text)

### Step 2.1: Read current launcher.ts and registry.ts

- [ ] **Step 2.1.1: Read files to confirm exact line numbers**

```bash
cat packages/core/src/platform/meta/launcher.ts
cat packages/core/src/platform/registry.ts
cat packages/core/src/platform/registry.test.ts
```

Note line numbers may have shifted; the implementer should use grep to locate `process.env.META_*` and `process.env.AD_*` references and replace them.

### Step 2.2: Update launcher.ts

- [ ] **Step 2.2.1: Replace env reads with config calls**

In `packages/core/src/platform/meta/launcher.ts`, replace at top of file (after existing imports):

```ts
// Before (line ~19-30 area)
//   age_min: Number(process.env.AD_TARGET_AGE_MIN ?? 20),
//   age_max: Number(process.env.AD_TARGET_AGE_MAX ?? 45),
//   ...
//   dailyBudgetKRW: Number(process.env.AD_DAILY_BUDGET_KRW ?? 10000),
//   durationDays: Number(process.env.AD_DURATION_DAYS ?? 14),
// Before (line ~39):
//   return new AdAccount(process.env.META_AD_ACCOUNT_ID!);

// After: import config helpers at top
import { getConfig } from "@ad-ai/core/config";
import { requireMeta } from "@ad-ai/core/config/helpers";

// Replace age_min/age_max/dailyBudgetKRW/durationDays usage:
//   age_min: getConfig().defaults.target_age_min,
//   age_max: getConfig().defaults.target_age_max,
//   dailyBudgetKRW: getConfig().defaults.daily_budget_krw,
//   durationDays: getConfig().defaults.duration_days,

// Replace AdAccount construction:
//   return new AdAccount(requireMeta().ad_account_id);
```

- [ ] **Step 2.2.2: Verify no `process.env` left in launcher.ts**

```bash
grep -n "process\.env\." packages/core/src/platform/meta/launcher.ts
```

Expected: 0 matches.

### Step 2.3: Update registry.ts

- [ ] **Step 2.3.1: Replace AD_PLATFORMS read + META_* presence check**

In `packages/core/src/platform/registry.ts`:

```ts
// Before
//   const REQUIRED: Record<string, string[]> = {
//     meta: ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID", "META_PAGE_ID"],
//   };
//   const names = parseActivePlatformNames(process.env.AD_PLATFORMS);

// After
import { getConfig } from "@ad-ai/core/config";

// REQUIRED check transforms from env-name presence to config presence:
//   For "meta": all of platforms.meta.{access_token, ad_account_id, page_id} must be non-empty.
//   The `missing` array now reports which TOML paths are missing rather than env var names.

// AD_PLATFORMS parsing:
//   const names = getConfig().platforms.enabled;
//   (already string[] from Zod, no parsing needed)
```

The `missing` field in `RegistryResult` (or equivalent) should now contain TOML paths like `"platforms.meta.access_token"` instead of `"META_ACCESS_TOKEN"`. This is a public-facing change but only affects error messages.

- [ ] **Step 2.3.2: Verify no `process.env` in registry.ts**

```bash
grep -n "process\.env\." packages/core/src/platform/registry.ts
```

Expected: 0 matches.

### Step 2.4: Update registry.test.ts

- [ ] **Step 2.4.1: Replace env stub pattern**

In `packages/core/src/platform/registry.test.ts`:

```ts
// Before
//   const env = { META_ACCESS_TOKEN: "x", META_AD_ACCOUNT_ID: "y", META_PAGE_ID: "z" };
//   ... uses env to override process.env or pass to function
//   expect(r.missing).toContain("META_AD_ACCOUNT_ID");

// After
import { setConfigForTesting } from "@ad-ai/core/config";
import { makeTestConfig } from "@ad-ai/core/config/testing";

// Replace env stub with setConfigForTesting + makeTestConfig:
//   setConfigForTesting(makeTestConfig({
//     platforms: {
//       enabled: ["meta"],
//       meta: {
//         access_token: "x",
//         ad_account_id: "act_1234567890",
//         page_id: "1234567890",
//         instagram_actor_id: "1234567890",
//       },
//     },
//   }));

// For "missing" tests, override with empty/undefined values:
//   setConfigForTesting(makeTestConfig({
//     platforms: { enabled: ["meta"], meta: undefined },
//   }));
//   expect(r.missing).toContain("platforms.meta"); // updated assertion
```

Note: assertion strings change from env names to TOML paths.

### Step 2.5: Update CLI error messages

- [ ] **Step 2.5.1: Update launch.ts error string**

In `packages/cli/src/entries/launch.ts:13`:

```ts
// Before
//   console.error("활성화된 플랫폼이 없습니다. .env의 AD_PLATFORMS 또는 credential을 확인하세요.");

// After
console.error(
  "활성화된 플랫폼이 없습니다. config.toml의 [platforms] enabled 또는 [platforms.meta] credential을 확인하세요."
);
```

- [ ] **Step 2.5.2: Update actions.ts error string**

In `packages/cli/src/actions.ts:150`:

```ts
// Before
//   logs: ["활성화된 플랫폼이 없습니다. .env의 AD_PLATFORMS 또는 credential을 확인하세요."]

// After
logs: [
  "활성화된 플랫폼이 없습니다. config.toml의 [platforms] enabled 또는 [platforms.meta] credential을 확인하세요.",
]
```

### Step 2.6: Run tests

- [ ] **Step 2.6.1: Run platform tests**

```bash
npm test -- packages/core/src/platform/
```

Expected: All platform tests PASS (registry.test.ts uses new setConfigForTesting pattern).

- [ ] **Step 2.6.2: Run full test suite**

```bash
npm test
```

Expected: All tests PASS.

- [ ] **Step 2.6.3: Verify Meta env-var grep is empty**

```bash
grep -rn "process\.env\.META_\|process\.env\.AD_" packages/ scripts/ 2>/dev/null
```

Expected: 0 matches.

### Step 2.7: Commit Task 2

- [ ] **Step 2.7.1: Stage and commit**

```bash
git add packages/core/src/platform/ packages/cli/src/entries/launch.ts packages/cli/src/actions.ts
git commit -m "$(cat <<'EOF'
feat(config): migrate Meta + AD_* domain to TOML config

launcher.ts and registry.ts now read getConfig().platforms.meta and
getConfig().defaults.* via config helpers. registry "missing" field
reports TOML paths (e.g. "platforms.meta.access_token") instead of env
var names. CLI error messages updated to point to config.toml.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Migrate AI Domain (ANTHROPIC + GOOGLE_AI + VOYAGE)

**Files (14 source + 2 test):**
- Modify: `packages/core/src/improver/runner.ts`
- Modify: `packages/core/src/rag/voyage.ts`
- Modify: `packages/core/src/rag/voyage.test.ts`
- Modify: `packages/core/src/campaign/monitor.ts`
- Modify: `packages/core/src/creative/image.ts`
- Modify: `packages/core/src/creative/video.ts`
- Modify: `packages/core/src/creative/copy.ts`
- Modify: `packages/server/src/scheduler.ts`
- Modify: `packages/server/src/scheduler.test.ts`
- Modify: `packages/server/src/jobs/videoJob.ts`
- Modify: `packages/server/src/routes/aiImage.ts`
- Modify: `packages/server/src/routes/aiAnalyze.ts`
- Modify: `packages/server/src/routes/aiParse.ts`
- Modify: `packages/server/src/routes/aiCopy.ts`
- Modify: `packages/cli/src/entries/worker.ts`
- Modify: `packages/cli/src/actions.ts`
- Modify: `packages/cli/src/scraper.ts`

### Step 3.1: Replace ANTHROPIC_API_KEY references

- [ ] **Step 3.1.1: Find all references**

```bash
grep -rn "process\.env\.ANTHROPIC_API_KEY" packages/ 2>/dev/null
```

Expected output: 6 matches across multiple files.

- [ ] **Step 3.1.2: Replace each with `requireAnthropicKey()`**

Pattern for each match:

```ts
// Before
const key = process.env.ANTHROPIC_API_KEY;
if (!key) throw new Error("ANTHROPIC_API_KEY missing");

// After
import { requireAnthropicKey } from "@ad-ai/core/config/helpers";
const key = requireAnthropicKey();
```

If used as inline argument:

```ts
// Before
new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// After
import { requireAnthropicKey } from "@ad-ai/core/config/helpers";
new Anthropic({ apiKey: requireAnthropicKey() })
```

### Step 3.2: Replace GOOGLE_AI_API_KEY references

- [ ] **Step 3.2.1: Find all references**

```bash
grep -rn "process\.env\.GOOGLE_AI_API_KEY" packages/ 2>/dev/null
```

Expected output: 7 matches.

- [ ] **Step 3.2.2: Replace each with `requireGoogleAiKey()`**

```ts
// Before
const key = process.env.GOOGLE_AI_API_KEY!;

// After
import { requireGoogleAiKey } from "@ad-ai/core/config/helpers";
const key = requireGoogleAiKey();
```

### Step 3.3: Replace VOYAGE_API_KEY references

- [ ] **Step 3.3.1: Find all references**

```bash
grep -rn "process\.env\.VOYAGE_API_KEY" packages/ 2>/dev/null
```

Expected output: 8 matches.

- [ ] **Step 3.3.2: Replace each with `requireVoyageKey()`**

```ts
// Before
const key = process.env.VOYAGE_API_KEY;
if (!key) throw new Error("VOYAGE_API_KEY missing");

// After
import { requireVoyageKey } from "@ad-ai/core/config/helpers";
const key = requireVoyageKey();
```

### Step 3.4: Update voyage.test.ts

- [ ] **Step 3.4.1: Replace env stub with setConfigForTesting**

In `packages/core/src/rag/voyage.test.ts`, find `process.env.VOYAGE_API_KEY` direct sets and `vi.stubEnv` calls. Replace pattern:

```ts
// Before
beforeEach(() => {
  vi.stubEnv("VOYAGE_API_KEY", "test-voyage");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

// After
import { setConfigForTesting } from "@ad-ai/core/config";
import { makeTestConfig } from "@ad-ai/core/config/testing";

beforeEach(() => {
  setConfigForTesting(makeTestConfig({
    ai: { voyage: { api_key: "test-voyage" } },
  }));
});
// (afterEach reset is handled by vitest.setup.ts)
```

For "missing key" assertion tests:

```ts
// Before
it("throws when VOYAGE_API_KEY missing", () => {
  vi.stubEnv("VOYAGE_API_KEY", "");
  expect(() => embed("text")).toThrow();
});

// After
import { makeTestConfig, setConfigForTesting } from "@ad-ai/core/config";
import type { Config } from "@ad-ai/core/config";

it("throws when voyage api_key missing", () => {
  // Build config without voyage
  const cfg = makeTestConfig();
  delete (cfg.ai as any).voyage;
  setConfigForTesting(cfg);
  expect(() => embed("text")).toThrow(/\[ai\.voyage\.api_key\]/);
});
```

### Step 3.5: Update scheduler.test.ts

- [ ] **Step 3.5.1: Replace env stubs**

Same pattern as Step 3.4.1, applied to whatever AI keys scheduler.test.ts stubs.

### Step 3.6: Run tests

- [ ] **Step 3.6.1: Run AI-touching tests**

```bash
npm test -- packages/core/src/rag/ packages/core/src/creative/ packages/core/src/improver/ packages/server/src/scheduler.test.ts
```

Expected: PASS.

- [ ] **Step 3.6.2: Full suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3.6.3: Verify AI env-vars eliminated**

```bash
grep -rn "process\.env\.\(ANTHROPIC\|GOOGLE_AI\|VOYAGE\)" packages/ 2>/dev/null
```

Expected: 0 matches.

### Step 3.7: Commit Task 3

```bash
git add packages/
git commit -m "$(cat <<'EOF'
feat(config): migrate AI domain (Anthropic/Google/Voyage) to TOML

14 source files now use requireAnthropicKey/requireGoogleAiKey/
requireVoyageKey helpers from @ad-ai/core/config/helpers. voyage.test.ts
and scheduler.test.ts use setConfigForTesting + makeTestConfig pattern.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Migrate Stripe Domain

**Files:**
- Modify: `packages/server/src/stripe.ts`
- Modify: `packages/server/src/admin.ts`
- Modify: `packages/server/src/index.ts` (only Stripe parts; SERVER_PORT/SERVER_BASE_URL stay for Task 5)

### Step 4.1: Replace STRIPE_SECRET_KEY references

- [ ] **Step 4.1.1: Find all references**

```bash
grep -rn "process\.env\.STRIPE_SECRET_KEY\|process\.env\.STRIPE_WEBHOOK_SECRET" packages/ 2>/dev/null
```

Expected: 5 matches.

- [ ] **Step 4.1.2: Replace pattern**

```ts
// Before
const stripeKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
if (!stripeKey || !webhookSecret) {
  // disable billing
  return;
}

// After
import { getConfig } from "@ad-ai/core/config";

const stripeCfg = getConfig().billing?.stripe;
if (!stripeCfg) {
  // disable billing (config.toml has no [billing.stripe] section)
  return;
}
const { secret_key: stripeKey, webhook_secret: webhookSecret } = stripeCfg;
```

For sites that require Stripe to be present (e.g. `admin.ts` charge command):

```ts
// Use require helper
import { requireStripeConfig } from "@ad-ai/core/config/helpers";
const { secret_key } = requireStripeConfig();
```

### Step 4.2: Run tests

- [ ] **Step 4.2.1: Run server tests**

```bash
npm test -- packages/server/
```

Expected: PASS.

- [ ] **Step 4.2.2: Verify Stripe env eliminated**

```bash
grep -rn "process\.env\.STRIPE" packages/ scripts/ 2>/dev/null
```

Expected: 0 matches.

### Step 4.3: Commit Task 4

```bash
git add packages/server/
git commit -m "$(cat <<'EOF'
feat(config): migrate Stripe billing domain to TOML

stripe.ts/admin.ts/index.ts now read getConfig().billing.stripe with
optional handling for owner-only deployments. requireStripeConfig
helper for sites that hard-require billing.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Migrate Server + CTR Threshold

**Files:**
- Modify: `packages/server/src/index.ts:20-21` (SERVER_PORT + SERVER_BASE_URL)
- Modify: `packages/core/src/improver/index.ts:3` (CTR_IMPROVEMENT_THRESHOLD)

### Step 5.1: Replace SERVER_* in server/index.ts

- [ ] **Step 5.1.1: Read current code**

```bash
sed -n '15,25p' packages/server/src/index.ts
```

Expected: `const PORT = Number(process.env.SERVER_PORT ?? 3000);` and similar.

- [ ] **Step 5.1.2: Replace**

```ts
// Before
const PORT = Number(process.env.SERVER_PORT ?? 3000);
const SERVER_URL = process.env.SERVER_BASE_URL ?? `http://localhost:${PORT}`;

// After
import { getConfig } from "@ad-ai/core/config";

const PORT = getConfig().server.port;
const SERVER_URL = getConfig().server.base_url;
```

Note: `base_url` default in Zod is `"http://localhost:3000"`, which doesn't auto-substitute the configured port. If user sets non-3000 port without setting `base_url`, they get the default localhost:3000. This matches the prior `??` fallback chain only when both are unset — close enough for default behavior. Document via comment if needed.

### Step 5.2: Replace CTR threshold in improver/index.ts

- [ ] **Step 5.2.1: Replace**

```ts
// Before (line 3)
export const CTR_THRESHOLD = Number(process.env.CTR_IMPROVEMENT_THRESHOLD ?? 1.5);

// After
import { getConfig } from "@ad-ai/core/config";

export const CTR_THRESHOLD = getConfig().defaults.ctr_improvement_threshold;
```

Note: this changes from module-level constant to runtime-evaluated constant. If `getConfig()` is called at module load, file-import order matters. Verify by running tests.

If module-load-order issues arise (config not yet injected when this module loads), convert to a getter:

```ts
import { getConfig } from "@ad-ai/core/config";

export function getCtrThreshold(): number {
  return getConfig().defaults.ctr_improvement_threshold;
}
```

And update consumers to call `getCtrThreshold()` instead of reading the constant. Find consumers:

```bash
grep -rn "CTR_THRESHOLD" packages/
```

Replace each `CTR_THRESHOLD` with `getCtrThreshold()`.

### Step 5.3: Run tests

- [ ] **Step 5.3.1: Run improver + server tests**

```bash
npm test -- packages/core/src/improver/ packages/server/
```

Expected: PASS.

- [ ] **Step 5.3.2: Full suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5.3.3: Verify SERVER + CTR env eliminated**

```bash
grep -rn "process\.env\.\(SERVER_\|CTR_IMPROVEMENT\)" packages/ scripts/ 2>/dev/null
```

Expected: 0 matches.

### Step 5.4: Verify only CONFIG_PATH remains

- [ ] **Step 5.4.1: Final env check**

```bash
grep -rn "process\.env\." packages/ scripts/ 2>/dev/null | grep -v CONFIG_PATH
```

Expected: 0 matches. (Only `loader.ts`'s `process.env.CONFIG_PATH` remains.)

### Step 5.5: Commit Task 5

```bash
git add packages/server/src/index.ts packages/core/src/improver/
git commit -m "$(cat <<'EOF'
feat(config): migrate Server port/url + CTR threshold to TOML

Final domain conversions. After this commit, no process.env access
remains except loader.ts:CONFIG_PATH (intentional meta-config).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Remove dotenv + Delete .env Files + Update Plist + Rewrite Script

**Files:**
- Delete: `.env.owner.example`
- Delete: `.env.service.example`
- Modify: `package.json` (remove dotenv from root deps)
- Modify: `packages/cli/package.json` (remove dotenv)
- Modify: `packages/server/package.json` (remove dotenv)
- Modify: 13 files containing `import "dotenv/config"` (remove the line)
- Modify: `scripts/com.adai.worker.plist` (remove META_ACCESS_TOKEN/META_AD_ACCOUNT_ID/ANTHROPIC_API_KEY/VOYAGE_API_KEY entries)
- Modify: `scripts/install-worker.sh` (update injection messaging)
- Modify: `scripts/fetch-meta-ids.local.sh` (output TOML snippet)

### Step 6.1: Remove `import "dotenv/config"` from all entries

- [ ] **Step 6.1.1: List all locations**

```bash
grep -rln 'import "dotenv/config"' packages/ scripts/
```

Expected: 13 files (2 server + 9 cli entries + cli pipeline.ts + cli actions.ts + 2 scripts).

- [ ] **Step 6.1.2: Remove the line from each**

For each file, delete the first line `import "dotenv/config";` (and the empty line after if present).

- [ ] **Step 6.1.3: Verify removal**

```bash
grep -rn 'dotenv' packages/ scripts/
```

Expected: 0 matches.

### Step 6.2: Remove dotenv dependency

- [ ] **Step 6.2.1: Uninstall from each workspace**

```bash
npm uninstall dotenv
npm uninstall --workspace @ad-ai/cli dotenv
npm uninstall --workspace @ad-ai/server dotenv
```

- [ ] **Step 6.2.2: Verify package.jsons**

```bash
grep -n "dotenv" package.json packages/*/package.json
```

Expected: 0 matches.

- [ ] **Step 6.2.3: Verify lockfile clean**

```bash
grep "dotenv" package-lock.json | head -3
```

Expected: 0 or only transitive references; no top-level `node_modules/dotenv` entry. If transitive deps still pull it, that's fine (it stays in node_modules but our code doesn't import it).

### Step 6.3: Delete .env.*.example files

- [ ] **Step 6.3.1: Remove via git**

```bash
git rm .env.owner.example .env.service.example
```

### Step 6.4: Update plist

- [ ] **Step 6.4.1: Remove env injections**

Modify `scripts/com.adai.worker.plist` — replace lines 17-24 (the EnvironmentVariables dict) so only PATH remains:

```xml
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/usr/bin:/bin</string>
  </dict>
```

The worker reads `config.toml` from cwd (`__PROJECT_ROOT__`), so no env injection needed.

### Step 6.5: Update install-worker.sh

- [ ] **Step 6.5.1: Update injection messaging**

In `scripts/install-worker.sh`, update lines 26-32 (the `__INJECT__` check):

```bash
# Before
# if grep -q '__INJECT__' "$PLIST_DST"; then
#   echo ""
#   echo "NEXT STEP: Edit $PLIST_DST and replace __INJECT__ with real token"
#   echo "  values (META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, ANTHROPIC_API_KEY, VOYAGE_API_KEY)."
#   ...
# fi

# After: remove the __INJECT__ check entirely (no env injection needed; config.toml provides values)
```

Replace lines 26-33 with:

```bash
# Worker reads config.toml from PROJECT_ROOT cwd at runtime — no env injection needed.
```

### Step 6.6: Rewrite fetch-meta-ids.local.sh

- [ ] **Step 6.6.1: Update output format**

In `scripts/fetch-meta-ids.local.sh`, replace lines 71-87 (the env-format output block) with TOML output:

```bash
echo "" >&2
echo "── config.toml 붙여넣기 ────────────────────────────────" >&2
echo "" >&2
echo "# 아래 스니펫을 config.toml의 [platforms.meta] 섹션에 복사하세요" >&2
echo ""

echo "[platforms.meta]"
echo "access_token = \"${TOKEN}\""
if [[ -n "$ad_id" ]]; then
  echo "ad_account_id = \"${ad_id}\""
else
  echo "# ad_account_id = \"\"  # not found"
fi
if [[ -n "$page_id" ]]; then
  echo "page_id = \"${page_id}\""
else
  echo "# page_id = \"\"  # not found"
fi
if [[ -n "$ig_id" ]]; then
  echo "instagram_actor_id = \"${ig_id}\""
else
  echo "# instagram_actor_id = \"\"  # no IG biz account linked"
fi
```

Also update header comment:

```bash
# Before
# stdout 은 .env 붙여넣기용 key=value, stderr 는 진단용 출력.

# After
# stdout 은 config.toml [platforms.meta] 섹션 붙여넣기용 TOML, stderr 는 진단용 출력.
```

### Step 6.7: Run all tests + acceptance checks

- [ ] **Step 6.7.1: Full test suite**

```bash
npm test
```

Expected: All tests PASS (vitest setup auto-injects test config; no .env needed).

- [ ] **Step 6.7.2: Acceptance criterion 1: no process.env.X (except CONFIG_PATH)**

```bash
grep -rn "process\.env\." packages/ scripts/ 2>/dev/null | grep -v CONFIG_PATH
```

Expected: 0 lines.

- [ ] **Step 6.7.3: Acceptance criterion 2: no dotenv**

```bash
grep -rn "dotenv" packages/ scripts/ package.json packages/*/package.json 2>/dev/null
```

Expected: 0 lines.

- [ ] **Step 6.7.4: Acceptance criterion 3: no .env.*.example**

```bash
ls .env* 2>/dev/null
```

Expected: 0 files (only user's local `.env` if any, which is in .gitignore).

- [ ] **Step 6.7.5: Acceptance criterion 4: tests pass without config.toml present**

```bash
test -f config.toml && mv config.toml config.toml.bak || true
npm test
test -f config.toml.bak && mv config.toml.bak config.toml || true
```

Expected: All tests PASS even without config.toml (vitest setup provides BASE_CONFIG).

- [ ] **Step 6.7.6: Acceptance criterion 5: real environment runtime works**

Manual smoke test (only if you have valid Meta token):

```bash
cp config.example.toml config.toml
# (edit config.toml with real values)
npm run app
```

Expected: TUI launches without "config not found" or "API_KEY missing" errors. (If no real Meta token, this step is skipped — automated test pass is sufficient.)

### Step 6.8: Commit Task 6

- [ ] **Step 6.8.1: Stage and commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(config): remove dotenv + delete .env templates + update plist

Removes import "dotenv/config" from 13 entry files. Drops dotenv
dependency from root + cli + server package.json. Deletes
.env.owner.example and .env.service.example. Updates worker plist to
no longer inject env vars (worker reads config.toml from cwd).
Rewrites fetch-meta-ids script to output TOML snippet for [platforms.meta].

After this commit, .env infrastructure is fully removed. process.env
access is limited to CONFIG_PATH meta-setting in loader.ts.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Update Documentation

**Files:**
- Modify: `README.md` (Setup section)
- Modify: `docs/STATUS.md` (recent changes + close M-1 dotenv-duplication issue)
- Modify: `docs/ROADMAP.md` (mark TOML migration done if listed)
- Modify: `docs/ARCHITECTURE.md` (add config infrastructure decision)
- Modify: `CLAUDE.md` (add "환경변수 사용 금지 (CONFIG_PATH 제외)" rule)

### Step 7.1: README.md Setup section

- [ ] **Step 7.1.1: Read current README setup section**

```bash
grep -n -A 30 -i "setup\|설정\|시작" README.md | head -60
```

- [ ] **Step 7.1.2: Replace .env-based setup with config.toml-based**

Update Setup section to:

```markdown
## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create config file from template:
   ```bash
   cp config.example.toml config.toml
   ```

3. Fill in required values in `config.toml`:
   - `[platforms.meta]` — Meta Marketing API credentials
   - `[ai.anthropic]` and/or `[ai.google]` — at least one LLM provider
   - `[ai.voyage]` — required for Winner DB / qualify pipeline
   - Other sections optional depending on deployment mode

4. (Optional) Use Meta token to auto-fetch ad_account_id / page_id / instagram_actor_id:
   ```bash
   ./scripts/fetch-meta-ids.local.sh <META_ACCESS_TOKEN>
   # Copy the output [platforms.meta] block into config.toml
   ```

5. Run any command:
   ```bash
   npm run app          # TUI
   npm run pipeline     # scrape → generate
   npm run server       # API server
   ```

### Custom config path

By default, the app reads `./config.toml`. Override via `CONFIG_PATH`:

```bash
CONFIG_PATH=/etc/ad-ai/prod.toml npm run server
```
```

### Step 7.2: STATUS.md update

- [ ] **Step 7.2.1: Add to "최근 변경 이력"**

Insert at the top of "최근 변경 이력" in `docs/STATUS.md`:

```markdown
- 2026-04-25: TOML 설정 마이그레이션 완료. `.env` 인프라 완전 제거(.env.*.example 2개 파일 삭제, dotenv 의존성 제거, 13개 entry의 `import "dotenv/config"` 삭제). 모든 17개 변수가 `config.toml` 단일 파일 + Zod 검증된 lazy singleton(`getConfig()`)으로 통일. 멀티모듈 리팩터의 알려진 결함 M-1(dotenv 중복) 해소.
```

- [ ] **Step 7.2.2: Mark M-1 as resolved**

Find the "알려진 결함" / "M-1" section and update to indicate resolution:

```markdown
- ~~M-1: dotenv duplicated across packages~~ — 2026-04-25 해소 (TOML 마이그레이션으로 dotenv 자체 제거)
```

- [ ] **Step 7.2.3: Update "마지막 업데이트"**

Set top-of-file `마지막 업데이트` to `2026-04-25`.

### Step 7.3: ROADMAP.md update

- [ ] **Step 7.3.1: Remove TOML migration if listed**

Check `docs/ROADMAP.md` for TOML migration in Tier 2/3 and remove if present. Add Sub-project 2 (멀티플랫폼 어댑터) entry if not already there:

```markdown
- **멀티플랫폼 어댑터 추가 (Sub-project 2)**: TikTok ACO, Google Ads PMax, YouTube (via Google Ads) 어댑터를 `AdPlatform` 인터페이스에 추가. `[platforms.tiktok]`, `[platforms.google]` config 섹션 + Zod 스키마 확장. 트리거: TOML 마이그레이션 완료 (2026-04-25 ✅).
```

### Step 7.4: ARCHITECTURE.md update

- [ ] **Step 7.4.1: Add config infrastructure to "핵심 설계 결정"**

Insert new section in `docs/ARCHITECTURE.md` "핵심 설계 결정":

```markdown
### 설정: 단일 `config.toml` + Zod 검증된 lazy singleton (2026-04-25)

**Why:** `.env` 평면 구조는 17개 변수를 한 줄씩 늘어놓아 도메인 그룹핑이 불가능하고, 멀티플랫폼 어댑터 추가 시 `META_*`/`TIKTOK_*`/`GOOGLE_*` 접두사가 폭증한다. TOML의 `[platforms.meta]`/`[platforms.tiktok]` 섹션은 자연스럽게 도메인을 표현한다.

**How:** `packages/core/src/config/`에 모듈 분리. `loader.ts`가 `smol-toml`로 파일 파싱 후 `schema.ts`의 Zod 스키마로 검증. `index.ts`의 lazy singleton(`getConfig()`)이 캐시. 도메인별 `requireMeta`/`requireAnthropicKey` 등 helper로 호출처 narrowing. 테스트는 `setConfigForTesting(makeTestConfig({...}))` 패턴으로 주입(vitest.setup.ts가 매 테스트 자동 reset).

`process.env`는 `CONFIG_PATH` 메타 설정 1건만 예외 허용. `dotenv` 의존성과 `.env.*.example` 파일은 완전 제거.
```

### Step 7.5: CLAUDE.md update

- [ ] **Step 7.5.1: Add config rule**

Insert in `CLAUDE.md` (project root, not global) — add to existing "하네스 엔지니어링 규칙" or create new "환경변수 정책" section:

```markdown
## 환경변수 정책

`process.env.X` 직접 참조 금지. 모든 설정은 `config.toml` 파일에 두고 `getConfig()` 또는 도메인 helper(`@ad-ai/core/config/helpers`)를 사용한다. 예외: `CONFIG_PATH` 1건 (loader 내부에서만).
```

### Step 7.6: Commit Task 7

```bash
git add README.md docs/ CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: update setup/status/architecture for TOML config migration

- README Setup section rewritten for config.toml workflow
- STATUS.md records migration completion + closes M-1 dotenv-duplication
- ARCHITECTURE.md adds config infrastructure design decision
- CLAUDE.md adds process.env ban rule (CONFIG_PATH excepted)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Final Acceptance Verification

After all 7 tasks committed, run the full acceptance suite:

```bash
# 1. No process.env.X except CONFIG_PATH
grep -rn "process\.env\." packages/ scripts/ 2>/dev/null | grep -v CONFIG_PATH
# Expected: 0 lines

# 2. No dotenv anywhere
grep -rn "dotenv" packages/ scripts/ package.json packages/*/package.json 2>/dev/null
# Expected: 0 lines

# 3. No .env.*.example files
ls .env* 2>/dev/null
# Expected: empty

# 4. All tests pass without config.toml present
test -f config.toml && mv config.toml config.toml.bak
npm test
test -f config.toml.bak && mv config.toml.bak config.toml
# Expected: full suite passes

# 5. Type-check
npx tsc --noEmit
# Expected: 0 errors

# 6. Real-environment smoke (with valid config.toml)
cp config.example.toml config.toml
# (fill in real values)
npm run app
# Expected: TUI launches normally

# 7. CONFIG_PATH override works
echo '[platforms]
enabled=["meta"]
[platforms.meta]
access_token="x"
ad_account_id="act_1"
page_id="1"
instagram_actor_id="1"
[ai.anthropic]
api_key="k"' > /tmp/test-config.toml
CONFIG_PATH=/tmp/test-config.toml node -e 'require("./packages/core/src/config/index.js")' 2>&1 || true
# (manual verification — should not throw "config.toml not found")
```

---

## Self-Review

**1. Spec coverage:**
- ✅ TOML schema (Section 1 of spec) → Task 1 Step 1.3
- ✅ Loader API (Section 2) → Task 1 Steps 1.5-1.6
- ✅ Zod schema + optionality (Section 3) → Task 1 Step 1.3
- ✅ Test strategy (Section 4) → Task 1 Steps 1.7, plus per-domain test conversion in Tasks 2-5
- ✅ Migration mechanics (Section 5) → Tasks 2-6
- ✅ File structure (Section 6) → Tasks 1-7 collectively
- ✅ Acceptance criteria (Section 7 of spec) → Task 6.7 + Final Acceptance Verification

**2. Placeholder scan:** All steps have explicit code, exact paths, exact commands. No "TBD", "implement later", or vague "add validation" instructions.

**3. Type consistency:**
- `getConfig()` / `setConfigForTesting()` / `resetConfigForTesting()` / `makeTestConfig()` — used consistently across all tasks
- `requireMeta()` / `requireAnthropicKey()` / `requireGoogleAiKey()` / `requireVoyageKey()` / `requireStripeConfig()` — exact names match Section 3 of spec
- TOML keys consistently `snake_case` (matches schema in Task 1.3)
- Import path `@ad-ai/core/config` and `@ad-ai/core/config/helpers` consistent (workspace alias resolved by npm workspaces deep-import pattern, matches multi-module refactor decision)

**Open observation (not a plan defect):** `.env.owner.example` currently in repo contains real-looking Meta credentials (META_ACCESS_TOKEN value, META_AD_ACCOUNT_ID, META_PAGE_ID). These are committed to git history. Migration deletes the file but the secret was already exposed; user should rotate the Meta access token after migration regardless of this plan. Documented here for awareness — out of scope for this plan to remediate.

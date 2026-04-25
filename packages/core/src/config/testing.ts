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

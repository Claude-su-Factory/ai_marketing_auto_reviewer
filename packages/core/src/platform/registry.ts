import type { AdPlatform } from "./types.js";

const REQUIRED_ENV: Record<string, string[]> = {
  meta: ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID", "META_PAGE_ID"],
};

export function parseActivePlatformNames(raw: string | undefined): string[] {
  if (!raw || raw.trim() === "") return ["meta"];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const chunk of raw.split(",")) {
    const name = chunk.trim().toLowerCase();
    if (name && !seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; missing: string[] };

export function validatePlatformEnv(
  name: string,
  env: Record<string, string | undefined>,
): ValidationResult {
  const required = REQUIRED_ENV[name];
  if (!required) {
    return { ok: false, missing: [`platform "${name}" not yet supported`] };
  }
  const missing = required.filter((key) => !env[key]);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

export async function activePlatforms(): Promise<AdPlatform[]> {
  const names = parseActivePlatformNames(process.env.AD_PLATFORMS);
  const platforms: AdPlatform[] = [];
  for (const name of names) {
    const v = validatePlatformEnv(name, process.env);
    if (!v.ok) {
      console.warn(`[platform] skipping "${name}": ${v.missing.join(", ")}`);
      continue;
    }
    if (name === "meta") {
      const { createMetaAdapter } = await import("./meta/adapter.js");
      platforms.push(createMetaAdapter());
    }
  }
  return platforms;
}

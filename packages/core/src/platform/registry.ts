import type { AdPlatform } from "./types.js";
import { getConfig, type Config } from "../config/index.js";


export type ValidationResult =
  | { ok: true }
  | { ok: false; missing: string[] };

export function validatePlatform(name: string, cfg: Config = getConfig()): ValidationResult {
  if (name !== "meta") {
    return { ok: false, missing: [`platform "${name}" not yet supported`] };
  }
  const meta = cfg.platforms.meta;
  if (!meta) return { ok: false, missing: ["platforms.meta"] };
  const missing: string[] = [];
  if (!meta.access_token) missing.push("platforms.meta.access_token");
  if (!meta.ad_account_id) missing.push("platforms.meta.ad_account_id");
  if (!meta.page_id) missing.push("platforms.meta.page_id");
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

export async function activePlatforms(): Promise<AdPlatform[]> {
  const cfg = getConfig();
  const platforms: AdPlatform[] = [];
  for (const name of cfg.platforms.enabled) {
    const v = validatePlatform(name, cfg);
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

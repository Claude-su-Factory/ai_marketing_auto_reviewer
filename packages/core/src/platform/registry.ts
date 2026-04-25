import type { AdPlatform } from "./types.js";
import { getConfig, type Config } from "../config/index.js";

const NOT_YET_IMPLEMENTED = new Set<string>(["tiktok", "google"]);

export type ValidationResult =
  | { ok: true }
  | { ok: false; missing: string[] };

export function validatePlatform(name: string, cfg: Config = getConfig()): ValidationResult {
  if (name === "meta") {
    const meta = cfg.platforms.meta;
    if (!meta) return { ok: false, missing: ["platforms.meta"] };
    const missing: string[] = [];
    if (!meta.access_token) missing.push("platforms.meta.access_token");
    if (!meta.ad_account_id) missing.push("platforms.meta.ad_account_id");
    if (!meta.page_id) missing.push("platforms.meta.page_id");
    return missing.length === 0 ? { ok: true } : { ok: false, missing };
  }
  if (name === "tiktok") {
    const tiktok = cfg.platforms.tiktok;
    if (!tiktok) return { ok: false, missing: ["platforms.tiktok"] };
    const missing: string[] = [];
    if (!tiktok.access_token) missing.push("platforms.tiktok.access_token");
    if (!tiktok.advertiser_id) missing.push("platforms.tiktok.advertiser_id");
    return missing.length === 0 ? { ok: true } : { ok: false, missing };
  }
  if (name === "google") {
    const google = cfg.platforms.google;
    if (!google) return { ok: false, missing: ["platforms.google"] };
    const missing: string[] = [];
    if (!google.developer_token) missing.push("platforms.google.developer_token");
    if (!google.customer_id) missing.push("platforms.google.customer_id");
    return missing.length === 0 ? { ok: true } : { ok: false, missing };
  }
  return { ok: false, missing: [`platform "${name}" not supported`] };
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
    if (NOT_YET_IMPLEMENTED.has(name)) {
      console.warn(
        `[platform] "${name}" is enabled and configured, but adapter is scaffold-only. ` +
          `Skipping registration. See packages/core/src/platform/${name}/README.md.`,
      );
      continue;
    }
    if (name === "meta") {
      const { createMetaAdapter } = await import("./meta/adapter.js");
      platforms.push(createMetaAdapter());
    }
    // 실 통합 시 NOT_YET_IMPLEMENTED에서 제거 + 분기 추가:
    // else if (name === "tiktok") {
    //   const { createTiktokAdapter } = await import("./tiktok/adapter.js");
    //   platforms.push(createTiktokAdapter());
    // }
    // else if (name === "google") {
    //   const { createGoogleAdapter } = await import("./google/adapter.js");
    //   platforms.push(createGoogleAdapter());
    // }
  }
  return platforms;
}

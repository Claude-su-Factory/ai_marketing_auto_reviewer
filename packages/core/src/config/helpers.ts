import { getConfig, type Config } from "./index.js";

export function requireMeta(
  cfg: Config = getConfig()
): NonNullable<Config["platforms"]["meta"]> {
  if (!cfg.platforms.meta) {
    throw new Error("[platforms.meta] is required for this operation");
  }
  return cfg.platforms.meta;
}

export function requireAnthropicKey(cfg: Config = getConfig()): string {
  const key = cfg.ai.anthropic?.api_key;
  if (!key) throw new Error("[ai.anthropic.api_key] is required for this operation");
  return key;
}

export function requireGoogleAiKey(cfg: Config = getConfig()): string {
  const key = cfg.ai.google?.api_key;
  if (!key) throw new Error("[ai.google.api_key] is required for this operation");
  return key;
}

// Defaults updated 2026-04-28 — imagen-3.0-generate-002 deprecated by Google (404 NOT_FOUND).
// Run `npm run list-models` to verify/refresh if these become unavailable later.
const DEFAULT_GOOGLE_IMAGE_MODEL = "imagen-4.0-generate-001";
const DEFAULT_GOOGLE_VIDEO_MODEL = "veo-3.1-generate-preview";

export function getGoogleImageModel(cfg: Config = getConfig()): string {
  return cfg.ai.google?.models?.image ?? DEFAULT_GOOGLE_IMAGE_MODEL;
}

export function getGoogleVideoModel(cfg: Config = getConfig()): string {
  return cfg.ai.google?.models?.video ?? DEFAULT_GOOGLE_VIDEO_MODEL;
}

export function requireVoyageKey(cfg: Config = getConfig()): string {
  const key = cfg.ai.voyage?.api_key;
  if (!key) throw new Error("[ai.voyage.api_key] is required for this operation");
  return key;
}

export function requireStripeConfig(
  cfg: Config = getConfig()
): NonNullable<NonNullable<Config["billing"]>["stripe"]> {
  const stripe = cfg.billing?.stripe;
  if (!stripe) throw new Error("[billing.stripe] is required for this operation");
  return stripe;
}

export function requireTiktok(
  cfg: Config = getConfig(),
): NonNullable<Config["platforms"]["tiktok"]> {
  if (!cfg.platforms.tiktok) {
    throw new Error("[platforms.tiktok] is required for this operation");
  }
  return cfg.platforms.tiktok;
}

export function requireGoogle(
  cfg: Config = getConfig(),
): NonNullable<Config["platforms"]["google"]> {
  if (!cfg.platforms.google) {
    throw new Error("[platforms.google] is required for this operation");
  }
  return cfg.platforms.google;
}

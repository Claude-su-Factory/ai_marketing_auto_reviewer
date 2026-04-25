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

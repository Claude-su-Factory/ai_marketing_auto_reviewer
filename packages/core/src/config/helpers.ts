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

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

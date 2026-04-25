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

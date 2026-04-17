export type AppMode = "owner" | "customer";

export interface ModeConfig {
  mode: AppMode;
  licenseKey?: string;
  serverUrl?: string;
  sessionToken?: string;
  tempDir: string;
}

export function detectMode(argv: string[] = process.argv.slice(2)): ModeConfig {
  const tempDir = "data/temp";

  const explicitMode = process.env.AD_AI_MODE;
  if (explicitMode === "owner") {
    return { mode: "owner", tempDir };
  }

  const keyFromArg = argv.find((a) => a.startsWith("--key="))?.split("=")[1];
  const keyFromEnv = process.env.AD_AI_LICENSE_KEY;
  const licenseKey = keyFromArg ?? keyFromEnv;

  if (explicitMode === "customer" || licenseKey) {
    return {
      mode: "customer",
      licenseKey,
      serverUrl: process.env.AD_AI_SERVER_URL ?? "http://localhost:3000",
      tempDir,
    };
  }

  return { mode: "owner", tempDir };
}

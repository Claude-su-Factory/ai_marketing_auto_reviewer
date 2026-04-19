import type { ModeConfig } from "../mode.js";

export function buildUrl(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/$/, "") + path;
}

export async function serverFetch(
  config: ModeConfig,
  path: string,
  body: object,
  maxRetries = 3
): Promise<Response> {
  const url = buildUrl(config.serverUrl!, path);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.sessionToken) {
    headers["Authorization"] = `Bearer ${config.sessionToken}`;
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (response.status === 401 && config.licenseKey && attempt < maxRetries - 1) {
        const refreshed = await refreshSession(config);
        if (refreshed) {
          headers["Authorization"] = `Bearer ${config.sessionToken}`;
          continue;
        }
      }

      if (response.status === 429 && attempt < maxRetries - 1) {
        const data = await response.json() as { retryAfter?: number };
        const waitMs = (data.retryAfter ?? 5) * 1000;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      return response;
    } catch (e) {
      if (attempt === maxRetries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  throw new Error("서버 연결 실패: Usage Server에 연결할 수 없습니다.");
}

export async function serverGet(
  config: ModeConfig,
  path: string,
  maxRetries = 3
): Promise<Response> {
  const url = buildUrl(config.serverUrl!, path);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const headers: Record<string, string> = {};
      if (config.sessionToken) {
        headers["Authorization"] = `Bearer ${config.sessionToken}`;
      }

      const response = await fetch(url, { headers });

      if (response.status === 401 && config.licenseKey && attempt < maxRetries - 1) {
        const refreshed = await refreshSession(config);
        if (refreshed) continue;
      }

      if (response.status === 429 && attempt < maxRetries - 1) {
        const data = await response.json() as { retryAfter?: number };
        await new Promise((r) => setTimeout(r, (data.retryAfter ?? 5) * 1000));
        continue;
      }

      return response;
    } catch (e) {
      if (attempt === maxRetries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  throw new Error("서버 연결 실패");
}

async function refreshSession(config: ModeConfig): Promise<boolean> {
  try {
    const url = buildUrl(config.serverUrl!, "/license/validate");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: config.licenseKey }),
    });
    if (!response.ok) return false;
    const data = await response.json() as { sessionToken: string };
    config.sessionToken = data.sessionToken;
    return true;
  } catch {
    return false;
  }
}

export async function validateLicense(config: ModeConfig): Promise<boolean> {
  return refreshSession(config);
}

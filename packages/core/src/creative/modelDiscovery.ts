import { requireGoogleAiKey } from "../config/helpers.js";

interface GoogleModel {
  name?: string;
  supportedGenerationMethods?: string[];
}

interface ListModelsResponse {
  models?: GoogleModel[];
  nextPageToken?: string;
}

let cachedModels: GoogleModel[] | null = null;
let pendingFetch: Promise<GoogleModel[]> | null = null;
let cachedImageModel: string | null = null;
let imageOverride: string | null = null;

function shortName(m: GoogleModel): string {
  return (m.name ?? "").replace(/^models\//, "");
}

async function fetchModels(): Promise<GoogleModel[]> {
  if (cachedModels) return cachedModels;
  if (pendingFetch) return pendingFetch;
  pendingFetch = (async () => {
    const apiKey = requireGoogleAiKey();
    const all: GoogleModel[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("pageSize", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Google list-models ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as ListModelsResponse;
      if (data.models) all.push(...data.models);
      pageToken = data.nextPageToken;
    } while (pageToken);
    cachedModels = all;
    return all;
  })();
  try {
    return await pendingFetch;
  } finally {
    pendingFetch = null;
  }
}

/** Higher score = preferred candidate. Heuristic:
 *  - non-preview > preview (production stability)
 *  - higher version number wins (imagen-4 > imagen-3)
 *  - "generate" base variant > fast/ultra/lite (balanced quality/cost) */
export function rankCandidate(name: string): number {
  let score = 0;
  if (!name.includes("preview")) score += 10000;
  const versionMatch = name.match(/(\d+)\.(\d+)/);
  if (versionMatch) {
    score += parseInt(versionMatch[1], 10) * 100;
    score += parseInt(versionMatch[2], 10) * 10;
  }
  const isFast = name.includes("fast");
  const isUltra = name.includes("ultra");
  const isLite = name.includes("lite");
  if (!isFast && !isUltra && !isLite) score += 50;
  return score;
}

function pickBestByName(models: GoogleModel[], includes: string, method: string): string | null {
  const candidates = models.filter((m) => {
    const n = shortName(m).toLowerCase();
    return n.includes(includes) && (m.supportedGenerationMethods ?? []).includes(method);
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => rankCandidate(shortName(b)) - rankCandidate(shortName(a)));
  return shortName(candidates[0]);
}

export async function discoverImageModel(): Promise<string> {
  if (imageOverride) return imageOverride;
  if (cachedImageModel) return cachedImageModel;
  const models = await fetchModels();
  const picked = pickBestByName(models, "imagen", "predict");
  if (!picked) {
    throw new Error(
      "Google API 키에 사용 가능한 imagen 모델 없음. " +
      "https://aistudio.google.com 에서 imagen 액세스 권한 확인. " +
      "디버깅: `npm run list-models` 로 가용 모델 확인.",
    );
  }
  cachedImageModel = picked;
  return picked;
}

/** Test-only: bypass auto-discovery (and network) by pinning specific model IDs. */
export function setModelOverrideForTesting(opts: { image?: string | null }): void {
  if (opts.image !== undefined) imageOverride = opts.image;
}

/** Reset in-memory caches — useful in test setup or when API key changes. */
export function clearModelDiscoveryCache(): void {
  cachedModels = null;
  pendingFetch = null;
  cachedImageModel = null;
  imageOverride = null;
}

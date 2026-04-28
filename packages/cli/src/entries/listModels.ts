import { requireGoogleAiKey } from "@ad-ai/core/config/helpers.js";

interface GoogleModel {
  name?: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
}

interface ListModelsResponse {
  models?: GoogleModel[];
  nextPageToken?: string;
}

async function fetchAllModels(apiKey: string): Promise<GoogleModel[]> {
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
      throw new Error(`Google API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as ListModelsResponse;
    if (data.models) all.push(...data.models);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return all;
}

function shortName(m: GoogleModel): string {
  return m.name?.replace(/^models\//, "") ?? "(unnamed)";
}

function pickFirst(models: GoogleModel[], substring: string, method?: string): GoogleModel | undefined {
  return models.find((m) => {
    const matches = (m.name ?? "").toLowerCase().includes(substring);
    const okMethod = !method || (m.supportedGenerationMethods ?? []).includes(method);
    return matches && okMethod;
  });
}

async function main(): Promise<void> {
  const apiKey = requireGoogleAiKey();
  const models = await fetchAllModels(apiKey);

  // Group by capability
  const byMethod = new Map<string, GoogleModel[]>();
  for (const m of models) {
    for (const method of m.supportedGenerationMethods ?? ["(none)"]) {
      const bucket = byMethod.get(method) ?? [];
      bucket.push(m);
      byMethod.set(method, bucket);
    }
  }

  const methods = Array.from(byMethod.keys()).sort();
  for (const method of methods) {
    const list = byMethod.get(method) ?? [];
    console.log(`\n=== ${method} (${list.length}) ===`);
    for (const m of list) {
      const flag = m.name?.includes("imagen") ? " [image]" :
                   m.name?.includes("veo") ? " [video]" :
                   m.name?.includes("gemini") ? " [text/multi]" : "";
      console.log(`  ${shortName(m)}${flag}`);
      if (m.displayName && m.displayName !== shortName(m)) {
        console.log(`    └ ${m.displayName}`);
      }
    }
  }

  console.log("\n--- Suggested config.toml [ai.google.models] ---");
  const imagenCandidate = pickFirst(models, "imagen", "predict") ?? pickFirst(models, "imagen");
  const veoCandidate = pickFirst(models, "veo");

  if (imagenCandidate) {
    const imagenAll = models.filter((m) => (m.name ?? "").includes("imagen"));
    console.log(`image = "${shortName(imagenCandidate)}"  # 후보: ${imagenAll.map(shortName).join(", ")}`);
  } else {
    console.log("# image: 가용 imagen 모델 없음 — Google AI Studio 콘솔에서 권한 확인 필요");
  }

  if (veoCandidate) {
    const veoAll = models.filter((m) => (m.name ?? "").includes("veo"));
    console.log(`video = "${shortName(veoCandidate)}"  # 후보: ${veoAll.map(shortName).join(", ")}`);
  } else {
    console.log("# video: 가용 veo 모델 없음 — Google AI Studio 콘솔에서 권한 확인 필요");
  }

  console.log("\n총 모델 수:", models.length);
}

main().catch((e) => {
  console.error(`[list-models] 실행 실패: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

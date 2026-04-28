import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  rankCandidate,
  discoverImageModel,
  discoverVideoModel,
  setModelOverrideForTesting,
  clearModelDiscoveryCache,
} from "./modelDiscovery.js";

describe("rankCandidate", () => {
  it("scores stable above preview", () => {
    expect(rankCandidate("imagen-4.0-generate-001")).toBeGreaterThan(rankCandidate("imagen-4.0-generate-preview"));
  });

  it("scores higher version above lower", () => {
    expect(rankCandidate("imagen-4.0-generate-001")).toBeGreaterThan(rankCandidate("imagen-3.0-generate-001"));
    expect(rankCandidate("veo-3.1-generate-preview")).toBeGreaterThan(rankCandidate("veo-3.0-generate-preview"));
  });

  it("scores 'generate' base above fast/ultra/lite variants", () => {
    expect(rankCandidate("imagen-4.0-generate-001")).toBeGreaterThan(rankCandidate("imagen-4.0-fast-generate-001"));
    expect(rankCandidate("imagen-4.0-generate-001")).toBeGreaterThan(rankCandidate("imagen-4.0-ultra-generate-001"));
    expect(rankCandidate("veo-3.1-generate-preview")).toBeGreaterThan(rankCandidate("veo-3.1-lite-generate-preview"));
  });
});

describe("discoverImageModel / discoverVideoModel", () => {
  beforeEach(() => {
    clearModelDiscoveryCache();
  });

  it("returns override immediately without fetch when set", async () => {
    setModelOverrideForTesting({ image: "pinned-imagen", video: "pinned-veo" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await discoverImageModel()).toBe("pinned-imagen");
    expect(await discoverVideoModel()).toBe("pinned-veo");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("fetches once and caches across multiple calls (image)", async () => {
    setModelOverrideForTesting({ image: null, video: null });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            { name: "models/imagen-3.0-generate-002", supportedGenerationMethods: ["predict"] },
            { name: "models/imagen-4.0-fast-generate-001", supportedGenerationMethods: ["predict"] },
            { name: "models/imagen-4.0-generate-001", supportedGenerationMethods: ["predict"] },
            { name: "models/imagen-4.0-ultra-generate-001", supportedGenerationMethods: ["predict"] },
            { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
          ],
        }),
        { status: 200 },
      ),
    );

    const first = await discoverImageModel();
    const second = await discoverImageModel();
    expect(first).toBe("imagen-4.0-generate-001"); // best by ranking (newer + base "generate")
    expect(second).toBe("imagen-4.0-generate-001");
    expect(fetchSpy).toHaveBeenCalledTimes(1); // cached after first
    fetchSpy.mockRestore();
  });

  it("picks veo predictLongRunning best candidate", async () => {
    setModelOverrideForTesting({ image: null, video: null });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            { name: "models/veo-2.0-generate-001", supportedGenerationMethods: ["predictLongRunning"] },
            { name: "models/veo-3.0-generate-001", supportedGenerationMethods: ["predictLongRunning"] },
            { name: "models/veo-3.1-generate-preview", supportedGenerationMethods: ["predictLongRunning"] },
            { name: "models/veo-3.1-lite-generate-preview", supportedGenerationMethods: ["predictLongRunning"] },
          ],
        }),
        { status: 200 },
      ),
    );

    expect(await discoverVideoModel()).toBe("veo-3.0-generate-001"); // stable beats preview
    fetchSpy.mockRestore();
  });

  it("throws actionable error when no imagen models in API response", async () => {
    setModelOverrideForTesting({ image: null, video: null });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
          ],
        }),
        { status: 200 },
      ),
    );
    await expect(discoverImageModel()).rejects.toThrow(/imagen 모델 없음.*npm run list-models/s);
    fetchSpy.mockRestore();
  });

  it("throws actionable error when no veo models in API response", async () => {
    setModelOverrideForTesting({ image: null, video: null });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
          ],
        }),
        { status: 200 },
      ),
    );
    await expect(discoverVideoModel()).rejects.toThrow(/veo 모델 없음.*npm run list-models/s);
    fetchSpy.mockRestore();
  });

  it("propagates fetch error with context", async () => {
    setModelOverrideForTesting({ image: null, video: null });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("forbidden", { status: 403 }),
    );
    await expect(discoverImageModel()).rejects.toThrow(/list-models 403/);
    fetchSpy.mockRestore();
  });

  it("concurrent calls share a single in-flight fetch", async () => {
    setModelOverrideForTesting({ image: null, video: null });
    let fetchCount = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      fetchCount++;
      // 약간의 지연으로 동시성 검증
      await new Promise((r) => setTimeout(r, 10));
      return new Response(
        JSON.stringify({
          models: [
            { name: "models/imagen-4.0-generate-001", supportedGenerationMethods: ["predict"] },
            { name: "models/veo-3.0-generate-001", supportedGenerationMethods: ["predictLongRunning"] },
          ],
        }),
        { status: 200 },
      );
    });

    const [a, b, c, d] = await Promise.all([
      discoverImageModel(),
      discoverImageModel(),
      discoverVideoModel(),
      discoverVideoModel(),
    ]);
    expect(a).toBe("imagen-4.0-generate-001");
    expect(b).toBe("imagen-4.0-generate-001");
    expect(c).toBe("veo-3.0-generate-001");
    expect(d).toBe("veo-3.0-generate-001");
    expect(fetchCount).toBe(1); // single in-flight fetch despite 4 callers
    fetchSpy.mockRestore();
  });
});

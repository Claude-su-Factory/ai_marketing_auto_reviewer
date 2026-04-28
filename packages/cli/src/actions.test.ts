import { describe, it, expect, vi } from "vitest";
import { buildOverallProgress, validateMonitorMode, runScrape, runGenerate, runLaunch, runMonitor, runImprove, runPipelineAction } from "./actions.js";
import type { TaskProgress } from "./tui/AppTypes.js";

describe("buildOverallProgress", () => {
  it("returns 0 when all tasks are 0", () => {
    const p: TaskProgress = { copy: 0, image: 0 };
    expect(buildOverallProgress(p)).toBe(0);
  });

  it("returns 100 when all tasks are 100", () => {
    const p: TaskProgress = { copy: 100, image: 100 };
    expect(buildOverallProgress(p)).toBe(100);
  });

  it("averages the two task percentages", () => {
    const p: TaskProgress = { copy: 100, image: 50 };
    expect(buildOverallProgress(p)).toBe(75);
  });
});

describe("validateMonitorMode", () => {
  it("accepts 'd' as daily", () => {
    expect(validateMonitorMode("d")).toBe("daily");
  });

  it("accepts 'w' as weekly", () => {
    expect(validateMonitorMode("w")).toBe("weekly");
  });

  it("returns null for invalid input", () => {
    expect(validateMonitorMode("x")).toBeNull();
    expect(validateMonitorMode("")).toBeNull();
  });
});

describe("actions no longer require AiProxy", () => {
  it("runScrape accepts (url, onProgress) without proxy", () => {
    expect(runScrape.length).toBe(2);
  });
  it("runGenerate accepts (onProgress) without proxy", () => {
    expect(runGenerate.length).toBe(1);
  });
  it("runLaunch accepts (onProgress) without proxy", () => {
    expect(runLaunch.length).toBe(1);
  });
  it("runMonitor accepts (mode, onProgress) without proxy", () => {
    expect(runMonitor.length).toBe(2);
  });
  it("runImprove accepts (onProgress) without proxy", () => {
    expect(runImprove.length).toBe(1);
  });
  it("runPipelineAction accepts (urls, onProgress) without proxy", () => {
    expect(runPipelineAction.length).toBe(2);
  });
});

describe("runGenerate parallelism", () => {
  it("emits progress.generate with copy + image tracks", async () => {
    // NOTE: 실제 SDK 호출은 mock. core/creative/* 모듈을 vi.mock 으로 stub
    // generateImage/generateCopy 를 instant resolve 로 대체
    // 아래 mock 은 beforeEach 에서 vi.resetModules 후 재주입
    const events: any[] = [];
    vi.doMock("@ad-ai/core/creative/image.js", () => ({ generateImage: async () => "img.jpg" }));
    vi.doMock("@ad-ai/core/creative/copy.js", () => ({
      generateCopy: async () => ({ headline: "h", body: "b", cta: "c", hashtags: [] }),
      createAnthropicClient: () => ({}),
    }));
    vi.doMock("@ad-ai/core/storage.js", () => ({
      listJson: async () => ["data/products/p1.json"],
      readJson: async () => ({ id: "p1", name: "AI 부트캠프", description: "d", targetUrl: "u", currency: "KRW", tags: [], inputMethod: "manual", createdAt: "" }),
      writeJson: async () => {},
    }));
    vi.doMock("@ad-ai/core/rag/voyage.js", () => ({
      createVoyageClient: () => ({ embed: async (texts: string[]) => texts.map(() => new Array(512).fill(0)) }),
    }));
    vi.doMock("@ad-ai/core/rag/db.js", () => ({
      createCreativesDb: () => ({ close: () => {}, prepare: () => ({ all: () => [], get: () => undefined, run: () => ({}) }) }),
    }));
    vi.doMock("@ad-ai/core/rag/store.js", () => ({
      WinnerStore: class {
        loadAll() { return []; }
        hasCreative() { return false; }
        insert() {}
      },
    }));
    vi.doMock("@ad-ai/core/rag/retriever.js", () => ({
      retrieveFewShotForProduct: async () => [],
    }));

    vi.resetModules();
    const { runGenerate: fresh } = await import("./actions.js");
    await fresh((p: any) => events.push(p));
    const withGen = events.filter((e) => e.generate);
    expect(withGen.length).toBeGreaterThan(0);
    expect(withGen[0].generate.tracks.copy).toBeDefined();
    expect(withGen[0].generate.tracks.image).toBeDefined();

    vi.doUnmock("@ad-ai/core/rag/voyage.js");
    vi.doUnmock("@ad-ai/core/rag/db.js");
    vi.doUnmock("@ad-ai/core/rag/store.js");
    vi.doUnmock("@ad-ai/core/rag/retriever.js");
  });

  it("retrieves fewShot for each product before generateCopy", async () => {
    const fewShotSpy = vi.fn().mockResolvedValue([
      { headline: "WINNER_H", body: "WINNER_B", cta: "WINNER_CTA" },
    ]);
    const generateCopySpy = vi.fn().mockResolvedValue({ headline: "h", body: "b", cta: "c", hashtags: [] });

    vi.doMock("@ad-ai/core/creative/image.js", () => ({ generateImage: async () => "img.jpg" }));
    vi.doMock("@ad-ai/core/creative/copy.js", () => ({
      generateCopy: generateCopySpy,
      createAnthropicClient: () => ({}),
    }));
    vi.doMock("@ad-ai/core/storage.js", () => ({
      listJson: async () => ["data/products/p1.json"],
      readJson: async () => ({ id: "p1", name: "X", description: "d", targetUrl: "u", currency: "KRW", tags: [], inputMethod: "manual", createdAt: "" }),
      writeJson: async () => {},
    }));
    vi.doMock("@ad-ai/core/rag/voyage.js", () => ({
      createVoyageClient: () => ({ embed: async () => [[]] }),
    }));
    vi.doMock("@ad-ai/core/rag/db.js", () => ({
      createCreativesDb: () => ({ close: () => {} }),
    }));
    vi.doMock("@ad-ai/core/rag/store.js", () => ({
      WinnerStore: class { loadAll() { return [{ headline: "WINNER_H", body: "WINNER_B", cta: "WINNER_CTA" } as any]; } },
    }));
    vi.doMock("@ad-ai/core/rag/retriever.js", () => ({
      retrieveFewShotForProduct: fewShotSpy,
    }));

    vi.resetModules();
    const { runGenerate: fresh } = await import("./actions.js");
    await fresh(() => {});

    expect(fewShotSpy).toHaveBeenCalled();
    // generateCopy 가 fewShot 받음 (3 variants × 1 product = 3 calls, 모두 same fewShot)
    const calls = generateCopySpy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const fewShotArg = calls[0][2];
    expect(fewShotArg).toEqual([{ headline: "WINNER_H", body: "WINNER_B", cta: "WINNER_CTA" }]);

    vi.doUnmock("@ad-ai/core/rag/voyage.js");
    vi.doUnmock("@ad-ai/core/rag/db.js");
    vi.doUnmock("@ad-ai/core/rag/store.js");
    vi.doUnmock("@ad-ai/core/rag/retriever.js");
  });
});

describe("runGenerate cleanup on partial failure", () => {
  it("unlinks fulfilled image file when copy task rejects", async () => {
    const unlinkedPaths: string[] = [];
    vi.doMock("fs/promises", () => ({
      unlink: async (p: string) => { unlinkedPaths.push(p); },
    }));
    vi.doMock("@ad-ai/core/creative/image.js", () => ({
      generateImage: async () => "data/creatives/p1-image.jpg",
    }));
    vi.doMock("@ad-ai/core/creative/copy.js", () => ({
      generateCopy: async () => { throw new Error("429 rate-limited — Anthropic"); },
      createAnthropicClient: () => ({}),
    }));
    const writtenJsons: string[] = [];
    vi.doMock("@ad-ai/core/storage.js", () => ({
      listJson: async () => ["data/products/p1.json"],
      readJson: async () => ({ id: "p1", name: "X", description: "d", targetUrl: "u", currency: "KRW", tags: [], learningOutcomes: [], differentiators: [], inputMethod: "manual", createdAt: "" }),
      writeJson: async (path: string) => { writtenJsons.push(path); },
    }));
    vi.doMock("@ad-ai/core/rag/voyage.js", () => ({
      createVoyageClient: () => ({ embed: async () => [[]] }),
    }));
    vi.doMock("@ad-ai/core/rag/db.js", () => ({
      createCreativesDb: () => ({ close: () => {} }),
    }));
    vi.doMock("@ad-ai/core/rag/store.js", () => ({
      WinnerStore: class { loadAll() { return []; } },
    }));
    vi.doMock("@ad-ai/core/rag/retriever.js", () => ({
      retrieveFewShotForProduct: async () => [],
    }));

    vi.resetModules();
    const { runGenerate: fresh } = await import("./actions.js");
    const result = await fresh(() => {});

    expect(result.success).toBe(false);
    expect(result.message).toBe("Generate 실패");
    // 이미지 파일이 cleanup 됨 (copy 실패 후 image fulfilled 의 파일을 unlink)
    expect(unlinkedPaths).toContain("data/creatives/p1-image.jpg");
    // creative JSON 은 written 되지 않음 (부분 실패 → variant 저장 skip)
    expect(writtenJsons.filter((p) => p.includes("creatives") && p.endsWith(".json"))).toEqual([]);

    vi.doUnmock("fs/promises");
    vi.doUnmock("@ad-ai/core/creative/image.js");
    vi.doUnmock("@ad-ai/core/creative/copy.js");
    vi.doUnmock("@ad-ai/core/storage.js");
    vi.doUnmock("@ad-ai/core/rag/voyage.js");
    vi.doUnmock("@ad-ai/core/rag/db.js");
    vi.doUnmock("@ad-ai/core/rag/store.js");
    vi.doUnmock("@ad-ai/core/rag/retriever.js");
  });
});

describe("runLaunch failure messages distinguish data state", () => {
  it("returns 'Generate 먼저' message when data/creatives/ is empty", async () => {
    vi.doMock("@ad-ai/core/platform/registry.js", () => ({
      activePlatforms: async () => [{ name: "meta", launch: async () => ({}) }],
    }));
    vi.doMock("@ad-ai/core/storage.js", () => ({
      listJson: async () => [],
      readJson: async () => null,
      writeJson: async () => {},
    }));
    vi.resetModules();
    const { runLaunch } = await import("./actions.js");
    const result = await runLaunch(() => {});
    expect(result.success).toBe(false);
    expect(result.message).toBe("Launch 실패");
    expect(result.logs.some((l: string) => l.includes("Generate 를 먼저"))).toBe(true);
    vi.doUnmock("@ad-ai/core/platform/registry.js");
    vi.doUnmock("@ad-ai/core/storage.js");
  });

  it("returns 'Review 에서 승인' guidance when creatives exist but none approved", async () => {
    vi.doMock("@ad-ai/core/platform/registry.js", () => ({
      activePlatforms: async () => [{ name: "meta", launch: async () => ({}) }],
    }));
    vi.doMock("@ad-ai/core/launch/groupApproval.js", () => ({
      groupCreativesByVariantGroup: (cs: any[]) => new Map([["g1", cs]]),
      groupApprovalCheck: () => ({ launch: false, approved: [] }),
    }));
    vi.doMock("@ad-ai/core/storage.js", () => ({
      listJson: async () => ["data/creatives/c.json"],
      readJson: async (p: string) => p.endsWith("c.json")
        ? { id: "c", productId: "p1", variantGroupId: "g1", status: "pending", imageLocalPath: "i" }
        : null,
      writeJson: async () => {},
    }));
    vi.resetModules();
    const { runLaunch } = await import("./actions.js");
    const result = await runLaunch(() => {});
    expect(result.success).toBe(false);
    expect(result.logs.some((l: string) => l.includes("승인된 변형이 부족") || l.includes("Review 에서 승인"))).toBe(true);
    vi.doUnmock("@ad-ai/core/platform/registry.js");
    vi.doUnmock("@ad-ai/core/launch/groupApproval.js");
    vi.doUnmock("@ad-ai/core/storage.js");
  });

  it("returns 'product 파일 없음' guidance when creatives are orphaned (product deleted)", async () => {
    vi.doMock("@ad-ai/core/platform/registry.js", () => ({
      activePlatforms: async () => [{ name: "meta", launch: async () => ({}) }],
    }));
    vi.doMock("@ad-ai/core/launch/groupApproval.js", () => ({
      groupCreativesByVariantGroup: (cs: any[]) => new Map([["g1", cs]]),
      groupApprovalCheck: () => ({ launch: true, approved: [{ productId: "missing", imageLocalPath: "i" }] }),
    }));
    vi.doMock("@ad-ai/core/storage.js", () => ({
      listJson: async () => ["data/creatives/c.json"],
      readJson: async (p: string) => p.endsWith("c.json")
        ? { id: "c", productId: "missing", variantGroupId: "g1", status: "approved", imageLocalPath: "i" }
        : null, // product file not found
      writeJson: async () => {},
    }));
    vi.resetModules();
    const { runLaunch } = await import("./actions.js");
    const result = await runLaunch(() => {});
    expect(result.success).toBe(false);
    expect(result.logs.some((l: string) => l.includes("product 파일이 없") || l.includes("고아"))).toBe(true);
    vi.doUnmock("@ad-ai/core/platform/registry.js");
    vi.doUnmock("@ad-ai/core/launch/groupApproval.js");
    vi.doUnmock("@ad-ai/core/storage.js");
  });
});

describe("runLaunch emits launchLogs to progress callback", () => {
  it("relays platform log entries through RunProgress.launchLogs", async () => {
    const events: any[] = [];
    vi.doMock("@ad-ai/core/platform/registry.js", () => ({
      activePlatforms: async () => [{
        name: "meta",
        launch: async (_g: any, onLog?: (l: any) => void) => {
          onLog?.({ ts: "14:32:04", method: "POST", path: "/act/campaigns", status: 200, refId: "c1" });
          return { campaignId: "c1", platform: "meta", externalIds: { campaign: "ext", adSet: "a", ad: "d" } };
        },
      }],
    }));
    vi.doMock("@ad-ai/core/launch/groupApproval.js", () => ({
      groupCreativesByVariantGroup: (cs: any[]) => new Map([["g1", cs]]),
      groupApprovalCheck: () => ({ launch: true, approved: [{ productId: "p1", imageLocalPath: "i" }] }),
    }));
    vi.doMock("@ad-ai/core/storage.js", () => ({
      listJson: async () => ["data/creatives/c.json"],
      readJson: async (p: string) => p.endsWith("c.json")
        ? { id: "c", productId: "p1", status: "approved", imageLocalPath: "i" }
        : { id: "p1", name: "X", description: "", targetUrl: "u", currency: "KRW", tags: [], inputMethod: "manual", createdAt: "" },
      writeJson: async () => {},
    }));
    vi.resetModules();
    const { runLaunch } = await import("./actions.js");
    await runLaunch((p: any) => events.push({ ...p }));
    const withLogs = events.filter((e) => Array.isArray(e.launchLogs) && e.launchLogs.length > 0);
    expect(withLogs.length).toBeGreaterThan(0);
    expect(withLogs.at(-1)!.launchLogs.at(-1).status).toBe(200);
    vi.doUnmock("@ad-ai/core/platform/registry.js");
    vi.doUnmock("@ad-ai/core/launch/groupApproval.js");
    vi.doUnmock("@ad-ai/core/storage.js");
  });
});

describe("runScrape emits 4-stage onProgress", () => {
  it("emits progress at playwright/pageload/parse/save stages", async () => {
    const messages: string[] = [];
    vi.doMock("playwright", () => ({
      chromium: {
        launch: async () => ({
          newPage: async () => ({
            goto: async () => {},
            content: async () => "<html>mock</html>",
          }),
          close: async () => {},
        }),
      },
    }));
    vi.doMock("@ad-ai/core/creative/copy.js", () => ({
      createAnthropicClient: () => ({}),
    }));
    vi.doMock("@ad-ai/core/product/parser.js", () => ({
      parseProductWithClaude: async () => ({
        id: "test-id",
        name: "Mock Product",
        description: "d",
        imageUrl: "",
        targetUrl: "https://example.com",
        category: "course",
        price: 0,
        currency: "KRW",
        tags: [],
        inputMethod: "scraped",
        createdAt: "2026-04-27T00:00:00.000Z",
      }),
    }));
    vi.doMock("@ad-ai/core/storage.js", () => ({
      writeJson: async () => {},
    }));

    vi.resetModules();
    const { runScrape: fresh } = await import("./actions.js");
    await fresh("https://example.com", (p: any) => messages.push(p.message));

    expect(messages.some((m) => /Playwright|브라우저/i.test(m))).toBe(true);
    expect(messages.some((m) => /페이지 로드/i.test(m))).toBe(true);
    expect(messages.some((m) => /Claude 파싱/i.test(m))).toBe(true);
    expect(messages.some((m) => /제품 저장 중/i.test(m))).toBe(true);

    vi.doUnmock("playwright");
    vi.doUnmock("@ad-ai/core/creative/copy.js");
    vi.doUnmock("@ad-ai/core/product/parser.js");
    vi.doUnmock("@ad-ai/core/storage.js");
  });
});

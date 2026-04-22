import { describe, it, expect, vi } from "vitest";
import { buildOverallProgress, validateMonitorMode, runScrape, runGenerate, runLaunch, runMonitor, runImprove, runPipelineAction } from "./actions.js";
import type { TaskProgress } from "./tui/AppTypes.js";

describe("buildOverallProgress", () => {
  it("returns 0 when all tasks are 0", () => {
    const p: TaskProgress = { copy: 0, image: 0, video: 0 };
    expect(buildOverallProgress(p)).toBe(0);
  });

  it("returns 100 when all tasks are 100", () => {
    const p: TaskProgress = { copy: 100, image: 100, video: 100 };
    expect(buildOverallProgress(p)).toBe(100);
  });

  it("averages the three task percentages", () => {
    const p: TaskProgress = { copy: 100, image: 50, video: 0 };
    expect(buildOverallProgress(p)).toBe(50);
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
  it("emits progress.generate with 3 tracks", async () => {
    // NOTE: 실제 SDK 호출은 mock. core/creative/* 모듈을 vi.mock 으로 stub
    // generateImage/generateVideo/generateCopy 를 instant resolve 로 대체
    // 아래 mock 은 beforeEach 에서 vi.resetModules 후 재주입
    const events: any[] = [];
    vi.doMock("../core/creative/image.js", () => ({ generateImage: async () => "img.jpg" }));
    vi.doMock("../core/creative/video.js", () => ({ generateVideo: async () => "vid.mp4" }));
    vi.doMock("../core/creative/copy.js", () => ({
      generateCopy: async () => ({ headline: "h", body: "b", cta: "c", hashtags: [] }),
      createAnthropicClient: () => ({}),
    }));
    vi.doMock("../core/storage.js", () => ({
      listJson: async () => ["data/products/p1.json"],
      readJson: async () => ({ id: "p1", name: "AI 부트캠프", description: "d", targetUrl: "u", currency: "KRW", tags: [], inputMethod: "manual", createdAt: "" }),
      writeJson: async () => {},
    }));
    const { runGenerate: fresh } = await import("./actions.js?parallel-test");
    await fresh((p: any) => events.push(p));
    const withGen = events.filter((e) => e.generate);
    expect(withGen.length).toBeGreaterThan(0);
    expect(withGen[0].generate.tracks.copy).toBeDefined();
    expect(withGen[0].generate.tracks.image).toBeDefined();
    expect(withGen[0].generate.tracks.video).toBeDefined();
  });
});

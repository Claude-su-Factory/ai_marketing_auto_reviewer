import { describe, it, expect } from "vitest";
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

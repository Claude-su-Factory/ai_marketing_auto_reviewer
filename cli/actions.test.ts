import { describe, it, expect } from "vitest";
import { buildOverallProgress, validateMonitorMode } from "./actions.js";
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

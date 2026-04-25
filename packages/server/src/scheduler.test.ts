import { describe, it, expect, vi } from "vitest";
import { setConfigForTesting } from "@ad-ai/core/config/index.js";
import { makeTestConfig } from "@ad-ai/core/config/testing.js";

vi.mock("@ad-ai/core/scheduler/index.js", () => ({
  registerJobs: vi.fn(),
}));
vi.mock("@ad-ai/core/scheduler/state.js", () => ({
  runCatchupIfNeeded: vi.fn(async () => {}),
  updateStateField: vi.fn(async () => {}),
}));
vi.mock("@ad-ai/core/campaign/monitor.js", () => ({
  collectDailyReports: vi.fn(async () => []),
  generateWeeklyAnalysis: vi.fn(async () => ""),
}));
vi.mock("@ad-ai/core/improver/runner.js", () => ({
  runImprovementCycle: vi.fn(async () => {}),
}));

describe("startScheduler", () => {
  it("SERVER_CADENCE 로 registerJobs 를 호출한다", async () => {
    // vitest.setup.ts already injected makeTestConfig() with voyage key — no setup needed
    const { startScheduler } = await import("./scheduler.js");
    const { registerJobs } = await import("@ad-ai/core/scheduler/index.js");
    const { SERVER_CADENCE } = await import("@ad-ai/core/scheduler/cadence.js");
    await startScheduler();
    expect(registerJobs).toHaveBeenCalledTimes(1);
    const calledCadence = (registerJobs as any).mock.calls[0][2];
    expect(calledCadence).toEqual(SERVER_CADENCE);
  });

  it("[ai.voyage.api_key] 부재 시 throws", async () => {
    setConfigForTesting(makeTestConfig({}, ["ai.voyage"]));
    const { startScheduler } = await import("./scheduler.js");
    await expect(startScheduler()).rejects.toThrow("[ai.voyage.api_key] not configured");
  });
});

import { describe, it, expect, vi } from "vitest";

vi.mock("../core/scheduler/index.js", () => ({
  registerJobs: vi.fn(),
}));
vi.mock("../core/scheduler/state.js", () => ({
  runCatchupIfNeeded: vi.fn(async () => {}),
  updateStateField: vi.fn(async () => {}),
}));
vi.mock("../core/campaign/monitor.js", () => ({
  collectDailyReports: vi.fn(async () => []),
  generateWeeklyAnalysis: vi.fn(async () => ""),
}));
vi.mock("../core/improver/runner.js", () => ({
  runImprovementCycle: vi.fn(async () => {}),
}));

describe("startScheduler", () => {
  it("SERVER_CADENCE 로 registerJobs 를 호출한다", async () => {
    const { startScheduler } = await import("./scheduler.js");
    const { registerJobs } = await import("../core/scheduler/index.js");
    const { SERVER_CADENCE } = await import("../core/scheduler/cadence.js");
    await startScheduler();
    expect(registerJobs).toHaveBeenCalledTimes(1);
    const calledCadence = (registerJobs as any).mock.calls[0][2];
    expect(calledCadence).toEqual(SERVER_CADENCE);
  });
});

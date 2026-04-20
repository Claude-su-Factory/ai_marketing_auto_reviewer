import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../storage.js", () => ({
  listJson: vi.fn(),
  readJson: vi.fn(),
}));
vi.mock("../improver/runner.js", () => ({
  runImprovementCycle: vi.fn(async () => {}),
}));
vi.mock("../improver/index.js", () => ({
  shouldTriggerImprovement: vi.fn((r: { ctr: number }) => r.ctr < 1.5),
}));
vi.mock("../campaign/monitor.js", () => ({
  variantReportsToReports: vi.fn((vrs: any[]) => vrs),
}));

describe("runScheduledImprovementCycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("weekly-analysis 가 없으면 runCycle 을 호출하지 않고 종료한다", async () => {
    const { listJson, readJson } = await import("../storage.js");
    const { runImprovementCycle: runCycle } = await import(
      "../improver/runner.js"
    );
    (listJson as any).mockResolvedValue([
      "data/reports/2026-04-19.json",
      "data/reports/2026-04-20.json",
    ]);
    (readJson as any).mockResolvedValue([{ ctr: 0.8 }]);

    const { runScheduledImprovementCycle } = await import(
      "./improvementCycle.js"
    );
    await runScheduledImprovementCycle();

    expect(listJson).toHaveBeenCalledWith("data/reports");
    expect(runCycle).not.toHaveBeenCalled();
  });

  it("weekly-analysis 가 있으면 weak reports 와 stringified analysis 로 runCycle 호출", async () => {
    const { listJson, readJson } = await import("../storage.js");
    const { runImprovementCycle: runCycle } = await import(
      "../improver/runner.js"
    );
    const paths = [
      "data/reports/weekly-analysis-2026-04-20.json",
      "data/reports/2026-04-18.json",
      "data/reports/2026-04-19.json",
      "data/reports/2026-04-20.json",
    ];
    (listJson as any).mockResolvedValue(paths);
    const weakReport = { ctr: 0.5, id: "weak" };
    const strongReport = { ctr: 2.0, id: "strong" };
    const analysisObj = { summary: "weekly summary" };
    (readJson as any).mockImplementation(async (p: string) => {
      if (p.includes("weekly-analysis")) return analysisObj;
      if (p.endsWith("2026-04-18.json")) return [weakReport];
      if (p.endsWith("2026-04-19.json")) return [strongReport];
      if (p.endsWith("2026-04-20.json")) return [weakReport];
      return null;
    });

    const { runScheduledImprovementCycle } = await import(
      "./improvementCycle.js"
    );
    await runScheduledImprovementCycle();

    expect(runCycle).toHaveBeenCalledTimes(1);
    const [weakArg, analysisArg] = (runCycle as any).mock.calls[0];
    expect(weakArg).toEqual([weakReport, weakReport]);
    expect(analysisArg).toBe(JSON.stringify(analysisObj));
  });
});

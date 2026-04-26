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

  it("weekly-analysis 가 있으면 weak reports 와 analysis object 로 runCycle 호출", async () => {
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
    expect(analysisArg).toEqual(analysisObj); // object directly, not stringified
  });
});

describe("defaultRunCycleAdapter — MIN_CAMPAIGNS gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips cycle when aggregated reports < 3", async () => {
    vi.doMock("../campaign/monitor.js", () => ({
      variantReportsToReports: vi.fn(() => [{ id: "r1", ctr: 0.5 } as any, { id: "r2", ctr: 0.4 } as any]),  // 2 only
    }));
    vi.resetModules();
    const { defaultRunCycleAdapter } = await import("./improvementCycle.js");
    const { runImprovementCycle } = await import("../improver/runner.js");
    const logs: string[] = [];
    const orig = console.log;
    console.log = (m: string) => { logs.push(m); };
    try {
      await defaultRunCycleAdapter({ summary: "x" }, []);
    } finally {
      console.log = orig;
    }
    expect(runImprovementCycle).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes("insufficient data"))).toBe(true);
    vi.doUnmock("../campaign/monitor.js");
  });
});

describe("runScheduledImprovementCycle — 3-stage separation", () => {
  it("runs all three stages when no stage throws", async () => {
    const { runScheduledImprovementCycle } = await import("./improvementCycle.js");
    const reports = [{ id: "r1" } as any];
    const analysis = { summary: "w" };
    const aggregate = vi.fn().mockResolvedValue({ variantReports: reports, weeklyAnalysis: analysis });
    const qualify = vi.fn().mockResolvedValue({ inserted: 0, skipped: 0 });
    const runCycle = vi.fn().mockResolvedValue(undefined);
    await runScheduledImprovementCycle({ aggregate, qualify, runCycle });
    expect(aggregate).toHaveBeenCalledOnce();
    expect(qualify).toHaveBeenCalledWith(reports);
    expect(runCycle).toHaveBeenCalledWith(analysis, reports);
  });

  it("skips remaining stages when aggregate throws, logs error", async () => {
    const { runScheduledImprovementCycle } = await import("./improvementCycle.js");
    const aggregate = vi.fn().mockRejectedValue(new Error("read fail"));
    const qualify = vi.fn();
    const runCycle = vi.fn();
    await runScheduledImprovementCycle({ aggregate, qualify, runCycle });
    expect(qualify).not.toHaveBeenCalled();
    expect(runCycle).not.toHaveBeenCalled();
  });

  it("still runs runCycle when qualify throws", async () => {
    const { runScheduledImprovementCycle } = await import("./improvementCycle.js");
    const aggregate = vi.fn().mockResolvedValue({ variantReports: [], weeklyAnalysis: { x: 1 } });
    const qualify = vi.fn().mockRejectedValue(new Error("voyage fail"));
    const runCycle = vi.fn().mockResolvedValue(undefined);
    await runScheduledImprovementCycle({ aggregate, qualify, runCycle });
    expect(runCycle).toHaveBeenCalledOnce();
  });

  it("resolves even when runCycle throws", async () => {
    const { runScheduledImprovementCycle } = await import("./improvementCycle.js");
    const aggregate = vi.fn().mockResolvedValue({ variantReports: [], weeklyAnalysis: null });
    const qualify = vi.fn().mockResolvedValue({ inserted: 0, skipped: 0 });
    const runCycle = vi.fn().mockRejectedValue(new Error("run fail"));
    await expect(
      runScheduledImprovementCycle({ aggregate, qualify, runCycle })
    ).resolves.toBeUndefined();
    expect(runCycle).toHaveBeenCalledOnce();
  });
});

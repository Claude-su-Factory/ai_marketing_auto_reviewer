import { describe, it, expect, vi } from "vitest";
import { registerJobs, type CronLike, type SchedulerDeps } from "./index.js";
import { OWNER_CADENCE } from "./cadence.js";

const passthrough = <T>(fn: () => Promise<T>) => fn();

function makeFakeCron() {
  const calls: Array<[string, () => Promise<void>]> = [];
  const cron: CronLike = {
    schedule: (expr, fn) => {
      calls.push([expr, fn as () => Promise<void>]);
    },
  };
  return { cron, calls };
}

function makeDeps(): SchedulerDeps {
  return {
    collectDailyReports: vi.fn(async () => []),
    generateWeeklyAnalysis: vi.fn(async () => ""),
    runImprovementCycle: vi.fn(async () => {}),
  };
}

describe("registerJobs", () => {
  it("collectCron 과 analyzeCron 두 스케줄을 등록한다", () => {
    const { cron, calls } = makeFakeCron();
    registerJobs(cron, makeDeps(), OWNER_CADENCE, passthrough, vi.fn());
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe("0 */6 * * *");
    expect(calls[1][0]).toBe("0 9 */2 * *");
  });

  it("analyze 콜백은 generateWeeklyAnalysis → runImprovementCycle 순서로 호출한다", async () => {
    const log: string[] = [];
    const deps: SchedulerDeps = {
      collectDailyReports: vi.fn(async () => []),
      generateWeeklyAnalysis: vi.fn(async () => {
        log.push("analyze");
        return "";
      }),
      runImprovementCycle: vi.fn(async () => {
        log.push("improve");
      }),
    };
    const { cron, calls } = makeFakeCron();
    registerJobs(cron, deps, OWNER_CADENCE, passthrough, vi.fn());
    await calls[1][1]();
    expect(log).toEqual(["analyze", "improve"]);
  });

  it("collect 콜백이 성공하면 onComplete('lastCollect') 를 호출한다", async () => {
    const deps = makeDeps();
    const onComplete = vi.fn(async () => {});
    const { cron, calls } = makeFakeCron();
    registerJobs(cron, deps, OWNER_CADENCE, passthrough, onComplete);
    await calls[0][1]();
    expect(onComplete).toHaveBeenCalledWith("lastCollect");
  });

  it("analyze 콜백이 성공하면 onComplete('lastAnalyze') 를 호출한다", async () => {
    const deps = makeDeps();
    const onComplete = vi.fn(async () => {});
    const { cron, calls } = makeFakeCron();
    registerJobs(cron, deps, OWNER_CADENCE, passthrough, onComplete);
    await calls[1][1]();
    expect(onComplete).toHaveBeenCalledWith("lastAnalyze");
  });

  it("mutex 를 경유해서 실행한다 (runExclusive 가 호출됨)", async () => {
    const deps = makeDeps();
    const spy = vi.fn();
    const runExclusive = <T>(fn: () => Promise<T>): Promise<T> => {
      spy();
      return fn();
    };
    const { cron, calls } = makeFakeCron();
    registerJobs(cron, deps, OWNER_CADENCE, runExclusive, vi.fn());
    await calls[0][1]();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

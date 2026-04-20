import type { Cadence } from "./cadence.js";
import type { SchedulerDeps, WorkerState } from "./state.js";

export type { SchedulerDeps } from "./state.js";

export interface CronLike {
  schedule: (expr: string, fn: () => void | Promise<void>) => void;
}

export type RunExclusive = <T>(fn: () => Promise<T>) => Promise<T>;

export type StateFieldUpdater = (field: keyof WorkerState) => Promise<void>;

export function registerJobs(
  cron: CronLike,
  deps: SchedulerDeps,
  cadence: Cadence,
  runExclusive: RunExclusive,
  onComplete: StateFieldUpdater,
): void {
  cron.schedule(cadence.collectCron, () =>
    runExclusive(async () => {
      try {
        await deps.collectDailyReports();
        await onComplete("lastCollect");
      } catch (e) {
        console.error("[scheduler] collect job failed:", e);
      }
    }),
  );
  cron.schedule(cadence.analyzeCron, () =>
    runExclusive(async () => {
      try {
        await deps.generateWeeklyAnalysis();
        await deps.runImprovementCycle();
        await onComplete("lastAnalyze");
      } catch (e) {
        console.error("[scheduler] analyze job failed:", e);
      }
    }),
  );
}

import cron from "node-cron";
import { registerJobs } from "../core/scheduler/index.js";
import { SERVER_CADENCE } from "../core/scheduler/cadence.js";
import {
  runCatchupIfNeeded,
  updateStateField,
} from "../core/scheduler/state.js";
import { createMutex } from "../core/scheduler/mutex.js";
import {
  collectDailyReports,
  generateWeeklyAnalysis,
} from "../core/campaign/monitor.js";
import { runScheduledImprovementCycle } from "../core/scheduler/improvementCycle.js";

export async function startScheduler(): Promise<void> {
  const mutex = createMutex();
  // TODO(plan-c-followup): wire real qualify deps — currently defaults to noop.
  // Winner DB won't populate until this passes { qualify: qualifyWinners(...) }.
  // See docs/superpowers/plans/2026-04-21-plan-c-winner-db-voyage-rag.md §2082-2083.
  const deps = {
    collectDailyReports,
    generateWeeklyAnalysis,
    runImprovementCycle: runScheduledImprovementCycle,
  };
  registerJobs(cron, deps, SERVER_CADENCE, mutex, updateStateField);
  console.log("[scheduler] registered (Server cadence)");
  void mutex(async () => {
    await runCatchupIfNeeded(deps, SERVER_CADENCE);
  }).catch((err) => {
    console.error("[scheduler] catchup failed:", err);
  });
}

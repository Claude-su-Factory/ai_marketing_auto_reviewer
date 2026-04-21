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
import { createQualifyJob } from "../core/rag/qualifyJob.js";

export async function startScheduler(): Promise<void> {
  const mutex = createMutex();
  const qualifyJob = createQualifyJob();
  const deps = {
    collectDailyReports,
    generateWeeklyAnalysis,
    runImprovementCycle: () => runScheduledImprovementCycle({ qualify: qualifyJob }),
  };
  registerJobs(cron, deps, SERVER_CADENCE, mutex, updateStateField);
  console.log("[scheduler] registered (Server cadence)");
  void mutex(async () => {
    await runCatchupIfNeeded(deps, SERVER_CADENCE);
  }).catch((err) => {
    console.error("[scheduler] catchup failed:", err);
  });
}

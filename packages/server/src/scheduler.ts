import cron from "node-cron";
import { registerJobs } from "@ad-ai/core/scheduler/index.js";
import { SERVER_CADENCE } from "@ad-ai/core/scheduler/cadence.js";
import {
  runCatchupIfNeeded,
  updateStateField,
} from "@ad-ai/core/scheduler/state.js";
import { createMutex } from "@ad-ai/core/scheduler/mutex.js";
import {
  collectDailyReports,
  generateWeeklyAnalysis,
} from "@ad-ai/core/campaign/monitor.js";
import { runScheduledImprovementCycle } from "@ad-ai/core/scheduler/improvementCycle.js";
import { createQualifyJob } from "@ad-ai/core/rag/qualifyJob.js";

export async function startScheduler(): Promise<void> {
  const voyageKey = process.env.VOYAGE_API_KEY;
  if (!voyageKey || voyageKey === "__INJECT__") {
    console.error("[scheduler] VOYAGE_API_KEY is missing or placeholder. Refusing to start scheduler (qualify stage would silently fail).");
    throw new Error("VOYAGE_API_KEY not configured");
  }
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

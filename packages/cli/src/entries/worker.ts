import "dotenv/config";
import cron from "node-cron";
import { registerJobs } from "@ad-ai/core/scheduler/index.js";
import { OWNER_CADENCE } from "@ad-ai/core/scheduler/cadence.js";
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
import {
  requireMeta,
  requireAnthropicKey,
  requireVoyageKey,
} from "@ad-ai/core/config/helpers.js";

try {
  requireMeta();
  requireAnthropicKey();
  requireVoyageKey();
} catch (err) {
  console.error(`[worker] config validation failed: ${(err as Error).message}. Refusing to start.`);
  process.exit(2);
}

const mutex = createMutex();
const qualifyJob = createQualifyJob();
const deps = {
  collectDailyReports,
  generateWeeklyAnalysis,
  runImprovementCycle: () => runScheduledImprovementCycle({ qualify: qualifyJob }),
};

registerJobs(cron, deps, OWNER_CADENCE, mutex, updateStateField);
console.log("[worker] scheduler registered (Owner cadence), awaiting cron fires");

void mutex(async () => {
  await runCatchupIfNeeded(deps, OWNER_CADENCE);
}).catch((err) => {
  console.error("[worker] catchup failed:", err);
});

process.stdin.resume();

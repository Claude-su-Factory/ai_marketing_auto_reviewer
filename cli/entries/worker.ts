import "dotenv/config";
import cron from "node-cron";
import { registerJobs } from "../../core/scheduler/index.js";
import { OWNER_CADENCE } from "../../core/scheduler/cadence.js";
import {
  runCatchupIfNeeded,
  updateStateField,
} from "../../core/scheduler/state.js";
import { createMutex } from "../../core/scheduler/mutex.js";
import {
  collectDailyReports,
  generateWeeklyAnalysis,
} from "../../core/campaign/monitor.js";
import { runScheduledImprovementCycle } from "../../core/scheduler/improvementCycle.js";

const required = ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID", "ANTHROPIC_API_KEY"];
for (const key of required) {
  const v = process.env[key];
  if (!v || v === "__INJECT__") {
    console.error(`[worker] ${key} is missing or still set to placeholder "__INJECT__". Refusing to start.`);
    process.exit(2);
  }
}

const mutex = createMutex();
// TODO(plan-c-followup): wire real qualify deps — currently defaults to noop.
// Winner DB won't populate until this passes { qualify: qualifyWinners(...) }.
// See docs/superpowers/plans/2026-04-21-plan-c-winner-db-voyage-rag.md §2082-2083.
const deps = {
  collectDailyReports,
  generateWeeklyAnalysis,
  runImprovementCycle: runScheduledImprovementCycle,
};

registerJobs(cron, deps, OWNER_CADENCE, mutex, updateStateField);
console.log("[worker] scheduler registered (Owner cadence), awaiting cron fires");

void mutex(async () => {
  await runCatchupIfNeeded(deps, OWNER_CADENCE);
}).catch((err) => {
  console.error("[worker] catchup failed:", err);
});

process.stdin.resume();

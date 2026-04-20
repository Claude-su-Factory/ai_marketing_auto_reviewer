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
import { runImprovementCycle as runCycle } from "../../core/improver/runner.js";
import { readJson, listJson } from "../../core/storage.js";
import { shouldTriggerImprovement } from "../../core/improver/index.js";
import type { Report } from "../../core/types.js";

const required = ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID", "ANTHROPIC_API_KEY"];
for (const key of required) {
  const v = process.env[key];
  if (!v || v === "__INJECT__") {
    console.error(`[worker] ${key} is missing or still set to placeholder "__INJECT__". Refusing to start.`);
    process.exit(2);
  }
}

async function runImprovementCycle(): Promise<void> {
  const reportPaths = await listJson("data/reports");
  const allReports: Report[] = [];
  for (const p of reportPaths.slice(-3)) {
    const daily = await readJson<Report[]>(p);
    if (daily) allReports.push(...daily);
  }
  const weeklyPaths = reportPaths.filter((p) => p.includes("weekly-analysis"));
  const latest = weeklyPaths[weeklyPaths.length - 1];
  if (!latest) return;
  const analysis = await readJson<object>(latest);
  const weak = allReports.filter(shouldTriggerImprovement);
  await runCycle(weak, JSON.stringify(analysis));
}

const mutex = createMutex();
const deps = {
  collectDailyReports,
  generateWeeklyAnalysis,
  runImprovementCycle,
};

registerJobs(cron, deps, OWNER_CADENCE, mutex, updateStateField);
console.log("[worker] scheduler registered (Owner cadence), awaiting cron fires");

void mutex(async () => {
  await runCatchupIfNeeded(deps, OWNER_CADENCE);
}).catch((err) => {
  console.error("[worker] catchup failed:", err);
});

process.stdin.resume();

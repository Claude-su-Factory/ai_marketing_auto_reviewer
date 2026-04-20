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
import { runImprovementCycle as runCycle } from "../core/improver/runner.js";
import { readJson, listJson } from "../core/storage.js";
import { shouldTriggerImprovement } from "../core/improver/index.js";
import type { Report } from "../core/types.js";

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

export async function startScheduler(): Promise<void> {
  const mutex = createMutex();
  const deps = {
    collectDailyReports,
    generateWeeklyAnalysis,
    runImprovementCycle,
  };
  registerJobs(cron, deps, SERVER_CADENCE, mutex, updateStateField);
  console.log("[scheduler] registered (Server cadence)");
  void mutex(async () => {
    await runCatchupIfNeeded(deps, SERVER_CADENCE);
  }).catch((err) => {
    console.error("[scheduler] catchup failed:", err);
  });
}

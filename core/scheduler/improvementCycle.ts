import { readJson, listJson } from "../storage.js";
import { runImprovementCycle as runCycle } from "../improver/runner.js";
import { shouldTriggerImprovement } from "../improver/index.js";
import type { Report } from "../types.js";

export async function runScheduledImprovementCycle(): Promise<void> {
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

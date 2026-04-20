import { readJson, listJson } from "../storage.js";
import { runImprovementCycle as runCycle } from "../improver/runner.js";
import { shouldTriggerImprovement } from "../improver/index.js";
import { variantReportsToReports } from "../campaign/monitor.js";
import type { VariantReport } from "../platform/types.js";

export async function runScheduledImprovementCycle(): Promise<void> {
  const reportPaths = await listJson("data/reports");
  const allVariants: VariantReport[] = [];
  for (const p of reportPaths.filter((f) => !f.includes("weekly-analysis")).slice(-3)) {
    const daily = await readJson<VariantReport[]>(p);
    if (daily) allVariants.push(...daily);
  }
  const weeklyPaths = reportPaths.filter((p) => p.includes("weekly-analysis"));
  const latest = weeklyPaths[weeklyPaths.length - 1];
  if (!latest) return;
  const analysis = await readJson<object>(latest);
  const aggregated = variantReportsToReports(allVariants);
  const weak = aggregated.filter(shouldTriggerImprovement);
  await runCycle(weak, JSON.stringify(analysis));
}

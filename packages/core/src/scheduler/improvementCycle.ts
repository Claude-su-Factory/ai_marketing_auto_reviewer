import { readJson, listJson } from "../storage.js";
import { runImprovementCycle as defaultRunCycle } from "../improver/runner.js";
import { shouldTriggerImprovement, type AnalysisResult } from "../improver/index.js";
import { variantReportsToReports } from "../campaign/monitor.js";
import type { VariantReport } from "../platform/types.js";

export interface AggregateResult {
  variantReports: VariantReport[];
  weeklyAnalysis: object | null;
}

export interface ImprovementCycleDeps {
  aggregate: () => Promise<AggregateResult>;
  qualify: (reports: VariantReport[]) => Promise<{ inserted: number; skipped: number }>;
  runCycle: (analysis: object | null, reports: VariantReport[]) => Promise<void>;
}

const MIN_CAMPAIGNS_FOR_LEARNING = 3;

export async function defaultAggregate(): Promise<AggregateResult> {
  const reportPaths = await listJson("data/reports");
  const allVariants: VariantReport[] = [];
  for (const p of reportPaths.filter((f) => !f.includes("weekly-analysis")).slice(-3)) {
    const daily = await readJson<VariantReport[]>(p);
    if (daily) allVariants.push(...daily);
  }
  const weeklyPaths = reportPaths.filter((p) => p.includes("weekly-analysis"));
  const latest = weeklyPaths[weeklyPaths.length - 1];
  const analysis = latest ? await readJson<object>(latest) : null;
  return { variantReports: allVariants, weeklyAnalysis: analysis };
}

export async function defaultRunCycleAdapter(
  analysis: object | null,
  reports: VariantReport[],
): Promise<void> {
  if (!analysis) return;
  const aggregated = variantReportsToReports(reports);
  if (aggregated.length < MIN_CAMPAIGNS_FOR_LEARNING) {
    console.log(
      `[improvementCycle] insufficient data (${aggregated.length}/${MIN_CAMPAIGNS_FOR_LEARNING}), skipping cycle`,
    );
    return;
  }
  const weak = aggregated.filter(shouldTriggerImprovement);
  if (weak.length === 0) return;
  await defaultRunCycle(weak, analysis as AnalysisResult);
}

export async function runScheduledImprovementCycle(
  deps?: Partial<ImprovementCycleDeps>,
): Promise<void> {
  const d: ImprovementCycleDeps = {
    aggregate: deps?.aggregate ?? defaultAggregate,
    qualify: deps?.qualify ?? (async () => ({ inserted: 0, skipped: 0 })),
    runCycle: deps?.runCycle ?? defaultRunCycleAdapter,
  };

  let aggregateResult: AggregateResult;
  try {
    aggregateResult = await d.aggregate();
  } catch (e) {
    console.error("[improvementCycle] aggregate stage failed:", e);
    return;
  }

  try {
    const qualifyResult = await d.qualify(aggregateResult.variantReports);
    console.log(
      `[improvementCycle] qualify: inserted=${qualifyResult.inserted} skipped=${qualifyResult.skipped}`,
    );
  } catch (e) {
    console.error("[improvementCycle] qualify stage failed, continuing:", e);
  }

  try {
    await d.runCycle(aggregateResult.weeklyAnalysis, aggregateResult.variantReports);
  } catch (e) {
    console.error("[improvementCycle] runCycle stage failed:", e);
  }
}

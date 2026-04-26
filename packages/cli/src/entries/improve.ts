import { readJson, listJson } from "@ad-ai/core/storage.js";
import { runImprovementCycle } from "@ad-ai/core/improver/runner.js";
import { shouldTriggerImprovement } from "@ad-ai/core/improver/index.js";
import type { AnalysisResult } from "@ad-ai/core/improver/index.js";
import type { Report } from "@ad-ai/core/types.js";

const reportPaths = await listJson("data/reports");
const allReports: Report[] = [];
for (const p of reportPaths.slice(-3)) {
  const daily = await readJson<Report[]>(p);
  if (daily) allReports.push(...daily);
}

const weeklyAnalysisPaths = reportPaths.filter((p) => p.includes("weekly-analysis"));
const weeklyAnalysisPath = weeklyAnalysisPaths[weeklyAnalysisPaths.length - 1];

if (!weeklyAnalysisPath) {
  console.log("주간 분석 없음. npm run monitor weekly 먼저 실행하세요.");
  process.exit(0);
}

const analysis = await readJson<AnalysisResult>(weeklyAnalysisPath);
if (!analysis) {
  console.log("주간 분석 읽기 실패.");
  process.exit(1);
}
const weakReports = allReports.filter(shouldTriggerImprovement);

console.log(`개선 대상: ${weakReports.length}개 캠페인`);
await runImprovementCycle(weakReports, analysis);

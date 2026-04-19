import cron from "node-cron";
import { collectDailyReports, generateWeeklyAnalysis } from "../../core/campaign/monitor.js";

export {
  collectDailyReports,
  generateWeeklyAnalysis,
  computeStats,
  buildAnalysisPrompt,
} from "../../core/campaign/monitor.js";
export type { PerformanceStats } from "../../core/campaign/monitor.js";

export function startCronScheduler(): void {
  // 매일 오전 9시
  cron.schedule("0 9 * * *", async () => {
    console.log("[Monitor] 일간 성과 수집 시작...");
    await collectDailyReports();
    console.log("[Monitor] 일간 수집 완료");
  });

  // 매주 월요일 오전 9시
  cron.schedule("0 9 * * 1", async () => {
    console.log("[Monitor] 주간 분석 시작...");
    const analysis = await generateWeeklyAnalysis();
    console.log("[Monitor] 주간 분석:\n", analysis);
  });

  console.log("[Monitor] 스케줄러 시작됨 (매일 09:00, 매주 월 09:00)");
}

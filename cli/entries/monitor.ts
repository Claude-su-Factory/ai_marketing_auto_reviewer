import "dotenv/config";
import { collectDailyReports, generateWeeklyAnalysis } from "../../core/campaign/monitor.js";
import { startCronScheduler } from "../monitor/scheduler.js";

const mode = process.argv[2] ?? "cron";
if (mode === "daily") {
  const reports = await collectDailyReports();
  console.log(`${reports.length}개 리포트 수집 완료`);
} else if (mode === "weekly") {
  const analysis = await generateWeeklyAnalysis();
  console.log(analysis);
} else {
  startCronScheduler();
}

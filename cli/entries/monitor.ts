import "dotenv/config";
import {
  collectDailyReports,
  generateWeeklyAnalysis,
} from "../../core/campaign/monitor.js";

const mode = process.argv[2];
if (mode === "daily") {
  const reports = await collectDailyReports();
  console.log(`${reports.length}개 리포트 수집 완료`);
} else if (mode === "weekly") {
  const analysis = await generateWeeklyAnalysis();
  console.log(analysis);
} else {
  console.error("Usage: npm run monitor -- daily|weekly");
  console.error(
    "(cron mode removed; autonomous scheduling is handled by the worker daemon)",
  );
  process.exit(1);
}

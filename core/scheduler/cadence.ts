const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface Cadence {
  collectCron: string;
  analyzeCron: string;
  catchupCollectMs: number;
  catchupAnalyzeMs: number;
}

export const OWNER_CADENCE: Cadence = {
  collectCron: "0 */6 * * *",
  analyzeCron: "0 9 */2 * *",
  catchupCollectMs: 6 * HOUR,
  catchupAnalyzeMs: 2 * DAY,
};

export const SERVER_CADENCE: Cadence = {
  collectCron: "0 9 * * *",
  analyzeCron: "0 9 * * 1",
  catchupCollectMs: 24 * HOUR,
  catchupAnalyzeMs: 7 * DAY,
};

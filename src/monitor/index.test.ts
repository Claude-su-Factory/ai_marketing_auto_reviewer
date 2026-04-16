import { describe, it, expect, vi } from "vitest";
import { computeStats, buildAnalysisPrompt } from "./index.js";
import type { Report } from "../types.js";

const mockReports: Report[] = [
  {
    id: "r1", campaignId: "c1", courseId: "course-1", date: "2026-04-15",
    impressions: 10000, clicks: 420, ctr: 4.2, spend: 134400,
    cpc: 320, reach: 8500, frequency: 1.18,
  },
  {
    id: "r2", campaignId: "c2", courseId: "course-2", date: "2026-04-15",
    impressions: 8000, clicks: 72, ctr: 0.9, spend: 86400,
    cpc: 1200, reach: 7000, frequency: 1.14,
  },
];

describe("computeStats", () => {
  it("identifies top and bottom performers by CTR", () => {
    const stats = computeStats(mockReports);
    expect(stats.top[0].ctr).toBeGreaterThan(stats.bottom[0].ctr);
  });

  it("computes total spend", () => {
    const stats = computeStats(mockReports);
    expect(stats.totalSpend).toBe(220800);
  });
});

describe("buildAnalysisPrompt", () => {
  it("includes performance data", () => {
    const stats = computeStats(mockReports);
    const prompt = buildAnalysisPrompt(mockReports, stats);
    expect(prompt).toContain("4.2");
    expect(prompt).toContain("0.9");
  });
});

describe("computeStats edge cases", () => {
  it("handles empty reports array without NaN", () => {
    const stats = computeStats([]);
    expect(stats.avgCtr).toBe(0);
    expect(stats.totalSpend).toBe(0);
    expect(stats.top).toHaveLength(0);
    expect(stats.bottom).toHaveLength(0);
  });

  it("handles single report without top/bottom overlap", () => {
    const singleReport: Report = {
      id: "r1", campaignId: "c1", courseId: "course-1", date: "2026-04-15",
      impressions: 1000, clicks: 10, ctr: 1.0, spend: 5000,
      cpc: 500, reach: 900, frequency: 1.1,
    };
    const stats = computeStats([singleReport]);
    // top and bottom should not contain the same item twice
    const topIds = stats.top.map(r => r.id);
    const bottomIds = stats.bottom.map(r => r.id);
    const allIds = [...topIds, ...bottomIds];
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});

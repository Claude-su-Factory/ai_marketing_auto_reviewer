import { describe, it, expect } from "vitest";
import { buildCampaignName, buildAdSetTargeting, buildAdConfig } from "./index.js";
import type { Course } from "../types.js";

const mockCourse: Course = {
  id: "course-1",
  title: "Docker 기초",
  description: "컨테이너 기술",
  thumbnail: "",
  url: "https://inflearn.com/course/docker",
  platform: "inflearn",
  price: 44000,
  tags: ["docker", "devops"],
  scrapedAt: "2026-04-16T00:00:00.000Z",
};

describe("buildCampaignName", () => {
  it("includes course title and date", () => {
    const name = buildCampaignName(mockCourse);
    expect(name).toContain("Docker 기초");
    expect(name).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("buildAdSetTargeting", () => {
  it("returns correct age range", () => {
    const targeting = buildAdSetTargeting();
    expect(targeting.age_min).toBe(20);
    expect(targeting.age_max).toBe(45);
  });

  it("targets South Korea", () => {
    const targeting = buildAdSetTargeting();
    expect(targeting.geo_locations.countries).toContain("KR");
  });
});

describe("buildAdConfig", () => {
  it("includes daily budget from env or default", () => {
    const config = buildAdConfig();
    expect(config.dailyBudgetKRW).toBeGreaterThan(0);
  });
});

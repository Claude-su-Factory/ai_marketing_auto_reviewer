import { describe, it, expect } from "vitest";
import { buildCampaignName, buildAdSetTargeting, buildAdConfig } from "./launcher.js";
import type { Product } from "../../types.js";

const mockProduct: Product = {
  id: "p1", name: "Docker 기초", description: "컨테이너 기술",
  targetUrl: "https://inflearn.com/course/docker",
  currency: "KRW", category: "course", price: 44000, tags: ["docker"],
  inputMethod: "scraped", createdAt: "2026-04-16T00:00:00.000Z",
};

describe("buildCampaignName", () => {
  it("includes product name and date", () => {
    const name = buildCampaignName(mockProduct);
    expect(name).toContain("Docker 기초");
    expect(name).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("buildAdSetTargeting", () => {
  it("targets South Korea on Instagram by default", () => {
    const targeting = buildAdSetTargeting();
    expect(targeting.geo_locations.countries).toContain("KR");
    expect(targeting.publisher_platforms).toContain("instagram");
  });
});

describe("buildAdConfig", () => {
  it("has daily budget > 0", () => {
    const config = buildAdConfig();
    expect(config.dailyBudgetKRW).toBeGreaterThan(0);
  });
});

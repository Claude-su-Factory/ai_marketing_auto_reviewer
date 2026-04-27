import { describe, it, expect } from "vitest";
import { buildCampaignName, buildAdSetTargeting, buildAdConfig, launchMetaDco } from "./launcher.js";
import { setConfigForTesting } from "../../config/index.js";
import { makeTestConfig } from "../../config/testing.js";
import type { Product } from "../../types.js";
import type { LaunchLog } from "../types.js";

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
  it("includes facebook + instagram in publisher_platforms when IG actor configured (default)", () => {
    // BASE_CONFIG already has instagram_actor_id; vitest.setup.ts injects it.
    const targeting = buildAdSetTargeting();
    expect(targeting.geo_locations.countries).toContain("KR");
    expect(targeting.publisher_platforms).toEqual(["facebook", "instagram"]);
    expect(targeting.facebook_positions).toEqual(
      expect.arrayContaining(["feed", "story", "video_feeds", "marketplace"]),
    );
    expect(targeting.instagram_positions).toEqual(["stream", "story", "reels"]);
  });

  it("excludes instagram from publisher_platforms when IG actor missing", () => {
    setConfigForTesting(makeTestConfig({}, ["platforms.meta.instagram_actor_id"]));
    const targeting = buildAdSetTargeting();
    expect(targeting.publisher_platforms).toEqual(["facebook"]);
    expect(targeting.facebook_positions).toEqual(
      expect.arrayContaining(["feed", "story", "video_feeds", "marketplace"]),
    );
    // instagram_positions 가 undefined 또는 미존재
    expect((targeting as any).instagram_positions).toBeUndefined();
  });
});

describe("buildAdConfig", () => {
  it("has daily budget > 0", () => {
    const config = buildAdConfig();
    expect(config.dailyBudgetKRW).toBeGreaterThan(0);
  });
});

describe("launchMetaDco onLog emission", () => {
  it("accepts optional onLog callback as second argument", () => {
    // Signature check — runtime path tests live in integration harness.
    const _fn: (g: any, onLog?: (l: LaunchLog) => void) => any = launchMetaDco;
    void _fn;
    expect(launchMetaDco.length).toBeGreaterThanOrEqual(1);
  });
});

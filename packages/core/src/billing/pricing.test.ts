import { describe, it, expect } from "vitest";
import { PRICING } from "./pricing.js";

describe("PRICING", () => {
  const expectedTypes = ["copy_gen", "image_gen", "video_gen", "parse", "analyze", "campaign_launch"];

  it("contains all expected usage types", () => {
    for (const type of expectedTypes) {
      expect(PRICING[type]).toBeDefined();
    }
  });

  it("aiCost is always less than or equal to charged", () => {
    for (const [type, pricing] of Object.entries(PRICING)) {
      expect(pricing.aiCost).toBeLessThanOrEqual(pricing.charged);
    }
  });

  it("all values are non-negative", () => {
    for (const [type, pricing] of Object.entries(PRICING)) {
      expect(pricing.aiCost).toBeGreaterThanOrEqual(0);
      expect(pricing.charged).toBeGreaterThanOrEqual(0);
    }
  });
});

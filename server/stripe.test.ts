import { describe, it, expect } from "vitest";
import { getTierAmount, RECHARGE_TIERS } from "./stripe.js";

describe("RECHARGE_TIERS", () => {
  it("has basic, standard, pro tiers", () => {
    expect(RECHARGE_TIERS.basic).toBe(10);
    expect(RECHARGE_TIERS.standard).toBe(20);
    expect(RECHARGE_TIERS.pro).toBe(50);
  });
});

describe("getTierAmount", () => {
  it("returns correct amount for valid tier", () => {
    expect(getTierAmount("standard")).toBe(20);
  });
  it("returns default 20 for unknown tier", () => {
    expect(getTierAmount("unknown")).toBe(20);
  });
});

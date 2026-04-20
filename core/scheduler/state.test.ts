import { describe, it, expect } from "vitest";
import { shouldCatchup } from "./state.js";
import { OWNER_CADENCE, SERVER_CADENCE } from "./cadence.js";

describe("shouldCatchup", () => {
  it("lastCollect 가 catchupCollectMs 를 초과했으면 collect true (Owner)", () => {
    const state = {
      lastCollect: "2026-04-19T00:00:00Z",
      lastAnalyze: "2026-04-19T00:00:00Z",
    };
    const now = Date.parse("2026-04-19T06:00:00Z"); // 6h 경과
    const result = shouldCatchup(state, OWNER_CADENCE, now);
    expect(result.collect).toBe(true); // Owner collect = 6h
    expect(result.analyze).toBe(false); // 2d 미만
  });

  it("주기 미만이면 두 값 모두 false", () => {
    const state = {
      lastCollect: "2026-04-19T00:00:00Z",
      lastAnalyze: "2026-04-19T00:00:00Z",
    };
    const now = Date.parse("2026-04-19T01:00:00Z"); // 1h
    const result = shouldCatchup(state, OWNER_CADENCE, now);
    expect(result.collect).toBe(false);
    expect(result.analyze).toBe(false);
  });

  it("null state 면 두 값 모두 true (최초 기동)", () => {
    const state = { lastCollect: null, lastAnalyze: null };
    const now = Date.now();
    const result = shouldCatchup(state, OWNER_CADENCE, now);
    expect(result.collect).toBe(true);
    expect(result.analyze).toBe(true);
  });

  it("Server cadence 에서는 24h 경과해야 collect true", () => {
    const state = {
      lastCollect: "2026-04-19T00:00:00Z",
      lastAnalyze: "2026-04-19T00:00:00Z",
    };
    const oneHour = Date.parse("2026-04-19T01:00:00Z");
    const twentyFour = Date.parse("2026-04-20T00:00:00Z");
    expect(shouldCatchup(state, SERVER_CADENCE, oneHour).collect).toBe(false);
    expect(shouldCatchup(state, SERVER_CADENCE, twentyFour).collect).toBe(true);
  });

  it("analyze 는 2d 경과해야 true (Owner)", () => {
    const state = {
      lastCollect: "2026-04-19T00:00:00Z",
      lastAnalyze: "2026-04-19T00:00:00Z",
    };
    const oneDay = Date.parse("2026-04-20T00:00:00Z");
    const twoDays = Date.parse("2026-04-21T00:00:00Z");
    expect(shouldCatchup(state, OWNER_CADENCE, oneDay).analyze).toBe(false);
    expect(shouldCatchup(state, OWNER_CADENCE, twoDays).analyze).toBe(true);
  });
});

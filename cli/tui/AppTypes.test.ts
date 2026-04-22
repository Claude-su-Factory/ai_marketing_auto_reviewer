import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  AppState,
  RunProgress,
  DoneResult,
  MenuItem,
  GenerateProgress,
  LaunchLog,
} from "./AppTypes.js";
import { MENU_ITEMS } from "./AppTypes.js";

describe("AppTypes", () => {
  it("AppState covers all states", () => {
    expectTypeOf<AppState>().toEqualTypeOf<
      "menu" | "input" | "running" | "done" | "review"
    >();
  });

  it("RunProgress has required fields", () => {
    expectTypeOf<RunProgress>().toMatchTypeOf<{
      message: string;
    }>();
  });

  it("DoneResult has success flag and logs", () => {
    expectTypeOf<DoneResult>().toMatchTypeOf<{
      success: boolean;
      logs: string[];
    }>();
  });

  it("MENU_ITEMS contains add-product action", () => {
    expect(MENU_ITEMS.some((item) => item.key === "add-product")).toBe(true);
  });

  it("MENU_ITEMS has 8 items", () => {
    expect(MENU_ITEMS).toHaveLength(8);
  });
});

describe("RunProgress optional extensions", () => {
  it("accepts generate field", () => {
    const p: RunProgress = {
      message: "x",
      generate: {
        queue: ["done", "running", "pending"],
        currentProduct: { id: "p1", name: "AI 부트캠프" },
        tracks: {
          copy:  { status: "running", pct: 50, label: "variant 2/3" },
          image: { status: "done", pct: 100, label: "done (2.1s)" },
          video: { status: "running", pct: 78, label: "polling Veo" },
        },
        elapsedMs: 47_000,
      },
    };
    expect(p.generate?.tracks.copy.pct).toBe(50);
  });
  it("accepts launchLogs field", () => {
    const log: LaunchLog = { ts: "14:32:04", method: "POST", path: "/act_X/campaigns", status: 201 };
    const p: RunProgress = { message: "x", launchLogs: [log] };
    expect(p.launchLogs?.[0].status).toBe(201);
  });
});

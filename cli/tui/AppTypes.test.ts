import { describe, it, expect, expectTypeOf } from "vitest";
import type { AppState, RunProgress, DoneResult, MenuItem } from "./AppTypes.js";
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

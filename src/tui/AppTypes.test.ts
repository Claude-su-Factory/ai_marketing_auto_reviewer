import { describe, it, expectTypeOf } from "vitest";
import type { AppState, RunProgress, DoneResult, MenuItem } from "./AppTypes.js";

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
});

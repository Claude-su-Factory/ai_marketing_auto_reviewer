import { describe, it, expect } from "vitest";
import { getNextStateForAction } from "./App.js";
import type { ActionKey } from "./AppTypes.js";

describe("getNextStateForAction", () => {
  it("review goes directly to review state", () => {
    expect(getNextStateForAction("review")).toBe("review");
  });

  it("actions needing input go to input state", () => {
    expect(getNextStateForAction("scrape")).toBe("input");
    expect(getNextStateForAction("monitor")).toBe("input");
    expect(getNextStateForAction("pipeline")).toBe("input");
  });

  it("actions not needing input go directly to running", () => {
    expect(getNextStateForAction("generate")).toBe("running");
    expect(getNextStateForAction("launch")).toBe("running");
    expect(getNextStateForAction("improve")).toBe("running");
  });
});

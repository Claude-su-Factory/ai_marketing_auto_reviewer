import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { MenuScreen } from "./MenuScreen.js";
import { MENU_ITEMS } from "../AppTypes.js";

describe("MenuScreen grouped layout", () => {
  it("renders CREATION / REVIEW & LAUNCH / ANALYTICS category labels", () => {
    const { lastFrame } = render(React.createElement(MenuScreen, {
      onSelect: () => {}, mode: "browse", selectedIndex: 0, inputValue: "", inputPrompt: "",
      items: MENU_ITEMS,
    }));
    const f = lastFrame() ?? "";
    expect(f).toContain("CREATION");
    expect(f).toContain("REVIEW & LAUNCH");
    expect(f).toContain("ANALYTICS");
  });
  it("highlights selected item with ▶ indicator", () => {
    const { lastFrame } = render(React.createElement(MenuScreen, {
      onSelect: () => {}, mode: "browse", selectedIndex: 0, inputValue: "", inputPrompt: "",
      items: MENU_ITEMS,
    }));
    expect(lastFrame()).toContain("▶");
  });

  // Guard invariant: App.tsx tracks selectedIndex in MENU_ITEMS order; MenuScreen renders
  // them grouped by category. Both must produce the same flat sequence or selection drifts.
  it("category grouping preserves MENU_ITEMS order within each category", () => {
    const CATEGORY_OF: Record<string, string> = {
      scrape: "CREATION", "add-product": "CREATION", generate: "CREATION",
      review: "REVIEW & LAUNCH", launch: "REVIEW & LAUNCH", pipeline: "REVIEW & LAUNCH",
      monitor: "ANALYTICS", improve: "ANALYTICS",
    };
    const categories = ["CREATION", "REVIEW & LAUNCH", "ANALYTICS"];
    const grouped = categories.flatMap((cat) => MENU_ITEMS.filter((it) => CATEGORY_OF[it.key] === cat));
    const allKeysInOrder = grouped.map((it) => it.key);
    const expectedKeys = [
      "scrape", "add-product", "generate",
      "review", "launch", "pipeline",
      "monitor", "improve",
    ];
    expect(allKeysInOrder).toEqual(expectedKeys);
    // Cross-check: every MENU_ITEMS entry appears exactly once in grouped order.
    const originalKeys = MENU_ITEMS.map((it) => it.key).sort();
    expect([...allKeysInOrder].sort()).toEqual(originalKeys);
  });
});

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
});

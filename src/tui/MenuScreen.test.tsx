import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { MenuScreen } from "./MenuScreen.js";

describe("MenuScreen", () => {
  it("renders all 8 menu items", () => {
    const { lastFrame } = render(
      React.createElement(MenuScreen, {
        onSelect: vi.fn(),
        mode: "browse",
        selectedIndex: 0,
        inputValue: "",
        inputPrompt: "",
      })
    );
    expect(lastFrame()).toContain("Scrape");
    expect(lastFrame()).toContain("Add Product");
    expect(lastFrame()).toContain("Generate");
    expect(lastFrame()).toContain("Review");
    expect(lastFrame()).toContain("Launch");
    expect(lastFrame()).toContain("Monitor");
    expect(lastFrame()).toContain("Improve");
    expect(lastFrame()).toContain("Pipeline");
  });

  it("highlights selected item", () => {
    const { lastFrame } = render(
      React.createElement(MenuScreen, {
        onSelect: vi.fn(),
        mode: "browse",
        selectedIndex: 3,
        inputValue: "",
        inputPrompt: "",
      })
    );
    expect(lastFrame()).toMatch(/▶.*Review/);
  });

  it("shows input prompt in input mode", () => {
    const { lastFrame } = render(
      React.createElement(MenuScreen, {
        onSelect: vi.fn(),
        mode: "input",
        selectedIndex: 0,
        inputValue: "https://inflearn.com",
        inputPrompt: "URL 입력 (Enter 확정):",
      })
    );
    expect(lastFrame()).toContain("URL 입력");
    expect(lastFrame()).toContain("https://inflearn.com");
  });
});

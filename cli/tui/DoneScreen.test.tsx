import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { DoneScreen } from "./DoneScreen.js";
import type { DoneResult } from "./AppTypes.js";

const successResult: DoneResult = {
  success: true,
  message: "Generate 완료",
  logs: ["TypeScript 입문 ✓", "Docker 기초 ✓"],
};

const errorResult: DoneResult = {
  success: false,
  message: "스크래핑 실패",
  logs: ["Error: timeout"],
};

describe("DoneScreen", () => {
  it("shows success message and logs", () => {
    const { lastFrame } = render(
      React.createElement(DoneScreen, {
        result: successResult,
        onBack: vi.fn(),
      })
    );
    expect(lastFrame()).toContain("Generate 완료");
    expect(lastFrame()).toContain("TypeScript 입문");
  });

  it("shows error indicator on failure", () => {
    const { lastFrame } = render(
      React.createElement(DoneScreen, {
        result: errorResult,
        onBack: vi.fn(),
      })
    );
    expect(lastFrame()).toContain("실패");
    expect(lastFrame()).toContain("timeout");
  });

  it("shows back hint", () => {
    const { lastFrame } = render(
      React.createElement(DoneScreen, {
        result: successResult,
        onBack: vi.fn(),
      })
    );
    expect(lastFrame()).toContain("메뉴로 복귀");
  });
});

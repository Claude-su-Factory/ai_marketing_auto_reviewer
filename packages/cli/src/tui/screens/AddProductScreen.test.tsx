import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { AddProductScreen } from "./AddProductScreen.js";

describe("AddProductScreen checklist form", () => {
  it("shows all 4 fields with current step marked", () => {
    const { lastFrame } = render(React.createElement(AddProductScreen, {
      currentStep: "description",
      formData: { name: "AI 부트캠프" },
      inputValue: "3개월 완성",
      onSubmit: () => {}, onCancel: () => {},
    }));
    const f = lastFrame() ?? "";
    expect(f).toContain("제품명");
    expect(f).toContain("AI 부트캠프");
    expect(f).toContain("설명");
    expect(f).toContain("랜딩 URL");
    expect(f).toContain("가격");
    expect(f).toContain("3개월 완성");
  });
});

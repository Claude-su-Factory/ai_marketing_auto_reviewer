import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ProgressTrack } from "./ProgressTrack.js";

describe("ProgressTrack", () => {
  it("renders label, bar, and percentage when running", () => {
    const { lastFrame } = render(
      React.createElement(ProgressTrack, {
        label: "이미지", status: "running", pct: 50, detail: "gen",
      })
    );
    const f = lastFrame() ?? "";
    expect(f).toContain("이미지");
    expect(f).toContain("50%");
    expect(f).toContain("gen");
  });
  it("shows done icon when status=done", () => {
    const { lastFrame } = render(
      React.createElement(ProgressTrack, { label: "영상", status: "done", pct: 100 })
    );
    expect(lastFrame()).toContain("✓");
  });
  it("shows pending icon when status=pending", () => {
    const { lastFrame } = render(
      React.createElement(ProgressTrack, { label: "카피", status: "pending", pct: 0 })
    );
    expect(lastFrame()).toContain("○");
  });
});

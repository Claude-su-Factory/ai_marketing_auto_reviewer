import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { PipelineProgress } from "./PipelineProgress.js";
import type { TaskProgress } from "./AppTypes.js";

const baseProps = {
  currentStep: "generate" as const,
  stepStatuses: {
    scrape: "done" as const,
    generate: "running" as const,
    review: "pending" as const,
    launch: "pending" as const,
  },
  currentCourse: "React 완전정복",
  courseIndex: 2,
  totalCourses: 3,
  progressMessage: "이미지 생성 중...",
};

describe("PipelineProgress", () => {
  it("renders without taskProgress (existing behavior)", () => {
    const { lastFrame } = render(React.createElement(PipelineProgress, baseProps));
    expect(lastFrame()).toContain("React 완전정복");
    expect(lastFrame()).toContain("이미지 생성 중");
  });

  it("renders per-task progress bars when taskProgress provided", () => {
    const taskProgress: TaskProgress = { copy: 100, image: 67, video: 0 };
    const { lastFrame } = render(
      React.createElement(PipelineProgress, { ...baseProps, taskProgress })
    );
    expect(lastFrame()).toContain("100%");
    expect(lastFrame()).toContain("67%");
    expect(lastFrame()).toContain("카피");
    expect(lastFrame()).toContain("이미지");
    expect(lastFrame()).toContain("영상");
  });

  it("shows overall progress when taskProgress provided", () => {
    const taskProgress: TaskProgress = { copy: 100, image: 67, video: 0 };
    const { lastFrame } = render(
      React.createElement(PipelineProgress, { ...baseProps, taskProgress })
    );
    // overall = Math.round((100 + 67 + 0) / 3) = 56
    expect(lastFrame()).toContain("56%");
  });
});

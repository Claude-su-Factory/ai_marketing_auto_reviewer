import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { useElapsed } from "./useElapsed.js";

function Harness({ startedAt }: { startedAt: number }) {
  const elapsedMs = useElapsed(startedAt);
  return React.createElement(Text, null, `elapsed:${elapsedMs}`);
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 3, 22, 9, 0, 0)); });
afterEach(() => { vi.useRealTimers(); });

describe("useElapsed", () => {
  it("reports 0 at start", () => {
    const { lastFrame } = render(React.createElement(Harness, { startedAt: Date.now() }));
    expect(lastFrame()).toContain("elapsed:0");
  });
  it("advances on interval tick", () => {
    const started = Date.now();
    const { lastFrame } = render(React.createElement(Harness, { startedAt: started }));
    vi.advanceTimersByTime(1500);
    expect(lastFrame()).toContain("elapsed:1500");
  });
});

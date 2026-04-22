import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { useWorkerStatus } from "./useWorkerStatus.js";

vi.mock("child_process", () => ({
  exec: (cmd: string, cb: (err: Error | null, out: string) => void) => {
    cb(null, cmd.includes("com.adai.worker") ? "1234\t0\tcom.adai.worker\n" : "");
  },
}));

function Harness() {
  const { active } = useWorkerStatus();
  return React.createElement(Text, null, active ? "active" : "inactive");
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useWorkerStatus", () => {
  it("reports active when launchctl output contains pid > 0", async () => {
    const { lastFrame } = render(React.createElement(Harness));
    await vi.waitFor(() => expect(lastFrame()).toContain("active"));
  });
});

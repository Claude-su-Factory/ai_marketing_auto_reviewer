import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Header } from "./Header.js";

vi.mock("../hooks/useWorkerStatus.js", () => ({
  useWorkerStatus: () => ({ active: true, checkedAt: Date.now() }),
}));

describe("Header", () => {
  it("renders logo, version, owner badge, and active worker badge", () => {
    const { lastFrame } = render(React.createElement(Header, { rightSlot: "Menu" }));
    const f = lastFrame() ?? "";
    expect(f).toContain("AD-AI");
    expect(f).toContain("v1.0.0");
    expect(f).toContain("owner");
    expect(f).toContain("worker");
    expect(f).toContain("Menu");
  });
});

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { StatusBar } from "./StatusBar.js";

vi.mock("@ad-ai/core/storage.js", () => ({
  listJson: vi.fn(async (dir: string) =>
    dir.endsWith("products") ? ["a.json","b.json","c.json"] :
    dir.endsWith("creatives") ? ["x.json","y.json"] : []),
}));
vi.mock("../hooks/useTodayStats.js", () => ({
  useTodayStats: () => ({ todayCount: 5, refresh: () => {}, bump: () => {} }),
}));

describe("StatusBar", () => {
  it("shows products, creatives, today ✓, and — for winners when DB absent", async () => {
    const { lastFrame } = render(React.createElement(StatusBar, { winners: null }));
    await vi.waitFor(() => {
      const f = lastFrame() ?? "";
      expect(f).toContain("products: 3");
      expect(f).toContain("creatives: 2");
      expect(f).toContain("today ✓ 5");
      expect(f).toContain("winners: —");
    });
  });
  it("shows winner count when provided", async () => {
    const { lastFrame } = render(React.createElement(StatusBar, { winners: 8 }));
    await vi.waitFor(() => expect(lastFrame()).toContain("winners: 8"));
  });
});

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { useTodayStats } from "./useTodayStats.js";

const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
const todayMtime = startOfToday.getTime() + 3_600_000;
const yesterdayMtime = startOfToday.getTime() - 3_600_000;

vi.mock("../../../core/storage.js", () => ({
  listJson: vi.fn(async (_dir: string) => [
    "data/creatives/a.json", "data/creatives/b.json", "data/creatives/c.json",
  ]),
  readJson: vi.fn(async (p: string) => {
    if (p.endsWith("a.json")) return { id: "a", status: "approved" };
    if (p.endsWith("b.json")) return { id: "b", status: "edited" };
    return { id: "c", status: "pending" };
  }),
}));
vi.mock("fs/promises", async () => {
  const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  return {
    ...actual,
    stat: vi.fn(async (p: string) => {
      if (p.endsWith("a.json")) return { mtimeMs: todayMtime } as any;
      if (p.endsWith("b.json")) return { mtimeMs: todayMtime } as any;
      return { mtimeMs: yesterdayMtime } as any;
    }),
  };
});

function Harness() {
  const { todayCount } = useTodayStats();
  return React.createElement(Text, null, `today:${todayCount}`);
}

describe("useTodayStats", () => {
  it("counts creatives with approved/edited status AND mtime in today", async () => {
    const { lastFrame } = render(React.createElement(Harness));
    await vi.waitFor(() => expect(lastFrame()).toContain("today:2"));
  });
});

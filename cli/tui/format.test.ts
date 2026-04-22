import { describe, it, expect } from "vitest";
import { formatWon, formatPct, formatAgo, truncate } from "./format.js";

describe("format.formatWon", () => {
  it("formats integer KRW with 천 단위 콤마", () => {
    expect(formatWon(12345)).toBe("12,345원");
  });
  it("handles zero", () => {
    expect(formatWon(0)).toBe("0원");
  });
});

describe("format.formatPct", () => {
  it("formats 0-1 ratio with 2 decimals", () => {
    expect(formatPct(0.0214)).toBe("2.14%");
  });
  it("handles 0", () => {
    expect(formatPct(0)).toBe("0.00%");
  });
});

describe("format.formatAgo", () => {
  it("minutes", () => {
    expect(formatAgo(new Date(Date.now() - 3 * 60_000))).toBe("3m ago");
  });
  it("hours", () => {
    expect(formatAgo(new Date(Date.now() - 2 * 3_600_000))).toBe("2h ago");
  });
  it("days", () => {
    expect(formatAgo(new Date(Date.now() - 4 * 86_400_000))).toBe("4d ago");
  });
  it("handles just now (<60s)", () => {
    expect(formatAgo(new Date(Date.now() - 5_000))).toBe("just now");
  });
  it("clamps future dates to just now", () => {
    expect(formatAgo(new Date(Date.now() + 5_000))).toBe("just now");
  });
});

describe("format.truncate", () => {
  it("truncates with ellipsis", () => {
    expect(truncate("안녕하세요 오늘은 월요일입니다", 10)).toBe(
      "안녕하세요 오늘은…"
    );
  });
  it("returns original when short", () => {
    expect(truncate("짧음", 10)).toBe("짧음");
  });
  it("returns empty string when max is 0 or negative", () => {
    expect(truncate("hello", 0)).toBe("");
    expect(truncate("hello", -1)).toBe("");
  });
  it("returns original when length equals max", () => {
    expect(truncate("abc", 3)).toBe("abc");
  });
});

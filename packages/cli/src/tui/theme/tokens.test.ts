import { describe, it, expect } from "vitest";
import { colors, border, icons } from "./tokens.js";

describe("theme tokens", () => {
  it("exposes 7 Tokyo Night color keys", () => {
    expect(Object.keys(colors).sort()).toEqual(
      ["accent", "analytics", "bg", "danger", "dim", "fg", "review", "success", "warning"].sort()
    );
  });
  it("border uses round style and review accent color", () => {
    expect(border.borderStyle).toBe("round");
    expect(border.borderColor).toBe(colors.review);
  });
  it("icons set covers the status quartet", () => {
    expect(icons.success).toBe("✓");
    expect(icons.running).toBe("⟳");
    expect(icons.pending).toBe("○");
    expect(icons.failure).toBe("✗");
  });
});

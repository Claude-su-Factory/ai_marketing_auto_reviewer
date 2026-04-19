import { describe, it, expect } from "vitest";
import { filterSafeImprovementFiles } from "./runner.js";

describe("filterSafeImprovementFiles", () => {
  it("accepts core/ paths with .ts extension", () => {
    expect(filterSafeImprovementFiles(["core/improver/index.ts"])).toEqual([
      "core/improver/index.ts",
    ]);
  });

  it("accepts cli/ paths with .ts extension", () => {
    expect(filterSafeImprovementFiles(["cli/actions.ts"])).toEqual([
      "cli/actions.ts",
    ]);
  });

  it("accepts server/ paths with .ts extension", () => {
    expect(filterSafeImprovementFiles(["server/billing.ts"])).toEqual([
      "server/billing.ts",
    ]);
  });

  it("rejects legacy src/ paths", () => {
    expect(filterSafeImprovementFiles(["src/legacy.ts"])).toEqual([]);
  });

  it("rejects .tsx files", () => {
    expect(filterSafeImprovementFiles(["cli/tui/App.tsx"])).toEqual([]);
  });

  it("rejects non-.ts extensions", () => {
    expect(filterSafeImprovementFiles(["core/config.json"])).toEqual([]);
  });

  it("rejects paths starting with slash", () => {
    expect(filterSafeImprovementFiles(["/etc/passwd"])).toEqual([]);
  });

  it("rejects paths not starting with a layer prefix", () => {
    expect(filterSafeImprovementFiles(["data/products/x.ts"])).toEqual([]);
  });

  it("filters a mixed list, keeping only safe entries", () => {
    const input = [
      "core/types.ts",
      "src/old.ts",
      "cli/tui/App.tsx",
      "server/auth.ts",
    ];
    expect(filterSafeImprovementFiles(input)).toEqual([
      "core/types.ts",
      "server/auth.ts",
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(filterSafeImprovementFiles([])).toEqual([]);
  });
});

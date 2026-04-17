import { describe, it, expect } from "vitest";
import { buildUrl } from "./usageServer.js";

describe("buildUrl", () => {
  it("combines base URL and path", () => {
    expect(buildUrl("http://localhost:3000", "/ai/copy")).toBe("http://localhost:3000/ai/copy");
  });

  it("handles trailing slash in base URL", () => {
    expect(buildUrl("http://localhost:3000/", "/ai/copy")).toBe("http://localhost:3000/ai/copy");
  });
});

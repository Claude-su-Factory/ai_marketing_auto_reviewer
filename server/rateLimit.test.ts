import { describe, it, expect } from "vitest";
import { createRateLimiter } from "./rateLimit.js";

describe("RateLimiter", () => {
  it("allows requests under limit", () => {
    const limiter = createRateLimiter(5, 60000);
    for (let i = 0; i < 5; i++) {
      expect(limiter.check("license-1").allowed).toBe(true);
    }
  });

  it("blocks requests over limit", () => {
    const limiter = createRateLimiter(3, 60000);
    limiter.check("license-1");
    limiter.check("license-1");
    limiter.check("license-1");
    const result = limiter.check("license-1");
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("tracks licenses independently", () => {
    const limiter = createRateLimiter(1, 60000);
    limiter.check("license-1");
    expect(limiter.check("license-1").allowed).toBe(false);
    expect(limiter.check("license-2").allowed).toBe(true);
  });
});

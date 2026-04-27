import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withGeminiRetry, defaultIsRetryable } from "./geminiRetry.js";

describe("defaultIsRetryable", () => {
  it("retries 503", () => {
    expect(defaultIsRetryable(new Error("ServerError: 503 Service Unavailable"))).toBe(true);
  });
  it("retries UNAVAILABLE", () => {
    expect(defaultIsRetryable(new Error("UNAVAILABLE: model busy"))).toBe(true);
  });
  it("retries 429", () => {
    expect(defaultIsRetryable(new Error("429 rate limit"))).toBe(true);
  });
  it("retries RESOURCE_EXHAUSTED", () => {
    expect(defaultIsRetryable(new Error("RESOURCE_EXHAUSTED quota"))).toBe(true);
  });
  it("does NOT retry 404", () => {
    expect(defaultIsRetryable(new Error("404 NOT_FOUND"))).toBe(false);
  });
  it("does NOT retry generic", () => {
    expect(defaultIsRetryable(new Error("oops random"))).toBe(false);
  });
});

describe("withGeminiRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns immediately on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withGeminiRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable error and succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("503 UNAVAILABLE"))
      .mockResolvedValueOnce("ok");
    const promise = withGeminiRetry(fn, { onAttempt: () => {} });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws non-retryable error immediately", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("404 NOT_FOUND"));
    await expect(withGeminiRetry(fn)).rejects.toThrow("404");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws after max retries on persistent retryable error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("503 always failing"));
    const promise = withGeminiRetry(fn, { maxRetries: 3, onAttempt: () => {} });
    promise.catch(() => {}); // suppress unhandled rejection
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow("503");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("uses exponential backoff (delay = baseDelayMs * attempt)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("503"));
    const promise = withGeminiRetry(fn, { maxRetries: 3, baseDelayMs: 1000, onAttempt: () => {} });
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);  // delay 1: 1000ms
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);  // delay 2: 2000ms (cumulative 3000)
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

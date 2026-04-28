import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withGeminiRetry, defaultIsRetryable, callGoogleModel, isModelNotFoundError, buildModelNotFoundMessage } from "./geminiRetry.js";

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

  it("uses linear-by-attempt delay (delay = baseDelayMs * attempt)", async () => {
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

describe("isModelNotFoundError", () => {
  it("matches '404 NOT_FOUND' from Google REST error body", () => {
    const e = new Error('ClientError: got status: 404 Not Found. {"error":{"code":404,"message":"models/imagen-3.0-generate-002 is not found for API version v1beta","status":"NOT_FOUND"}}');
    expect(isModelNotFoundError(e)).toBe(true);
  });

  it("matches '404 is not found' lowercase variant", () => {
    expect(isModelNotFoundError(new Error("got status: 404 — model is not found"))).toBe(true);
  });

  it("does NOT match 503 / UNAVAILABLE / 429", () => {
    expect(isModelNotFoundError(new Error("503 UNAVAILABLE"))).toBe(false);
    expect(isModelNotFoundError(new Error("429 RESOURCE_EXHAUSTED"))).toBe(false);
  });

  it("does NOT match generic 404 without NOT_FOUND/is not found", () => {
    expect(isModelNotFoundError(new Error("HTTP 404 something"))).toBe(false);
  });
});

describe("buildModelNotFoundMessage", () => {
  it("includes model name + kind + actionable guidance", () => {
    const msg = buildModelNotFoundMessage("imagen-x", "image", new Error("orig 404"));
    expect(msg).toContain("imagen-x");
    expect(msg).toContain("image");
    expect(msg).toContain("npm run list-models");
    expect(msg).toContain("[ai.google.models]");
    expect(msg).toContain("orig 404");
  });
});

describe("callGoogleModel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns result on success (no retry)", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await callGoogleModel(fn, "model-x", "image");
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("rewraps 404 NOT_FOUND with friendly guidance message", async () => {
    const fn = vi.fn().mockRejectedValue(new Error('404 Not Found {"status":"NOT_FOUND"}'));
    await expect(callGoogleModel(fn, "imagen-3", "image")).rejects.toThrow(/imagen-3.*npm run list-models/s);
  });

  it("preserves retryable behavior (503 retried via withGeminiRetry, eventually throws)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("503 UNAVAILABLE"));
    const promise = callGoogleModel(fn, "model-x", "image", { onAttempt: () => {} });
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow("503");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does NOT rewrap non-404 non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("400 BAD_REQUEST"));
    await expect(callGoogleModel(fn, "model-x", "image")).rejects.toThrow("400");
    // verify message is original, not rewrapped
    try {
      await callGoogleModel(fn, "model-x", "image");
    } catch (e) {
      expect(String(e)).not.toContain("npm run list-models");
    }
  });
});

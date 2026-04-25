import { describe, it, expect } from "vitest";
import { createGoogleAdapter } from "./adapter.js";

describe("createGoogleAdapter", () => {
  it("returns AdPlatform with name=google", () => {
    const adapter = createGoogleAdapter();
    expect(adapter.name).toBe("google");
    expect(typeof adapter.launch).toBe("function");
    expect(typeof adapter.fetchReports).toBe("function");
    expect(typeof adapter.cleanup).toBe("function");
  });

  it("launch throws NotImplemented", async () => {
    const adapter = createGoogleAdapter();
    await expect(adapter.launch({} as any)).rejects.toThrow(/scaffold only/i);
  });

  it("fetchReports throws NotImplemented", async () => {
    const adapter = createGoogleAdapter();
    await expect(adapter.fetchReports("c", "2026-04-25")).rejects.toThrow(
      /scaffold only/i,
    );
  });

  it("cleanup throws NotImplemented", async () => {
    const adapter = createGoogleAdapter();
    await expect(adapter.cleanup("c")).rejects.toThrow(/scaffold only/i);
  });
});

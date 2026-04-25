import { describe, it, expect } from "vitest";
import { createTiktokAdapter } from "./adapter.js";

describe("createTiktokAdapter", () => {
  it("returns AdPlatform with name=tiktok", () => {
    const adapter = createTiktokAdapter();
    expect(adapter.name).toBe("tiktok");
    expect(typeof adapter.launch).toBe("function");
    expect(typeof adapter.fetchReports).toBe("function");
    expect(typeof adapter.cleanup).toBe("function");
  });

  it("launch throws NotImplemented", async () => {
    const adapter = createTiktokAdapter();
    await expect(adapter.launch({} as any)).rejects.toThrow(/scaffold only/i);
  });

  it("fetchReports throws NotImplemented", async () => {
    const adapter = createTiktokAdapter();
    await expect(adapter.fetchReports("c", "2026-04-25")).rejects.toThrow(
      /scaffold only/i,
    );
  });

  it("cleanup throws NotImplemented", async () => {
    const adapter = createTiktokAdapter();
    await expect(adapter.cleanup("c")).rejects.toThrow(/scaffold only/i);
  });
});

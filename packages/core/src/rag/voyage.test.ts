import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createVoyageClient } from "./voyage.js";

describe("createVoyageClient", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.VOYAGE_API_KEY = "test-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.VOYAGE_API_KEY;
  });

  it("POSTs to voyage embeddings endpoint with api key header", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }] }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const client = createVoyageClient();
    const result = await client.embed(["hello"]);

    expect(result).toEqual([[0.1, 0.2, 0.3]]);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.voyageai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Authorization": "Bearer test-key",
          "Content-Type": "application/json",
        }),
      }),
    );
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ input: ["hello"], model: "voyage-3-lite" });
  });

  it("throws when response is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    }) as unknown as typeof fetch;

    const client = createVoyageClient();
    await expect(client.embed(["x"])).rejects.toThrow(/401/);
  });

  it("preserves order of returned embeddings by index", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { embedding: [2], index: 1 },
          { embedding: [1], index: 0 },
        ],
      }),
    }) as unknown as typeof fetch;

    const client = createVoyageClient();
    const result = await client.embed(["a", "b"]);
    expect(result).toEqual([[1], [2]]);
  });

  it("throws when response length does not match input length", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1, 2], index: 0 }] }),
    }) as unknown as typeof fetch;

    const client = createVoyageClient();
    await expect(client.embed(["a", "b", "c"])).rejects.toThrow(/1.*3/);
  });
});

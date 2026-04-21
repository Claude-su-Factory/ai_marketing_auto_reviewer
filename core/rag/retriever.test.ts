import { describe, it, expect } from "vitest";
import { cosineSimilarity, dedupByCosine } from "./retriever.js";
import type { WinnerCreative } from "./types.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });

  it("throws on length mismatch", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/length/i);
  });
});

function mkWinner(id: string, embedding: number[]): WinnerCreative {
  return {
    id,
    creativeId: `creative-${id}`,
    productCategory: "course",
    productTags: [],
    productDescription: "desc",
    headline: "h",
    body: "b",
    cta: "c",
    variantLabel: "emotional",
    embeddingProduct: embedding,
    embeddingCopy: embedding,
    qualifiedAt: "2026-04-20T00:00:00Z",
    impressions: 1000,
    inlineLinkClickCtr: 0.03,
  };
}

describe("dedupByCosine", () => {
  it("removes near-duplicate pairs above threshold, preserves order", () => {
    const candidates = [
      mkWinner("a", [1, 0, 0]),
      mkWinner("b", [0.98, 0.01, 0]), // very similar to a
      mkWinner("c", [0, 1, 0]),
    ];
    const result = dedupByCosine(candidates, 0.95, "embeddingProduct");
    expect(result.map((w) => w.id)).toEqual(["a", "c"]);
  });

  it("keeps all when all are distinct below threshold", () => {
    const candidates = [
      mkWinner("a", [1, 0, 0]),
      mkWinner("b", [0, 1, 0]),
      mkWinner("c", [0, 0, 1]),
    ];
    const result = dedupByCosine(candidates, 0.95, "embeddingProduct");
    expect(result).toHaveLength(3);
  });

  it("returns empty for empty input", () => {
    expect(dedupByCosine([], 0.95, "embeddingProduct")).toEqual([]);
  });
});

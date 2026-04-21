import { describe, it, expect } from "vitest";
import { cosineSimilarity, dedupByCosine, filterByCategory, retrieveTopK, lexicalFallback } from "./retriever.js";
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

describe("filterByCategory", () => {
  it("returns only winners with matching category", () => {
    const winners = [
      { ...mkWinner("a", [1, 0, 0]), productCategory: "course" },
      { ...mkWinner("b", [0, 1, 0]), productCategory: "ecommerce" },
      { ...mkWinner("c", [0, 0, 1]), productCategory: "course" },
    ];
    const result = filterByCategory(winners, "course");
    expect(result.map((w) => w.id)).toEqual(["a", "c"]);
  });

  it("returns [] when category is null and no winner has null category", () => {
    const winners = [{ ...mkWinner("a", [1, 0, 0]), productCategory: "course" }];
    expect(filterByCategory(winners, null)).toEqual([]);
  });

  it("returns matching null-category winners when target is null", () => {
    const winners = [
      { ...mkWinner("a", [1, 0, 0]), productCategory: null },
      { ...mkWinner("b", [0, 1, 0]), productCategory: "course" },
    ];
    const result = filterByCategory(winners, null);
    expect(result.map((w) => w.id)).toEqual(["a"]);
  });

  it("returns [] for empty corpus", () => {
    expect(filterByCategory([], "course")).toEqual([]);
  });
});

describe("retrieveTopK", () => {
  it("returns top-k by cosine similarity above minCosine", () => {
    const query = [1, 0, 0];
    const corpus = [
      mkWinner("a", [0.9, 0.1, 0]),   // high sim
      mkWinner("b", [0, 1, 0]),        // orthogonal — below 0.6
      mkWinner("c", [0.7, 0.3, 0]),    // medium sim
      mkWinner("d", [0.95, 0.05, 0]),  // highest sim
    ];
    const result = retrieveTopK(query, corpus, 3, 0.6);
    expect(result.map((w) => w.id)).toEqual(["d", "a", "c"]);
  });

  it("returns fewer than k when not enough pass minCosine", () => {
    const query = [1, 0, 0];
    const corpus = [
      mkWinner("a", [0.9, 0.1, 0]),
      mkWinner("b", [0, 1, 0]),
    ];
    const result = retrieveTopK(query, corpus, 3, 0.6);
    expect(result.map((w) => w.id)).toEqual(["a"]);
  });

  it("returns [] for empty corpus", () => {
    expect(retrieveTopK([1, 0], [], 3, 0.6)).toEqual([]);
  });
});

describe("lexicalFallback", () => {
  it("ranks by Jaccard tag overlap", () => {
    const productTags = ["react", "frontend", "hooks"];
    const corpus = [
      { ...mkWinner("a", [0, 0, 0]), productTags: ["react", "hooks"] },          // J=2/3
      { ...mkWinner("b", [0, 0, 0]), productTags: ["vue", "backend"] },           // J=0
      { ...mkWinner("c", [0, 0, 0]), productTags: ["react", "frontend", "hooks"] }, // J=3/3
    ];
    const result = lexicalFallback(productTags, corpus, 2);
    expect(result.map((w) => w.id)).toEqual(["c", "a"]);
  });

  it("returns [] for empty corpus", () => {
    expect(lexicalFallback(["tag"], [], 3)).toEqual([]);
  });

  it("returns [] when no tags overlap", () => {
    const corpus = [{ ...mkWinner("a", [0, 0, 0]), productTags: ["unrelated"] }];
    expect(lexicalFallback(["react"], corpus, 3)).toEqual([]);
  });
});

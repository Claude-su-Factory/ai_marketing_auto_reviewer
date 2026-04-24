import { describe, it, expect, vi } from "vitest";
import { cosineSimilarity, dedupByCosine, filterByCategory, retrieveTopK, lexicalFallback, selectFewShotWinners } from "./retriever.js";
import type { WinnerCreative } from "./types.js";
import type { Product } from "../types.js";

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

function mkProduct(overrides: Partial<Product>): Product {
  return {
    id: "p1",
    name: "Test",
    description: "desc",
    currency: "KRW",
    targetUrl: "https://example.com",
    tags: [],
    inputMethod: "manual",
    createdAt: "2026-04-20T00:00:00Z",
    ...overrides,
  };
}

describe("selectFewShotWinners", () => {
  const queryEmbed = [1, 0, 0];

  it("returns category-matched top-3 when enough available", () => {
    // Vectors chosen so all have cosine > 0.6 to query, and cosine < 0.95 to each other
    const allWinners = [
      { ...mkWinner("a", [1, 0, 0]), productCategory: "course" },
      { ...mkWinner("b", [0.8, 0.6, 0]), productCategory: "course" },
      { ...mkWinner("c", [0.7, 0, 0.71]), productCategory: "course" },
      { ...mkWinner("d", [0.95, 0.05, 0]), productCategory: "ecommerce" },
    ];
    const product = mkProduct({ category: "course", tags: [] });
    const result = selectFewShotWinners(queryEmbed, allWinners, product);
    expect(result.map((w) => w.id)).toEqual(["a", "b", "c"]);
  });

  it("fills from global pool when category yields fewer than 3", () => {
    // Only "a" matches category; b and c come from global fill (all have cosine > 0.6)
    const allWinners = [
      { ...mkWinner("a", [1, 0, 0]), productCategory: "course" },
      { ...mkWinner("b", [0.8, 0.6, 0]), productCategory: "ecommerce" },
      { ...mkWinner("c", [0.7, 0, 0.71]), productCategory: "service" },
    ];
    const product = mkProduct({ category: "course", tags: [] });
    const result = selectFewShotWinners(queryEmbed, allWinners, product);
    expect(result.map((w) => w.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("falls back to lexical when cosine results still < 3", () => {
    const allWinners = [
      { ...mkWinner("a", [0.9, 0.1, 0]), productCategory: "course", productTags: ["react"] },
      { ...mkWinner("b", [0, 1, 0]), productCategory: "course", productTags: ["react", "hooks"] }, // cosine below 0.6
      { ...mkWinner("c", [0, 0, 1]), productCategory: "course", productTags: ["react"] }, // cosine below 0.6
    ];
    const product = mkProduct({ category: "course", tags: ["react", "hooks"] });
    const result = selectFewShotWinners(queryEmbed, allWinners, product);
    expect(result.map((w) => w.id)).toContain("a");
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("dedupes near-duplicates by embeddingProduct cosine > 0.95", () => {
    // a has highest cosine to query; b is a near-duplicate of a (cosine > 0.95) → b is dropped
    const allWinners = [
      { ...mkWinner("a", [1, 0, 0]), productCategory: "course" },
      { ...mkWinner("b", [0.98, 0.1, 0]), productCategory: "course" }, // near-duplicate of a
      { ...mkWinner("c", [0.7, 0, 0.71]), productCategory: "course" },
    ];
    const product = mkProduct({ category: "course", tags: [] });
    const result = selectFewShotWinners(queryEmbed, allWinners, product);
    const ids = result.map((w) => w.id);
    expect(ids).not.toContain("b");
  });

  it("returns [] when Winner DB is empty", () => {
    const product = mkProduct({ category: "course", tags: [] });
    expect(selectFewShotWinners(queryEmbed, [], product)).toEqual([]);
  });
});

import { retrieveFewShotForProduct } from "./retriever.js";

describe("retrieveFewShotForProduct", () => {
  it("returns FewShotExample[] from selected winners", async () => {
    const winners = [
      { ...mkWinner("a", [1, 0, 0]), productCategory: "course", headline: "H-A", body: "B-A", cta: "C-A" },
      { ...mkWinner("b", [0.8, 0.6, 0]), productCategory: "course", headline: "H-B", body: "B-B", cta: "C-B" },
    ];
    const product = mkProduct({ category: "course", tags: [] });
    const result = await retrieveFewShotForProduct(product, {
      embed: async () => [[1, 0, 0]],
      loadAllWinners: () => winners,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("headline");
    expect(result[0]).toHaveProperty("body");
    expect(result[0]).toHaveProperty("cta");
    expect(result[0].headline).toBe("H-A");
    expect(result[0].body).toBe("B-A");
    expect(result[0].cta).toBe("C-A");
  });

  it("returns [] when Winner DB is empty (no embed call)", async () => {
    const embedSpy = vi.fn();
    const result = await retrieveFewShotForProduct(mkProduct({}), {
      embed: embedSpy,
      loadAllWinners: () => [],
    });
    expect(result).toEqual([]);
    expect(embedSpy).not.toHaveBeenCalled();
  });

  it("returns [] and warns when embed throws (graceful degradation)", async () => {
    const result = await retrieveFewShotForProduct(mkProduct({}), {
      embed: async () => { throw new Error("voyage down"); },
      loadAllWinners: () => [mkWinner("a", [1, 0, 0])],
    });
    expect(result).toEqual([]);
  });

  it("returns [] and warns when loadAllWinners throws (graceful degradation)", async () => {
    const embedSpy = vi.fn();
    const result = await retrieveFewShotForProduct(mkProduct({}), {
      embed: embedSpy,
      loadAllWinners: () => { throw new Error("db corrupt"); },
    });
    expect(result).toEqual([]);
    expect(embedSpy).not.toHaveBeenCalled();
  });
});

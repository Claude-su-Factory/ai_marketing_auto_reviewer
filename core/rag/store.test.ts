import { describe, it, expect, afterEach } from "vitest";
import { createCreativesDb } from "./db.js";
import { WinnerStore } from "./store.js";
import type { WinnerCreative } from "./types.js";
import { unlinkSync, existsSync } from "fs";

const TEST_DB = "/tmp/ad-ai-test-store.db";

function cleanup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = `${TEST_DB}${suffix}`;
    if (existsSync(p)) unlinkSync(p);
  }
}

function mkWinner(overrides: Partial<WinnerCreative> = {}): WinnerCreative {
  return {
    id: "w1",
    creativeId: "creative-1",
    productCategory: "course",
    productTags: ["react", "hooks"],
    productDescription: "React hooks tutorial",
    headline: "Learn React Hooks",
    body: "Master modern React in 2 weeks.",
    cta: "SIGN_UP",
    variantLabel: "emotional",
    embeddingProduct: Array.from({ length: 512 }, (_, i) => Math.sin(i)),
    embeddingCopy: Array.from({ length: 512 }, (_, i) => Math.cos(i)),
    qualifiedAt: "2026-04-20T00:00:00Z",
    impressions: 1500,
    inlineLinkClickCtr: 0.04,
    ...overrides,
  };
}

describe("WinnerStore", () => {
  afterEach(cleanup);

  it("insert + loadAll roundtrips all fields including 512-dim embeddings", () => {
    const db = createCreativesDb(TEST_DB);
    const store = new WinnerStore(db);
    const winner = mkWinner();
    store.insert(winner);
    const all = store.loadAll();
    expect(all).toHaveLength(1);
    const loaded = all[0];
    expect(loaded.id).toBe(winner.id);
    expect(loaded.creativeId).toBe(winner.creativeId);
    expect(loaded.productTags).toEqual(winner.productTags);
    expect(loaded.embeddingProduct).toHaveLength(512);
    expect(loaded.embeddingProduct[0]).toBeCloseTo(winner.embeddingProduct[0], 5);
    expect(loaded.embeddingCopy).toHaveLength(512);
    db.close();
  });

  it("hasCreative returns true after insert, false otherwise", () => {
    const db = createCreativesDb(TEST_DB);
    const store = new WinnerStore(db);
    expect(store.hasCreative("creative-1")).toBe(false);
    store.insert(mkWinner({ creativeId: "creative-1" }));
    expect(store.hasCreative("creative-1")).toBe(true);
    expect(store.hasCreative("creative-99")).toBe(false);
    db.close();
  });

  it("loadAll returns empty array for fresh DB", () => {
    const db = createCreativesDb(TEST_DB);
    const store = new WinnerStore(db);
    expect(store.loadAll()).toEqual([]);
    db.close();
  });

  it("insert handles null productCategory", () => {
    const db = createCreativesDb(TEST_DB);
    const store = new WinnerStore(db);
    store.insert(mkWinner({ productCategory: null }));
    const all = store.loadAll();
    expect(all[0].productCategory).toBeNull();
    db.close();
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import path from "path";
import os from "os";
import { createQualifyJob } from "./qualifyJob.js";
import type { VoyageClient } from "./voyage.js";
import type { VariantReport } from "../platform/types.js";
import type { Creative, Product } from "../types.js";

let tmpRoot: string;
let creativesDir: string;
let productsDir: string;
let dbPath: string;

async function writeCreative(id: string, variantGroupId: string, variantLabel: Creative["copy"]["variantLabel"]): Promise<void> {
  const creative: Creative = {
    id,
    productId: "p1",
    variantGroupId,
    copy: {
      headline: `h-${id}`,
      body: `b-${id}`,
      cta: "SHOP_NOW",
      hashtags: ["tag"],
      variantLabel,
      assetLabel: `${variantGroupId}::${variantLabel}`,
    },
    imageLocalPath: "/tmp/a.jpg",
    videoLocalPath: "/tmp/a.mp4",
    status: "approved",
    createdAt: "2026-04-20T00:00:00Z",
  };
  await writeFile(path.join(creativesDir, `${id}.json`), JSON.stringify(creative), "utf-8");
}

async function writeProduct(id: string): Promise<void> {
  const product: Product = {
    id,
    name: "Test Product",
    description: "This is a product description used for embedding",
    currency: "KRW",
    targetUrl: "https://example.com",
    tags: ["tag"],
    inputMethod: "manual",
    createdAt: "2026-04-20T00:00:00Z",
    category: "course",
  };
  await writeFile(path.join(productsDir, `${id}.json`), JSON.stringify(product), "utf-8");
}

function mkReport(overrides: Partial<VariantReport>): VariantReport {
  return {
    id: "r1",
    campaignId: "c1",
    variantGroupId: "g1",
    variantLabel: "emotional",
    assetLabel: "g1::emotional",
    productId: "p1",
    platform: "meta",
    date: "2026-04-20",
    impressions: 1000,
    clicks: 40,
    inlineLinkClickCtr: 0.04,
    platformMetrics: {
      meta: {
        qualityRanking: "AVERAGE",
        engagementRanking: "AVERAGE",
        conversionRanking: "AVERAGE",
      },
    },
    ...overrides,
  };
}

// Deterministic across calls — same input position always yields the same 1-hot
// vector. J3 relies on this to trigger cross-invocation dedup via shouldSkipInsert.
const fakeVoyage: VoyageClient = {
  async embed(texts) {
    return texts.map((_, i) => {
      const v = new Array(512).fill(0);
      v[i % 512] = 1;
      return v;
    });
  },
};

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "qualifyjob-"));
  creativesDir = path.join(tmpRoot, "creatives");
  productsDir = path.join(tmpRoot, "products");
  await mkdir(creativesDir, { recursive: true });
  await mkdir(productsDir, { recursive: true });
  dbPath = path.join(tmpRoot, "creatives.db");
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("createQualifyJob", () => {
  it("J1: end-to-end — fixtures to DB insert", async () => {
    await writeProduct("p1");
    await writeProduct("p2");
    await writeCreative("cr1e", "g1", "emotional");
    await writeCreative("cr1n", "g1", "numerical");
    await writeCreative("cr1u", "g1", "urgency");
    await writeCreative("cr2e", "g2", "emotional");
    await writeCreative("cr2n", "g2", "numerical");
    await writeCreative("cr2u", "g2", "urgency");

    const reports: VariantReport[] = [
      mkReport({ variantGroupId: "g1", variantLabel: "emotional", productId: "p1", impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04 }),
      mkReport({ variantGroupId: "g2", variantLabel: "numerical", productId: "p2", impressions: 300, clicks: 10, inlineLinkClickCtr: 0.033 }),
    ];

    const job = createQualifyJob({
      voyage: fakeVoyage,
      creativesDbPath: dbPath,
      creativesDir,
      productsDir,
    });
    const result = await job(reports);
    expect(result.inserted).toBe(1);
  });

  it("J2: findCreativeByVariant matches (variantGroupId, variantLabel)", async () => {
    await writeProduct("p1");
    await writeCreative("cr1e", "g1", "emotional");
    await writeCreative("cr1n", "g1", "numerical");
    await writeCreative("cr1u", "g1", "urgency");

    // All 3 variants pass threshold and share the same group → exactly 1 winner
    // is selected (pickBestPerVariantGroup). The ctr/imp make "urgency" win.
    const reports: VariantReport[] = [
      mkReport({ variantGroupId: "g1", variantLabel: "emotional", impressions: 1000, clicks: 30, inlineLinkClickCtr: 0.03 }),
      mkReport({ variantGroupId: "g1", variantLabel: "numerical", impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04 }),
      mkReport({ variantGroupId: "g1", variantLabel: "urgency", impressions: 1000, clicks: 50, inlineLinkClickCtr: 0.05 }),
    ];

    const job = createQualifyJob({
      voyage: fakeVoyage,
      creativesDbPath: dbPath,
      creativesDir,
      productsDir,
    });
    const result = await job(reports);
    expect(result.inserted).toBe(1);
  });

  it("J3: DB lifecycle — second invocation reopens DB and sees prior winner via dedup", async () => {
    await writeProduct("p1");
    await writeProduct("p2");
    await writeCreative("cr1e", "g1", "emotional");
    await writeCreative("cr2e", "g2", "emotional");

    const reports1: VariantReport[] = [
      mkReport({ variantGroupId: "g1", variantLabel: "emotional", productId: "p1", impressions: 1000, clicks: 40, inlineLinkClickCtr: 0.04 }),
    ];
    const reports2: VariantReport[] = [
      mkReport({ variantGroupId: "g2", variantLabel: "emotional", productId: "p2", impressions: 1000, clicks: 50, inlineLinkClickCtr: 0.05 }),
    ];

    const job = createQualifyJob({
      voyage: fakeVoyage,
      creativesDbPath: dbPath,
      creativesDir,
      productsDir,
    });
    const r1 = await job(reports1);
    const r2 = await job(reports2);
    expect(r1.inserted).toBe(1);
    // Second invocation opens a fresh DB connection to the same file; it must see
    // the winner inserted by r1 (proving close-in-finally flushed) and dedup against
    // it via shouldSkipInsert. That r2 resolves without throwing proves the
    // reopen path works; the skip count proves persistence across connections.
    expect(r2.skipped).toBe(1);
    expect(r2.inserted).toBe(0);
  });
});

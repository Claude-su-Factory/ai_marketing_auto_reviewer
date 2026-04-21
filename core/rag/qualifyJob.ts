import { readdir, readFile } from "fs/promises";
import path from "path";
import { createVoyageClient, type VoyageClient } from "./voyage.js";
import { createCreativesDb } from "./db.js";
import { WinnerStore } from "./store.js";
import { qualifyWinners } from "./qualifier.js";
import type { VariantReport } from "../platform/types.js";
import type { Creative, Product } from "../types.js";
import type { QualifyDeps } from "./types.js";

export interface QualifyJobOverrides {
  voyage?: VoyageClient;
  creativesDbPath?: string;
  creativesDir?: string;
  productsDir?: string;
}

export type QualifyJob = (
  reports: VariantReport[],
) => Promise<{ inserted: number; skipped: number }>;

export function createQualifyJob(overrides: QualifyJobOverrides = {}): QualifyJob {
  const voyage = overrides.voyage ?? createVoyageClient();
  const dbPath = overrides.creativesDbPath ?? "data/creatives.db";
  const creativesDir = overrides.creativesDir ?? "data/creatives";
  const productsDir = overrides.productsDir ?? "data/products";

  return async function qualify(reports: VariantReport[]) {
    // Rebuilt per tick so newly generated creative.json files (added between ticks
    // by runPipeline) become qualify-visible without worker restart. See spec §2.4.
    const creativeIndex = await buildCreativeIndex(creativesDir);

    const db = createCreativesDb(dbPath);
    try {
      const store = new WinnerStore(db);
      const deps: QualifyDeps = {
        findCreativeByVariant: async (variantGroupId, variantLabel) => {
          const key = `${variantGroupId}::${variantLabel}`;
          return creativeIndex.get(key) ?? null;
        },
        loadProduct: async (productId) => {
          const filePath = path.join(productsDir, `${productId}.json`);
          try {
            const content = await readFile(filePath, "utf-8");
            return JSON.parse(content) as Product;
          } catch {
            return null;
          }
        },
        embed: (texts) => voyage.embed(texts),
        store: {
          hasCreative: (id) => store.hasCreative(id),
          loadAll: () => store.loadAll(),
          insert: (w) => store.insert(w),
        },
      };
      return await qualifyWinners(reports, deps);
    } finally {
      db.close();
    }
  };
}

async function buildCreativeIndex(dir: string): Promise<Map<string, Creative>> {
  const index = new Map<string, Creative>();
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return index;
  }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const content = await readFile(path.join(dir, f), "utf-8");
      const creative = JSON.parse(content) as Creative;
      const key = `${creative.variantGroupId}::${creative.copy.variantLabel}`;
      index.set(key, creative);
    } catch (e) {
      console.warn("[qualifyJob] skipping malformed creative:", f, e);
    }
  }
  return index;
}

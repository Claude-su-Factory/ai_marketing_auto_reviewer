import type { WinnerCreative } from "./types.js";
import type { Product } from "../types.js";

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: length mismatch ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function dedupByCosine(
  candidates: WinnerCreative[],
  threshold: number,
  field: "embeddingProduct" | "embeddingCopy",
): WinnerCreative[] {
  const kept: WinnerCreative[] = [];
  for (const c of candidates) {
    const isDup = kept.some(
      (k) => cosineSimilarity(c[field], k[field]) > threshold,
    );
    if (!isDup) kept.push(c);
  }
  return kept;
}

export function filterByCategory(
  corpus: WinnerCreative[],
  category: string | null,
): WinnerCreative[] {
  return corpus.filter((w) => w.productCategory === category);
}

export function retrieveTopK(
  queryEmbed: number[],
  corpus: WinnerCreative[],
  k: number,
  minCosine: number,
): WinnerCreative[] {
  const scored = corpus
    .map((w) => ({ w, score: cosineSimilarity(queryEmbed, w.embeddingProduct) }))
    .filter((s) => s.score >= minCosine)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return scored.map((s) => s.w);
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function lexicalFallback(
  productTags: string[],
  corpus: WinnerCreative[],
  k: number,
): WinnerCreative[] {
  const scored = corpus
    .map((w) => ({ w, score: jaccard(productTags, w.productTags) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return scored.map((s) => s.w);
}

const MIN_COSINE = 0.6;
export const DEDUP_COSINE = 0.95;
const TOP_K = 3;

export function selectFewShotWinners(
  queryEmbed: number[],
  allWinners: WinnerCreative[],
  product: Product,
): WinnerCreative[] {
  if (allWinners.length === 0) return [];

  const categoryMatched = filterByCategory(allWinners, product.category ?? null);
  let ranked = retrieveTopK(queryEmbed, categoryMatched, TOP_K, MIN_COSINE);

  if (ranked.length < TOP_K) {
    const remaining = allWinners.filter((w) => !ranked.includes(w));
    const global = retrieveTopK(queryEmbed, remaining, TOP_K - ranked.length, MIN_COSINE);
    ranked = [...ranked, ...global];
  }

  if (ranked.length < TOP_K) {
    const remaining = allWinners.filter((w) => !ranked.includes(w));
    const lex = lexicalFallback(product.tags, remaining, TOP_K - ranked.length);
    ranked = [...ranked, ...lex];
  }

  return dedupByCosine(ranked, DEDUP_COSINE, "embeddingProduct");
}

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

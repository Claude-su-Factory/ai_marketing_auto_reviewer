import type { Product } from "../types.js";

export function buildProductEmbedText(product: Product): string {
  const parts: string[] = [product.description];
  if (product.learningOutcomes.length > 0) {
    parts.push(`학습 결과: ${product.learningOutcomes.join(", ")}`);
  }
  if (product.differentiators.length > 0) {
    parts.push(`차별점: ${product.differentiators.join(", ")}`);
  }
  return parts.join("\n");
}

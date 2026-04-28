import type { Product } from "../types.js";
import { loadPrompts, substitutePlaceholders } from "../learning/prompts.js";

export type VariantLabel = "emotional" | "numerical" | "urgency";

// Plan C에서 WinnerCreative 기반으로 확장. Plan B는 빈 배열만 사용.
export interface FewShotExample {
  headline: string;
  body: string;
  cta: string;
}

function buildPriceText(product: Product): string {
  if (!product.price) return "가격 미정";
  const base = `${product.currency} ${product.price.toLocaleString()}`;
  if (product.originalPrice && product.originalPrice > product.price) {
    // Math.floor (not round): 표시광고법상 표시 할인율은 실제 할인율을 초과하면 안 됨
    const discount = Math.floor(
      ((product.originalPrice - product.price) / product.originalPrice) * 100
    );
    return `${base} (정가 ${product.currency} ${product.originalPrice.toLocaleString()} 에서 ${discount}% 할인)`;
  }
  return base;
}

/** Returns "" or "\n학습 결과:\n- a\n- b". Leading \n intentional —
 *  helper concatenates onto {{priceText}} with no separator, so block owns its line break. */
function buildLearningOutcomesBlock(items: string[]): string {
  if (items.length === 0) return "";
  return `\n학습 결과:\n${items.map((s) => `- ${s}`).join("\n")}`;
}

/** Returns "" or "\n차별점:\n- a\n- b". Leading \n intentional (same pattern as outcomes block). */
function buildDifferentiatorsBlock(items: string[]): string {
  if (items.length === 0) return "";
  return `\n차별점:\n${items.map((s) => `- ${s}`).join("\n")}`;
}

export const VARIANT_LABELS: readonly VariantLabel[] = [
  "emotional",
  "numerical",
  "urgency",
] as const;

export async function buildCopyPrompt(
  product: Product,
  fewShot: FewShotExample[],
  variantLabel: VariantLabel,
): Promise<string> {
  const prompts = await loadPrompts();

  const fewShotBlock =
    fewShot.length > 0
      ? `\n\n참고 예시:\n${fewShot
          .map(
            (ex, i) =>
              `[${i + 1}] 헤드라인: ${ex.headline} / 본문: ${ex.body} / CTA: ${ex.cta}`,
          )
          .join("\n")}\n`
      : "";

  return substitutePlaceholders(prompts.copy.userTemplate, {
    name: product.name,
    description: product.description,
    priceText: buildPriceText(product),
    category: product.category ?? "기타",
    tags: product.tags.join(", "),
    targetUrl: product.targetUrl,
    angleHint: prompts.copy.angleHints[variantLabel],
    fewShotBlock,
    learningOutcomesBlock: buildLearningOutcomesBlock(product.learningOutcomes),
    differentiatorsBlock: buildDifferentiatorsBlock(product.differentiators),
  });
}

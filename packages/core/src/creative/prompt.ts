import type { Product } from "../types.js";
import { loadPrompts, substitutePlaceholders } from "../learning/prompts.js";

export type VariantLabel = "emotional" | "numerical" | "urgency";

// Plan C에서 WinnerCreative 기반으로 확장. Plan B는 빈 배열만 사용.
export interface FewShotExample {
  headline: string;
  body: string;
  cta: string;
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
  const priceText = product.price
    ? `${product.currency} ${product.price.toLocaleString()}`
    : "가격 미정";

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
    priceText,
    category: product.category ?? "기타",
    tags: product.tags.join(", "),
    targetUrl: product.targetUrl,
    angleHint: prompts.copy.angleHints[variantLabel],
    fewShotBlock,
  });
}

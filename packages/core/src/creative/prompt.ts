import type { Product } from "../types.js";

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

const ANGLE_HINTS: Record<VariantLabel, string> = {
  emotional: "감정 호소 중심으로 독자의 욕구·공감대를 자극하세요.",
  numerical: "수치·통계·비교를 전면에 배치하세요.",
  urgency: "긴급성·희소성(기한, 한정 수량 등)을 강조하세요.",
};

export function buildCopyPrompt(
  product: Product,
  fewShot: FewShotExample[],
  variantLabel: VariantLabel,
): string {
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

  return `다음 제품/서비스에 대한 Instagram 광고 카피를 작성해주세요.

제품명: ${product.name}
설명: ${product.description}
가격: ${priceText}
카테고리: ${product.category ?? "기타"}
태그: ${product.tags.join(", ")}
링크: ${product.targetUrl}

이 variant의 톤 가이드: ${ANGLE_HINTS[variantLabel]}${fewShotBlock}`;
}

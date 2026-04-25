import Anthropic from "@anthropic-ai/sdk";
import type { Product, Creative } from "../types.js";
import { buildCopyPrompt, type FewShotExample, type VariantLabel } from "./prompt.js";
import { requireAnthropicKey } from "../config/helpers.js";

export const COPY_SYSTEM_PROMPT = `당신은 Meta(Instagram/Facebook) 광고 카피라이터입니다.
모든 종류의 제품·서비스 광고에 최적화된 카피를 작성합니다.

규칙:
- 헤드라인: 구매/사용 후 얻는 구체적 결과물 또는 수치 포함 (최대 40자)
- 본문: 제품/서비스의 핵심 가치와 차별점 강조 (최대 125자)
- CTA: 행동을 유도하는 짧은 문구 (최대 20자)
- 해시태그: 관련 해시태그 3개

반드시 JSON 형식으로만 응답하세요:
{"headline":"","body":"","cta":"","hashtags":[]}`;

export async function generateCopy(
  client: Anthropic,
  product: Product,
  fewShot: FewShotExample[] = [],
  variantLabel: VariantLabel = "emotional",
): Promise<Creative["copy"]> {
  const userPrompt = buildCopyPrompt(product, fewShot, variantLabel);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: [{ type: "text", text: COPY_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? "{}");
  return {
    ...parsed,
    variantLabel,
    assetLabel: "", // 호출자가 Creative를 조립할 때 채움
  };
}

export function createAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: requireAnthropicKey() });
}

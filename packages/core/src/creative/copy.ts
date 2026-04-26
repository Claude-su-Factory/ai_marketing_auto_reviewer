import Anthropic from "@anthropic-ai/sdk";
import type { Product, Creative } from "../types.js";
import { buildCopyPrompt, type FewShotExample, type VariantLabel } from "./prompt.js";
import { loadPrompts } from "../learning/prompts.js";
import { requireAnthropicKey } from "../config/helpers.js";

export async function generateCopy(
  client: Anthropic,
  product: Product,
  fewShot: FewShotExample[] = [],
  variantLabel: VariantLabel = "emotional",
): Promise<Creative["copy"]> {
  const prompts = await loadPrompts();
  const userPrompt = await buildCopyPrompt(product, fewShot, variantLabel);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: [{ type: "text", text: prompts.copy.systemPrompt, cache_control: { type: "ephemeral" } }],
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

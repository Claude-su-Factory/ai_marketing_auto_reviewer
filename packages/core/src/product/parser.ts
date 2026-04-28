import Anthropic from "@anthropic-ai/sdk";
import type { Product } from "../types.js";
import { randomUUID } from "crypto";
import { MODEL_PARSER } from "../config/claudeModels.js";

export function detectCategory(url: string): string {
  if (url.includes("inflearn.com")) return "course";
  if (url.includes("class101.net")) return "course";
  return "other";
}

const PARSER_SYSTEM_PROMPT = `당신은 제품/서비스 페이지 HTML 에서 정보를 추출하는 파서입니다.

규칙:
- 반드시 JSON 형식으로만 응답. 다른 텍스트 절대 포함 금지.
- 불확실한 필드는 빈 문자열, 0, null, 또는 빈 배열 반환.
- price 는 숫자만 (KRW 가정, 통화 기호/콤마 제거).
- originalPrice 는 페이지에 "할인 전 가격" 명시된 경우만 숫자로 반환, 없으면 null.
- tags 는 핵심 키워드 3-5개.
- learningOutcomes: 페이지에 명시된 "학습 결과/사용 후 변화" 3-5개. 동사형 ("~할 수 있다", "~를 구현"). 검증 가능한 사실만.
- differentiators: 페이지에 명시된 "차별점/USP" 1-3개. 사실 기반 ("현직 시니어 강의", "실 프로젝트 사례"). superlative ("유일한", "1위") 추출 금지 — 검증 불가능.

응답 형식:
{"name":"","description":"","price":0,"originalPrice":null,"tags":[],"imageUrl":"","learningOutcomes":[],"differentiators":[]}`;

export async function parseProductWithClaude(
  client: Anthropic,
  url: string,
  html: string,
): Promise<Product> {
  const userPrompt = `URL: ${url}

다음 HTML 에서 제품 정보를 추출하세요.

HTML:
${html.slice(0, 8000)}`;

  const response = await client.messages.create({
    model: MODEL_PARSER,
    max_tokens: 1024,
    system: [{ type: "text", text: PARSER_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userPrompt }],
  });

  const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? "{}");

  return {
    id: randomUUID(),
    name: parsed.name ?? "",
    description: parsed.description ?? "",
    imageUrl: parsed.imageUrl ?? "",
    targetUrl: url,
    category: detectCategory(url),
    price: parsed.price ?? 0,
    originalPrice: parsed.originalPrice ?? undefined,
    currency: "KRW",
    tags: parsed.tags ?? [],
    learningOutcomes: parsed.learningOutcomes ?? [],
    differentiators: parsed.differentiators ?? [],
    inputMethod: "scraped",
    createdAt: new Date().toISOString(),
  };
}

import Anthropic from "@anthropic-ai/sdk";
import type { Course, Creative } from "../types.js";

export const COPY_SYSTEM_PROMPT = `당신은 온라인 강의 광고 카피라이터입니다.
인스타그램 광고에 최적화된 카피를 작성합니다.

규칙:
- 헤드라인: 수강 후 얻는 구체적 결과물 또는 수치 포함 (최대 40자)
- 본문: 강의의 핵심 가치와 차별점 강조 (최대 125자)
- CTA: 행동을 유도하는 짧은 문구 (최대 20자)
- 해시태그: 관련 해시태그 3개

반드시 JSON 형식으로만 응답하세요:
{"headline":"","body":"","cta":"","hashtags":[]}`;

export async function generateCopy(
  client: Anthropic,
  course: Course
): Promise<Creative["copy"]> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: [
      {
        type: "text",
        text: COPY_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `다음 강의에 대한 인스타그램 광고 카피를 작성해주세요.

강의명: ${course.title}
설명: ${course.description}
가격: ₩${course.price.toLocaleString()}
태그: ${course.tags.join(", ")}
플랫폼 URL: ${course.url}`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch?.[0] ?? "{}");
}

export function createAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

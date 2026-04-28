/** Claude 모델 ID — use-case 별 tier 분리. 변경 시 이 파일 1곳만 수정.
 *  명명 근거 (use-case vs HIGH/LOW): docs/superpowers/specs/2026-04-28-claude-model-tier-design.md §3.2.
 *  미래 한 사이트만 모델 변경 (e.g. Improver Sonnet 4.7) 시 1 줄 수정 가능. */

// HTML → JSON 추출 (mechanical, schema 강제, 한국어 nuance 영향 작음)
export const MODEL_PARSER = "claude-haiku-4-5";

// 한국어 광고 카피 작성 (한국어 nuance + banned-pattern 준수 critical)
export const MODEL_COPY = "claude-sonnet-4-6";

// CTR 분석 + prompt 개선안 제안 (reasoning + 자기학습 input)
export const MODEL_ANALYSIS = "claude-sonnet-4-6";

// 분석 결과로 prompt 재작성 (모든 미래 카피 영향, very high stakes)
export const MODEL_IMPROVER = "claude-sonnet-4-6";

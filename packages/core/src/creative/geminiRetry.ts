export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  isRetryable?: (e: unknown) => boolean;
  onAttempt?: (attempt: number, maxRetries: number, error: unknown) => void;
}

const DEFAULT_RETRYABLE_PATTERNS = [
  "503",
  "UNAVAILABLE",
  "429",
  "RESOURCE_EXHAUSTED",
];

export function defaultIsRetryable(e: unknown): boolean {
  const msg = String(e);
  return DEFAULT_RETRYABLE_PATTERNS.some((p) => msg.includes(p));
}

function defaultOnAttempt(attempt: number, maxRetries: number, error: unknown): void {
  console.warn(
    `[gemini-retry] attempt ${attempt}/${maxRetries} failed (transient), retrying:`,
    String(error).slice(0, 120),
  );
}

export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 2000;
  const isRetryable = options.isRetryable ?? defaultIsRetryable;
  const onAttempt = options.onAttempt ?? defaultOnAttempt;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt === maxRetries || !isRetryable(e)) throw e;
      onAttempt(attempt, maxRetries, e);
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
  throw lastError;
}

export type GoogleModelKind = "image" | "text";

export function isModelNotFoundError(e: unknown): boolean {
  const msg = String(e);
  return msg.includes("404") && (msg.includes("NOT_FOUND") || msg.includes("is not found"));
}

export function buildModelNotFoundMessage(modelName: string, kind: GoogleModelKind, originalError: unknown): string {
  const original = String(originalError).slice(0, 200);
  return `Google ${kind} 모델 "${modelName}" 을 찾을 수 없습니다 (404).
해결 방법:
  1. \`npm run list-models\` 실행해 가용 모델 확인
  2. config.toml 의 [ai.google.models] 에 "${kind} = \\"<model-id>\\"" 추가 (또는 기존 값 교체)

원본 에러: ${original}`;
}

/** Calls a Google Gemini API with retry + 404 friendly error.
 *  On 404 (model not found), throws an Error guiding to `npm run list-models` + config override. */
export async function callGoogleModel<T>(
  fn: () => Promise<T>,
  modelName: string,
  kind: GoogleModelKind,
  options: RetryOptions = {},
): Promise<T> {
  try {
    return await withGeminiRetry(fn, options);
  } catch (e) {
    if (isModelNotFoundError(e)) {
      throw new Error(buildModelNotFoundMessage(modelName, kind, e));
    }
    throw e;
  }
}

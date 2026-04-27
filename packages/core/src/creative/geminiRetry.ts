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

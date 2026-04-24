interface RateBucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(maxRequests = 10, windowMs = 60000) {
  const buckets = new Map<string, RateBucket>();

  return {
    check(licenseId: string): { allowed: boolean; retryAfter?: number } {
      const now = Date.now();
      let bucket = buckets.get(licenseId);

      if (!bucket || now > bucket.resetAt) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(licenseId, bucket);
      }

      if (bucket.count >= maxRequests) {
        return {
          allowed: false,
          retryAfter: Math.ceil((bucket.resetAt - now) / 1000),
        };
      }

      bucket.count++;
      return { allowed: true };
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

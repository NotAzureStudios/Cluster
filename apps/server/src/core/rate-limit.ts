export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export type RateLimiterStats = {
  buckets: number;
  softLimit: number;
  hardLimit: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private nextAutomaticPruneAt = 0;
  private static readonly PRUNE_INTERVAL_MS = 15_000;

  constructor(
    private readonly softLimit = 5_000,
    private readonly hardLimit = 10_000
  ) {
    if (!Number.isInteger(softLimit) || softLimit < 1) throw new Error("Rate limiter soft limit must be a positive integer.");
    if (!Number.isInteger(hardLimit) || hardLimit < softLimit) throw new Error("Rate limiter hard limit must be at least the soft limit.");
  }

  consume(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitDecision {
    return this.consumeCost(key, limit, windowMs, 1, now);
  }

  consumeCost(key: string, limit: number, windowMs: number, cost: number, now = Date.now()): RateLimitDecision {
    if (!key) throw new Error("Rate limiter key is required.");
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Rate limit must be a positive integer.");
    if (!Number.isFinite(windowMs) || windowMs < 1) throw new Error("Rate limit window must be positive.");
    if (!Number.isInteger(cost) || cost < 1 || cost > limit) throw new Error("Rate limit cost must be a positive integer no larger than the limit.");

    // A full map sweep per request becomes expensive once thousands of keys
    // accumulate. Expiry for the requested key is still enforced immediately;
    // global cleanup is periodic and capacity remains strictly bounded.
    if (this.buckets.size >= this.softLimit && now >= this.nextAutomaticPruneAt) {
      this.prune(now);
      this.nextAutomaticPruneAt = now + FixedWindowRateLimiter.PRUNE_INTERVAL_MS;
    }
    const current = this.buckets.get(key);
    const bucket = !current || current.resetAt <= now
      ? { count: cost, resetAt: now + windowMs }
      : { count: current.count + cost, resetAt: current.resetAt };

    // Reinsert active buckets so hard-limit pruning removes the least recently used keys.
    this.buckets.delete(key);
    this.buckets.set(key, bucket);
    if (this.buckets.size > this.hardLimit) this.prune(now);

    const allowed = bucket.count <= limit;
    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      resetAt: bucket.resetAt,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    };
  }

  delete(key: string) {
    return this.buckets.delete(key);
  }

  clear() {
    this.buckets.clear();
  }

  prune(now = Date.now()) {
    let expired = 0;
    if (this.buckets.size >= this.softLimit) {
      for (const [key, bucket] of this.buckets) {
        if (bucket.resetAt <= now) {
          this.buckets.delete(key);
          expired += 1;
        }
      }
    }

    let evicted = 0;
    while (this.buckets.size > this.hardLimit) {
      const oldestKey = this.buckets.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.buckets.delete(oldestKey);
      evicted += 1;
    }

    return { expired, evicted };
  }

  stats(): RateLimiterStats {
    return {
      buckets: this.buckets.size,
      softLimit: this.softLimit,
      hardLimit: this.hardLimit
    };
  }
}

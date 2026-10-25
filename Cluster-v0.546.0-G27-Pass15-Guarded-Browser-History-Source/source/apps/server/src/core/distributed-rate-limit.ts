import type { RateLimitDecision } from "./rate-limit.js";
import { BoundedCache } from "./bounded-cache.js";

type RawPrisma = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

export class DistributedFixedWindowRateLimiter {
  private consumed = 0;
  private rejected = 0;
  private failures = 0;
  private accelerationHits = 0;
  private databaseFallbacks = 0;
  private failoverSeeds = 0;
  private readonly acceleratedWindows = new BoundedCache<string, { count: number; resetAt: number }>({ maxEntries: 50_000 });

  constructor(
    private readonly prisma: RawPrisma,
    private readonly acceleration?: {
      consumeFixedWindow: (key: string, limit: number, windowMs: number, cost?: number, now?: number) => Promise<RateLimitDecision | null>;
      deleteRateLimit?: (key: string) => Promise<boolean>;
      snapshot?: () => { distributed?: boolean };
    },
  ) {}

  async consume(key: string, limit: number, windowMs: number, now = Date.now()) {
    return this.consumeCost(key, limit, windowMs, 1, now);
  }

  async consumeCost(key: string, limit: number, windowMs: number, cost: number, now = Date.now()): Promise<RateLimitDecision> {
    if (!key) throw new Error("Rate limiter key is required.");
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Rate limit must be a positive integer.");
    if (!Number.isFinite(windowMs) || windowMs < 1) throw new Error("Rate limit window must be positive.");
    if (!Number.isInteger(cost) || cost < 1 || cost > limit) throw new Error("Rate limit cost must be positive and no larger than the limit.");
    try {
      const cleanKey = key.slice(0, 320);
      const knownWindow = this.acceleratedWindows.get(cleanKey);
      if (this.acceleration?.snapshot?.().distributed) {
        const accelerated = await this.acceleration.consumeFixedWindow(cleanKey, limit, windowMs, cost, now);
        if (accelerated) {
          const observedCount = Math.max(0, limit - accelerated.remaining);
          const expectedMinimum = knownWindow && knownWindow.resetAt > now ? knownWindow.count + cost : cost;
          if (observedCount >= expectedMinimum) {
            this.consumed += cost;
            this.accelerationHits += 1;
            this.acceleratedWindows.set(cleanKey, { count: observedCount, resetAt: accelerated.resetAt }, Math.max(1, accelerated.resetAt - now));
            if (!accelerated.allowed) this.rejected += 1;
            return accelerated;
          }
          // Redis recovered with a counter behind the PostgreSQL failover
          // window. Fall through to PostgreSQL so recovery can never grant
          // requests that were already consumed during the outage.
          this.failoverSeeds += 1;
        }
      }
      this.databaseFallbacks += 1;
      const acceleratedWindow = this.acceleratedWindows.get(cleanKey);
      const guarded = acceleratedWindow && acceleratedWindow.resetAt > now ? acceleratedWindow : null;
      const seedCount = guarded ? guarded.count + cost : cost;
      const seedResetAt = guarded ? guarded.resetAt : now + Math.round(windowMs);
      if (guarded) this.failoverSeeds += 1;
      const rows = await this.prisma.$queryRawUnsafe<Array<{ count: number | bigint | string; resetAt: Date }>>(
        `INSERT INTO "RateLimitBucket" ("key", "count", "resetAt", "updatedAt")
         VALUES ($1, $2, to_timestamp($5 / 1000.0), NOW())
         ON CONFLICT ("key") DO UPDATE SET
           "count" = CASE
             WHEN "RateLimitBucket"."resetAt" <= to_timestamp($4 / 1000.0) THEN EXCLUDED."count"
             ELSE GREATEST("RateLimitBucket"."count" + $3, EXCLUDED."count")
           END,
           "resetAt" = CASE
             WHEN "RateLimitBucket"."resetAt" <= to_timestamp($4 / 1000.0) THEN EXCLUDED."resetAt"
             ELSE GREATEST("RateLimitBucket"."resetAt", EXCLUDED."resetAt")
           END,
           "updatedAt" = NOW()
         RETURNING "count", "resetAt"`,
        cleanKey, seedCount, cost, now, seedResetAt,
      );
      const count = Number(rows[0]?.count || cost);
      const resetAt = new Date(rows[0]?.resetAt || now + windowMs).getTime();
      const allowed = count <= limit;
      this.acceleratedWindows.set(cleanKey, { count, resetAt }, Math.max(1, resetAt - now));
      this.consumed += cost;
      if (!allowed) this.rejected += 1;
      return { allowed, limit, remaining: Math.max(0, limit - count), resetAt, retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000)) };
    } catch (error) {
      this.failures += 1;
      throw error;
    }
  }

  async delete(key: string) {
    const clean = key.slice(0, 320);
    this.acceleratedWindows.delete(clean);
    let accelerated = false;
    try { accelerated = Boolean(await this.acceleration?.deleteRateLimit?.(clean)); } catch { /* PostgreSQL cleanup remains authoritative fallback */ }
    const database = (await this.prisma.$executeRawUnsafe(`DELETE FROM "RateLimitBucket" WHERE "key" = $1`, clean)) > 0;
    return accelerated || database;
  }

  async prune(now = new Date(), options: { batchSize?: number; maxRows?: number } = {}) {
    const batchSize = Math.max(100, Math.min(5_000, Math.round(options.batchSize ?? 1_000)));
    const maxRows = Math.max(batchSize, Math.min(100_000, Math.round(options.maxRows ?? 10_000)));
    let removed = 0;
    while (removed < maxRows) {
      const limit = Math.min(batchSize, maxRows - removed);
      const count = await this.prisma.$executeRawUnsafe(
        `WITH doomed AS (
           SELECT "key" FROM "RateLimitBucket"
           WHERE "resetAt" < $1
           ORDER BY "resetAt" ASC
           LIMIT $2
         )
         DELETE FROM "RateLimitBucket" bucket
         USING doomed
         WHERE bucket."key" = doomed."key"`,
        now,
        limit,
      );
      removed += Number(count || 0);
      if (Number(count || 0) < limit) break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return removed;
  }

  stats() {
    const distributed = Boolean(this.acceleration?.snapshot?.().distributed);
    return {
      consumed: this.consumed,
      rejected: this.rejected,
      failures: this.failures,
      accelerationHits: this.accelerationHits,
      databaseFallbacks: this.databaseFallbacks,
      failoverSeeds: this.failoverSeeds,
      mode: distributed ? "redis-with-postgresql-fallback" as const : "postgresql-atomic" as const,
    };
  }
}

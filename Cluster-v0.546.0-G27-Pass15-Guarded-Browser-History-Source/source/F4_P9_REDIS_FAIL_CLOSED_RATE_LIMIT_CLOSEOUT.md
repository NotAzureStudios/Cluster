# F4 P9: Redis rate-limit correctness and secret redaction

Parent: F4 P8. Security defect: the distributed rate limiter previously trusted malformed/non-array Lua results by substituting `cost` and `ttl`, potentially treating invalid backend replies as allowed quota.

- `validatedRateLimitReply` accepts exactly two safe numeric integers with `count >= cost` and `0 < PTTL <= window TTL`.
- Any missing, expired, malformed, infinite, unsafe, or out-of-range reply fails closed to `null`, which triggers the existing PostgreSQL atomic fallback through `DistributedFixedWindowRateLimiter`.
- Redis errors are classified into fixed, bounded codes. Raw redis:// credentials and token-bearing messages are not included in snapshots, connection-fallback logs or `redis-required` startup errors.
- Compatibility evidence cache is invalidated on Redis error.

Focused assertions: 73/73, including behavior exercised directly on the transpiled `ClusterAccelerationRuntime` with injected mock transport. The network and PostgreSQL fallback still require a live integration test. No new migration.

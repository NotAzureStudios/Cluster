import assert from "node:assert/strict";
import test from "node:test";
import { authTransportRateLimitPolicy, ConcurrentWorkLimiter, requestWorkPolicy } from "../../../apps/server/src/core/request-workload";
import { FixedWindowRateLimiter } from "../../../apps/server/src/core/rate-limit";

const policy = (pathname: string, method = "GET") => requestWorkPolicy({
  pathname, method, globalBodyLimitBytes: 512 * 1024 * 1024, uploadLimitBytes: 512 * 1024 * 1024, avatarUploadLimitBytes: 5 * 1024 * 1024,
});


test("auth transport limiter ignores bootstrap reads and keeps a broad credential-write guard", () => {
  assert.equal(authTransportRateLimitPolicy({ pathname: "/api/auth/config", method: "GET", authRateLimitMax: 12 }), null);
  assert.equal(authTransportRateLimitPolicy({ pathname: "/api/auth/csrf", method: "GET", authRateLimitMax: 12 }), null);
  assert.equal(authTransportRateLimitPolicy({ pathname: "/api/auth/logout", method: "POST", authRateLimitMax: 12 }), null);
  assert.deepEqual(authTransportRateLimitPolicy({ pathname: "/api/auth/login", method: "POST", authRateLimitMax: 12 }), {
    bucketName: "auth-transport",
    limit: 120,
  });
  assert.equal(authTransportRateLimitPolicy({ pathname: "/api/auth/reauth", method: "POST", authRateLimitMax: 3 })?.limit, 60);
  assert.equal(authTransportRateLimitPolicy({ pathname: "/api/auth/session-password", method: "POST", authRateLimitMax: 500 })?.limit, 1_000);
});

test("request workload classifies cheap, heavy, and critical operations", () => {
  assert.deepEqual(policy("/api/projects"), { cost: 1, workClass: "normal", bodyLimitBytes: 64 * 1024 });
  assert.equal(policy("/api/security/events/export").workClass, "heavy");
  assert.equal(policy("/api/admin/backups/now", "POST").workClass, "critical");
  assert.equal(policy("/api/sync/batch", "POST").cost, 6);
});

test("generic JSON receives a small route body ceiling while uploads retain bounded envelopes", () => {
  assert.equal(policy("/api/cards/abc", "PATCH").bodyLimitBytes, 2 * 1024 * 1024);
  assert.ok(policy("/api/users/me/avatar", "POST").bodyLimitBytes < 9 * 1024 * 1024);
  assert.ok(policy("/api/knowledge/upload", "POST").bodyLimitBytes <= 512 * 1024 * 1024);
  assert.equal(policy("/api/desktop-transfers/uploads/id/chunks", "PUT").bodyLimitBytes, 9 * 1024 * 1024);
});

test("weighted rate limiter spends multiple units for expensive requests", () => {
  const limiter = new FixedWindowRateLimiter();
  assert.equal(limiter.consumeCost("client", 10, 60_000, 6, 1_000).allowed, true);
  const second = limiter.consumeCost("client", 10, 60_000, 6, 1_001);
  assert.equal(second.allowed, false);
  assert.equal(second.remaining, 0);
});

test("concurrency limiter isolates per-client and global expensive work", () => {
  const limiter = new ConcurrentWorkLimiter({ heavyGlobal: 2, heavyPerClient: 1, criticalGlobal: 1, criticalPerClient: 1 });
  const releaseA = limiter.acquire("heavy", "a");
  assert.ok(releaseA);
  assert.equal(limiter.acquire("heavy", "a"), null);
  const releaseB = limiter.acquire("heavy", "b");
  assert.ok(releaseB);
  assert.equal(limiter.acquire("heavy", "c"), null);
  releaseA?.();
  assert.ok(limiter.acquire("heavy", "c"));

  const critical = limiter.acquire("critical", "a");
  assert.ok(critical);
  assert.equal(limiter.acquire("critical", "b"), null);
  critical?.();
});

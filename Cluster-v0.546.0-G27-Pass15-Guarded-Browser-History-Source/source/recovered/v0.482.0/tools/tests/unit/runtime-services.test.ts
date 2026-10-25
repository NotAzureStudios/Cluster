import assert from "node:assert/strict";
import test from "node:test";
import { BackgroundTaskRegistry } from "../../../apps/server/src/core/background-tasks";
import { FixedWindowRateLimiter } from "../../../apps/server/src/core/rate-limit";

test("fixed-window limiter returns stable headers and resets after the window", () => {
  const limiter = new FixedWindowRateLimiter(2, 4);
  const first = limiter.consume("login:duckey", 2, 1_000, 1_000);
  const second = limiter.consume("login:duckey", 2, 1_000, 1_100);
  const blocked = limiter.consume("login:duckey", 2, 1_000, 1_200);
  const reset = limiter.consume("login:duckey", 2, 1_000, 2_001);

  assert.deepEqual({ allowed: first.allowed, remaining: first.remaining }, { allowed: true, remaining: 1 });
  assert.deepEqual({ allowed: second.allowed, remaining: second.remaining }, { allowed: true, remaining: 0 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 1);
  assert.equal(reset.allowed, true);
  assert.equal(reset.remaining, 1);
});

test("rate limiter remains bounded under identifier spraying", () => {
  const limiter = new FixedWindowRateLimiter(2, 3);
  for (let index = 0; index < 8; index += 1) limiter.consume(`spray:${index}`, 2, 60_000, index);
  assert.equal(limiter.stats().buckets, 3);
  assert.equal(limiter.delete("spray:7"), true);
  assert.equal(limiter.stats().buckets, 2);
});

test("background tasks run immediately, avoid overlap, and stop cleanly", async () => {
  const registry = new BackgroundTaskRegistry();
  let runs = 0;
  let releaseTask: (() => void) | null = null;
  registry.scheduleInterval("slow-task", 5, async () => {
    runs += 1;
    await new Promise<void>((resolve) => { releaseTask = resolve; });
  }, { runImmediately: true });

  await new Promise((resolve) => setTimeout(resolve, 35));
  const snapshot = registry.snapshots()[0];
  assert.equal(snapshot.runs, 1);
  assert.ok(snapshot.skippedOverlaps >= 1);

  releaseTask?.();
  await new Promise((resolve) => setTimeout(resolve, 2));
  registry.stopAll();
  const stoppedAt = runs;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(runs, stoppedAt);
  assert.deepEqual(registry.snapshots(), []);
});

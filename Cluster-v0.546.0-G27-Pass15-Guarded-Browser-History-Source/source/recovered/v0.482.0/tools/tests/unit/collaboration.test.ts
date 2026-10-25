import assert from "node:assert/strict";
import test from "node:test";
import {
  COLLABORATION_STALE_MS,
  collaborationFallbackDelay,
  collaborationPresenceIsActive,
  collaborationReconnectDelay
} from "../../../packages/renderer/src/features/collaboration/realtime";

test("stream reconnect backoff grows and is capped", () => {
  assert.equal(collaborationReconnectDelay(0), 800);
  assert.equal(collaborationReconnectDelay(1), 1600);
  assert.equal(collaborationReconnectDelay(5), 15000);
  assert.equal(collaborationReconnectDelay(50), 15000);
});

test("polling fallback backoff remains bounded", () => {
  assert.equal(collaborationFallbackDelay(0), 1000);
  assert.equal(collaborationFallbackDelay(3), 3000);
  assert.equal(collaborationFallbackDelay(40), 15000);
});

test("presence expires at the shared stale-session threshold", () => {
  const now = 100_000;
  assert.equal(collaborationPresenceIsActive(now - COLLABORATION_STALE_MS + 1, now), true);
  assert.equal(collaborationPresenceIsActive(now - COLLABORATION_STALE_MS, now), false);
});

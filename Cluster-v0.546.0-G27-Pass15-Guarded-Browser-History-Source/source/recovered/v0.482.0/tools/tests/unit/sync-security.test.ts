import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalSyncMutationPath,
  computeSyncScopeDigest,
  containsSensitiveSyncValue,
  decodeSyncCursor,
  encodeSyncCursor,
  sanitizeSyncHeaders,
} from "../../../apps/server/src/core/sync-security.js";

const secret = "0123456789abcdef0123456789abcdef";

test("signed sync cursor round-trips only for the same user, feed, and scope", () => {
  const scope = computeSyncScopeDigest({ role: "member", projects: ["a", "b"] });
  const cursor = encodeSyncCursor("core", "user-1", scope, { at: "2026-08-16T00:00:00.000Z", id: "x" }, secret);
  assert.deepEqual(decodeSyncCursor(cursor, "core", "user-1", scope, secret), {
    payload: { at: "2026-08-16T00:00:00.000Z", id: "x" },
    resetRequired: false,
    resetReason: null,
  });
  assert.equal(decodeSyncCursor(cursor, "core", "user-2", scope, secret).resetReason, "invalid");
  assert.equal(decodeSyncCursor(cursor, "library", "user-1", scope, secret).resetReason, "invalid");
});

test("tampered and legacy cursors fail closed", () => {
  const scope = computeSyncScopeDigest({ visible: true });
  const cursor = encodeSyncCursor("core", "user-1", scope, { n: 1 }, secret);
  const [payload, signature] = cursor.split(".");
  const tamperedSignature = `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
  assert.equal(decodeSyncCursor(`${payload}.${tamperedSignature}`, "core", "user-1", scope, secret).resetReason, "invalid");
  assert.equal(decodeSyncCursor("eyJ2ZXJzaW9uIjoxfQ", "core", "user-1", scope, secret).resetReason, "legacy");
});

test("authorization scope changes require a conservative cursor reset", () => {
  const oldScope = computeSyncScopeDigest({ projects: ["a", "b"] });
  const newScope = computeSyncScopeDigest({ projects: ["a"] });
  const cursor = encodeSyncCursor("core", "user-1", oldScope, { positions: {} }, secret);
  const decoded = decodeSyncCursor(cursor, "core", "user-1", newScope, secret);
  assert.equal(decoded.payload, null);
  assert.equal(decoded.resetRequired, true);
  assert.equal(decoded.resetReason, "scope_changed");
});

test("offline replay paths are canonical same-origin API paths", () => {
  assert.equal(canonicalSyncMutationPath("/api/cards/abc?view=1"), "/api/cards/abc?view=1");
  assert.equal(canonicalSyncMutationPath("https://evil.example/api/cards/abc"), null);
  assert.equal(canonicalSyncMutationPath("/api/%2e%2e/admin/settings"), null);
  assert.equal(canonicalSyncMutationPath("/api/cards/abc#fragment"), null);
  assert.equal(canonicalSyncMutationPath("/not-api/cards/abc"), null);
});

test("offline replay rejects nested secret-shaped payloads", () => {
  assert.equal(containsSensitiveSyncValue({ title: "Card", nested: { discordBotToken: "nope" } }), true);
  assert.equal(containsSensitiveSyncValue({ title: "Card", details: { password: "nope" } }), true);
  assert.equal(containsSensitiveSyncValue({ title: "Card", details: { priority: "high" } }), false);
});

test("offline replay forwards only concurrency-safe headers", () => {
  assert.deepEqual(sanitizeSyncHeaders({
    Authorization: "Bearer secret",
    Cookie: "session=secret",
    "If-Match": '"8"',
    "X-Cluster-Base-Revision": "8",
    "X-Anything-Else": "drop-me",
  }), {
    "if-match": '"8"',
    "x-cluster-base-revision": "8",
  });
});

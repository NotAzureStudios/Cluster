import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../../..");
const read = (f) => readFileSync(path.join(root, f), "utf8");
test("v0.409 Phase 6 resilience completion contract", () => {
  const pkg = JSON.parse(read("package.json"));
  const contracts = read("packages/shared/src/api-contracts.ts");
  const e2e = read("tools/scripts/e2e-ci.mjs");
  const notes = read("RELEASE_NOTES_v0.422.0.md");
  assert.equal(pkg.version, "0.422.0");
  assert.ok(contracts.includes('version: "2026-08-02.62"'));
  assert.ok(contracts.includes('"integration-e2e-resilience-v1"'));
  for (const phrase of [
    "external integration failures remain bounded and admin-readable",
    "server restart preserves authenticated client recovery",
    "network loss preserves route and reconnects without duplicate client state",
    "offline-safe edits reconcile after reconnect while stale edits conflict",
    "database restart hook is explicit and recoverable in chaos mode",
    "web and desktop-compatible clients can share one session contract",
    "hostile and malformed requests fail closed",
    "bounded soak keeps health session and collaboration stable",
  ]) assert.ok(e2e.includes(phrase), phrase);
  assert.ok(notes.includes("Phase 6.1-6.27"));
});

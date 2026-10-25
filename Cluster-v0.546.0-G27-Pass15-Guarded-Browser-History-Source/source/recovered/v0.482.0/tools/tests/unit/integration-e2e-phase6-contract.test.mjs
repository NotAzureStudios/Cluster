import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("v0.408 Phase 6 E2E foundation compatibility contract", () => {
  const pkg = JSON.parse(read("package.json"));
  const versions = JSON.parse(read("config/toolchain-versions.json"));
  const contracts = read("packages/shared/src/api-contracts.ts");
  const e2e = read("tools/scripts/e2e-ci.mjs");
  const notes = read("RELEASE_NOTES_v0.422.0.md");
  assert.equal(pkg.version, "0.422.0");
  assert.equal(versions.cluster, "0.422.0");
  assert.ok(contracts.includes('version: "2026-08-02.62"'));
  assert.ok(contracts.includes('"integration-e2e-foundation-v1"'));
  assert.ok(e2e.includes("anonymousContext"));
  assert.ok(e2e.includes("peerContext"));
  assert.ok(e2e.includes("session logout and re-authentication lifecycle is enforced"));
  assert.ok(e2e.includes("board realtime collaboration propagates multi-client presence and actions"));
  assert.ok(e2e.includes("whiteboard realtime collaboration propagates multi-client presence and actions"));
  assert.ok(notes.includes("Phase 6.1-6.16"));
});

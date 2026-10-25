import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
const root = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => readFile(path.join(root, relative), "utf8");
test("v0.402 desktop offline resilience contract", async () => {
  const [versionsText, contracts, policy, storage, api, crash, update, notes, doc, pkgText] = await Promise.all([
    read("config/toolchain-versions.json"), read("packages/shared/src/api-contracts.ts"), read("packages/renderer/src/core/offline-policy.ts"),
    read("packages/renderer/src/core/offline-storage.ts"), read("packages/renderer/src/core/api.ts"), read("apps/desktop-qt/src/CrashReporter.cpp"),
    read("apps/desktop-qt/src/NativeUpdateManager.cpp"), read("RELEASE_NOTES_v0.422.0.md"), read("docs/DESKTOP_OFFLINE_RESILIENCE.md"), read("package.json")
  ]);
  assert.equal(JSON.parse(versionsText).cluster, "0.422.0");
  assert.ok(contracts.includes('version: "2026-08-02.62"'));
  assert.ok(contracts.includes('"desktop-offline-resilience-v2"'));
  assert.ok(contracts.includes('"desktop-update-recovery-v2"'));
  assert.ok(contracts.includes('"desktop-startup-diagnostics-v2"'));
  assert.ok(policy.includes("revision_guarded") && policy.includes("online_only"));
  assert.ok(storage.includes("getOfflineCacheHealth"));
  assert.ok(api.includes("shouldQuarantineMutation"));
  assert.ok(crash.includes("QUuid::createUuid") && crash.includes("crashStreak"));
  assert.ok(update.includes("recordStartupFailure") && update.includes("rollback-ready"));
  assert.ok(notes.includes("4.10") && notes.includes("4.14"));
  assert.ok(doc.includes("Release-blocking boundary"));
  assert.ok(String(JSON.parse(pkgText).scripts?.audit || "").includes("desktop-offline-resilience-audit.mjs"));
});

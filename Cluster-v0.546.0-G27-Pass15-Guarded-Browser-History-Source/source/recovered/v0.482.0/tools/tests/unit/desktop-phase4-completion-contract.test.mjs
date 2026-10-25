import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
const root = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => readFile(path.join(root, relative), "utf8");
test("v0.403 closes Desktop-Native Advantage Phase 4", async () => {
  const [versionsText, contracts, broker, desktop, panel, notes, doc, pkgText] = await Promise.all([
    read("config/toolchain-versions.json"), read("packages/shared/src/api-contracts.ts"), read("apps/desktop-qt/src/NativeCapabilityBroker.cpp"),
    read("packages/renderer/src/core/desktop.ts"), read("packages/renderer/src/features/desktop/DesktopNativeServicesPanel.tsx"),
    read("RELEASE_NOTES_v0.422.0.md"), read("docs/DESKTOP_PHASE4_COMPLETION.md"), read("package.json")
  ]);
  assert.equal(JSON.parse(versionsText).cluster, "0.422.0");
  assert.ok(contracts.includes('version: "2026-08-02.62"'));
  assert.ok(contracts.includes('"desktop-native-boundary-v2"'));
  assert.ok(contracts.includes('"desktop-shared-renderer-parity-v2"'));
  assert.ok(contracts.includes('"desktop-native-advantage-set-v1"'));
  assert.ok(broker.includes("PROFILE_CONTEXT_MISMATCH") && broker.includes("BROKER_EPOCH_EXPIRED"));
  assert.ok(broker.includes("validatePayloadShape") && broker.includes("clearTransientCapabilityState"));
  assert.ok(desktop.includes("nativeBrokerContext") && desktop.includes("brokerEpoch?: string"));
  assert.ok(panel.includes("Desktop-only advantages") && panel.includes("same product renderer"));
  assert.ok(notes.includes("4.15") && notes.includes("4.16") && notes.includes("4.17"));
  assert.ok(notes.includes("Phase 4: Desktop-Native Advantage is complete"));
  assert.ok(doc.includes("Release-blocking boundary"));
  assert.ok(String(JSON.parse(pkgText).scripts?.audit || "").includes("desktop-phase4-completion-audit.mjs"));
});

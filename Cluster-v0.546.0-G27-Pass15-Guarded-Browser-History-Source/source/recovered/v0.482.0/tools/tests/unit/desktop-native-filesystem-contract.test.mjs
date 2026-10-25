import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("v0.400 desktop-native filesystem contract", async () => {
  const [versionsText, contracts, broker, header, qml, desktop, types, notes, doc, pkgText] = await Promise.all([
    read("config/toolchain-versions.json"),
    read("packages/shared/src/api-contracts.ts"),
    read("apps/desktop-qt/src/NativeCapabilityBroker.cpp"),
    read("apps/desktop-qt/src/NativeCapabilityBroker.h"),
    read("apps/desktop-qt/qml/pages/SharedRendererPage.qml"),
    read("packages/renderer/src/core/desktop.ts"),
    read("packages/renderer/src/core/desktop-types.ts"),
    read("RELEASE_NOTES_v0.422.0.md"),
    read("docs/DESKTOP_NATIVE_FILESYSTEM.md"),
    read("package.json"),
  ]);

  assert.equal(JSON.parse(versionsText).cluster, "0.422.0");
  assert.ok(contracts.includes('version: "2026-08-02.62"'));
  assert.ok(contracts.includes('"desktop-native-filesystem-v1"'));
  assert.ok(broker.includes('QStringLiteral("dialog.saveFile")'));
  assert.ok(broker.includes("issueDestinationHandle"));
  assert.ok(header.includes("acceptDroppedUrls"));
  assert.ok(broker.includes('QStringLiteral("filesystem.drop")'));
  assert.ok(qml.includes("clusterApp.nativeCapabilities.acceptDroppedUrls(urls)"));
  assert.ok(desktop.includes("pickNativeSaveDestination"));
  assert.ok(types.includes("onFilesystemDrop?:"));
  assert.ok(notes.includes("Phase 4 continues"));
  assert.ok(doc.includes("opaque `fh-*` handles"));
  assert.ok(String(JSON.parse(pkgText).scripts?.audit || "").includes("desktop-native-filesystem-audit.mjs"));
});

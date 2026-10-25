import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("v0.401 desktop-native shell productivity contract", async () => {
  const [versionsText, contracts, broker, profiles, controller, integration, desktop, notes, doc, pkgText] = await Promise.all([
    read("config/toolchain-versions.json"),
    read("packages/shared/src/api-contracts.ts"),
    read("apps/desktop-qt/src/NativeCapabilityBroker.cpp"),
    read("apps/desktop-qt/src/ServerProfileStore.cpp"),
    read("apps/desktop-qt/src/AppController.cpp"),
    read("apps/desktop-qt/src/DesktopIntegration.cpp"),
    read("packages/renderer/src/core/desktop.ts"),
    read("RELEASE_NOTES_v0.422.0.md"),
    read("docs/DESKTOP_NATIVE_SHELL_PRODUCTIVITY.md"),
    read("package.json"),
  ]);

  assert.equal(JSON.parse(versionsText).cluster, "0.422.0");
  assert.ok(contracts.includes('version: "2026-08-02.62"'));
  assert.ok(contracts.includes('"desktop-native-shell-productivity-v1"'));
  assert.ok(broker.includes('QStringLiteral("clipboard.status")'));
  assert.ok(broker.includes('QStringLiteral("clipboard.writeText")'));
  assert.ok(!broker.includes("clipboard.readText"));
  assert.ok(desktop.includes("copyClusterText"));
  assert.ok(profiles.includes("MaximumRecentWorkspaces = 12"));
  assert.ok(profiles.includes("recent-workspaces.json"));
  assert.ok(controller.includes("recordRecentWorkspace"));
  assert.ok(integration.includes('QStringLiteral("Recent workspaces")'));
  assert.ok(integration.includes('"navigateSharedRenderer"'));
  assert.ok(notes.includes("Phase 4 continues"));
  assert.ok(doc.includes("profile-scoped recent workspace"));
  assert.ok(String(JSON.parse(pkgText).scripts?.audit || "").includes("desktop-native-shell-productivity-audit.mjs"));
});

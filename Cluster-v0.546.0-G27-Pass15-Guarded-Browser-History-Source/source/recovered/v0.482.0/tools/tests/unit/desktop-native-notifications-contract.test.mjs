import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("v0.399 desktop-native notification contract", async () => {
  const [versionsText, contracts, broker, integration, sync, shell, notes, doc, pkgText] = await Promise.all([
    read("config/toolchain-versions.json"),
    read("packages/shared/src/api-contracts.ts"),
    read("apps/desktop-qt/src/NativeCapabilityBroker.cpp"),
    read("apps/desktop-qt/src/DesktopIntegration.cpp"),
    read("packages/renderer/src/features/notifications/desktop-notification-sync.ts"),
    read("packages/renderer/src/features/application/modules/application-shell.tsx"),
    read("RELEASE_NOTES_v0.422.0.md"),
    read("docs/DESKTOP_NATIVE_NOTIFICATIONS.md"),
    read("package.json"),
  ]);

  assert.equal(JSON.parse(versionsText).cluster, "0.422.0");
  assert.ok(contracts.includes('version: "2026-08-02.62"'));
  assert.ok(contracts.includes('"desktop-native-notifications-v1"'));
  assert.ok(broker.includes('QStringLiteral("notification.status")'));
  assert.ok(broker.includes("m_seenNotificationTags.contains(tag)"));
  assert.ok(broker.includes('QStringLiteral("suppressed"), QStringLiteral("app-active")'));
  assert.ok(integration.includes("QSystemTrayIcon::Critical"));
  assert.ok(!integration.includes("new workspace update"));
  assert.ok(sync.includes("POLL_INTERVAL_MS = 30_000"));
  assert.ok(sync.includes("MAX_SEEN_IDS = 256"));
  assert.ok(sync.includes("desktopNotificationRoute(top)"));
  assert.ok(shell.includes("useDesktopNotificationSync"));
  assert.ok(notes.includes("Phase 4 continues"));
  assert.ok(doc.includes("HttpOnly"));
  assert.ok(String(JSON.parse(pkgText).scripts?.audit || "").includes("desktop-native-notifications-audit.mjs"));
});

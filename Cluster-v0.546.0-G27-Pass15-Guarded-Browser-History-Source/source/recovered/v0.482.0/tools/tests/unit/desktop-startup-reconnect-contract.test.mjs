import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("v0.398 desktop startup and reconnect recovery contract", async () => {
  const [versionsText, contracts, controller, renderer, notes, doc, pkgText] = await Promise.all([
    read("config/toolchain-versions.json"),
    read("packages/shared/src/api-contracts.ts"),
    read("apps/desktop-qt/src/AppController.cpp"),
    read("apps/desktop-qt/qml/pages/SharedRendererPage.qml"),
    read("RELEASE_NOTES_v0.398.0.md"),
    read("docs/DESKTOP_STARTUP_RECONNECT.md"),
    read("package.json"),
  ]);

  assert.equal(JSON.parse(versionsText).cluster, "0.422.0");
  assert.ok(contracts.includes('version: "2026-08-02.62"'));
  assert.ok(contracts.includes('"desktop-startup-recovery-v1"'));
  assert.ok(controller.includes("m_reconnectTimer->setSingleShot(true)"));
  assert.ok(controller.includes("ReconnectMaximumDelayMs = 60'000"));
  assert.ok(controller.includes('QStringLiteral("reconnectCompatibility")'));
  assert.ok(controller.includes("emit connectionRecovered()"));
  assert.ok(renderer.includes("Your workspace and route are preserved"));
  assert.ok(renderer.includes("function onConnectionRecovered()"));
  assert.ok(notes.includes("Phase 4 continues"));
  assert.ok(doc.includes("Compatibility before replay"));
  assert.ok(String(JSON.parse(pkgText).scripts?.audit || "").includes("desktop-startup-reconnect-audit.mjs"));
});

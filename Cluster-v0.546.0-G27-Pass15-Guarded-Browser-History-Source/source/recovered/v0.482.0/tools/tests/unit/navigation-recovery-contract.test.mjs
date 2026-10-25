import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (relative) => readFile(new URL(`../../../${relative}`, import.meta.url), "utf8");

test("v0.395 begins Phase 3 with durable navigation recovery", async () => {
  const [versionsText, contracts, navigation, app, desktop, desktopTypes, qml, controller, profileStore, notes, doc, packageText, packager] = await Promise.all([
    read("config/toolchain-versions.json"),
    read("packages/shared/src/api-contracts.ts"),
    read("packages/renderer/src/core/navigation.ts"),
    read("packages/renderer/src/features/application/ClusterApplication.tsx"),
    read("packages/renderer/src/core/desktop.ts"),
    read("packages/renderer/src/core/desktop-types.ts"),
    read("apps/desktop-qt/qml/pages/SharedRendererPage.qml"),
    read("apps/desktop-qt/src/AppController.cpp"),
    read("apps/desktop-qt/src/ServerProfileStore.cpp"),
    read("RELEASE_NOTES_v0.395.0.md"),
    read("docs/NAVIGATION_SESSION_RECOVERY.md"),
    read("package.json"),
    read("tools/scripts/package-cluster-master.mjs"),
  ]);
  assert.equal(JSON.parse(versionsText).cluster, "0.422.0");
  assert.ok(contracts.includes('version: "2026-08-02.62"') && contracts.includes('"navigation-recovery-v1"'));
  assert.ok(navigation.includes("parseNavigationRoute") && navigation.includes("serializeNavigationRoute") && navigation.includes("resolveInitialNavigation"));
  assert.ok(navigation.includes('`project/${encoded(state.projectId)}`') && navigation.includes('`board/${encoded(state.projectId)}/${encoded(state.boardId)}`'));
  assert.ok(app.includes('addEventListener("popstate"') && app.includes('addEventListener("hashchange"'));
  assert.ok(app.includes("explicitNavigationRef.current") && app.includes("writeNavigationSession"));
  assert.ok(desktop.includes("parseNavigationRoute(route)") && desktopTypes.includes("activeRoute?: string"));
  assert.ok(qml.includes("activeLastRoute") && controller.includes("activeRoute.isEmpty()") && profileStore.includes("MaximumRouteLength = 420"));
  assert.ok(notes.includes("navigation-recovery-v1") && doc.includes("Release-blocking boundary"));
  assert.ok(JSON.parse(packageText).scripts.audit.includes("navigation-recovery-audit.mjs"));
  assert.ok(packager.includes("navigation-recovery-audit.mjs") && packager.includes("docs/NAVIGATION_SESSION_RECOVERY.md"));
});

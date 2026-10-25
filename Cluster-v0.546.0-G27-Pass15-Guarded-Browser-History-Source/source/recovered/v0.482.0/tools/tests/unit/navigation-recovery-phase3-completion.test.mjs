import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (relative) => readFile(new URL(`../../../${relative}`, import.meta.url), "utf8");

test("v0.396 completes Phase 3 navigation and session recovery", async () => {
  const [versionsText, contracts, navigation, app, auth, desktop, qml, integration, notes, doc, packageText, packager] = await Promise.all([
    read("config/toolchain-versions.json"),
    read("packages/shared/src/api-contracts.ts"),
    read("packages/renderer/src/core/navigation.ts"),
    read("packages/renderer/src/features/application/ClusterApplication.tsx"),
    read("packages/renderer/src/features/auth/AuthScreens.tsx"),
    read("packages/renderer/src/core/desktop.ts"),
    read("apps/desktop-qt/qml/pages/SharedRendererPage.qml"),
    read("apps/desktop-qt/src/DesktopIntegration.cpp"),
    read("RELEASE_NOTES_v0.396.0.md"),
    read("docs/NAVIGATION_SESSION_RECOVERY.md"),
    read("package.json"),
    read("tools/scripts/package-cluster-master.mjs"),
  ]);

  assert.equal(JSON.parse(versionsText).cluster, "0.422.0");
  assert.ok(contracts.includes('version: "2026-08-02.62"'));
  assert.ok(contracts.includes('"navigation-recovery-v1"') && contracts.includes('"navigation-recovery-v2"'));
  assert.ok(navigation.includes("navigationParentState") && navigation.includes('createNavigationState("project"'));
  assert.ok(app.includes("contextual-navigation-v396") && app.includes("openContextualParent"));
  assert.ok(app.includes("clearAuthenticatedUiState({ preserveNavigation: true })") && auth.includes("recoveryMessage"));
  assert.ok(app.includes("navigation-connectivity-v396") && app.includes("previousServerReachableRef"));
  assert.ok(app.includes('title: "Project unavailable"') && app.includes('title: "Board unavailable"') && app.includes('title: "Whiteboard unavailable"'));
  assert.ok(desktop.includes("parseNavigationRoute(route)") && qml.includes("activeLastRoute"));
  assert.ok(integration.includes("Qt::BackButton") && integration.includes("Qt::ForwardButton"));
  assert.ok(notes.includes("Phase 3 navigation and session recovery is complete") && doc.includes("Web/Desktop scenario boundary"));
  assert.ok(JSON.parse(packageText).scripts.audit.includes("navigation-recovery-audit.mjs"));
  assert.ok(packager.includes("navigation-recovery-audit.mjs") && packager.includes("docs/NAVIGATION_SESSION_RECOVERY.md"));
});

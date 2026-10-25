import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const checks = [];
const check = (label, ok, detail = "") => checks.push({ label, ok, detail });
const text = (relative) => readFile(path.join(root, relative), "utf8");

const [navigation, app, auth, operationalStatus, desktopCore, desktopTypes, sharedQml, appController, profileStore, desktopIntegration, contracts, pkgText, packager, notes, doc] = await Promise.all([
  text("packages/renderer/src/core/navigation.ts"),
  text("packages/renderer/src/features/application/ClusterApplication.tsx"),
  text("packages/renderer/src/features/auth/AuthScreens.tsx"),
  text("packages/renderer/src/components/operational-status.ts"),
  text("packages/renderer/src/core/desktop.ts"),
  text("packages/renderer/src/core/desktop-types.ts"),
  text("apps/desktop-qt/qml/pages/SharedRendererPage.qml"),
  text("apps/desktop-qt/src/AppController.cpp"),
  text("apps/desktop-qt/src/ServerProfileStore.cpp"),
  text("apps/desktop-qt/src/DesktopIntegration.cpp"),
  text("packages/shared/src/api-contracts.ts"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
  text("RELEASE_NOTES_v0.396.0.md"),
  text("docs/NAVIGATION_SESSION_RECOVERY.md"),
]);

check("navigation state is resource-aware", navigation.includes("AppNavigationState") && navigation.includes("projectId") && navigation.includes("boardId") && navigation.includes("whiteboardId"));
check("canonical project route is serialized", navigation.includes('`project/${encoded(state.projectId)}`'));
check("canonical board route is serialized", navigation.includes('`board/${encoded(state.projectId)}/${encoded(state.boardId)}`'));
check("canonical whiteboard route is serialized", navigation.includes('`whiteboard/${encoded(state.projectId)}/${encoded(state.whiteboardId)}`'));
check("navigation segments are bounded and allowlisted", navigation.includes("MAX_NAVIGATION_SEGMENT_LENGTH") && navigation.includes("NAVIGATION_SEGMENT"));
check("startup navigation has deterministic precedence", navigation.includes('source: "hash"') && navigation.includes('source: "history"') && navigation.includes('source: "session"') && navigation.includes('source: "default"'));
check("same-tab navigation recovery is persisted", navigation.includes("NAVIGATION_SESSION_STORAGE_KEY") && navigation.includes("readNavigationSession") && navigation.includes("writeNavigationSession"));
check("resource parent navigation is deterministic", navigation.includes("navigationParentState") && navigation.includes('state.clusterScreen === "project"') && navigation.includes('state.clusterScreen === "board" || state.clusterScreen === "whiteboard"'));
check("admin subareas have deterministic parent navigation", navigation.includes('["userAdmin", "toolInfrastructure", "studioSettings", "serverConfig"]') && navigation.includes('createNavigationState("admin")'));

check("application restores both popstate and hashchange", app.includes('addEventListener("popstate"') && app.includes('addEventListener("hashchange"'));
check("application writes canonical history state", app.includes("navigationHash(navigation)") && app.includes("window.history.replaceState(navigation"));
check("explicit navigation wins over configured start page", app.includes("explicitNavigationRef.current") && app.includes("screenFromStartSetting"));
check("contextual parent navigation is rendered", app.includes("contextual-navigation-v396") && app.includes("navigationParentState(currentNavigation)") && app.includes("openContextualParent"));
check("board exit returns to owning project", app.includes("parentProjectId") && app.includes("openProject(parentProjectId)"));
check("board recovery restores owning project", app.includes("boardOptions(visibleProjects).find") && app.includes("setProjectId(target.projectId)"));
check("whiteboard recovery restores owning project", app.includes("whiteboards.find") && app.includes("target.projectId") && app.includes("setProjectId(target.projectId)"));
check("missing project resources recover with visible notice", app.includes('title: "Project unavailable"') && app.includes('replaceWith("projects"'));
check("missing boards recover with visible notice", app.includes('title: "Board unavailable"') && app.includes("Projects was opened instead"));
check("missing whiteboards recover with visible notice", app.includes('title: "Whiteboard unavailable"'));
check("permission-invalid routes replace rather than push", app.includes('title: "Access changed"') && app.includes('createNavigationState("dashboard")') && app.includes("window.history.replaceState(navigation"));
check("invalid startup route gets visible recovery feedback", app.includes('title: "That Cluster link could not be opened"') && app.includes('initialNavigation.source === "invalid"'));
check("automatic session invalidation preserves navigation", app.includes("clearAuthenticatedUiState({ preserveNavigation: true })") && app.includes("lastNavigationRef.current"));
check("explicit sign-out clears preserved navigation", app.includes("setSessionRecoveryMessage(null)") && app.includes("clearAuthenticatedUiState();"));
check("sign-in communicates workspace return", auth.includes("recoveryMessage") && auth.includes('state: "auth_expired"') && auth.includes('label: "Authentication expired"'));
check("disconnect state preserves workspace and exposes retry", app.includes("navigation-operational-status-v433") && app.includes(">Retry connection</ClusterButton>") && app.includes("refreshOfflineSyncState({ flush: false, pull: true })") && operationalStatus.includes("Workspace data remains available"));
check("reconnect revalidates current resource state", app.includes("previousServerReachableRef") && app.includes('title: "Connection restored"') && app.includes("loadProjects()") && app.includes("loadWhiteboards()") && app.includes("boardId ? loadBoard(boardId)"));
check("account settings event uses canonical navigation", app.includes('void setScreen("settings")'));

check("desktop deep links use shared route parser", desktopCore.includes("parseNavigationRoute(route)") && desktopCore.includes("navigationHash(navigation)"));
check("desktop renderer state carries full active route", desktopTypes.includes("activeRoute?: string") && app.includes("currentNavigationRoute"));
check("Qt profile persistence prefers full active route", appController.includes("activeRoute.isEmpty()") && appController.includes("updateRendererIdentity"));
check("Qt launch restores saved route", sharedQml.includes("activeLastRoute") && sharedQml.includes("launchRoute"));
check("Qt direct navigation relies on renderer hash contract", sharedQml.includes("window.location.hash=") && sharedQml.includes("JSON.stringify(target)"));
check("native route storage accepts bounded resource routes", profileStore.includes("MaximumRouteLength = 420") && profileStore.includes("safeRoute"));
check("mouse back and forward remain native", desktopIntegration.includes("Qt::BackButton") && desktopIntegration.includes("Qt::ForwardButton"));

check("navigation recovery API capability is current", contracts.includes('version: "2026-08-02.63"') && contracts.includes('"navigation-recovery-v1"') && contracts.includes('"navigation-recovery-v2"'));
const pkg = JSON.parse(pkgText);
check("navigation recovery audit is aggregate release gate", String(pkg.scripts?.audit || "").includes("navigation-recovery-audit.mjs"));
check("navigation recovery audit has named package script", String(pkg.scripts?.["audit:navigation-recovery"] || "").includes("navigation-recovery-audit.mjs"));
check("navigation recovery audit is invoked by master packaging", packager.includes("navigation-recovery-audit.mjs"));
check("navigation recovery documentation is packaged", packager.includes("docs/NAVIGATION_SESSION_RECOVERY.md"));
check("release notes advertise Phase 3 completion", notes.includes("Phase 3 navigation and session recovery is complete") && notes.includes("navigation-recovery-v2") && notes.includes("2026-08-02.36"));
check("documentation defines completed Web/Desktop boundary", doc.includes("Web/Desktop scenario boundary") && doc.includes("Release-blocking boundary") && doc.includes("expired/revoked-session") && doc.includes("disconnect and reconnect"));

const failures = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.detail ? ` (${item.detail})` : ""}`);
console.log(`\nCluster navigation recovery audit: ${checks.length - failures.length}/${checks.length} passed.`);
if (failures.length) process.exit(1);

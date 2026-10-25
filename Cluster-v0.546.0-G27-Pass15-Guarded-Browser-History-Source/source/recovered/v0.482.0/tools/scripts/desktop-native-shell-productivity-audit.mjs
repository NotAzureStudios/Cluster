import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const checks = [];
const check = (label, ok) => checks.push({ label, ok });
const text = (relative) => readFile(path.join(root, relative), "utf8");

const [broker, brokerHeader, profiles, profilesHeader, controller, integration, integrationHeader, desktop, contracts, pkgText, packager, notes, doc, accessPanel, closeoutPanel, adminPanel] = await Promise.all([
  text("apps/desktop-qt/src/NativeCapabilityBroker.cpp"),
  text("apps/desktop-qt/src/NativeCapabilityBroker.h"),
  text("apps/desktop-qt/src/ServerProfileStore.cpp"),
  text("apps/desktop-qt/src/ServerProfileStore.h"),
  text("apps/desktop-qt/src/AppController.cpp"),
  text("apps/desktop-qt/src/DesktopIntegration.cpp"),
  text("apps/desktop-qt/src/DesktopIntegration.h"),
  text("packages/renderer/src/core/desktop.ts"),
  text("packages/shared/src/api-contracts.ts"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
  text("RELEASE_NOTES_v0.422.0.md"),
  text("docs/DESKTOP_NATIVE_SHELL_PRODUCTIVITY.md"),
  text("packages/renderer/src/features/projects/ProjectAccessPanel.tsx"),
  text("packages/renderer/src/features/projects/CloseoutPortalPanel.tsx"),
  text("packages/renderer/src/features/admin/AdminWorkspacePage.tsx"),
]);

check("native broker advertises clipboard status", broker.includes('QStringLiteral("clipboard.status")'));
check("native broker retains bounded clipboard writer", broker.includes('QStringLiteral("clipboard.writeText")') && broker.includes("MaxClipboardText = 4096"));
check("clipboard status advertises confirmed read semantics", broker.includes('QStringLiteral("writeOnly"), false') && broker.includes('QStringLiteral("readRequiresConfirmation"), true'));
check("native broker clipboard read is explicit and non-passive", broker.includes('QStringLiteral("clipboard.readText")') && broker.includes("QMessageBox::No") && broker.includes('QStringLiteral("backgroundRead"), false'));
check("clipboard payload is not written to native audit", broker.includes("writeAudit") && !broker.match(/writeAudit\([^\n]{0,180}clipboard[^\n]{0,180}text/i));
check("renderer exposes native clipboard status", desktop.includes("getNativeClipboardStatus"));
check("renderer centralizes cross-runtime copy", desktop.includes("export async function copyClusterText") && desktop.includes("writeNativeClipboardText(value)") && desktop.includes("navigator.clipboard.writeText(value)"));
check("Project Access uses shared clipboard helper", accessPanel.includes("copyClusterText(") && !accessPanel.includes("navigator.clipboard.writeText"));
check("Closeout Portal uses shared clipboard helper", closeoutPanel.includes("copyClusterText(") && !closeoutPanel.includes("navigator.clipboard.writeText"));
check("Admin temporary password copy uses shared clipboard helper", adminPanel.includes("copyClusterText(") && !adminPanel.includes("navigator.clipboard.writeText"));

check("recent workspace store is profile scoped", profiles.includes('recentWorkspacesPath(activeNativeDataPath') || (profiles.includes("activeNativeDataPath()") && profiles.includes('recent-workspaces.json')));
check("recent workspace registry is bounded", profiles.includes("MaximumRecentWorkspaces = 12"));
check("recent workspace title is bounded", profiles.includes("MaximumRecentTitleLength = 120"));
check("recent routes reuse canonical route sanitizer", profiles.includes("safeRoute(routeValue)"));
check("recent kinds are allowlisted", profiles.includes('kind != QStringLiteral("project")') && profiles.includes('kind != QStringLiteral("board")') && profiles.includes('kind != QStringLiteral("whiteboard")'));
check("recent persistence avoids polling write churn", profiles.includes("existing.first().isObject()") && profiles.includes("return;") && profiles.includes("writeRecentWorkspaceArray"));
check("recent records contain no filesystem path field", !profiles.match(/recentWorkspaces[\s\S]{0,5000}QStringLiteral\("path"\)/));
check("server profile API exposes recent workspaces", profilesHeader.includes("recentWorkspaces() const") && profilesHeader.includes("recordRecentWorkspace") && profilesHeader.includes("clearRecentWorkspaces"));
check("recent workspace changes are observable", profilesHeader.includes("recentWorkspacesChanged"));
check("renderer state records active project routes natively", controller.includes("recordRecentWorkspace(activeRoute, projectName, kind, projectId)"));
check("board and whiteboard recents retain canonical routes", controller.includes('activeRoute.startsWith(QStringLiteral("board/"))') && controller.includes('activeRoute.startsWith(QStringLiteral("whiteboard/"))'));

check("native tray owns recent-workspaces menu", integration.includes('addMenu(QStringLiteral("Recent workspaces"))') && integrationHeader.includes("m_recentMenu"));
check("tray recent list is capped at eight", integration.includes("if (count++ >= 8) break"));
check("tray recents use shared renderer navigation", integration.includes('invokeMethod(m_window, "navigateSharedRenderer"'));
check("tray supports explicit profile-local recent clearing", integration.includes('QStringLiteral("Clear recent workspaces")') && integration.includes("clearRecentWorkspaces()"));
check("tray refreshes recents on profile switch", integration.includes("rebuildRecentMenu();") && integration.includes("activeProfileChanged"));
check("profile lifecycle still deletes native container", profiles.includes("removeProfileData") && profiles.includes("nativeProfilePath(profileId)"));

check("shell productivity capability is current", contracts.includes('version: "2026-08-02.63"') && contracts.includes('"desktop-native-shell-productivity-v1"'));
const pkg = JSON.parse(pkgText);
check("shell productivity audit is aggregate release gate", String(pkg.scripts?.audit || "").includes("desktop-native-shell-productivity-audit.mjs"));
check("shell productivity audit has named package script", String(pkg.scripts?.["audit:desktop-native-shell-productivity"] || "").includes("desktop-native-shell-productivity-audit.mjs"));
check("shell productivity audit is invoked by master packaging", packager.includes("desktop-native-shell-productivity-audit.mjs"));
check("shell productivity documentation is packaged", packager.includes("docs/DESKTOP_NATIVE_SHELL_PRODUCTIVITY.md"));
check("release notes identify Phase 4.8 and 4.9", notes.includes("4.8") && notes.includes("4.9") && notes.includes("desktop-native-shell-productivity-v1"));
check("documentation defines clipboard and profile trust boundaries", doc.includes("one-shot, native-confirmed plain-text read") && doc.includes("Profiles/<server-profile>/recent-workspaces.json") && doc.includes("Release-blocking boundary"));

const failures = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}`);
console.log(`\nCluster desktop-native shell productivity audit: ${checks.length - failures.length}/${checks.length} passed.`);
if (failures.length) process.exit(1);

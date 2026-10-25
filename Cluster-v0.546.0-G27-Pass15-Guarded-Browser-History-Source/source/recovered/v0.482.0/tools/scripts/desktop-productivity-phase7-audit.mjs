import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const text = (relative) => readFile(path.join(root, relative), "utf8");
let passed = 0;
let total = 0;
function check(label, ok) {
  total += 1;
  if (!ok) { console.error(`FAIL  ${label}`); process.exitCode = 1; return; }
  passed += 1;
  console.log(`PASS  ${label}`);
}

const [broker, profiles, profilesHeader, controller, sharedRenderer, mainQml, integration, desktop, desktopTypes, palette, appShell, application, masterDetail, docs, notes, pkgText, packager, contracts] = await Promise.all([
  text("apps/desktop-qt/src/NativeCapabilityBroker.cpp"),
  text("apps/desktop-qt/src/ServerProfileStore.cpp"),
  text("apps/desktop-qt/src/ServerProfileStore.h"),
  text("apps/desktop-qt/src/AppController.cpp"),
  text("apps/desktop-qt/qml/pages/SharedRendererPage.qml"),
  text("apps/desktop-qt/qml/Main.qml"),
  text("apps/desktop-qt/src/DesktopIntegration.cpp"),
  text("packages/renderer/src/core/desktop.ts"),
  text("packages/renderer/src/core/desktop-types.ts"),
  text("packages/renderer/src/features/search/CommandPalette.tsx"),
  text("packages/renderer/src/features/application/modules/application-shell.tsx"),
  text("packages/renderer/src/features/application/ClusterApplication.tsx"),
  text("packages/renderer/src/components/ClusterMasterDetail.tsx"),
  text("docs/DESKTOP_PRODUCTIVITY_PHASE7.md"),
  text("RELEASE_NOTES_v0.430.0.md"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
  text("packages/shared/src/api-contracts.ts"),
]);

check("native broker advertises recent workspaces", broker.includes('QStringLiteral("workspace.recent")'));
check("recent-workspace payload accepts no fields", broker.includes('{QStringLiteral("workspace.recent"), {}}'));
check("recent-workspace response is profile sourced and capped", broker.includes("serverProfiles()->recentWorkspaces().mid(0, 8)"));
check("runtime info advertises native recents", broker.includes('{QStringLiteral("nativeRecentWorkspaces"), true}'));
check("desktop advantages advertise recents and native commands", broker.includes('QStringLiteral("profile-scoped-recent-workspaces")') && broker.includes('QStringLiteral("native-command-shortcuts")'));

check("renderer capability union includes workspace.recent", desktop.includes('| "workspace.recent"'));
check("renderer runtime contract exposes native recents", desktop.includes("nativeRecentWorkspaces: true"));
check("renderer exposes bounded recent-workspace helper", desktop.includes("export async function getNativeRecentWorkspaces()") && desktop.includes('requestNativeCapability<ClusterNativeRecentWorkspace[]>("workspace.recent")'));
check("renderer exposes native reload helper", desktop.includes("export async function reloadNativeRenderer()") && desktop.includes('requestNativeCapability("window.reload")'));
check("recent workspace type contains canonical route metadata", desktop.includes("export type ClusterNativeRecentWorkspace") && desktop.includes('kind: "project" | "board" | "whiteboard"'));

check("command palette fetches desktop recents only for desktop", palette.includes("if (!open || !desktopHost)") && palette.includes("getNativeRecentWorkspaces()"));
check("command palette caps recent entries to eight", palette.includes("items.slice(0, 8)"));
check("command palette validates native recent routes", palette.includes("parseNavigationRoute(route)") && palette.includes("if (!navigation) return"));
check("recent navigation clears stale inspector state", palette.includes('current.searchParams.delete("inspect")'));
check("command palette exposes native app settings", palette.includes('key: "desktop-app-settings"') && palette.includes("openNativeAppSettings"));
check("command palette exposes native server profiles", palette.includes('key: "desktop-server-profiles"') && palette.includes("openNativeServerProfiles"));
check("command palette exposes native renderer reload", palette.includes('key: "desktop-reload"') && palette.includes("reloadNativeRenderer"));
check("command palette includes desktop recent workspaces", palette.includes("desktopRecentItems") && palette.includes("Recent ${item.kind} · Desktop"));

check("profile store exposes active inspector", profilesHeader.includes("activeLastInspector") && profiles.includes("ServerProfileStore::activeLastInspector"));
check("inspector persistence is bounded", profiles.includes("MaximumInspectorLength = 220"));
check("inspector persistence is allowlisted", profiles.includes('QRegularExpression pattern(QStringLiteral("^[A-Za-z0-9_-]{1,40}:[A-Za-z0-9._:-]{1,160}$"))'));
check("renderer identity persists sanitized inspector", profiles.includes("const QString nextInspector = safeInspector(inspector)") && profiles.includes("profile.lastInspector"));
check("sign out clears saved inspector", profiles.includes("m_profiles[index].lastInspector.clear()"));
check("controller accepts only renderer activeInspector field", controller.includes('object.value(QStringLiteral("activeInspector")).toString()'));
check("renderer desktop state publishes bounded inspector", appShell.includes('searchParams.get("inspect")?.slice(0, 220)'));
check("renderer desktop state refreshes on inspector changes", appShell.includes('addEventListener("cluster:inspector-state-changed"') && appShell.includes('addEventListener("popstate"'));
check("master detail emits inspector-state changes", masterDetail.includes('new CustomEvent("cluster:inspector-state-changed"'));
check("desktop renderer state type includes inspector", desktopTypes.includes("activeInspector?: string"));
check("shared renderer restores route and inspector", sharedRenderer.includes("activeLastRoute") && sharedRenderer.includes("activeLastInspector"));
check("shared renderer encodes restored inspector", sharedRenderer.includes('"&inspect=" + encodeURIComponent(launchInspector)'));

check("native shell command bridge has a fixed allowlist", sharedRenderer.includes('const allowed = ["command-palette", "quick-create", "shortcut-help"]'));
check("native shell command bridge verifies renderer origin", sharedRenderer.includes("isAllowedRendererUrl") && sharedRenderer.includes("dispatchShellCommand"));
check("native shell command bridge does not expose arbitrary evaluate helper", !sharedRenderer.includes("dispatchShellCommand(command, script") && !sharedRenderer.includes("shell.execute"));
check("Ctrl+K opens command palette through native shell", mainQml.includes('sequence: "Ctrl+K"') && mainQml.includes('dispatchSharedRendererCommand("command-palette")'));
check("Ctrl+Shift+N opens quick create through native shell", mainQml.includes('sequence: "Ctrl+Shift+N"') && mainQml.includes('dispatchSharedRendererCommand("quick-create")'));
check("Ctrl+/ opens shortcut help through native shell", mainQml.includes('sequence: "Ctrl+/"') && mainQml.includes('dispatchSharedRendererCommand("shortcut-help")'));
check("tray exposes Search / Commands", integration.includes('QStringLiteral("Search / Commands…")') && integration.includes('QStringLiteral("command-palette")'));
check("tray exposes Quick create", integration.includes('QStringLiteral("Quick create…")') && integration.includes('QStringLiteral("quick-create")'));
check("renderer consumes allowlisted native commands", application.includes('addEventListener("cluster-native-command"') && application.includes('command === "command-palette"') && application.includes('command === "quick-create"') && application.includes('command === "shortcut-help"'));
check("shortcut help documents desktop quick create", application.includes("Quick create from the native shell") && application.includes("Ctrl+Shift+N"));
check("shortcut help documents desktop reload and server profiles", application.includes("Reload the desktop workspace") && application.includes("Manage desktop server profiles"));

check("later clipboard read keeps the Phase 7 native boundary narrow", broker.includes("clipboard.readText") && desktop.includes("clipboard.readText") && broker.includes('QStringLiteral("readRequiresConfirmation"), true') && broker.includes('QStringLiteral("backgroundRead"), false'));
check("Phase 7 does not add generic shell/process capability", !broker.includes("shell.execute") && !broker.includes("process.execute") && !desktop.includes('"shell.execute"') && !desktop.includes('"process.execute"'));
check("Phase 7 documentation records trust boundaries", docs.includes("does **not** add") && docs.includes("generic shell or process execution") && docs.includes("clipboard-read capability") && docs.includes("raw filesystem path APIs"));
check("Phase 7 documentation defines release-blocking boundary", docs.includes("## Release-blocking boundary") && docs.includes("desktop-productivity-phase7-audit.mjs"));
check("Phase 7 release notes identify capability", notes.includes("desktop-productivity-phase7-v1") && notes.includes("API contract: unchanged from `2026-08-02.62`"));
check("server API contract remains unchanged", contracts.includes('version: "2026-08-02.63"'));

const pkg = JSON.parse(pkgText);
check("aggregate audit includes Phase 7 gate", String(pkg.scripts?.audit || "").includes("desktop-productivity-phase7-audit.mjs"));
check("named Phase 7 audit exists", String(pkg.scripts?.["audit:desktop-productivity-phase7"] || "").includes("desktop-productivity-phase7-audit.mjs"));
check("master packager invokes Phase 7 gate", packager.includes("desktop-productivity-phase7-audit.mjs"));
const packagedDocOccurrences = packager.split("docs/DESKTOP_PRODUCTIVITY_PHASE7.md").length - 1;
check("master and source packages carry Phase 7 docs", packagedDocOccurrences >= 2);

console.log(`\nDesktop productivity Phase 7 audit: ${passed}/${total} passed.`);
if (passed !== total) process.exitCode = 1;

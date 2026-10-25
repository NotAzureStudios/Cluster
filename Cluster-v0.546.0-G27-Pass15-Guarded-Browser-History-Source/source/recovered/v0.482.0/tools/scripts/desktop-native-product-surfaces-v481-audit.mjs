import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const checks = [];
const check = (label, ok, detail = "") => checks.push({ label, ok, detail });
const text = (relative) => readFile(path.join(root, relative), "utf8");
const exists = async (relative) => { try { await access(path.join(root, relative)); return true; } catch { return false; } };

const [pkgText, versionsText, cmake, broker, mountManager, desktopCore, workspace, clipboard, nativePanel, shell, app, models, userPrefs, serverSettings, adminRoutes, adminUi, settingsPage, changelog, readme, doc, status, notes, packager] = await Promise.all([
  text("package.json"), text("config/toolchain-versions.json"), text("apps/desktop-qt/CMakeLists.txt"),
  text("apps/desktop-qt/src/NativeCapabilityBroker.cpp"), text("apps/desktop-qt/src/LibraryMountManager.cpp"), text("packages/renderer/src/core/desktop.ts"),
  text("packages/renderer/src/features/desktop/DesktopWorkspacePage.tsx"), text("packages/renderer/src/features/desktop/DesktopClipboardWidget.tsx"),
  text("packages/renderer/src/features/desktop/DesktopNativeServicesPanel.tsx"), text("packages/renderer/src/features/application/modules/application-shell.tsx"),
  text("packages/renderer/src/features/application/ClusterApplication.tsx"), text("packages/renderer/src/features/application/application-models.ts"),
  text("apps/server/src/domains/users/user-preference-routes.ts"), text("apps/server/src/app/server-routes-configuration-integrations.ts"),
  text("apps/server/src/domains/admin/admin-tool-routes.ts"), text("packages/renderer/src/features/admin/AdminToolControls.tsx"),
  text("packages/renderer/src/features/settings/AccountSettingsPage.tsx"), text("packages/renderer/src/features/changelog/data/cluster-changelog.ts"),
  text("apps/desktop-qt/README.md"), text("docs/DESKTOP_NATIVE_PRODUCT_SURFACES_V481.md"), text("docs/DESKTOP_NATIVE_FEATURE_STATUS_V481.md"),
  text("RELEASE_NOTES_v0.481.0.md"), text("tools/scripts/package-cluster-master.mjs"),
]);
const pkg = JSON.parse(pkgText);
const versions = JSON.parse(versionsText);
const versionParts = String(pkg.version || "0.0.0").split(".").map((part) => Number.parseInt(part, 10) || 0);
const atLeast481 = versionParts[0] > 0 || versionParts[1] > 481 || (versionParts[1] === 481 && versionParts[2] >= 0);

check("v0.481 product baseline is retained", atLeast481 && versions.cluster === pkg.version);
check("desktop CMake version tracks the release", cmake.includes(`project(ClusterDesktop VERSION ${pkg.version}`));

check("clipboard read is allowlisted natively and in renderer", broker.includes('QStringLiteral("clipboard.readText")') && desktopCore.includes('"clipboard.readText"'));
check("clipboard read requires a native confirmation", broker.includes("QMessageBox") && broker.includes("Allow clipboard access?") && broker.includes("QMessageBox::No"));
check("clipboard read remains bounded plain text", broker.includes("MaxClipboardText = 4096") && broker.includes('QStringLiteral("plainTextOnly")') && broker.includes('QStringLiteral("backgroundRead"), false'));
check("renderer has no clipboard change subscription", !desktopCore.includes("clipboard.changed") && !broker.includes('QStringLiteral("clipboard.changed")'));
check("Home clipboard widget is manual and editable", clipboard.includes("Read clipboard") && clipboard.includes("textarea") && clipboard.includes("Copy back") && clipboard.includes("Search"));
check("Home shell actually renders clipboard widget", shell.includes("DesktopClipboardWidget") && shell.includes("<DesktopClipboardWidget"));

check("Desktop is a first-class screen", app.includes('screen === "desktop"') && shell.includes('navigate("desktop")'));
check("Desktop native services are not duplicated in Account Settings", !settingsPage.includes("DesktopNativeServicesPanel"));
check("Desktop workspace owns native services", workspace.includes("DesktopNativeServicesPanel") && workspace.includes("Mounted Libraries"));

check("native local preview is allowlisted", broker.includes('QStringLiteral("file.preview")') && desktopCore.includes('"file.preview"'));
check("local preview accepts opaque handles", broker.includes('capability == QStringLiteral("file.preview")') && broker.includes("resolveHandle(handle)"));
check("local preview never returns the canonical path", !/file\.preview[\s\S]{0,4200}QStringLiteral\("path"\)/.test(broker));
check("local preview caps text payload", broker.includes("MaxNativePreviewBytes = 8 * 1024") && broker.includes('QStringLiteral("truncated")'));
check("native services expose local preview action", nativePanel.includes("previewNativeHandle") && nativePanel.includes("Preview") && nativePanel.includes("8 KB"));

check("legacy native search index is retired", !(await exists("apps/desktop-qt/src/LocalSearchIndex.cpp")) && !(await exists("apps/desktop-qt/src/LocalSearchIndex.h")) && !cmake.includes("LocalSearchIndex"));
check("legacy native preview manager is retired", !(await exists("apps/desktop-qt/src/FilePreviewManager.cpp")) && !(await exists("apps/desktop-qt/src/FilePreviewManager.h")) && !cmake.includes("FilePreviewManager"));

for (const field of ["desktopLibraryMountEnabled", "desktopLibraryMountLayout", "desktopLibraryMountOrganization", "desktopLibraryMountLocation"]) {
  check(`user mount preference ${field} exists`, models.includes(field) && userPrefs.includes(field));
}
for (const field of ["libraryDesktopMountPolicy", "libraryDesktopMountIsolation", "libraryCrossServerTransferPolicy", "libraryDesktopMountReadOnly"]) {
  check(`server mount policy ${field} exists`, models.includes(field) && serverSettings.includes(field) && adminRoutes.includes(field));
}
check("admin UI exposes mount policy and isolation", adminUi.includes("Desktop mount policy") && adminUi.includes("Mount isolation") && adminUi.includes("Cross-server moves") && adminUi.includes("Mounted Libraries read only"));
check("unified mount is the user default", workspace.includes('desktopLibraryMountLayout: "unified"') && workspace.includes('desktopLibraryMountOrganization: "servers"'));
check("server isolation can force separate mounts", workspace.includes('isolation === "dedicated" || isolation === "exclusive"') && workspace.includes("forcedSeparate"));
check("disabled server policy prevents local enablement", workspace.includes('mountPolicy === "disabled"') && workspace.includes("desktopLibraryMountEnabled: mountPolicy"));

check("Windows uses Drive terminology", workspace.includes('"Cluster Drive"') && workspace.includes('"Drive letter"') && (broker.includes('QStringLiteral("WinFsp")') || mountManager.includes('QStringLiteral("WinFsp FUSE3")')));
check("macOS uses Volume terminology", workspace.includes('"Cluster Volume"') && workspace.includes('"Volume name"') && (broker.includes('QStringLiteral("macFUSE")') || mountManager.includes('QStringLiteral("macFUSE FUSE3")')));
check("Linux uses Mount terminology", workspace.includes('"Cluster Mount"') && workspace.includes('"Mount location"') && (broker.includes('QStringLiteral("FUSE")') || mountManager.includes('QStringLiteral("FUSE3")')));
check("mount readiness remains honest as implementation evolves", workspace.includes("!mountStatus?.engineReady") && (broker.includes('QStringLiteral("engineReady"), false') || (mountManager.includes("providerDetected()") && mountManager.includes("adapterBuilt") && mountManager.includes("engineReady"))));

check("v0.481 docs define the security and mount boundary", doc.includes("User-confirmed clipboard reading") && doc.includes("Mounted Libraries foundation") && doc.includes("virtual filesystem engine is deliberately reported as not ready"));
check("v0.481 status names remaining unfinished runtime work", status.includes("Still unfinished") && status.includes("WinFsp/macFUSE/FUSE") && status.includes("system-wide shortcuts"));
check("desktop README explains the visible Desktop workspace", readme.includes("first-class Desktop workspace") && readme.includes("user-confirmed clipboard reads"));
check("release notes preserve production foundation contract", notes.includes("Phase 7.1-7.6 production-build-foundation-v1"));
check("changelog contains v0.481.0", changelog.includes('version: "v0.481.0"') && changelog.includes("Desktop native product surfaces"));
check("aggregate audit includes v0.481 gate", String(pkg.scripts?.audit || "").includes("desktop-native-product-surfaces-v481-audit.mjs"));
check("named v0.481 audit exists", String(pkg.scripts?.["audit:desktop-native-product-surfaces-v481"] || "").includes("desktop-native-product-surfaces-v481-audit.mjs"));
check("master packager runs v0.481 gate", packager.includes("desktop-native-product-surfaces-v481-audit.mjs"));
check("master packager carries v0.481 docs", packager.includes("docs/DESKTOP_NATIVE_PRODUCT_SURFACES_V481.md") && packager.includes("docs/DESKTOP_NATIVE_FEATURE_STATUS_V481.md"));

const failures = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.detail && !item.ok ? ` (${item.detail})` : ""}`);
console.log(`\nCluster Desktop native product surfaces v0.481 audit: ${checks.length - failures.length}/${checks.length} passed.`);
if (failures.length) process.exit(1);

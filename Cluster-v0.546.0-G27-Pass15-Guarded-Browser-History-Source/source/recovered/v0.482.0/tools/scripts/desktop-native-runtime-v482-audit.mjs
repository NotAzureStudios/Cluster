import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const checks = [];
const check = (label, ok, detail = "") => checks.push({ label, ok, detail });
const text = (relative) => readFile(path.join(root, relative), "utf8");
const exists = async (relative) => { try { await access(path.join(root, relative)); return true; } catch { return false; } };

const [pkgText, versionsText, cmake, appH, appCpp, broker, mountH, mountCpp, fuseH, fuseCpp, shortcutsH, shortcutsCpp, cookies, api, libraryRoutes, authRoutes, desktopRoutes, desktopCore, workspace, css, changelog, readme, completion, status, notes, packager] = await Promise.all([
  text("package.json"), text("config/toolchain-versions.json"), text("apps/desktop-qt/CMakeLists.txt"),
  text("apps/desktop-qt/src/AppController.h"), text("apps/desktop-qt/src/AppController.cpp"), text("apps/desktop-qt/src/NativeCapabilityBroker.cpp"),
  text("apps/desktop-qt/src/LibraryMountManager.h"), text("apps/desktop-qt/src/LibraryMountManager.cpp"), text("apps/desktop-qt/src/ClusterFuseMount.h"), text("apps/desktop-qt/src/ClusterFuseMount.cpp"),
  text("apps/desktop-qt/src/GlobalShortcutManager.h"), text("apps/desktop-qt/src/GlobalShortcutManager.cpp"), text("apps/desktop-qt/src/PersistentCookieJar.cpp"), text("apps/desktop-qt/src/ApiClient.cpp"),
  text("apps/server/src/domains/library/library-routes.ts"), text("apps/server/src/domains/auth/auth-core-routes.ts"), text("apps/server/src/domains/desktop/desktop-transfer-routes.ts"),
  text("packages/renderer/src/core/desktop.ts"), text("packages/renderer/src/features/desktop/DesktopWorkspacePage.tsx"), text("packages/renderer/src/features/desktop/desktop-workspace.css"),
  text("packages/renderer/src/features/changelog/data/cluster-changelog.ts"), text("apps/desktop-qt/README.md"), text("docs/DESKTOP_NATIVE_RUNTIME_COMPLETION_V482.md"),
  text("docs/DESKTOP_NATIVE_FEATURE_STATUS_V482.md"), text("RELEASE_NOTES_v0.482.0.md"), text("tools/scripts/package-cluster-master.mjs"),
]);
const pkg = JSON.parse(pkgText); const versions = JSON.parse(versionsText);
const parts = String(pkg.version || "0.0.0").split(".").map((part) => Number.parseInt(part, 10) || 0);
const atLeast482 = parts[0] > 0 || parts[1] > 482 || (parts[1] === 482 && parts[2] >= 0);
check("v0.482 native runtime baseline is retained", atLeast482 && versions.cluster === pkg.version);
check("desktop CMake version tracks release", cmake.includes(`project(ClusterDesktop VERSION ${pkg.version}`));

check("FUSE mount adapter is in the desktop build graph", cmake.includes("ClusterFuseMount.cpp") && cmake.includes("CLUSTER_FUSE3_FOUND") && cmake.includes("CLUSTER_HAS_FUSE3"));
check("Windows mount provider targets WinFsp", cmake.includes("WinFsp/inc") && cmake.includes("winfsp-x64"));
check("Unix mount provider uses fuse3 pkg-config", cmake.includes("pkg_check_modules(CLUSTER_FUSE3 QUIET fuse3)"));
check("mount manager declares QJsonValue directly", mountH.includes("#include <QJsonValue>"));
check("mount readiness requires both adapter and provider", mountCpp.includes("adapterBuilt") && mountCpp.includes("providerDetected") && mountCpp.includes('QStringLiteral("engineReady"), ready'));
check("obsolete false-ready placeholder is retired", !broker.includes('QStringLiteral("engineReady"), false'));

check("unified layout remains default", mountH.includes('m_layout = QStringLiteral("unified")') && workspace.includes('desktopLibraryMountLayout: "unified"'));
check("saved profiles become mount sources", mountCpp.includes("m_profiles ? m_profiles->profiles()") && mountCpp.includes("rebuildSourceContexts"));
check("inactive profiles use their own API and transfer objects", mountCpp.includes("source->api = new ApiClient") && mountCpp.includes("source->transfers = new TransferManager"));
check("source credentials stay inside native runtime config", mountCpp.includes('QStringLiteral("cookieHeader")') && mountCpp.includes('QStringLiteral("csrfToken")') && !desktopCore.includes("cookieHeader") && !desktopCore.includes("csrfToken"));
check("unified server-first topology is explicit", mountCpp.includes("serverLabel + QLatin1Char('/')") && mountCpp.includes('m_organization == QStringLiteral("servers")'));
check("libraries-first topology retains server ownership", mountCpp.includes("routingRoot = root + QLatin1Char('/') + serverLabel"));
check("dedicated and exclusive policy split mounts", mountCpp.includes('isolation == QStringLiteral("dedicated")') && mountCpp.includes('isolation == QStringLiteral("exclusive")'));
check("active exclusive server suppresses other sources", mountCpp.includes("activeExclusive") && mountCpp.includes("eligible = {active}"));
check("required mounts cannot be stopped normally", mountCpp.includes("activeMountRequired()") && mountCpp.includes("MOUNT_REQUIRED_BY_SERVER"));
check("cache clearing is blocked while mounted", mountCpp.includes("if (anyRunning())") && mountCpp.includes("Unmount Cluster Libraries before clearing"));

check("filesystem cache verifies SHA-256", fuseCpp.includes("QCryptographicHash::Sha256") && fuseCpp.includes("checksum"));
check("filesystem carries stable source and revision metadata", fuseCpp.includes("sourceProfileId") && fuseCpp.includes("revision") && fuseCpp.includes("entry.id"));
check("cross-directory rename is rejected with EXDEV", fuseCpp.includes("return -EXDEV"));
check("filesystem emits dirty-file writes to transfer layer", fuseCpp.includes("fileDirty") && mountCpp.includes("queueDirtyFile"));
check("filesystem emits metadata changes for server-backed refresh", fuseCpp.includes("metadataChanged") && mountCpp.includes("refresh()"));
check("server exposes mount manifest", libraryRoutes.includes('/api/desktop-libraries/mount-manifest') && libraryRoutes.includes("checksumSha256"));
check("server exposes mounted folder operations", libraryRoutes.includes('/api/desktop-libraries/folders') && libraryRoutes.includes('/:itemId/rename'));
check("mounted writes use resumable desktop transfer finalization", libraryRoutes.includes('/api/desktop-libraries/from-desktop-transfer') && desktopRoutes.includes("checksumSha256"));
check("mounted existing-file writes are revision guarded", libraryRoutes.includes("expectedRevision") && libraryRoutes.includes("REVISION_CONFLICT"));

check("browser issues one-time desktop session codes", authRoutes.includes('/api/auth/desktop-session-code') && authRoutes.includes("desktop.session_code_issued"));
check("native redemption creates a distinct desktop-native session", authRoutes.includes('authMethod: "desktop-native"') && authRoutes.includes("csrfTokenForSession"));
check("native broker only accepts bounded one-time claim code", broker.includes('QStringLiteral("session.claim")') && broker.includes("code.size() < 32"));
check("Windows native session storage uses DPAPI", cookies.includes("CryptProtectData") && cookies.includes("CryptUnprotectData"));
check("macOS native session storage uses Keychain", cookies.includes("SecItemCopyMatching") && cookies.includes("SecItemAdd"));
check("Linux native session storage uses libsecret", cookies.includes("secret_password_lookup_sync") && cookies.includes("secret_password_store_sync"));
check("libsecret is optional in CMake", cmake.includes("CLUSTER_LIBSECRET_FOUND") && cmake.includes("libsecret-1"));

check("Windows global shortcuts use RegisterHotKey", shortcutsCpp.includes("RegisterHotKey") && shortcutsCpp.includes("WM_HOTKEY"));
check("macOS global shortcuts use Carbon hot keys", shortcutsCpp.includes("RegisterEventHotKey") && shortcutsCpp.includes("kEventHotKeyPressed"));
check("Linux global shortcuts use XDG portal", shortcutsCpp.includes("org.freedesktop.portal.GlobalShortcuts") && shortcutsCpp.includes("CreateSession") && shortcutsCpp.includes("BindShortcuts"));
check("Linux portal activation routes all three actions", shortcutsCpp.includes('show-cluster') && shortcutsCpp.includes('command-palette') && shortcutsCpp.includes('quick-create'));
check("Linux does not default portal prompts on without saved preference", shortcutsCpp.includes("hasSavedPreference") && shortcutsCpp.includes("m_enabled = hasSavedPreference"));
check("desktop build includes Qt DBus only on Linux", cmake.includes("UNIX AND NOT APPLE") && cmake.includes("COMPONENTS DBus"));
check("renderer exposes global shortcut status and toggle", desktopCore.includes('"shortcut.global.status"') && desktopCore.includes('"shortcut.global.setEnabled"') && workspace.includes("Global shortcuts"));

const appLines = appCpp.split(/\r?\n/).length;
check("AppController remains shell-scale", appLines <= 500, `${appLines} lines`);
for (const retiredMethod of ["createProject", "createBoard", "createTicket", "createTimeline", "createWhiteboard", "deleteProject", "loadProjects"]) check(`AppController omits retired ${retiredMethod}`, !appH.includes(retiredMethod) && !appCpp.includes(retiredMethod));
check("AppController still coordinates mounts and shortcuts", appH.includes("LibraryMountManager") && appH.includes("GlobalShortcutManager") && appCpp.includes("m_libraryMountManager") && appCpp.includes("m_globalShortcuts"));
check("retired mutation queue stays absent", !(await exists("apps/desktop-qt/src/MutationQueue.cpp")) && !(await exists("apps/desktop-qt/src/MutationQueue.h")) && !cmake.includes("MutationQueue"));

check("Desktop UI surfaces required mount policy", workspace.includes("Required by server") && css.includes(".desktop-required-mount-v482"));
check("Desktop UI hides cache clear while mounted", workspace.includes('!mountStatus?.running && <button') && workspace.includes("Clear cache"));
check("Desktop UI respects engine readiness", workspace.includes("!mountStatus?.engineReady"));
check("Desktop UI shows authenticated server and mount counts", workspace.includes("authenticatedServerCount") && workspace.includes("mountCount"));

check("v0.482 completion doc defines release boundary", completion.includes("Release-blocking boundary") && completion.includes("EXDEV") && completion.includes("XDG Desktop Portal"));
check("v0.482 status separates source completion from runtime certification", status.includes("Completed in source") && status.includes("Still requires runtime certification"));
check("desktop README is current", readme.startsWith("# Cluster Desktop v0.482.0") && readme.includes("XDG Desktop Portal GlobalShortcuts"));
check("release notes preserve production foundation contract", notes.includes("Phase 7.1-7.6 production-build-foundation-v1"));
check("changelog contains v0.482.0", changelog.includes('version: "v0.482.0"') && changelog.includes("Native filesystem and global shortcut completion"));
check("aggregate audit includes v0.482 gate", String(pkg.scripts?.audit || "").includes("desktop-native-runtime-v482-audit.mjs"));
check("named v0.482 audit exists", String(pkg.scripts?.["audit:desktop-native-runtime-v482"] || "").includes("desktop-native-runtime-v482-audit.mjs"));
check("master packager runs v0.482 gate", packager.includes("desktop-native-runtime-v482-audit.mjs"));
check("master packager carries v0.482 docs", packager.includes("docs/DESKTOP_NATIVE_RUNTIME_COMPLETION_V482.md") && packager.includes("docs/DESKTOP_NATIVE_FEATURE_STATUS_V482.md"));

const failures = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.detail && !item.ok ? ` (${item.detail})` : ""}`);
console.log(`\nCluster Desktop native runtime v0.482 audit: ${checks.length - failures.length}/${checks.length} passed.`);
if (failures.length) process.exit(1);

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => readFile(path.join(root, relative), "utf8");
const readApplicationDomain = async () => (await Promise.all([
  read("packages/renderer/src/features/application/ClusterApplication.tsx"),
  read("packages/renderer/src/features/application/modules/application-foundation.tsx"),
  read("packages/renderer/src/features/application/modules/application-shell.tsx"),
  read("packages/renderer/src/features/application/modules/application-operations.tsx"),
  read("packages/renderer/src/features/application/modules/application-workspaces.tsx"),
])).join("\n");
const readSettingsDomain = async () => (await Promise.all([
  read("packages/renderer/src/features/settings/SettingsWorkspacePages.tsx"),
  read("packages/renderer/src/features/settings/AccountSettingsPage.tsx"),
  read("packages/renderer/src/features/settings/StudioSettingsPage.tsx"),
  read("packages/renderer/src/features/settings/ServerConfigPage.tsx"),
])).join("\n");

test("current toolchain versions are centralized", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const pkg = JSON.parse(await read("package.json"));
  const server = JSON.parse(await read("apps/server/package.json"));
  const renderer = JSON.parse(await read("packages/renderer/package.json"));
  assert.equal(pkg.version, versions.cluster);
  assert.equal(server.dependencies["@prisma/client"], versions.prisma.version);
  assert.equal(server.dependencies["@prisma/adapter-pg"], versions.prisma.version);
  assert.equal(renderer.dependencies.three, versions.three.version);
});

test("Prisma 7 uses generated ESM client and PostgreSQL adapter", async () => {
  const schema = await read("apps/server/prisma/schema.prisma");
  const config = await read("prisma.config.ts");
  const client = await read("apps/server/src/core/prisma-client.ts");
  assert.match(schema, /provider\s*=\s*"prisma-client"/);
  assert.match(schema, /output\s*=\s*"\.\.\/src\/generated\/prisma"/);
  assert.doesNotMatch(schema, /^\s*url\s*=/m);
  assert.match(config, /datasource:\s*\{/);
  assert.match(client, /@prisma\/adapter-pg/);
  assert.match(client, /new PrismaPg/);
  assert.match(client, /Extract<GeneratedClientOptions, \{ adapter: unknown \}>/);
  assert.match(client, /Omit<DirectClientOptions, "adapter">/);
  assert.doesNotMatch(client, /accelerateUrl/);
});

test("Three.js and application styles are package-managed and consolidated", async () => {
  const viewer = await read("packages/renderer/src/features/library/LibraryThreeModelViewer.tsx");
  const styles = await read("packages/renderer/src/styles.css");
  assert.match(viewer, /import\("three/);
  assert.match(styles, /styles\/application\.css/);
  await assert.rejects(access(path.join(root, "packages/renderer/vendor")));
  await assert.rejects(access(path.join(root, "packages/renderer/src/styles/legacy")));
});

test("native launchers use current toolchain and valid PostgreSQL lock signature", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const launcher = await read("apps/server-launcher-go/main.go");
  const runtime = await read("apps/server-launcher-go/runtime_windows.go");
  const lock = await read("apps/server/src/core/database-bootstrap-lock.ts");
  assert.match(launcher, new RegExp(`privateNodeVersion = "${versions.node.version.replaceAll(".", "\\.")}"`));
  assert.match(runtime, new RegExp(`postgresVersion = "${versions.postgresql.version.replaceAll(".", "\\.")}"`));
  assert.match(lock, /pg_try_advisory_xact_lock\(\$1::integer, \$2::integer\)/);
});

test("desktop targets Qt 6.11 and has automatic toolchain discovery", async () => {
  const cmake = await read("apps/desktop-qt/CMakeLists.txt");
  const setup = await read("tools/scripts/desktop-setup.mjs");
  assert.match(cmake, /find_package\(Qt6 6\.11 REQUIRED/);
  assert.match(setup, /mingw_64/);
  assert.match(setup, /MSVC 2022 x64 or MinGW x64/);
});

test("Qt 6.11 desktop C++ contracts are compiler-safe", async () => {
  const controller = await read("apps/desktop-qt/src/AppController.h");
  const controllerCpp = await read("apps/desktop-qt/src/AppController.cpp");
  const previewCpp = await read("apps/desktop-qt/src/FilePreviewManager.cpp");
  const main = await read("apps/desktop-qt/src/main.cpp");
  assert.match(controller, /#include "DesktopPreferences\.h"/);
  assert.match(controller, /#include "NativeUpdateManager\.h"/);
  assert.doesNotMatch(controller, /class DesktopPreferences;/);
  assert.doesNotMatch(controller, /class NativeUpdateManager;/);
  for (const type of ["WhiteboardCanvas", "BuildFlowCanvas", "BoardCanvas"]) {
    const header = await read(`apps/desktop-qt/src/${type}.h`);
    assert.doesNotMatch(header, new RegExp(`class\\s+${type}\\s+final\\s*:`));
    assert.match(main, new RegExp(`qmlRegisterType<${type}>`));
  }
  assert.doesNotMatch(await read("apps/desktop-qt/src/WhiteboardCanvas.cpp"), /setCursor\(Qt::/);
  assert.doesNotMatch(await read("apps/desktop-qt/src/BoardCanvas.cpp"), /setCursor\(Qt::/);
  assert.doesNotMatch(controllerCpp, /m_pendingDeepLink\s*=\s*\{\}/);
  assert.doesNotMatch(previewCpp, /m_localUrl\s*=\s*\{\}/);
});


test("renderer build blockers and v0.344 shell contracts are fixed", async () => {
  const app = await readApplicationDomain();
  const accessibility = await read("packages/renderer/src/components/AccessibilityManager.tsx");
  const performance = await read("packages/renderer/src/core/performance.ts");
  const changelog = await read("packages/renderer/src/features/changelog/data/cluster-changelog.ts");
  const styles = await read("packages/renderer/src/styles.css");
  const parity = await read("packages/renderer/src/styles/parity-v344.css");
  assert.doesNotMatch(accessibility, /\.at\(-1\)/);
  assert.doesNotMatch(performance, /\.at\(-1\)/);
  assert.equal((app.match(/import \{ ColorField \}/g) || []).length, 1);
  assert.match(changelog, /v0\.344\.0/);
  assert.match(app, /cluster\.sidebar\.collapsed/);
  assert.match(app, /--cluster-sidebar-current-width/);
  assert.match(parity, /--cluster-sidebar-collapsed:\s*76px/);
  assert.match(parity, /sidebar-icon-slot-v344/);
  assert.match(parity, /taskbar-unified-v3430/);
  assert.ok(styles.includes('@import "./styles/parity-v344.css";'));
  assert.ok(styles.trimEnd().endsWith('@import "./styles/design-system/phase-k-polish.css";'));
  assert.ok(styles.indexOf('@import "./styles/design-system/primitives.css";') < styles.indexOf('@import "./styles/design-system/phase-a-polish.css";'));
  assert.ok(styles.indexOf('@import "./styles/parity-v344.css";') < styles.indexOf('@import "./styles/design-system/primitives.css";'));
});


test("master packaging preserves legitimate nested data directories", async () => {
  const packager = await read("tools/scripts/package-cluster-master.mjs");
  assert.match(packager, /rootGeneratedNames = new Set\(\["data", "runtime", "bin"\]\)/);
  assert.doesNotMatch(packager, /"\.git", "data", "runtime", "bin"/);
});


test("desktop hosts the shared renderer and keeps native integration separate", async () => {
  const cmake = await read("apps/desktop-qt/CMakeLists.txt");
  const setup = await read("tools/scripts/desktop-setup.mjs");
  const mainCpp = await read("apps/desktop-qt/src/main.cpp");
  const mainQml = await read("apps/desktop-qt/qml/Main.qml");
  const shared = await read("apps/desktop-qt/qml/pages/SharedRendererPage.qml");
  const settings = await read("apps/desktop-qt/qml/pages/AppSettingsWindow.qml");
  const integration = await read("apps/desktop-qt/src/DesktopIntegration.cpp");
  const buildScript = await read("tools/scripts/build-qt-desktop.mjs");
  const packageScript = await read("tools/scripts/package-qt-desktop.mjs");
  const app = await readApplicationDomain();
  assert.match(cmake, /COMPONENTS[\s\S]*WebView/);
  assert.match(cmake, /Qt6::WebView/);
  assert.match(setup, /"WebView"/);
  assert.match(mainCpp, /#include <QtWebView>/);
  assert.match(mainCpp, /QtWebView::initialize\(\)/);
  assert.match(mainQml, /sharedRendererPage/);
  assert.doesNotMatch(mainQml, /state === "setup" \? setupPage/);
  assert.match(shared, /import QtWebView/);
  assert.match(shared, /clusterDesktop=1/);
  assert.match(shared, /WebView\s*\{/);
  assert.match(settings, /App settings/);
  assert.doesNotMatch(settings, /Studio defaults/);
  assert.doesNotMatch(integration, /120'000/);
  assert.match(integration, /reloadSharedRenderer/);
  assert.match(buildScript, /desktop-setup\.mjs/);
  assert.match(packageScript, /loadDesktopToolchain/);
  assert.match(packageScript, /toolchain\?\.cmake \|\| "cmake"/);
  assert.match(app, /desktop-history-controls-v344/);
  assert.match(app, /event\.button === 3/);
  assert.match(app, /event\.button === 4/);
});



test("v0.345 security boundaries and per-server profiles are explicit", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const profiles = await read("apps/desktop-qt/src/ServerProfileStore.cpp");
  const controller = await read("apps/desktop-qt/src/AppController.cpp");
  const shared = await read("apps/desktop-qt/qml/pages/SharedRendererPage.qml");
  const settings = await read("apps/desktop-qt/qml/pages/AppSettingsWindow.qml");
  const server = await read("apps/server/src/app/cluster-server.ts");
  const requestDomain = await read("apps/server/src/app/server-services-request-domain.ts");
  const gateway = await read("apps/host-go/gateway.go");
  const serviceWorker = await read("apps/web/public/cluster-sw.js");
  const webIndex = await read("apps/web/index.html");
  const rendererApplication = await readApplicationDomain();
  const changelog = await read("packages/renderer/src/features/changelog/data/cluster-changelog.ts");
  const securityDoc = await read("docs/SECURITY_ARCHITECTURE.md");

  assert.match(versions.cluster, /^0\.422\./);
  assert.match(profiles, /WEBVIEW2_USER_DATA_FOLDER/);
  assert.match(profiles, /QCryptographicHash::Sha256/);
  assert.match(profiles, /validProfileId/);
  assert.match(profiles, /Remote Cluster servers must use HTTPS/);
  assert.match(profiles, /CLUSTER_DESKTOP_ALLOW_INSECURE_HTTP/);
  assert.doesNotMatch(profiles, /sessionToken|bearerToken|passwordHash/);
  assert.match(controller, /ServerProfileStore::normalizeServerUrl/);
  assert.match(shared, /settings\.allowFileAccess = false/);
  assert.match(shared, /settings\.localContentCanAccessFileUrls = false/);
  assert.match(shared, /JSON\.stringify\(window\.__clusterDesktopState \|\| null\)/);
  assert.match(shared, /updateRendererStateJson/);
  assert.match(shared, /result\.length <= 4096/);
  assert.match(controller, /void AppController::updateRendererStateJson/);
  assert.match(controller, /Authentication lives inside the isolated WebView2 profile/);
  assert.doesNotMatch(shared, /sessionToken|bearerToken|authorizationToken/);
  assert.match(settings, /Server profiles/);
  assert.match(server, /methods: \["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"\]/);
  assert.match(server, /X-Cluster-Idempotency-Key/);
  assert.match(requestDomain, /Cache-Control", "no-store, max-age=0/);
  assert.match(gateway, /HOST_NOT_ALLOWED/);
  assert.match(gateway, /METHOD_NOT_ALLOWED/);
  assert.match(gateway, /origin == "null"/);
  assert.match(serviceWorker, /cluster-shell-v345/);
  assert.match(serviceWorker, /\/api\//);
  assert.match(rendererApplication, /window\.__clusterDesktopState =/);
  assert.match(rendererApplication, /unreadNotifications/);
  assert.match(rendererApplication, /serverLabel/);
  assert.match(rendererApplication, /userLabel/);
  assert.doesNotMatch(webIndex, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.match(changelog, new RegExp(`v${versions.cluster.replaceAll(".", "\\.")}`));
  assert.match(securityDoc, /Per-server browser and native-data isolation/);
});


test("v0.346 release certification builds before packaging", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const ci = await read(".github/workflows/ci.yml");
  const release = await read(".github/workflows/release.yml");
  const packager = await read("tools/scripts/package-cluster-master.mjs");
  const launcher = await read("apps/server-launcher-go/main.go");
  const mainCpp = await read("apps/desktop-qt/src/main.cpp");
  const rootPackage = JSON.parse(await read("package.json"));
  assert.match(versions.cluster, /^0\.422\./);
  assert.equal(rootPackage.version, versions.cluster);
  assert.match(ci, /Server \+ Web \+ PostgreSQL \(Linux\)/);
  assert.match(ci, /Server \+ Web compile \(Windows\)/);
  assert.match(ci, /Desktop \(\$\{\{ matrix\.compiler \}\}\)/);
  assert.match(ci, /npm run desktop:smoke/);
  assert.match(ci, /CLUSTER_TEST_DATABASE_URL/);
  assert.match(release, /CLUSTER_RELEASE_REQUIRE_PREBUILT/);
  assert.match(release, /CLUSTER_RELEASE_REQUIRE_DESKTOP_PACKAGE/);
  assert.match(release, /Previous release database upgrade/);
  assert.match(release, /actions\/download-artifact@v8/);
  assert.match(release, /needs: \[certify-build, upgrade-drill\]/);
  assert.match(release, /release-verify-artifacts\.mjs --require-prebuilt --require-desktop-package/);
  assert.match(packager, /CLUSTER_RELEASE\.json/);
  assert.match(packager, /release-preflight\.json/);
  assert.match(packager, /--package-lock-only/);
  assert.match(packager, /Cluster-Desktop-v\$\{version\}-Windows-x64\.zip/);
  assert.match(packager, /release-verify-artifacts\.mjs/);
  assert.match(launcher, /releasePrebuiltReady/);
  assert.match(launcher, /Using prebuilt Cluster Server, Prisma client, and web client from the release package/);
  assert.match(mainCpp, /--smoke-test/);
});

test("v0.347 desktop server profiles are first-class and recoverable", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const cmake = await read("apps/desktop-qt/CMakeLists.txt");
  const mainQml = await read("apps/desktop-qt/qml/Main.qml");
  const profileQml = await read("apps/desktop-qt/qml/pages/ServerProfilesWindow.qml");
  const sharedQml = await read("apps/desktop-qt/qml/pages/SharedRendererPage.qml");
  const profilesHeader = await read("apps/desktop-qt/src/ServerProfileStore.h");
  const profilesCpp = await read("apps/desktop-qt/src/ServerProfileStore.cpp");
  const integrationCpp = await read("apps/desktop-qt/src/DesktopIntegration.cpp");
  const controllerCpp = await read("apps/desktop-qt/src/AppController.cpp");
  const rendererTypes = await read("packages/renderer/src/core/desktop-types.ts");
  const rendererApplication = await readApplicationDomain();
  const securityDoc = await read("docs/SECURITY_ARCHITECTURE.md");
  assert.equal(versions.cluster, "0.422.0");
  assert.match(cmake, /ServerProfilesWindow\.qml/);
  assert.match(mainQml, /Ctrl\+Shift\+S/);
  assert.match(mainQml, /recoveryRequired/);
  assert.match(profileQml, /Add a Cluster server/);
  assert.match(profileQml, /Reset local data/);
  assert.match(profileQml, /Sign out/);
  assert.match(profileQml, /Forget server/);
  assert.match(profileQml, /Open profile folder/);
  assert.match(profilesHeader, /recordRendererLoadSucceeded/);
  assert.match(profilesHeader, /recordRendererLoadFailed/);
  assert.match(profilesHeader, /markCleanExit/);
  assert.match(profilesCpp, /RegistrySchemaVersion = 4/);
  assert.match(profilesCpp, /profile-sessions/);
  assert.match(profilesCpp, /RecoveryFailureThreshold = 3/);
  assert.match(profilesCpp, /pendingClear/);
  assert.match(profilesCpp, /QCryptographicHash::Sha256/);
  assert.match(integrationCpp, /rebuildServerMenu/);
  assert.match(integrationCpp, /Manage servers/);
  assert.match(sharedQml, /\/api\/auth\/logout/);
  assert.match(sharedQml, /credentials:'include'/);
  assert.match(sharedQml, /completeSignOut/);
  assert.match(sharedQml, /recordRendererLoadSucceeded/);
  assert.match(sharedQml, /recordRendererLoadFailed/);
  assert.match(controllerCpp, /schema\"\)\)\.toInt\(-1\) != 2/);
  assert.match(controllerCpp, /updateRendererIdentity/);
  assert.match(rendererTypes, /schema: 2/);
  assert.match(rendererApplication, /serverLabel:/);
  assert.match(rendererApplication, /userLabel:/);
  assert.match(securityDoc, /Active sign-out performs the server-side `\/api\/auth\/logout` request inside the same-origin WebView context/);
  assert.doesNotMatch(profilesCpp, /passwordHash|bearerToken|authorizationToken|cookieValue/);
});


test("v0.348 native capability broker is narrow, opaque, and origin-bound", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const cmake = await read("apps/desktop-qt/CMakeLists.txt");
  const brokerHeader = await read("apps/desktop-qt/src/NativeCapabilityBroker.h");
  const brokerCpp = await read("apps/desktop-qt/src/NativeCapabilityBroker.cpp");
  const controller = await read("apps/desktop-qt/src/AppController.h");
  const sharedQml = await read("apps/desktop-qt/qml/pages/SharedRendererPage.qml");
  const rendererDesktop = await read("packages/renderer/src/core/desktop.ts");
  const nativePanel = await read("packages/renderer/src/features/desktop/DesktopNativeServicesPanel.tsx");
  const securityDoc = await read("docs/SECURITY_ARCHITECTURE.md");
  const brokerDoc = await read("docs/NATIVE_CAPABILITY_BROKER.md");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(cmake, /NativeCapabilityBroker\.cpp/);
  assert.match(controller, /Q_PROPERTY\(NativeCapabilityBroker\* nativeCapabilities/);
  assert.match(brokerHeader, /processRequestJson/);
  assert.match(brokerCpp, /isAllowedRendererUrl\(rendererUrl\)/);
  assert.match(brokerCpp, /MaxRequestBytes = 16 \* 1024/);
  assert.match(brokerCpp, /MaxPayloadBytes = 8 \* 1024/);
  assert.match(brokerCpp, /MaxRequestsPerMinute/);
  assert.match(brokerCpp, /MaxDialogsPerMinute/);
  assert.match(brokerCpp, /MaxNotificationsPerMinute/);
  assert.match(brokerCpp, /m_seenRequestIds/);
  assert.match(brokerCpp, /QCryptographicHash|QUuid::createUuid/);
  assert.match(brokerCpp, /fh-%1/);
  assert.match(brokerCpp, /activeProfileId\(\)/);
  assert.match(brokerCpp, /HandleLifetimeMs = 30 \* 60 \* 1000/);
  assert.match(brokerCpp, /rawFilesystemPathsExposed/);
  assert.doesNotMatch(brokerCpp, /payload\.value\(QStringLiteral\("command"\)\)/);
  assert.doesNotMatch(brokerCpp, /cmd\.exe|powershell|\/bin\/sh|CreateProcess/);
  assert.match(sharedQml, /__clusterNativeRequests/);
  assert.match(sharedQml, /processRequestJson\(requestJson, String\(webView\.url/);
  assert.match(sharedQml, /__clusterNativeDeliver/);
  assert.match(rendererDesktop, /CLUSTER_DESKTOP_BRIDGE_VERSION/);
  assert.match(rendererDesktop, /requestNativeCapability/);
  assert.match(rendererDesktop, /cluster-handle:/);
  assert.match(rendererDesktop, /Raw filesystem|Raw filesystem/i);
  assert.doesNotMatch(nativePanel, /credential vault|Desktop Agent|Record bug clip|runDesktopAgentJob/i);
  assert.match(nativePanel, /no raw paths/i);
  assert.match(securityDoc, /Native capability broker/);
  assert.match(brokerDoc, /Explicitly absent/);
});


test("v0.349 authentication and session controls fail closed", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const runtime = await read("apps/server/src/core/runtime-config.ts");
  const auth = await read("apps/server/src/core/auth.ts");
  const sessionSecurity = await read("apps/server/src/core/session-security.ts");
  const requestDomain = await read("apps/server/src/app/server-services-request-domain.ts");
  const server = await read("apps/server/src/app/cluster-server.ts");
  const authRoutes = await read("apps/server/src/domains/auth/auth-core-routes.ts");
  const apiClient = await read("packages/api-client/src/index.ts");
  const rendererApi = await read("packages/renderer/src/core/api.ts");
  const reauthHost = await read("packages/renderer/src/components/ReauthenticationHost.tsx");
  const desktopQml = await read("apps/desktop-qt/qml/pages/SharedRendererPage.qml");
  const schema = await read("apps/server/prisma/schema.prisma");
  const migration = await read("apps/server/prisma/migrations/20260811210000_auth_session_hardening/migration.sql");
  const securityDoc = await read("docs/AUTH_SESSION_SECURITY.md");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(runtime, /sessionSecure \? "__Host-cluster_session" : "cluster_session"/);
  assert.match(runtime, /configuredSessionDays === 30 \? 7/);
  assert.match(runtime, /configuredSessionIdleHours === 168 \? 12/);
  assert.match(runtime, /configuredSessionMaxPerUser === 10 \? 5/);
  assert.match(auth, /REAUTH_WINDOW_MS = 10 \* 60 \* 1000/);
  assert.match(auth, /LOGIN_FAILURE_DECAY_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(auth, /loginLockDurationMs/);
  assert.match(sessionSecurity, /csrfProtectionRequired/);
  assert.match(sessionSecurity, /recentAuthenticationRequired/);
  assert.match(requestDomain, /createHmac\("sha256"/);
  assert.match(requestDomain, /timingSafeEqual/);
  assert.match(server, /X-Cluster-CSRF-Invalid/);
  assert.match(server, /AUTH_REAUTH_REQUIRED/);
  assert.match(authRoutes, /\/api\/auth\/csrf/);
  assert.match(authRoutes, /\/api\/auth\/reauth/);
  assert.match(authRoutes, /revocationReason: "reauthenticated"/);
  assert.match(apiClient, /X-Cluster-CSRF/);
  assert.match(apiClient, /fetchCsrfToken/);
  assert.match(rendererApi, /requestReauthentication/);
  assert.match(reauthHost, /current-password/);
  assert.match(desktopQml, /\/api\/auth\/csrf/);
  assert.match(desktopQml, /X-Cluster-CSRF/);
  assert.match(schema, /lastFailedLoginAt/);
  assert.match(schema, /authMethod/);
  assert.match(schema, /revocationReason/);
  assert.match(migration, /lastFailedLoginAt/);
  assert.match(securityDoc, /HMAC-bound CSRF/);
});


test("v0.350 desktop updates are signed, bounded, transactional, and recoverable", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const updater = await read("apps/desktop-qt/src/NativeUpdateManager.cpp");
  const updaterHeader = await read("apps/desktop-qt/src/NativeUpdateManager.h");
  const updateDialog = await read("apps/desktop-qt/qml/components/UpdateDialog.qml");
  const mainQml = await read("apps/desktop-qt/qml/Main.qml");
  const mainCpp = await read("apps/desktop-qt/src/main.cpp");
  const sharedQml = await read("apps/desktop-qt/qml/pages/SharedRendererPage.qml");
  const helper = await read("apps/update-helper-go/main.go");
  const signer = await read("tools/scripts/release-update-manifest.mjs");
  const updateDoc = await read("docs/DESKTOP_UPDATE_SECURITY.md");
  const rootPackage = JSON.parse(await read("package.json"));

  assert.equal(versions.cluster, "0.422.0");
  assert.equal(rootPackage.scripts["release:update-manifest"], "node tools/scripts/release-update-manifest.mjs");
  assert.match(updaterHeader, /rollbackUpdate/);
  assert.match(updaterHeader, /markRuntimeHealthy/);
  assert.match(updater, /SameOriginRedirectPolicy/);
  assert.match(updater, /MaxManifestBytes = 256 \* 1024/);
  assert.match(updater, /MaxArtifactBytes = 2LL \* 1024LL \* 1024LL \* 1024LL/);
  assert.match(updater, /Content-Range/);
  assert.match(updater, /persistPendingInstall/);
  assert.match(updater, /desktop\/updateTransaction/);
  assert.match(updater, /verifyArtifactFile\(m_downloadedPath/);
  assert.match(updater, /verifyArtifactFile\(m_rollbackPath/);
  assert.match(updater, /rollback-ready/);
  assert.match(updateDialog, /Rollback to/);
  assert.match(updateDialog, /Keep this version/);
  assert.match(mainQml, /updateRecoveryDialog/);
  assert.match(mainCpp, /30'000/);
  assert.match(sharedQml, /updateManager\.markRuntimeHealthy/);
  assert.match(helper, /validateManifest/);
  assert.match(helper, /manifest product must be cluster-desktop/);
  assert.match(helper, /maxManifestBytes = 256 \* 1024/);
  assert.match(signer, /createPrivateKey/);
  assert.match(signer, /cluster-desktop/);
  assert.match(updateDoc, /Transactional recovery/);
});


test("v0.351 request authorization is centralized, object-aware, and fail-closed", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const routePolicy = await read("apps/server/src/domains/access/route-policy.ts");
  const boundary = await read("apps/server/src/domains/access/request-authorization-boundary.ts");
  const authorization = await read("apps/server/src/domains/access/authorization.ts");
  const accessRoutes = await read("apps/server/src/domains/access/access-routes.ts");
  const customFields = await read("apps/server/src/domains/custom-fields/custom-field-routes.ts");
  const cards = await read("apps/server/src/domains/cards/card-routes.ts");
  const calendar = await read("apps/server/src/domains/planning/calendar-routes.ts");
  const timeline = await read("apps/server/src/domains/planning/timeline-routes.ts");
  const time = await read("apps/server/src/domains/time/time-routes.ts");
  const server = await read("apps/server/src/app/cluster-server.ts");
  const requestDomain = await read("apps/server/src/app/server-services-request-domain.ts");
  const sessionSecurity = await read("apps/server/src/core/session-security.ts");
  const originSecurity = await read("apps/server/src/core/security.ts");
  const securityDoc = await read("docs/AUTHORIZATION_ARCHITECTURE.md");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(routePolicy, /isPublicPath\(pathname: string, method = "GET"\)/);
  assert.match(routePolicy, /buildArtifact.*return "builds"/s);
  assert.match(routePolicy, /qaPlan\|qaSession.*return "qa"/s);
  assert.match(boundary, /pathname\.startsWith\("\/api\/admin\/"\)/);
  assert.match(boundary, /pathname\.startsWith\("\/api\/context-packs"\)/);
  assert.match(boundary, /authorization\.requireCard\(request, reply, item\.card\.id, minimum\)/);
  assert.match(requestDomain, /createRequestAuthorizationBoundary/);
  assert.match(server, /authorizeRequestBoundary\(request, reply\)/);
  assert.match(authorization, /const effective = lowerAccessLevel\(resourceLevel, toolCap\)/);
  assert.match(authorization, /requestCanUserScope/);
  assert.match(authorization, /labels\.includes\("ticket"\)/);
  assert.match(cards, /authorization\.requireTool\(request, reply, "tickets", "edit"\)/);
  assert.match(accessRoutes, /projectIdHint && resolved\.project\?\.id !== projectIdHint/);
  assert.match(customFields, /resolveEntityContext/);
  assert.match(customFields, /const canonicalProjectId = context\.project\?\.id \|\| null/);
  assert.match(calendar, /canViewEvent/);
  assert.match(timeline, /canViewTimelineItem/);
  assert.match(time, /requireTimeReferences/);
  assert.match(time, /PARENT_MISMATCH/);
  assert.match(time, /filterVisibleTimeEntries/);
  assert.match(time, /filterVisibleScheduleBlocks/);
  assert.doesNotMatch(sessionSecurity, /pathname\.startsWith\("\/api\/public\/"\)/);
  assert.doesNotMatch(originSecurity, /pathname\.startsWith\("\/api\/public\/"\)/);
  assert.match(securityDoc, /server-side authorization as the only security boundary/);
  assert.match(securityDoc, /Authoritative target resolution/);
});


test("v0.352 uploads and untrusted content are signature-first, contained, and capacity-bounded", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const uploads = await read("apps/server/src/core/uploads.ts");
  const requestDomain = await read("apps/server/src/app/server-services-request-domain.ts");
  const library = await read("apps/server/src/domains/library/library-routes.ts");
  const media = await read("apps/server/src/app/server-routes-media-whiteboards.ts");
  const desktopTransfers = await read("apps/server/src/domains/desktop/desktop-transfer-routes.ts");
  const blenderPreview = await read("apps/server/src/core/blender-preview.ts");
  const sharedErrors = await read("packages/shared/src/error-codes.ts");
  const securityDoc = await read("docs/UPLOAD_CONTENT_SECURITY.md");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(uploads, /decodeDataUrl\(dataUrl: string, maximumDecodedBytes/);
  assert.match(uploads, /resolvedUploadMime/);
  assert.match(uploads, /ACTIVE_CONTENT_MIME_TYPES/);
  assert.match(uploads, /uploadContentDisposition/);
  assert.match(uploads, /X-Content-Type-Options/);
  assert.match(uploads, /Content-Security-Policy/);
  assert.match(uploads, /WINDOWS_RESERVED_BASENAMES/);
  assert.match(requestDomain, /decodeDataUrl\(dataUrl, maxBytes\)/);
  assert.match(requestDomain, /resolvedUploadMime\(buffer, originalName, requestedMime\)/);
  assert.match(requestDomain, /UPLOAD_PATH_INVALID/);
  assert.match(library, /uploadContentDisposition\(contentType, item\.originalName \|\| item\.title, true\)/);
  assert.match(library, /detected !== declared/);
  assert.match(media, /uploadContentDisposition\(contentType, asset\.originalName, true\)/);
  assert.match(desktopTransfers, /MAX_UPLOAD_SESSIONS_PER_USER = 8/);
  assert.match(desktopTransfers, /MAX_RESERVED_UPLOAD_BYTES_PER_USER = 40 \* 1024 \* 1024 \* 1024/);
  assert.match(desktopTransfers, /MIN_FREE_SPACE_RESERVE_BYTES = 512 \* 1024 \* 1024/);
  assert.match(desktopTransfers, /resolvedUploadMime\(header, body\.originalName, body\.mimeType\)/);
  assert.match(desktopTransfers, /sha256File\(sourcePath\).*resolved\.metadata\.checksumSha256/s);
  assert.match(desktopTransfers, /rm\(uploadDirectory\(dataLayout, body\.uploadId\)/);
  assert.match(blenderPreview, /MAX_MODEL_PREVIEW_SOURCE_BYTES = 512 \* 1024 \* 1024/);
  assert.match(blenderPreview, /MAX_MODEL_PREVIEW_OUTPUT_BYTES = 512 \* 1024 \* 1024/);
  assert.match(sharedErrors, /UPLOAD_CAPACITY_EXCEEDED/);
  assert.match(securityDoc, /Cluster does not claim to provide antivirus/);
  assert.match(securityDoc, /active content is never treated like an ordinary inline preview/i);
});

test("v0.353 outbound networking is DNS-pinned, bounded, and SSRF-resistant", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const outbound = await read("apps/server/src/core/outbound-http.ts");
  const requestDomain = await read("apps/server/src/app/server-services-request-domain.ts");
  const settings = await read("apps/server/src/app/server-services-settings-integrations.ts");
  const configRoutes = await read("apps/server/src/app/server-routes-configuration-integrations.ts");
  const projectIntegrations = await read("apps/server/src/domains/projects/project-control-integration-routes.ts");
  const authDiscord = await read("apps/server/src/domains/auth/auth-discord-routes.ts");
  const model = await read("apps/server/src/app/server-composition-types.ts");
  const securityDoc = await read("docs/OUTBOUND_NETWORK_SECURITY.md");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(outbound, /dns\.lookup/);
  assert.match(outbound, /lookup: \(_hostname, _options, callback\)/);
  assert.match(outbound, /ALWAYS_BLOCKED_V4/);
  assert.match(outbound, /169\.254\.0\.0/);
  assert.match(outbound, /private\/reserved address/);
  assert.match(outbound, /cross-origin redirect was blocked/);
  assert.match(outbound, /maxResponseBytes/);
  assert.match(outbound, /allowHttpPrivateNetwork/);
  assert.match(requestDomain, /secureOutboundFetch/);
  assert.doesNotMatch(requestDomain, /return await fetch\(url/);
  assert.match(settings, /purpose: "Discord webhook"/);
  assert.match(settings, /allowedHosts: \["discord\.com", "discordapp\.com"\]/);
  assert.match(settings, /purpose: "Git integration"/);
  assert.match(projectIntegrations, /giteaAllowPrivateNetwork/);
  assert.match(authDiscord, /purpose: "Discord OAuth"/);
  assert.match(model, /giteaAllowPrivateNetwork\?: boolean/);
  assert.match(configRoutes, /!existing\.giteaAllowPrivateNetwork && body\.giteaAllowPrivateNetwork === true/);
  assert.match(securityDoc, /DNS rebinding/);
  assert.match(securityDoc, /Link-local and metadata-style ranges are always blocked/);
});

test("v0.354 secret and configuration custody is encrypted, rotatable, and recovery-safe", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const crypto = await read("apps/server/src/core/setting-crypto.ts");
  const runtime = await read("apps/server/src/core/runtime-config.ts");
  const settings = await read("apps/server/src/app/server-services-settings-integrations.ts");
  const requestDomain = await read("apps/server/src/app/server-services-request-domain.ts");
  const sessionSecurity = await read("apps/server/src/core/session-security.ts");
  const operations = await read("apps/server/src/app/server-services-operations.ts");
  const backup = await read("apps/server/src/core/database-backup.ts");
  const launcher = await read("apps/server-launcher-go/main.go");
  const packager = await read("tools/scripts/package-cluster-master.mjs");
  const securityDoc = await read("docs/SECRET_CONFIGURATION_SECURITY.md");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(crypto, /const ENCRYPTION_PREFIX = "enc:v2:"/);
  assert.match(crypto, /crypto\.hkdfSync/);
  assert.match(crypto, /CLUSTER_SECRET_KEY_PREVIOUS/);
  assert.match(crypto, /Production requires CLUSTER_SECRET_KEY/);
  assert.match(crypto, /distinct from SESSION_SECRET/);
  assert.match(runtime, /validateSecretEncryptionConfiguration/);
  assert.match(runtime, /req\.body\.databaseUrlOverride/);
  assert.match(settings, /SENSITIVE_SETTING_KEYS\.has\(key\)/);
  assert.match(settings, /secretPolicy: "server-managed-only"/);
  assert.match(settings, /encryptBootSettingStorageValue/);
  assert.match(settings, /migrateContextPackEncryption/);
  assert.match(settings, /databaseUrlOverride: maskConfiguredSecret/);
  assert.match(requestDomain, /"discordWebhookUrl".*"discordBotToken"/s);
  assert.match(requestDomain, /"giteaToken"/);
  assert.match(sessionSecurity, /path\.endsWith\("\/export"\)/);
  assert.match(operations, /keyIncluded: false/);
  assert.match(operations, /Cluster backups never copy secret-key material/);
  assert.match(backup, /chmod\(dumpPath, 0o600\)/);
  assert.match(launcher, /CLUSTER_SECRET_KEY_PREVIOUS/);
  assert.match(launcher, /os\.Chmod\(file, 0o600\)/);
  assert.match(packager, /forbiddenSecretFile/);
  assert.match(packager, /\.env\.production/);
  assert.match(securityDoc, /Cluster backups never contain `CLUSTER_SECRET_KEY`/);
  assert.match(securityDoc, /Key rotation/);
});

test("v0.355 security audit trail is append-only, tamper-evident, and centrally covered", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const schema = await read("apps/server/prisma/schema.prisma");
  const migration = await read("apps/server/prisma/migrations/20260812060000_security_audit_integrity/migration.sql");
  const integrity = await read("apps/server/src/core/security-audit-integrity.ts");
  const store = await read("apps/server/src/core/security-audit-store.ts");
  const policy = await read("apps/server/src/core/security-audit-policy.ts");
  const repository = await read("apps/server/src/domains/audit/audit-repository.ts");
  const service = await read("apps/server/src/domains/audit/audit-service.ts");
  const routes = await read("apps/server/src/domains/audit/audit-routes.ts");
  const server = await read("apps/server/src/app/cluster-server.ts");
  const operations = await read("apps/server/src/app/server-services-operations.ts");
  const sessionSecurity = await read("apps/server/src/core/session-security.ts");
  const securityDoc = await read("docs/SECURITY_AUDIT_TRAIL.md");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(schema, /integrityVersion Int\s+@default\(0\)/);
  assert.match(schema, /previousHash\s+String\?/);
  assert.match(schema, /eventHash\s+String\?/);
  assert.match(migration, /SecurityAuditEvent_v1_sequence_key/);
  assert.match(migration, /SecurityAuditEvent_eventHash_key/);
  assert.match(integrity, /SECURITY_AUDIT_GENESIS_HASH/);
  assert.match(integrity, /computeSecurityAuditHash/);
  assert.match(integrity, /verifySecurityAuditChain/);
  assert.match(integrity, /SECURITY_AUDIT_METADATA_MAX_BYTES = 32 \* 1024/);
  assert.match(store, /pg_advisory_xact_lock/);
  assert.match(store, /appendSecurityAuditEvent/);
  assert.match(store, /LEGACY:/);
  assert.match(repository, /appendSecurityAuditEvent/);
  assert.match(service, /security\.audit_write_failed|SECURITY_AUDIT_WRITE_FAILED/);
  assert.match(policy, /request\.\$\{category\}_mutation/);
  assert.match(server, /securityAuditPolicyForRequest/);
  assert.match(routes, /\/api\/security\/events\/integrity/);
  assert.match(routes, /\/api\/security\/events\/export/);
  assert.match(routes, /X-Cluster-Audit-Digest-SHA256/);
  assert.match(sessionSecurity, /\/api\/security\/events\/export/);
  assert.doesNotMatch(operations, /securityAuditEvent\.deleteMany/);
  assert.match(securityDoc, /append-only integrity trail/i);
  assert.match(securityDoc, /does \*\*not\*\* claim that pre-v0\.355 rows have retroactive tamper evidence/i);
});


test("v0.356 API workload is cost-aware, body-bounded, and backpressured", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const workload = await read("apps/server/src/core/request-workload.ts");
  const limiter = await read("apps/server/src/core/rate-limit.ts");
  const server = await read("apps/server/src/app/cluster-server.ts");
  const requestDomain = await read("apps/server/src/app/server-services-request-domain.ts");
  const contract = await read("packages/shared/src/api-contracts.ts");
  const securityDoc = await read("docs/API_ABUSE_RESOURCE_SECURITY.md");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(workload, /RequestWorkClass = "normal" \| "heavy" \| "critical"/);
  assert.match(workload, /bodyLimitBytes: Math\.min\(globalLimit, 2 \* MIB\)/);
  assert.match(workload, /boundedPayloadStream/);
  assert.match(workload, /criticalGlobal: 2/);
  assert.match(workload, /heavyPerClient: 2/);
  assert.match(limiter, /consumeCost/);
  assert.match(requestDomain, /rateLimiter\.consumeCost/);
  assert.match(server, /X-Cluster-Request-Cost/);
  assert.match(server, /X-Cluster-Work-Class/);
  assert.match(server, /boundedPayloadStream\(payload, policy\.bodyLimitBytes\)/);
  assert.match(server, /concurrentWorkLimiter\.acquire/);
  assert.match(server, /X-Cluster-Backpressure/);
  assert.match(server, /requestWorkReleases/);
  assert.match(contract, /cost-aware-backpressure/);
  assert.match(securityDoc, /chunked requests cannot bypass/);
});


test("v0.357 mutation delivery is durable, idempotent, and revision-safe", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const schema = await read("apps/server/prisma/schema.prisma");
  const migration = await read("apps/server/prisma/migrations/20260816053000_mutation_integrity/migration.sql");
  const idempotency = await read("apps/server/src/core/idempotency.ts");
  const storage = await read("apps/server/src/core/storage-migrations.ts");
  const apiClient = await read("packages/api-client/src/index.ts");
  const rendererApi = await read("packages/renderer/src/core/api.ts");
  const timeline = await read("apps/server/src/domains/planning/timeline-routes.ts");
  const library = await read("apps/server/src/domains/library/library-routes.ts");
  const projects = await read("apps/server/src/domains/projects/project-routes.ts");
  const whiteboards = await read("apps/server/src/app/server-routes-media-whiteboards.ts");
  const contract = await read("packages/shared/src/api-contracts.ts");
  const integrityDoc = await read("docs/MUTATION_DATA_INTEGRITY.md");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(schema, /model ApiMutationReceipt/);
  assert.match(schema, /@@unique\(\[userId, method, path, idempotencyKey\]\)/);
  assert.match(migration, /ApiMutationReceipt_userId_method_path_idempotencyKey_key/);
  assert.match(idempotency, /apiMutationReceipt\.create/);
  assert.match(idempotency, /IDEMPOTENCY_IN_PROGRESS/);
  assert.match(idempotency, /IDEMPOTENCY_RESULT_UNKNOWN/);
  assert.match(idempotency, /state: "uncertain"/);
  assert.match(storage, /ApiMutationReceipt_state_updatedAt_idx/);
  assert.match(apiClient, /needsIdempotency\(pathname, method\)/);
  assert.match(apiClient, /X-Cluster-Idempotency-Key/);
  assert.match(rendererApi, /mutationIdempotencyKey\(headers\)/);
  assert.match(rendererApi, /queueOfflineMutation\([\s\S]*idempotencyKey/);
  assert.match(timeline, /timelineItem\.updateMany/);
  assert.match(library, /knowledgeItem\.updateMany/);
  assert.match(library, /data\.revision = \{ increment: 1 \}/);
  assert.match(projects, /project\.updateMany/);
  assert.match(whiteboards, /whiteboard\.deleteMany/);
  assert.match(contract, /mutation-integrity-v2/);
  assert.match(contract, /mutationIdempotency: "durable-preclaim"/);
  assert.match(integrityDoc, /does not claim global exactly-once delivery/);
});

test("v0.358 offline sync is signed, authorization-aware, and replay-safe", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const syncSecurity = await read("apps/server/src/core/sync-security.ts");
  const syncRoutes = await read("apps/server/src/domains/sync/sync-routes.ts");
  const syncRepository = await read("apps/server/src/domains/sync/sync-control-repository.ts");
  const library = await read("apps/server/src/domains/library/library-routes.ts");
  const rendererApi = await read("packages/renderer/src/core/api.ts");
  const deltaSync = await read("packages/renderer/src/core/delta-sync.ts");
  const offlineStorage = await read("packages/renderer/src/core/offline-storage.ts");
  const contract = await read("packages/shared/src/api-contracts.ts");
  const syncDoc = await read("docs/SYNC_INTEGRITY_SECURITY.md");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(syncSecurity, /createHmac\("sha256"/);
  assert.match(syncSecurity, /timingSafeEqual/);
  assert.match(syncSecurity, /scope_changed/);
  assert.match(syncRoutes, /decodeSyncCursor<DeltaCursor>/);
  assert.match(syncRoutes, /authorizedStreamPage/);
  assert.match(syncRoutes, /hasTargetAccess\(user, role, "board"/);
  assert.match(syncRoutes, /hasToolPermission\(user, role, "tickets", "view"\)/);
  assert.match(syncRoutes, /canonicalSyncMutationPath/);
  assert.match(syncRoutes, /containsSensitiveSyncValue/);
  assert.match(syncRoutes, /sanitizeSyncHeaders/);
  assert.doesNotMatch(syncRoutes, /await syncControl\.receipt\(/);
  assert.match(syncRepository, /clusterSyncDevice\.upsert/);
  assert.match(syncRepository, /ownershipConflict: true/);
  assert.doesNotMatch(syncRepository, /INSERT OR IGNORE|CREATE TABLE IF NOT EXISTS|\$queryRawUnsafe/);
  assert.match(library, /visibleOverflow \? visible\.at\(-1\) : candidates\.at\(-1\)/);
  assert.match(rendererApi, /`\$\{SYNC_DEVICE_ID_KEY\}:\$\{scope\}`/);
  assert.match(deltaSync, /response\.resetReason === "scope_changed"/);
  assert.match(deltaSync, /invalidateApiQueries\(\)/);
  assert.match(deltaSync, /clearOfflineReadScope\(\)/);
  assert.match(deltaSync, /resetSyncDeviceId/);
  assert.match(offlineStorage, /export async function clearOfflineReadScope/);
  assert.match(contract, /sync-integrity-v2/);
  assert.match(contract, /signedScopeBoundCursors: true/);
  assert.match(syncDoc, /same server-side capability and target-access rules/);
  assert.match(syncDoc, /Pending mutations and pending uploads are deliberately preserved/);
});


test("v0.359 backups are portable, filesystem-complete, signed, and restore-drilled", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const filesystemBackup = await read("apps/server/src/core/filesystem-backup.ts");
  const databaseRecovery = await read("apps/server/src/core/database-recovery.ts");
  const backupManifest = await read("apps/server/src/core/backup-manifest.ts");
  const databaseBackup = await read("apps/server/src/core/database-backup.ts");
  const postgresqlRuntime = await read("apps/server/src/core/postgresql-runtime.ts");
  const operations = await read("apps/server/src/app/server-services-operations.ts");
  const configurationRoutes = await read("apps/server/src/app/server-routes-configuration-integrations.ts");
  const contract = await read("packages/shared/src/api-contracts.ts");
  const recoveryDoc = await read("docs/DATABASE_RECOVERY_RESILIENCE.md");
  const packager = await read("tools/scripts/package-cluster-master.mjs");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(operations, /schemaVersion: 2/);
  assert.match(operations, /\.uploads\.tar/);
  assert.match(operations, /\.branding\.tar/);
  assert.match(operations, /createFilesystemBackup/);
  assert.match(operations, /verifyBackupManifestSignature/);
  assert.match(operations, /protectedManifests = new Set\(manifests\.slice\(0, 3\)\)/);
  assert.match(backupManifest, /signWithClusterSecret\("backup-manifest-v2"/);
  assert.match(backupManifest, /verifyClusterSecretSignature\("backup-manifest-v2"/);
  assert.match(filesystemBackup, /isSymbolicLink\(\)/);
  assert.match(filesystemBackup, /Filesystem restore path escaped/);
  assert.match(databaseBackup, /\.partial-/);
  assert.match(databaseRecovery, /CREATE DATABASE/);
  assert.match(databaseRecovery, /pg_restore/);
  assert.match(databaseRecovery, /DROP DATABASE IF EXISTS/);
  assert.match(postgresqlRuntime, /requires a writable PostgreSQL primary/);
  assert.match(configurationRoutes, /backupTimezoneSchema/);
  assert.match(configurationRoutes, /runServerRestoreDrill/);
  assert.match(contract, /backup-recovery-v2/);
  assert.match(recoveryDoc, /does \*\*not\*\* provide PostgreSQL point-in-time recovery or WAL archiving/);
  assert.match(recoveryDoc, /Backups should be copied off-host/);
  assert.ok((packager.match(/docs\/DATABASE_RECOVERY_RESILIENCE\.md/g) || []).length >= 2);
});


test("v0.360 operational health separates liveness, readiness, and admin diagnostics", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const operational = await read("apps/server/src/core/operational-health.ts");
  const healthRoutes = await read("apps/server/src/app/server-routes-health-operations.ts");
  const server = await read("apps/server/src/app/cluster-server.ts");
  const routePolicy = await read("apps/server/src/domains/access/route-policy.ts");
  const contract = await read("packages/shared/src/api-contracts.ts");
  const healthDoc = await read("docs/OPERATIONAL_HEALTH_RESILIENCE.md");
  const packager = await read("tools/scripts/package-cluster-master.mjs");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(operational, /class WritableStorageProbe/);
  assert.match(operational, /class OperationalHealthHistory/);
  assert.match(operational, /this\.incidents\.length > 64/);
  assert.match(operational, /state = "unavailable"/);
  assert.match(healthRoutes, /app\.get\("\/health\/live"/);
  assert.match(healthRoutes, /app\.get\("\/health\/ready"/);
  assert.match(healthRoutes, /writableStorageProbe\.check\(\)/);
  assert.match(healthRoutes, /app\.get\("\/api\/admin\/operations\/health"/);
  assert.match(healthRoutes, /app\.get\("\/api\/admin\/operations\/incidents"/);
  assert.match(routePolicy, /"\/health\/live", "\/health\/ready"/);
  assert.match(server, /if \(!operational\.ready\) throw new Error/);
  assert.ok(server.indexOf('if (!operational.ready) throw new Error') < server.lastIndexOf('jobRuntime.start();'));
  assert.match(server, /reply\.header\("Connection", "close"\)/);
  assert.match(contract, /operational-health-v1/);
  assert.match(healthDoc, /process-liveness endpoint/);
  assert.match(healthDoc, /traffic-readiness endpoint/);
  assert.ok((packager.match(/docs\/OPERATIONAL_HEALTH_RESILIENCE\.md/g) || []).length >= 2);
});


test("v0.361 final release certification is revision-bound, lock-backed, and public-signing aware", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const release = await read(".github/workflows/release.yml");
  const packager = await read("tools/scripts/package-cluster-master.mjs");
  const verifier = await read("tools/scripts/release-verify-artifacts.mjs");
  const evidence = await read("tools/scripts/release-evidence-lib.mjs");
  const ledger = await read("tools/scripts/release-certification-ledger.mjs");
  const sbom = await read("tools/scripts/release-sbom.mjs");
  const signing = await read("tools/scripts/release-verify-windows-signatures.mjs");
  const releaseDoc = await read("docs/RELEASE_CERTIFICATION_SUPPLY_CHAIN.md");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(evidence, /recordHash/);
  assert.match(evidence, /sourceRevision/);
  assert.match(ledger, /dependency-audit/);
  assert.match(ledger, /backup-restore/);
  assert.match(ledger, /upgrade-drill/);
  assert.match(ledger, /desktop-smoke/);
  assert.match(ledger, /publicDistributionReady/);
  assert.match(sbom, /SPDX-2\.3/);
  assert.match(sbom, /--require-lock/);
  assert.match(packager, /schema: 3/);
  assert.match(packager, /CERTIFICATION_EVIDENCE\.json/);
  assert.match(packager, /SBOM\.spdx\.json/);
  assert.match(packager, /CLUSTER_RELEASE_REUSE_NATIVE/);
  assert.match(verifier, /runtimeDependencyLockSha256/);
  assert.match(verifier, /assertAuthenticode/);
  assert.match(signing, /Get-AuthenticodeSignature/);
  assert.match(release, /--gate=dependency-audit/);
  assert.match(release, /--gate=backup-restore/);
  assert.match(release, /--gate=upgrade-drill/);
  assert.match(release, /--gate=desktop-smoke/);
  assert.match(release, /release:sign-windows/);
  assert.match(release, /release:sign-installer/);
  assert.match(release, /release:verify-windows-signatures/);
  assert.doesNotMatch(release, /Attest Cluster Master provenance[\s\S]{0,80}continue-on-error:\s*true/);
  assert.match(releaseDoc, /local-unattested/);
  assert.match(releaseDoc, /ci-certified/);
  assert.match(releaseDoc, /public-signed/);
});


test("v0.362 privacy policy publication is public, versioned, immutable, and admin-controlled", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const schema = await read("apps/server/prisma/schema.prisma");
  const migration = await read("apps/server/prisma/migrations/20260819010000_privacy_policy_system/migration.sql");
  const core = await read("apps/server/src/core/privacy-policy.ts");
  const routes = await read("apps/server/src/domains/legal/privacy-policy-routes.ts");
  const routePolicy = await read("apps/server/src/domains/access/route-policy.ts");
  const renderer = await read("packages/renderer/src/features/legal/PrivacyPolicyPage.tsx");
  const admin = await read("packages/renderer/src/features/legal/PrivacyPolicyAdminPanel.tsx");
  const app = await readApplicationDomain();
  const auth = await read("packages/renderer/src/features/auth/AuthScreens.tsx");
  const contract = await read("packages/shared/src/api-contracts.ts");
  const policyDoc = await read("docs/PRIVACY_POLICY_SYSTEM.md");
  const packager = await read("tools/scripts/package-cluster-master.mjs");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(schema, /model LegalPolicyVersion/);
  assert.match(schema, /@@unique\(\[kind, version\]\)/);
  assert.match(migration, /CREATE TABLE "LegalPolicyVersion"/);
  assert.match(core, /createHash\("sha256"\)/);
  assert.match(core, /starterPrivacyPolicy/);
  assert.match(routes, /app\.get\("\/api\/public\/legal\/privacy"/);
  assert.match(routes, /app\.post\("\/api\/admin\/legal\/privacy\/versions"/);
  assert.match(routes, /existing\.status !== "draft"/);
  assert.doesNotMatch(routes, /status: "published"[\s\S]{0,300}updateMany/);
  assert.match(routePolicy, /\/api\/public\/legal\/privacy/);
  assert.match(renderer, /PolicyMarkdown/);
  assert.doesNotMatch(renderer, /dangerouslySetInnerHTML/);
  assert.match(admin, /Publish version/);
  assert.match(app, /privacyPolicyPath/);
  assert.match(auth, /href="\/legal\/privacy"/);
  assert.match(auth, /Authorized access only/);
  assert.match(contract, /privacy-policy-v1/);
  assert.match(policyDoc, /never silently publishes a generic template/);
  assert.ok((packager.match(/docs\/PRIVACY_POLICY_SYSTEM\.md/g) || []).length >= 2);
});



test("v0.363 consent management gates optional browser state and external embeds", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const schema = await read("apps/server/prisma/schema.prisma");
  const migration = await read("apps/server/prisma/migrations/20260819020000_privacy_consent_management/migration.sql");
  const core = await read("apps/server/src/core/privacy-consent.ts");
  const routes = await read("apps/server/src/domains/legal/privacy-consent-routes.ts");
  const routePolicy = await read("apps/server/src/domains/access/route-policy.ts");
  const rendererConsent = await read("packages/renderer/src/core/privacy-consent.ts");
  const manager = await read("packages/renderer/src/features/legal/PrivacyConsentManager.tsx");
  const library = await read("packages/renderer/src/features/library/LibraryMediaPreview.tsx");
  const app = await readApplicationDomain();
  const media = await read("packages/renderer/src/features/library/LibraryMediaPlayer.tsx");
  const search = await read("packages/renderer/src/features/search/search-ranking.ts");
  const webMain = await read("apps/web/src/main.tsx");
  const contract = await read("packages/shared/src/api-contracts.ts");
  const consentDoc = await read("docs/PRIVACY_CONSENT_STORAGE.md");
  const packager = await read("tools/scripts/package-cluster-master.mjs");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(schema, /model PrivacyConsentPreference/);
  assert.match(migration, /CREATE TABLE "PrivacyConsentPreference"/);
  assert.match(migration, /PrivacyConsentPreference_userId_key/);
  assert.match(core, /analyticsProviders: \[\]/);
  assert.match(core, /available: false/);
  assert.match(routes, /app\.get\("\/api\/public\/privacy\/consent-config"/);
  assert.match(routes, /app\.put\("\/api\/privacy\/consent"/);
  assert.match(routes, /PRIVACY_CONSENT_NOTICE_STALE/);
  assert.match(routePolicy, /\/api\/public\/privacy\/consent-config/);
  assert.match(rendererConsent, /OPTIONAL_PREFERENCE_PATTERNS/);
  assert.match(rendererConsent, /clearOptionalPreferenceStorage/);
  assert.doesNotMatch(rendererConsent, /localStorage\.clear/);
  assert.match(manager, /Reject optional/);
  assert.match(manager, /Customize/);
  assert.match(manager, /Accept optional/);
  assert.match(library, /externalContentAllowed/);
  assert.match(library, /External preview blocked/);
  assert.match(app, /writePreferenceStorage\(THEME_STORAGE_KEY/);
  assert.match(media, /writePreferenceStorage\("cluster-media-volume"/);
  assert.match(search, /writePreferenceStorage/);
  assert.match(webMain, /cluster-privacy-consent-v1/);
  assert.match(contract, /privacy-consent-v1/);
  assert.match(consentDoc, /does not load third-party behavioral analytics SDKs/);
  assert.ok((packager.match(/docs\/PRIVACY_CONSENT_STORAGE\.md/g) || []).length >= 2);
});

test("v0.364 privacy data control center provides bounded self-service data rights", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const schema = await read("apps/server/prisma/schema.prisma");
  const migration = await read("apps/server/prisma/migrations/20260819033000_privacy_data_control_center/migration.sql");
  const core = await read("apps/server/src/core/privacy-data-control.ts");
  const routes = await read("apps/server/src/domains/legal/privacy-data-routes.ts");
  const sessionSecurity = await read("apps/server/src/core/session-security.ts");
  const storage = await read("apps/server/src/core/storage-migrations.ts");
  const center = await read("packages/renderer/src/features/legal/PrivacyDataControlCenter.tsx");
  const settings = await readSettingsDomain();
  const contract = await read("packages/shared/src/api-contracts.ts");
  const privacyDoc = await read("docs/PRIVACY_DATA_CONTROL_CENTER.md");
  const packager = await read("tools/scripts/package-cluster-master.mjs");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(schema, /model PrivacyDataRequest/);
  assert.match(migration, /CREATE TABLE "PrivacyDataRequest"/);
  assert.match(storage, /"PrivacyDataRequest"/);
  assert.match(core, /PRIVACY_EXPORT_MAX_RECORDS_PER_CATEGORY = 2500/);
  assert.match(core, /privacyProfileSnapshot/);
  assert.doesNotMatch(core, /snapshot\.passwordHash/);
  assert.match(routes, /app\.get\("\/api\/privacy\/data-summary"/);
  assert.match(routes, /app\.post\("\/api\/privacy\/data-export"/);
  assert.match(routes, /app\.post\("\/api\/privacy\/data-requests"/);
  assert.match(routes, /automaticDeletion: false/);
  assert.match(routes, /app\.delete\("\/api\/privacy\/integrations\/discord"/);
  assert.match(routes, /requireDiscordLink/);
  assert.match(sessionSecurity, /\/api\/privacy\/data-export/);
  assert.match(sessionSecurity, /\/api\/privacy\/data-requests/);
  assert.match(sessionSecurity, /\/api\/privacy\/integrations\/discord/);
  assert.match(center, /Download my data/);
  assert.match(center, /Request account-data deletion/);
  assert.match(center, /Disconnect Discord/);
  assert.match(settings, /PrivacyDataControlCenter/);
  assert.match(contract, /privacy-data-controls-v1/);
  assert.match(privacyDoc, /does not determine which privacy law applies/);
  assert.ok((packager.match(/docs\/PRIVACY_DATA_CONTROL_CENTER\.md/g) || []).length >= 2);
});

test("v0.365 data inventory and retention centralizes safe lifecycle cleanup", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const schema = await read("apps/server/prisma/schema.prisma");
  const migration = await read("apps/server/prisma/migrations/20260819050000_data_inventory_retention/migration.sql");
  const core = await read("apps/server/src/core/data-retention.ts");
  const routes = await read("apps/server/src/domains/legal/data-retention-routes.ts");
  const syncRoutes = await read("apps/server/src/domains/sync/sync-routes.ts");
  const storage = await read("apps/server/src/core/storage-migrations.ts");
  const admin = await read("packages/renderer/src/features/legal/DataRetentionAdminPanel.tsx");
  const settings = await readSettingsDomain();
  const contract = await read("packages/shared/src/api-contracts.ts");
  const retentionDoc = await read("docs/DATA_INVENTORY_RETENTION.md");
  const packager = await read("tools/scripts/package-cluster-master.mjs");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(schema, /model DataRetentionPolicy/);
  assert.match(schema, /model DataRetentionRun/);
  assert.match(migration, /CREATE TABLE "DataRetentionPolicy"/);
  assert.match(storage, /"DataRetentionPolicy"/);
  assert.match(core, /CONFIGURABLE_RETENTION_POLICIES/);
  assert.match(core, /prisma\.\$transaction\(operations\)/);
  assert.doesNotMatch(core, /securityAuditEvent\.deleteMany/);
  assert.match(routes, /\/api\/admin\/privacy\/data-inventory/);
  assert.match(routes, /\/api\/admin\/privacy\/retention-preview/);
  assert.match(routes, /"APPLY DATA RETENTION"/);
  assert.doesNotMatch(syncRoutes, /lastTombstoneCleanupAt/);
  assert.match(admin, /Protected \/ manual data/);
  assert.match(admin, /Refresh dry run/);
  assert.match(settings, /LegalComplianceCenter/);
  assert.match(contract, /data-retention-v1/);
  assert.match(contract, /privacy: 6/);
  assert.match(retentionDoc, /SecurityAuditEvent/);
  assert.ok((packager.match(/docs\/DATA_INVENTORY_RETENTION\.md/g) || []).length >= 2);
});

test("v0.366 Terms of Service publication is public, versioned, immutable, and not acceptance", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const schema = await read("apps/server/prisma/schema.prisma");
  const core = await read("apps/server/src/core/terms-policy.ts");
  const routes = await read("apps/server/src/domains/legal/terms-policy-routes.ts");
  const routePolicy = await read("apps/server/src/domains/access/route-policy.ts");
  const renderer = await read("packages/renderer/src/features/legal/TermsPolicyPage.tsx");
  const admin = await read("packages/renderer/src/features/legal/TermsPolicyAdminPanel.tsx");
  const app = await readApplicationDomain();
  const auth = await read("packages/renderer/src/features/auth/AuthScreens.tsx");
  const settings = await readSettingsDomain();
  const contract = await read("packages/shared/src/api-contracts.ts");
  const policyDoc = await read("docs/TERMS_OF_SERVICE_SYSTEM.md");
  const packager = await read("tools/scripts/package-cluster-master.mjs");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(schema, /model LegalPolicyVersion/);
  assert.match(schema, /@@unique\(\[kind, version\]\)/);
  assert.match(core, /TERMS_POLICY_KIND = "terms"/);
  assert.match(core, /createHash\("sha256"\)/);
  assert.match(core, /starterTermsPolicy/);
  assert.match(core, /\[LEGAL REVIEW REQUIRED\]/);
  assert.match(routes, /app\.get\("\/api\/public\/legal\/terms"/);
  assert.match(routes, /app\.post\("\/api\/admin\/legal\/terms\/versions"/);
  assert.match(routes, /existing\.status !== "draft"/);
  assert.match(routes, /acceptanceTrackingImplemented: true/);
  assert.doesNotMatch(routes, /status: "published"[\s\S]{0,300}starterTermsPolicy/);
  assert.match(routePolicy, /\/api\/public\/legal\/terms/);
  assert.match(renderer, /PolicyMarkdown/);
  assert.doesNotMatch(renderer, /dangerouslySetInnerHTML/);
  assert.match(admin, /Publish version/);
  assert.match(app, /termsPolicyPath/);
  assert.match(app, /href="\/legal\/terms"/);
  assert.doesNotMatch(auth, /Terms of Service/);
  assert.match(settings, /LegalComplianceCenter/);
  assert.match(contract, /terms-policy-v1/);
  assert.match(contract, /legal: 9/);
  assert.match(policyDoc, /does \*\*not\*\*:/);
  assert.match(policyDoc, /Roadmap Step 17 is implemented in v0\.378\.0/);
  assert.ok((packager.match(/docs\/TERMS_OF_SERVICE_SYSTEM\.md/g) || []).length >= 2);
});


test("v0.367 Server Operator Agreement is distinct, immutable, public-readable, and not acceptance", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const schema = await read("apps/server/prisma/schema.prisma");
  const core = await read("apps/server/src/core/operator-agreement.ts");
  const routes = await read("apps/server/src/domains/legal/operator-agreement-routes.ts");
  const routePolicy = await read("apps/server/src/domains/access/route-policy.ts");
  const renderer = await read("packages/renderer/src/features/legal/OperatorAgreementPage.tsx");
  const admin = await read("packages/renderer/src/features/legal/OperatorAgreementAdminPanel.tsx");
  const app = await readApplicationDomain();
  const settings = await readSettingsDomain();
  const contract = await read("packages/shared/src/api-contracts.ts");
  const policyDoc = await read("docs/SERVER_OPERATOR_AGREEMENT.md");
  const packager = await read("tools/scripts/package-cluster-master.mjs");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(schema, /model LegalPolicyVersion/);
  assert.match(core, /OPERATOR_AGREEMENT_KIND = "operator_agreement"/);
  assert.match(core, /createHash\("sha256"\)/);
  assert.match(core, /starterOperatorAgreement/);
  assert.match(core, /\[CLUSTER LICENSOR \/ DISTRIBUTOR LEGAL NAME\]/);
  assert.match(core, /\[LEGAL REVIEW REQUIRED\]/);
  assert.match(routes, /app\.get\("\/api\/public\/legal\/operator-agreement"/);
  assert.match(routes, /app\.post\("\/api\/admin\/legal\/operator-agreement\/versions"/);
  assert.match(routes, /existing\.status !== "draft"/);
  assert.match(routes, /intendedAudience: "server-operator"/);
  assert.match(routes, /acceptanceTrackingImplemented: true/);
  assert.match(routePolicy, /\/api\/public\/legal\/operator-agreement/);
  assert.match(renderer, /PolicyMarkdown/);
  assert.doesNotMatch(renderer, /dangerouslySetInnerHTML/);
  assert.match(admin, /Publish version/);
  assert.match(app, /operatorAgreementPath/);
  assert.match(settings, /LegalComplianceCenter/);
  assert.match(contract, /server-operator-agreement-v1/);
  assert.match(contract, /legal: 9/);
  assert.match(policyDoc, /not the operator's Terms of Service/);
  assert.match(policyDoc, /Roadmap Step 17 is implemented in v0\.378\.0/);
  assert.ok((packager.match(/docs\/SERVER_OPERATOR_AGREEMENT\.md/g) || []).length >= 2);
});

test("v0.368 Copyright / DMCA Policy is versioned, public-readable, immutable, and not a workflow", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const schema = await read("apps/server/prisma/schema.prisma");
  const core = await read("apps/server/src/core/copyright-policy.ts");
  const routes = await read("apps/server/src/domains/legal/copyright-policy-routes.ts");
  const routePolicy = await read("apps/server/src/domains/access/route-policy.ts");
  const renderer = await read("packages/renderer/src/features/legal/CopyrightPolicyPage.tsx");
  const admin = await read("packages/renderer/src/features/legal/CopyrightPolicyAdminPanel.tsx");
  const app = await readApplicationDomain();
  const settings = await readSettingsDomain();
  const contract = await read("packages/shared/src/api-contracts.ts");
  const policyDoc = await read("docs/COPYRIGHT_DMCA_POLICY.md");
  const packager = await read("tools/scripts/package-cluster-master.mjs");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(schema, /model LegalPolicyVersion/);
  assert.match(core, /COPYRIGHT_POLICY_KIND = "copyright_dmca"/);
  assert.match(core, /createHash\("sha256"\)/);
  assert.match(core, /starterCopyrightPolicy/);
  assert.match(core, /does not by itself establish eligibility/);
  assert.match(core, /U\.S\. Copyright Office/);
  assert.match(core, /17 U\.S\.C\. § 512\(c\)\(3\)/);
  assert.match(core, /17 U\.S\.C\. § 512\(g\)/);
  assert.match(routes, /app\.get\("\/api\/public\/legal\/copyright"/);
  assert.match(routes, /app\.post\("\/api\/admin\/legal\/copyright\/versions"/);
  assert.match(routes, /existing\.status !== "draft"/);
  assert.match(routes, /reportingWorkflowImplemented: true/);
  assert.match(routes, /safeHarborEligibilityClaimed: false/);
  assert.match(routePolicy, /\/api\/public\/legal\/copyright/);
  assert.match(renderer, /PolicyMarkdown/);
  assert.doesNotMatch(renderer, /dangerouslySetInnerHTML/);
  assert.match(admin, /Publish version/);
  assert.match(app, /copyrightPolicyPath/);
  assert.match(settings, /LegalComplianceCenter/);
  assert.match(contract, /copyright-dmca-policy-v1/);
  assert.match(contract, /legal: 9/);
  assert.match(policyDoc, /does not claim/);
  assert.match(policyDoc, /COPYRIGHT_REPORTING_WORKFLOW/);
  assert.match(policyDoc, /Roadmap Step 17/);
  assert.ok((packager.match(/docs\/COPYRIGHT_DMCA_POLICY\.md/g) || []).length >= 2);
});


test("v0.369 Copyright Reporting Workflow is durable, reversible, authorization-bound, and auditable", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const schema = await read("apps/server/prisma/schema.prisma");
  const migration = await read("apps/server/prisma/migrations/20260819032000_copyright_reporting_workflow/migration.sql");
  const core = await read("apps/server/src/core/copyright-workflow.ts");
  const routes = await read("apps/server/src/domains/legal/copyright-workflow-routes.ts");
  const policyRoutes = await read("apps/server/src/domains/legal/copyright-policy-routes.ts");
  const mediaRoutes = await read("apps/server/src/app/server-routes-media-whiteboards.ts");
  const libraryRoutes = await read("apps/server/src/domains/library/library-routes.ts");
  const accessMedia = await read("apps/server/src/app/server-routes-access-media.ts");
  const routePolicy = await read("apps/server/src/domains/access/route-policy.ts");
  const workload = await read("apps/server/src/core/request-workload.ts");
  const reportPage = await read("packages/renderer/src/features/legal/CopyrightReportPage.tsx");
  const counterPage = await read("packages/renderer/src/features/legal/CopyrightCounterNoticePage.tsx");
  const adminPanel = await read("packages/renderer/src/features/legal/CopyrightWorkflowAdminPanel.tsx");
  const settings = await readSettingsDomain();
  const contract = await read("packages/shared/src/api-contracts.ts");
  const docs = await read("docs/COPYRIGHT_REPORTING_WORKFLOW.md");
  const errorCodes = await read("packages/shared/src/error-codes.ts");
  const packager = await read("tools/scripts/package-cluster-master.mjs");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(schema, /model CopyrightCase/);
  assert.match(schema, /model CopyrightCounterNotice/);
  assert.match(schema, /model CopyrightEvidence/);
  assert.match(schema, /model CopyrightResourceRestriction/);
  assert.match(schema, /model CopyrightStrike/);
  assert.match(migration, /CREATE TABLE "CopyrightCase"/);
  assert.match(migration, /CREATE UNIQUE INDEX "CopyrightResourceRestriction_active_resource_key"/);
  assert.match(core, /COPYRIGHT_EVIDENCE_MAX_FILE_BYTES/);
  assert.match(core, /addBusinessDays/);
  assert.match(core, /COPYRIGHT_ACCESS_DISABLED/);
  assert.match(routes, /\/api\/public\/copyright\/reports/);
  assert.match(routes, /\/api\/public\/copyright\/cases\/status/);
  assert.match(routes, /\/counter-notice/);
  assert.match(routes, /forward_counter/);
  assert.match(routes, /record_legal_action/);
  assert.match(routes, /restore_access/);
  assert.match(routes, /apply_strike/);
  assert.match(routes, /externalDeliveryConfirmed/);
  assert.match(routes, /restorationEligibleAt/);
  assert.match(policyRoutes, /export function registerCopyrightPolicyRoutes/);
  assert.doesNotMatch(policyRoutes, /export function registerOperatorAgreementRoutes/);
  assert.match(mediaRoutes, /isCopyrightResourceDisabled/);
  assert.match(libraryRoutes, /copyrightDisabledResponse/);
  assert.match(accessMedia, /copyrightResourceRestriction/);
  assert.match(accessMedia, /state: "disabled"/);
  assert.match(routePolicy, /\/api\/public\/copyright\/reports/);
  assert.ok(workload.includes("public\\/copyright\\/reports"));
  assert.match(reportPage, /Submit copyright notice/);
  assert.match(counterPage, /Submit counter-notice/);
  assert.match(adminPanel, /Repeat-infringer review/);
  assert.match(settings, /LegalComplianceCenter/);
  assert.match(contract, /copyright-reporting-workflow-v1/);
  assert.match(contract, /legal: 9/);
  assert.match(errorCodes, /status === 451[^\n]+COPYRIGHT_ACCESS_DISABLED/);
  assert.match(docs, /10- and 14-business-day/);
  assert.match(docs, /does not automatically terminate/);
  assert.match(docs, /does not automatically restore/);
  assert.ok((packager.match(/docs\/COPYRIGHT_REPORTING_WORKFLOW\.md/g) || []).length >= 2);
});


test("v0.370 app-wide accessibility baseline fixes shared semantics and keyboard paths", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const appRoot = await read("packages/renderer/src/App.tsx");
  const manager = await read("packages/renderer/src/components/AccessibilityManager.tsx");
  const select = await read("packages/renderer/src/components/ClusterSelect.tsx");
  const application = await readApplicationDomain();
  const portfolio = await read("packages/renderer/src/features/projects/ProjectPortfolioItem.tsx");
  const board = await read("packages/renderer/src/features/boards/BoardWorkspacePage.tsx");
  const card = await read("packages/renderer/src/features/boards/BoardCardTile.tsx");
  const whiteboard = await read("packages/renderer/src/features/whiteboards/WhiteboardWorkspacePage.tsx");
  const command = await read("packages/renderer/src/features/search/CommandPalette.tsx");
  const create = await read("packages/renderer/src/features/create/SharedCreateDrawer.tsx");
  const css = await read("packages/renderer/src/styles/accessibility.css");
  const contract = await read("packages/shared/src/api-contracts.ts");
  const docs = await read("docs/APP_WIDE_ACCESSIBILITY.md");
  const packager = await read("tools/scripts/package-cluster-master.mjs");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(appRoot, /skip-link-v204/);
  assert.match(appRoot, /<AccessibilityManager \/>/);
  assert.match(manager, /modalCandidateSelector/);
  assert.match(manager, /setAttribute\("inert", ""\)/);
  assert.match(manager, /aria-hidden/);
  assert.match(manager, /inferControlLabel/);
  assert.match(manager, /focusableSelector/);
  assert.match(manager, /if \(!main\.hasAttribute\("tabindex"\)\) main\.tabIndex = -1/);
  assert.match(select, /role="listbox"/);
  assert.match(select, /role="option"/);
  assert.match(select, /aria-activedescendant/);
  assert.doesNotMatch(select, /<button[\s\S]{0,80}role="option"/);
  assert.match(application, /aria-current=\{screen === "dashboard" \? "page"/);
  assert.match(application, /role=\{open \? "dialog" : undefined\}/);
  assert.match(application, /project-tab-close-button-v370/);
  assert.doesNotMatch(application, /role="button"/);
  assert.doesNotMatch(portfolio, /role="button"/);
  assert.match(portfolio, /role="progressbar"/);
  assert.match(board, /KeyboardSensor/);
  assert.match(card, /Press Space to pick up/);
  assert.match(whiteboard, /keyboardNudge/);
  assert.match(whiteboard, /whiteboard-keyboard-instructions-v370/);
  assert.match(command, /role="dialog" aria-modal="true"/);
  assert.match(create, /role="dialog" aria-modal="true"/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /\.sr-only-v370/);
  assert.match(contract, /app-accessibility-v1/);
  assert.match(docs, /Roadmap Step 10/);
  assert.match(docs, /Roadmap Step 11/);
  assert.ok((packager.match(/docs\/APP_WIDE_ACCESSIBILITY\.md/g) || []).length >= 2);
});


test("v0.371 accessibility settings provide system-aware Web and native preferences", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const model = await read("packages/renderer/src/features/application/application-models.ts");
  const preferenceRoutes = await read("apps/server/src/domains/users/user-preference-routes.ts");
  const preferenceCore = await read("packages/renderer/src/core/accessibility-preferences.ts");
  const manager = await read("packages/renderer/src/components/AccessibilityManager.tsx");
  const application = await readApplicationDomain();
  const settings = await readSettingsDomain();
  const css = await read("packages/renderer/src/styles/accessibility.css");
  const desktopHeader = await read("apps/desktop-qt/src/DesktopPreferences.h");
  const desktopSource = await read("apps/desktop-qt/src/DesktopPreferences.cpp");
  const theme = await read("apps/desktop-qt/qml/Theme.qml");
  const nativeSettings = await read("apps/desktop-qt/qml/pages/SettingsPage.qml");
  const contract = await read("packages/shared/src/api-contracts.ts");
  const docs = await read("docs/ACCESSIBILITY_SETTINGS.md");
  const packager = await read("tools/scripts/package-cluster-master.mjs");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(model, /userMotionPreference\?: "system" \| "full" \| "reduced" \| "none"/);
  assert.match(model, /userStatusPalette\?: "default" \| "color-vision-safe" \| "monochrome"/);
  assert.match(model, /userTextScale\?: "default" \| "large" \| "larger" \| "largest"/);
  assert.match(preferenceRoutes, /userTransparencyPreference: z\.enum/);
  assert.match(preferenceRoutes, /userFocusIndicator: z\.enum/);
  assert.match(preferenceCore, /resolveAccessibilityPreferences/);
  assert.match(preferenceCore, /prefers-reduced-transparency/);
  assert.match(manager, /syncSystemAccessibilityPreferences/);
  assert.match(manager, /prefers-contrast: more/);
  assert.match(application, /dataSet|dataset\.statusPalette/);
  assert.match(settings, /150% text/);
  assert.match(settings, /Color-vision safe/);
  assert.match(settings, /Reset accessibility/);
  assert.match(css, /data-status-palette="color-vision-safe"/);
  assert.match(css, /data-text-scale="largest"/);
  assert.match(css, /data-transparency="off"/);
  assert.match(desktopHeader, /Q_PROPERTY\(QString motionMode/);
  assert.match(desktopHeader, /Q_PROPERTY\(QString statusPalette/);
  assert.match(desktopSource, /QAccessibilityHints::contrastPreferenceChanged/);
  assert.match(desktopSource, /SPI_GETCLIENTAREAANIMATION/);
  assert.match(theme, /readonly property real textScale/);
  assert.match(theme, /color-vision-safe/);
  assert.match(nativeSettings, /Larger interaction targets/);
  assert.match(contract, /accessibility-preferences-v1/);
  assert.match(docs, /Roadmap Step 11/);
  assert.ok((packager.match(/docs\/ACCESSIBILITY_SETTINGS\.md/g) || []).length >= 2);
});


test("v0.372 automated accessibility CI is a required runtime and certification gate", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const pkg = JSON.parse(await read("package.json"));
  const ci = await read(".github/workflows/ci.yml");
  const release = await read(".github/workflows/release.yml");
  const runtime = await read("tools/scripts/accessibility-ci.mjs");
  const runtimeLib = await read("tools/scripts/accessibility-ci-lib.mjs");
  const staticAudit = await read("tools/scripts/accessibility-static-audit.mjs");
  const ledger = await read("tools/scripts/release-certification-ledger.mjs");
  const verifier = await read("tools/scripts/release-verify-artifacts.mjs");
  const packager = await read("tools/scripts/package-cluster-master.mjs");
  const localCert = await read("tools/scripts/release-certify-local.mjs");
  const app = await read("packages/renderer/src/App.tsx");
  const login = await read("packages/renderer/src/features/auth/AuthScreens.tsx");
  const docs = await read("docs/AUTOMATED_ACCESSIBILITY_CI.md");

  assert.equal(versions.cluster, "0.422.0");
  assert.equal(pkg.devDependencies.playwright, "1.62.1");
  assert.equal(pkg.devDependencies["axe-core"], "4.12.1");
  assert.match(pkg.scripts["accessibility:static"], /accessibility-static-audit/);
  assert.match(pkg.scripts["accessibility:ci"], /accessibility-ci/);
  assert.match(runtime, /await import\("playwright"\)/);
  assert.match(runtime, /axe-core\/axe\.min\.js/);
  assert.match(runtime, /Public copyright report/);
  assert.match(runtime, /Authenticated home/);
  assert.match(runtime, /Skip link reaches main content/);
  assert.match(runtime, /Command palette traps and restores focus/);
  assert.match(runtime, /accessibility-report\.json/);
  assert.match(runtimeLib, /ACCESSIBILITY_ALWAYS_BLOCK_RULES = new Set\(\["color-contrast"\]\)/);
  assert.match(staticAudit, /fake role=button controls are prohibited/);
  assert.match(staticAudit, /iframe without an accessible title/);
  assert.match(staticAudit, /img without alt text/);
  assert.match(ci, /npx playwright install --with-deps chromium/);
  assert.match(ci, /npm run accessibility:ci/);
  assert.match(ci, /path: \.cluster\/accessibility/);
  assert.match(release, /--gate=accessibility/);
  assert.match(release, /certification-inputs\/accessibility/);
  assert.match(ledger, /"accessibility"/);
  assert.match(ledger, /Certified releases require a passing runtime accessibility report/);
  assert.match(verifier, /Evidence\/accessibility-report\.json/);
  assert.match(packager, /Evidence", "accessibility-report\.json/);
  assert.match(localCert, /--gate=accessibility/);
  assert.match(app, /requestAnimationFrame\(\(\) => document\.getElementById\("cluster-main-content"\)\?\.focus\(\)\)/);
  assert.doesNotMatch(login, /autoFocus/);
  assert.match(docs, /Roadmap Step 12/);
  assert.match(docs, /not a declaration that Cluster is fully conformant/);
  assert.ok((packager.match(/docs\/AUTOMATED_ACCESSIBILITY_CI\.md/g) || []).length >= 2);
});


test("v0.373 direct-resource authorization hostile regression suite covers real object boundaries", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const boundary = await read("apps/server/src/domains/access/request-authorization-boundary.ts");
  const routePolicy = await read("apps/server/src/domains/access/route-policy.ts");
  const unit = await read("tools/tests/unit/direct-resource-authorization.test.ts");
  const integration = await read("tools/tests/integration/direct-resource-authorization.test.ts");
  const contract = await read("packages/shared/src/api-contracts.ts");
  const docs = await read("docs/DIRECT_RESOURCE_AUTHORIZATION_REGRESSION.md");
  const packager = await read("tools/scripts/package-cluster-master.mjs");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(boundary, /pathname\.startsWith\("\/api\/video-comments\/"\)/);
  assert.match(boundary, /videoComment\.findUnique/);
  assert.match(boundary, /comment\.videoAsset\.project/);
  assert.match(boundary, /"video", comment\.videoAsset\.id/);
  assert.match(routePolicy, /path\.startsWith\("\/api\/video-assets"\) \|\| path\.startsWith\("\/api\/video-comments"\)/);
  assert.match(unit, /video comment IDs cannot bypass/);
  assert.match(unit, /generic checklist aliases resolve through card authorization/);
  assert.match(unit, /unknown direct object IDs fail closed/);
  assert.match(integration, /logged-out replay/);
  assert.match(integration, /crossProjectSharePatch/);
  assert.match(integration, /commentAttack\.status, 403/);
  assert.match(integration, /secondShareOpen\.status, 404/);
  assert.match(contract, /direct-resource-authorization-v1/);
  assert.match(docs, /Roadmap Step 12/);
  assert.match(docs, /Roadmap Step 13 is implemented in v0\.374\.0/);
  assert.ok((packager.match(/docs\/DIRECT_RESOURCE_AUTHORIZATION_REGRESSION\.md/g) || []).length >= 2);
});


test("v0.374 logout/session hostile regression rejects captured credential replay", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const authRoutes = await read("apps/server/src/domains/auth/auth-core-routes.ts");
  const sessionRoutes = await read("apps/server/src/domains/sessions/session-routes.ts");
  const collaborationRuntime = await read("apps/server/src/core/collaboration-runtime.ts");
  const collaborationRoutes = await read("apps/server/src/domains/collaboration/collaboration-routes.ts");
  const rendererApi = await read("packages/renderer/src/core/api.ts");
  const collaborationClient = await read("packages/renderer/src/features/collaboration/index.tsx");
  const unit = await read("tools/tests/unit/session-hostile-regression.test.ts");
  const integration = await read("tools/tests/integration/logout-session-regression.test.ts");
  const contract = await read("packages/shared/src/api-contracts.ts");
  const docs = await read("docs/LOGOUT_SESSION_REPLAY_REGRESSION.md");
  const packager = await read("tools/scripts/package-cluster-master.mjs");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(authRoutes, /account\.logged_out/);
  assert.match(authRoutes, /onSessionRevoked\(session\.id, session\.userId, "logout"\)/);
  assert.match(sessionRoutes, /currentSessionRevoked/);
  assert.match(sessionRoutes, /Clear-Site-Data/);
  assert.match(collaborationRuntime, /disconnectSession\(sessionId/);
  assert.match(collaborationRuntime, /const state = \["reauthenticated", "discord_identity_changed"\]\.includes\(reason\) \? "rotated" : "revoked"/);
  assert.match(collaborationRoutes, /sessionId: session\.id/);
  assert.match(rendererApi, /CLUSTER_SESSION_INVALIDATED_EVENT/);
  assert.match(rendererApi, /clearOfflineReadScope\(previousScope\)/);
  assert.match(rendererApi, /sessionCacheGeneration/);
  assert.match(collaborationClient, /sessionControlAction/);
  assert.match(unit, /realtime session control distinguishes revocation from rotation/);
  assert.match(integration, /staleCsrfReplay/);
  assert.match(integration, /protectedReplay\.status, 401/);
  assert.match(integration, /event: session/);
  assert.match(contract, /session-replay-regression-v1/);
  assert.match(docs, /Roadmap Step 13/);
  assert.match(docs, /pending offline mutations and uploads/);
  assert.ok((packager.match(/docs\/LOGOUT_SESSION_REPLAY_REGRESSION\.md/g) || []).length >= 2);
});


test("v0.375 security disclosure policy publishes immutable policy and RFC-style security.txt", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const schema = await read("apps/server/prisma/schema.prisma");
  const migration = await read("apps/server/prisma/migrations/20260820010000_security_disclosure_policy/migration.sql");
  const core = await read("apps/server/src/core/security-disclosure-policy.ts");
  const routes = await read("apps/server/src/domains/legal/security-disclosure-policy-routes.ts");
  const routePolicy = await read("apps/server/src/domains/access/route-policy.ts");
  const host = await read("apps/host-go/gateway.go");
  const vite = await read("apps/web/vite.config.ts");
  const entrypoints = await read("packages/renderer/src/features/application/application-entrypoints.tsx");
  const app = await readApplicationDomain();
  const settings = await readSettingsDomain();
  const contract = await read("packages/shared/src/api-contracts.ts");
  const errorCodes = await read("packages/shared/src/error-codes.ts");
  const docs = await read("docs/SECURITY_VULNERABILITY_DISCLOSURE_POLICY.md");
  const packager = await read("tools/scripts/package-cluster-master.mjs");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(schema, /metadataJson\s+String\?/);
  assert.match(migration, /ADD COLUMN "metadataJson" TEXT/);
  assert.match(core, /SECURITY_DISCLOSURE_POLICY_KIND = "security_vulnerability_disclosure"/);
  assert.match(core, /SECURITY_TXT_MAX_VALIDITY_DAYS = 366/);
  assert.match(core, /Contact: \$\{contact\}/);
  assert.match(core, /Canonical: \$\{origin\}\/\.well-known\/security\.txt/);
  assert.match(core, /does not create a bug bounty/i);
  assert.match(routes, /app\.get\("\/api\/public\/legal\/security"/);
  assert.match(routes, /app\.get\("\/\.well-known\/security\.txt"/);
  assert.match(routes, /app\.post\("\/api\/admin\/legal\/security\/versions\/\:policyId\/publish"/);
  assert.match(routePolicy, /\/api\/public\/legal\/security/);
  assert.match(host, /pathValue == "\/\.well-known\/security\.txt"/);
  assert.match(vite, /"\/\.well-known\/security\.txt"/);
  assert.match(entrypoints, /SecurityDisclosurePolicyPage/);
  assert.match(app, /securityDisclosurePolicyPath/);
  assert.match(settings, /LegalComplianceCenter/);
  assert.match(contract, /security-disclosure-policy-v1/);
  assert.match(contract, /2026-08-02\.62/);
  assert.match(errorCodes, /SECURITY_POLICY_NOT_PUBLISHED/);
  assert.match(docs, /Roadmap Step 14/);
  assert.match(docs, /RFC 9116/);
  assert.ok((packager.match(/docs\/SECURITY_VULNERABILITY_DISCLOSURE_POLICY\.md/g) || []).length >= 2);
});


test("v0.376 consolidated Legal & Compliance center reports state without claiming certification", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const core = await read("apps/server/src/core/legal-compliance.ts");
  const routes = await read("apps/server/src/domains/legal/legal-compliance-routes.ts");
  const server = await read("apps/server/src/app/cluster-server.ts");
  const center = await read("packages/renderer/src/features/legal/LegalComplianceCenter.tsx");
  const requests = await read("packages/renderer/src/features/legal/PrivacyRequestsAdminPanel.tsx");
  const settings = await readSettingsDomain();
  const contract = await read("packages/shared/src/api-contracts.ts");
  const openapi = await read("apps/server/src/core/openapi.ts");
  const docs = await read("docs/LEGAL_COMPLIANCE_CENTER.md");
  const packager = await read("tools/scripts/package-cluster-master.mjs");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(core, /legalCertification: false/);
  assert.match(core, /pendingDataRequests/);
  assert.match(core, /copyrightLegalHolds/);
  assert.match(core, /security:expires-soon/);
  assert.match(routes, /app\.get\("\/api\/admin\/legal\/compliance"/);
  assert.match(routes, /Cache-Control", "no-store/);
  assert.match(server, /registerLegalComplianceRoutes\(\{ app, prisma, readSettings, authorization, logSecurityEvent \}\)/);
  assert.match(center, /Private deployment/);
  assert.match(center, /PrivacyRequestsAdminPanel/);
  assert.match(center, /Data & retention/);
  assert.match(requests, /resolutionNote/);
  assert.match(requests, /\/api\/admin\/privacy\/data-requests/);
  assert.match(settings, /label: "Privacy & data"/);
  assert.match(settings, /<LegalComplianceCenter \/>/);
  assert.match(contract, /legal-compliance-center-v1/);
  assert.match(contract, /2026-08-02\.62/);
  assert.match(openapi, /\/api\/admin\/legal\/compliance/);
  assert.match(docs, /Roadmap Step 15/);
  assert.match(docs, /not a legal, privacy, accessibility, or regulatory certification/i);
  assert.ok((packager.match(/docs\/LEGAL_COMPLIANCE_CENTER\.md/g) || []).length >= 2);
});


test("v0.377 third-party disclosure generation is reviewed, public-safe, and configuration-aware", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const schema = await read("apps/server/prisma/schema.prisma");
  const migration = await read("apps/server/prisma/migrations/20260820023000_third_party_disclosures/migration.sql");
  const storage = await read("apps/server/src/core/storage-migrations.ts");
  const core = await read("apps/server/src/core/third-party-disclosure.ts");
  const routes = await read("apps/server/src/domains/legal/third-party-disclosure-routes.ts");
  const routePolicy = await read("apps/server/src/domains/access/route-policy.ts");
  const server = await read("apps/server/src/app/cluster-server.ts");
  const compliance = await read("apps/server/src/core/legal-compliance.ts");
  const page = await read("packages/renderer/src/features/legal/ThirdPartyDisclosurePage.tsx");
  const admin = await read("packages/renderer/src/features/legal/ThirdPartyDisclosureAdminPanel.tsx");
  const center = await read("packages/renderer/src/features/legal/LegalComplianceCenter.tsx");
  const app = await readApplicationDomain();
  const contract = await read("packages/shared/src/api-contracts.ts");
  const errors = await read("packages/shared/src/error-codes.ts");
  const openapi = await read("apps/server/src/core/openapi.ts");
  const docs = await read("docs/THIRD_PARTY_DISCLOSURE_GENERATION.md");
  const packager = await read("tools/scripts/package-cluster-master.mjs");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(schema, /model ThirdPartyDisclosureProvider/);
  assert.match(migration, /CREATE TABLE "ThirdPartyDisclosureProvider"/);
  assert.match(storage, /"ThirdPartyDisclosureProvider"/);
  assert.match(storage, /"ThirdPartyDisclosureProvider_status_publicVisible_idx"/);
  assert.match(core, /detectThirdPartyCandidates/);
  assert.match(core, /THIRD_PARTY_RECIPIENT_ROLES/);
  assert.match(core, /builtin\.youtube-embed/);
  assert.match(core, /builtin\.discord-identity/);
  assert.match(core, /builtin\.discord-messaging/);
  assert.match(core, /builtin\.gitea/);
  assert.match(routes, /app\.get\("\/api\/public\/privacy\/third-parties"/);
  assert.match(routes, /publicVisible: true, reviewedAt: \{ not: null \}/);
  assert.match(routes, /materialChanged/);
  assert.match(routes, /reviewInvalidated/);
  assert.match(routePolicy, /\/api\/public\/privacy\/third-parties/);
  assert.match(server, /registerThirdPartyDisclosureRoutes\(\{ app, prisma, getCurrentUser, readSettings \}\)/);
  assert.match(compliance, /detectedNotRecorded/);
  assert.match(compliance, /recordedButNotDetected/);
  assert.match(page, /Third-party data disclosure/);
  assert.match(admin, /Review & publish/);
  assert.match(admin, /const body = reviewAndPublish \? \{ \.\.\.record, reviewed: true, publicVisible: true \} : record/);
  assert.doesNotMatch(admin, /reviewed: reviewAndPublish \? true : form\.reviewed/);
  assert.match(center, /ThirdPartyDisclosureAdminPanel/);
  assert.match(app, /thirdPartyDisclosurePath/);
  assert.match(contract, /third-party-disclosure-v1/);
  assert.match(contract, /2026-08-02\.62/);
  assert.match(errors, /THIRD_PARTY_DISCLOSURE_REVIEW_REQUIRED/);
  assert.match(openapi, /\/api\/admin\/legal\/third-parties/);
  assert.match(docs, /Roadmap Step 16/);
  assert.match(docs, /Roadmap Step 17/);
  assert.ok((packager.match(/docs\/THIRD_PARTY_DISCLOSURE_GENERATION\.md/g) || []).length >= 2);
});


test("v0.378 auditable policy acceptance is explicit, version-bound, and fail-closed", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const schema = await read("apps/server/prisma/schema.prisma");
  const migration = await read("apps/server/prisma/migrations/20260820030000_policy_acceptance/migration.sql");
  const storage = await read("apps/server/src/core/storage-migrations.ts");
  const core = await read("apps/server/src/core/policy-acceptance.ts");
  const routes = await read("apps/server/src/domains/legal/policy-acceptance-routes.ts");
  const server = await read("apps/server/src/app/cluster-server.ts");
  const screen = await read("packages/renderer/src/features/legal/PolicyAcceptanceScreen.tsx");
  const admin = await read("packages/renderer/src/features/legal/PolicyAcceptanceAdminPanel.tsx");
  const privacy = await read("apps/server/src/domains/legal/privacy-data-routes.ts");
  const retention = await read("apps/server/src/core/data-retention.ts");
  const contract = await read("packages/shared/src/api-contracts.ts");
  const errors = await read("packages/shared/src/error-codes.ts");
  const openapi = await read("apps/server/src/core/openapi.ts");
  const docs = await read("docs/AUDITABLE_POLICY_ACCEPTANCE.md");
  const packager = await read("tools/scripts/package-cluster-master.mjs");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(schema, /model PolicyAcceptance/);
  assert.match(schema, /policyAcceptanceDigest\s+String\?/);
  assert.match(schema, /acceptanceMode\s+String\s+@default\("none"\)/);
  assert.match(schema, /subjectPolicyKey\s+String\s+@unique/);
  assert.match(migration, /CREATE TABLE "PolicyAcceptance"/);
  assert.match(migration, /DEFAULT 'none'/);
  assert.match(storage, /"PolicyAcceptance"/);
  assert.match(storage, /"PolicyAcceptance_subjectPolicyKey_key"/);
  assert.match(core, /policyRequirementHash/);
  assert.match(core, /acceptanceEvidenceHash/);
  assert.match(core, /verifyPolicyAcceptanceEvidence/);
  assert.match(core, /normalizePolicyAcceptanceMode\(row\.acceptanceMode\) !== "none"/);
  assert.match(core, /policyAcceptanceDigest === current\.digest/);
  assert.match(routes, /app\.post\("\/api\/legal\/acceptance"/);
  assert.match(routes, /POLICY_ACCEPTANCE_STALE/);
  assert.match(routes, /attestation: z\.literal\(true\)/);
  assert.match(routes, /String\(error\?\.code \|\| ""\) !== "P2002"/);
  assert.match(server, /ensureSessionPolicyAcceptance/);
  assert.match(server, /POLICY_ACCEPTANCE_REQUIRED/);
  assert.match(screen, /Review current policies/);
  assert.match(screen, /input type="checkbox"/);
  assert.match(admin, /Policy acceptance history/);
  assert.match(admin, /Integrity check failed/);
  assert.match(privacy, /policyAcceptances/);
  assert.match(retention, /policy_acceptances/);
  assert.match(contract, /policy-acceptance-v1/);
  assert.match(contract, /2026-08-02\.62/);
  assert.match(errors, /POLICY_ACCEPTANCE_REQUIRED/);
  assert.match(openapi, /\/api\/legal\/acceptance\/status/);
  assert.match(docs, /Roadmap Step 17 of 20/);
  assert.match(docs, /Publication and acceptance are separate actions/);
  assert.ok((packager.match(/docs\/AUDITABLE_POLICY_ACCEPTANCE\.md/g) || []).length >= 2);
});

test("v0.380 privacy erasure fulfillment is explicit, idempotent, and legal-hold aware", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const schema = await read("apps/server/prisma/schema.prisma");
  const migration = await read("apps/server/prisma/migrations/20260820070000_privacy_erasure_fulfillment/migration.sql");
  const storage = await read("apps/server/src/core/storage-migrations.ts");
  const core = await read("apps/server/src/core/privacy-erasure.ts");
  const routes = await read("apps/server/src/domains/legal/privacy-data-routes.ts");
  const admin = await read("packages/renderer/src/features/legal/PrivacyRequestsAdminPanel.tsx");
  const selfService = await read("packages/renderer/src/features/legal/PrivacyDataControlCenter.tsx");
  const compliance = await read("apps/server/src/core/legal-compliance.ts");
  const contract = await read("packages/shared/src/api-contracts.ts");
  const errors = await read("packages/shared/src/error-codes.ts");
  const openapi = await read("apps/server/src/core/openapi.ts");
  const docs = await read("docs/PRIVACY_ERASURE_FULFILLMENT.md");
  const packager = await read("tools/scripts/package-cluster-master.mjs");

  assert.equal(versions.cluster, "0.422.0");
  assert.match(schema, /model PrivacyLegalHold/);
  assert.match(schema, /model PrivacyErasureReceipt/);
  assert.match(migration, /PrivacyErasureReceipt_requestId_fkey/);
  assert.match(storage, /"PrivacyLegalHold"/);
  assert.match(storage, /"PrivacyErasureReceipt_requestId_key"/);
  assert.match(core, /const existingReceipt = await prisma\.privacyErasureReceipt\.findUnique/);
  assert.match(core, /status !== "approved"/);
  assert.match(core, /accountState: "PRIVACY_ERASED"/);
  assert.match(core, /privacyLegalHold\.findMany/);
  assert.match(routes, /\/erasure-plan/);
  assert.match(routes, /\/fulfill/);
  assert.match(routes, /FULFILL PRIVACY ERASURE/);
  assert.match(routes, /CREATE PRIVACY LEGAL HOLD/);
  assert.match(routes, /RELEASE PRIVACY LEGAL HOLD/);
  assert.match(admin, /Preview erasure/);
  assert.match(admin, /Active privacy legal holds/);
  assert.match(selfService, /Approved for operator fulfillment/);
  assert.match(compliance, /approvedErasureRequests/);
  assert.match(compliance, /activeLegalHolds/);
  assert.match(contract, /privacy-erasure-fulfillment-v1/);
  assert.match(contract, /2026-08-02\.62/);
  assert.match(errors, /PRIVACY_ERASURE_LEGAL_HOLD/);
  assert.match(openapi, /\/api\/admin\/privacy\/data-requests\/\{requestId\}\/fulfill/);
  assert.match(docs, /Roadmap Step 19 of 20/);
  assert.ok((packager.match(/docs\/PRIVACY_ERASURE_FULFILLMENT\.md/g) || []).length >= 2);
});


test("roadmap Step 20 release-readiness evidence is permanent", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const contract = await read("packages/shared/src/api-contracts.ts");
  const core = await read("apps/server/src/core/legal-compliance.ts");
  const routes = await read("apps/server/src/domains/legal/legal-compliance-routes.ts");
  const ui = await read("packages/renderer/src/features/legal/LegalComplianceCenter.tsx");
  const evidence = await read("tools/scripts/legal-roadmap-evidence.mjs");
  const ledger = await read("tools/scripts/release-certification-ledger.mjs");
  const verifier = await read("tools/scripts/release-verify-artifacts.mjs");
  const packager = await read("tools/scripts/package-cluster-master.mjs");
  const workflow = await read(".github/workflows/release.yml");
  const docs = await read("docs/LEGAL_PRIVACY_ACCESSIBILITY_RELEASE_READINESS.md");
  assert.equal(versions.cluster, "0.422.0");
  assert.match(contract, /legal-roadmap-evidence-v1/);
  assert.match(contract, /2026-08-02\.62/);
  assert.match(core, /aggregate-deployment-posture/);
  assert.match(core, /containsUserList: false/);
  assert.match(routes, /\/api\/admin\/legal\/compliance\/evidence/);
  assert.match(routes, /legal\.compliance_evidence_exported/);
  assert.match(ui, /Download evidence snapshot/);
  assert.match(evidence, /totalSteps: 20/);
  assert.match(evidence, /legalCertification: false/);
  assert.match(ledger, /legal-readiness/);
  assert.match(verifier, /legal-privacy-accessibility-roadmap\.json/);
  assert.match(packager, /legal-roadmap-evidence\.mjs/);
  assert.match(workflow, /--gate=legal-readiness/);
  assert.match(docs, /Roadmap Step 20 of 20/);
  assert.ok((packager.match(/docs\/LEGAL_PRIVACY_ACCESSIBILITY_RELEASE_READINESS\.md/g) || []).length >= 2);
});

import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const checks = [];
const check = (label, ok, detail = "") => checks.push({ label, ok, detail });
const text = (relative) => readFile(path.join(root, relative), "utf8");
const exists = async (relative) => { try { await access(path.join(root, relative)); return true; } catch { return false; } };

const [profileHeader, profileStore, apiHeader, apiClient, cookieHeader, cookieJar,
  transferHeader, transferManager, appController, profilesQml, contracts, pkgText,
  packager, notes, doc] = await Promise.all([
  text("apps/desktop-qt/src/ServerProfileStore.h"),
  text("apps/desktop-qt/src/ServerProfileStore.cpp"),
  text("apps/desktop-qt/src/ApiClient.h"),
  text("apps/desktop-qt/src/ApiClient.cpp"),
  text("apps/desktop-qt/src/PersistentCookieJar.h"),
  text("apps/desktop-qt/src/PersistentCookieJar.cpp"),
  text("apps/desktop-qt/src/TransferManager.h"),
  text("apps/desktop-qt/src/TransferManager.cpp"),
  text("apps/desktop-qt/src/AppController.cpp"),
  text("apps/desktop-qt/qml/pages/ServerProfilesWindow.qml"),
  text("packages/shared/src/api-contracts.ts"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
  text("RELEASE_NOTES_v0.397.0.md"),
  text("docs/DESKTOP_SERVER_PROFILE_ISOLATION.md"),
]);

check("profile registry schema advances for native isolation", profileStore.includes("RegistrySchemaVersion = 4"));
check("profile ID remains origin-derived SHA-256", profileStore.includes("QCryptographicHash::Sha256") && profileStore.includes('QStringLiteral("server-")'));
check("native profile root is separate from WebView root", profileStore.includes('QStringLiteral("/Profiles")') && profileStore.includes('QStringLiteral("/WebView2")'));
check("active native profile path is exposed to controller", profileHeader.includes("activeNativeDataPath") && profileStore.includes("ServerProfileStore::activeNativeDataPath"));
check("native profile paths are traversal bounded", profileStore.includes("nativeProfilePath") && profileStore.includes("relative.startsWith(QStringLiteral(\"..\"))") && profileStore.includes("QDir::isAbsolutePath(relative)"));
check("startup pending-clear removes WebView data", profileStore.includes("QFileInfo::exists(profileRoot)") && profileStore.includes("QDir(profileRoot).removeRecursively()"));
check("startup pending-clear removes native profile data", profileStore.includes("QFileInfo::exists(nativeProfileRoot)") && profileStore.includes("QDir(nativeProfileRoot).removeRecursively()"));
check("profile deletion removes both local containers", profileStore.includes("webViewRemoved") && profileStore.includes("nativeRemoved") && profileStore.includes("return webViewRemoved && nativeRemoved"));
check("legacy API session metadata is removed during profile cleanup", profileStore.includes("removeLegacyApiSession") && profileStore.includes('beginGroup(QStringLiteral("sessions"))'));
check("active native profile path is exported process-locally", profileStore.includes("CLUSTER_DESKTOP_NATIVE_PROFILE_PATH"));

check("API client requires explicit profile context", apiHeader.includes("setProfileContext") && apiClient.includes("ApiClient::setProfileContext"));
check("API client rejects missing profile context before server use", apiClient.includes("The desktop server profile has not been initialized"));
check("native HTTP cache is profile-local", apiClient.includes('normalizedPath + QStringLiteral("/http-cache")') && !apiClient.includes('CacheLocation) + QStringLiteral("/http")'));
check("network disk cache is rebound through profile context", apiHeader.includes("QNetworkDiskCache *m_diskCache") && apiClient.includes("m_diskCache->setCacheDirectory(cachePath)"));
check("API cookie jar receives profile ID and data path", apiClient.includes("m_cookieJar->setProfileContext(m_profileId") && cookieHeader.includes("setProfileContext"));

check("native cookie vault is stored under profile session directory", cookieJar.includes('m_profileDataPath + QStringLiteral("/session")') && cookieJar.includes('QStringLiteral("/cookies.dpapi")'));
check("native cookie persistence remains OS-protected", cookieJar.includes("CryptProtectData") && cookieJar.includes("CryptUnprotectData"));
check("DPAPI entropy binds ciphertext to profile ID", cookieJar.includes('QByteArrayLiteral("ClusterDesktopSessionV2|") + m_profileId.toUtf8()'));
check("legacy cookie vault can be migrated", cookieJar.includes("unprotectLegacy") && cookieJar.includes('QByteArrayLiteral("ClusterDesktopSessionV1")'));
check("successful legacy cookie migration removes QSettings entry", cookieJar.includes("migratedLegacy") && cookieJar.includes("settings.remove(legacyStorageKey())"));
check("new cookie persistence is file-backed rather than QSettings-backed", cookieJar.includes("QSaveFile file(path)") && cookieJar.includes("file.write(cipher)"));

check("retired native mutation queue no longer duplicates renderer offline state", !(await exists("apps/desktop-qt/src/MutationQueue.cpp")) && !(await exists("apps/desktop-qt/src/MutationQueue.h")) && !appController.includes("m_mutationQueue"));
check("transfer manager accepts profile data root", transferHeader.includes("setProfileDataRoot") && transferManager.includes("TransferManager::setProfileDataRoot"));
check("transfer persistence is profile-local", transferManager.includes('m_profileDataRoot + QStringLiteral("/transfers")'));
check("transfer legacy state is migrated", transferManager.includes("legacyStoragePath") && transferManager.includes("migrateLegacy"));
check("legacy native local search no longer creates a second persisted profile index", !(await exists("apps/desktop-qt/src/LocalSearchIndex.cpp")) && !appController.includes("m_localSearchIndex"));

check("controller configures API profile before base URL", appController.indexOf("setProfileContext(profileId, profileDataPath") < appController.indexOf("setBaseUrl(normalizedServerUrl"));
check("controller configures transfer root before unclaimed native scope", appController.indexOf("m_transferManager->setProfileDataRoot(profileDataPath)") < appController.indexOf('m_transferManager->setScope(m_serverUrl + QStringLiteral("|native-unclaimed"))'));
check("server profile UI describes WebView and native isolation", profilesQml.includes("WebView + native data") && profilesQml.includes("native API session") && profilesQml.includes("renderer offline state") && profilesQml.includes("mounted-Library cache"));

check("profile isolation API capability is current", contracts.includes('version: "2026-08-02.63"') && contracts.includes('"desktop-profile-isolation-v2"'));
const pkg = JSON.parse(pkgText);
check("profile isolation audit is aggregate release gate", String(pkg.scripts?.audit || "").includes("desktop-profile-isolation-audit.mjs"));
check("profile isolation audit has named package script", String(pkg.scripts?.["audit:desktop-profile-isolation"] || "").includes("desktop-profile-isolation-audit.mjs"));
check("profile isolation audit is invoked by master packaging", packager.includes("desktop-profile-isolation-audit.mjs"));
check("profile isolation documentation is packaged", packager.includes("docs/DESKTOP_SERVER_PROFILE_ISOLATION.md"));
check("release notes identify Phase 4 profile isolation", notes.includes("Phase 4 begins") && notes.includes("desktop-profile-isolation-v2") && notes.includes("2026-08-02.37"));
check("documentation defines reset lifecycle boundary", doc.includes("Two local containers per server") && doc.includes("Reset, sign-out, and forget semantics") && doc.includes("Release-blocking boundary"));

const failures = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.detail ? ` (${item.detail})` : ""}`);
console.log(`\nCluster desktop profile isolation audit: ${checks.length - failures.length}/${checks.length} passed.`);
if (failures.length) process.exit(1);

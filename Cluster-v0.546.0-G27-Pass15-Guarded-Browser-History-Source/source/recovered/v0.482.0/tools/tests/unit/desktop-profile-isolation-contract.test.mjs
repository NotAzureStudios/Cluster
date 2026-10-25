import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (relative) => readFile(new URL(`../../../${relative}`, import.meta.url), "utf8");

test("v0.397 isolates native desktop state per Cluster server profile", async () => {
  const [versionsText, contracts, profileStore, apiClient, cookies, mutations, transfers, search, app, qml, notes, doc, packageText, packager] = await Promise.all([
    read("config/toolchain-versions.json"),
    read("packages/shared/src/api-contracts.ts"),
    read("apps/desktop-qt/src/ServerProfileStore.cpp"),
    read("apps/desktop-qt/src/ApiClient.cpp"),
    read("apps/desktop-qt/src/PersistentCookieJar.cpp"),
    read("apps/desktop-qt/src/MutationQueue.cpp"),
    read("apps/desktop-qt/src/TransferManager.cpp"),
    read("apps/desktop-qt/src/LocalSearchIndex.cpp"),
    read("apps/desktop-qt/src/AppController.cpp"),
    read("apps/desktop-qt/qml/pages/ServerProfilesWindow.qml"),
    read("RELEASE_NOTES_v0.397.0.md"),
    read("docs/DESKTOP_SERVER_PROFILE_ISOLATION.md"),
    read("package.json"),
    read("tools/scripts/package-cluster-master.mjs"),
  ]);

  assert.equal(JSON.parse(versionsText).cluster, "0.422.0");
  assert.ok(contracts.includes('version: "2026-08-02.62"'));
  assert.ok(contracts.includes('"desktop-profile-isolation-v2"'));
  assert.ok(profileStore.includes("RegistrySchemaVersion = 4") && profileStore.includes('QStringLiteral("/Profiles")'));
  assert.ok(profileStore.includes("webViewRemoved") && profileStore.includes("nativeRemoved"));
  assert.ok(apiClient.includes('normalizedPath + QStringLiteral("/http-cache")') && apiClient.includes("setProfileContext"));
  assert.ok(cookies.includes('QStringLiteral("/cookies.dpapi")') && cookies.includes('QByteArrayLiteral("ClusterDesktopSessionV2|")'));
  assert.ok(mutations.includes('m_profileDataRoot + QStringLiteral("/offline")') && mutations.includes("legacyStoragePath"));
  assert.ok(transfers.includes('m_profileDataRoot + QStringLiteral("/transfers")') && transfers.includes("legacyStoragePath"));
  assert.ok(search.includes('m_profileDataRoot + QStringLiteral("/search-index")') && search.includes("legacyStoragePath"));
  assert.ok(app.includes("setProfileContext(profileId, profileDataPath") && app.includes("setProfileDataRoot(profileDataPath)"));
  assert.ok(qml.includes("WebView + native data") && qml.includes("native API session"));
  assert.ok(notes.includes("Phase 4 begins") && doc.includes("Release-blocking boundary"));
  assert.ok(JSON.parse(packageText).scripts.audit.includes("desktop-profile-isolation-audit.mjs"));
  assert.ok(packager.includes("desktop-profile-isolation-audit.mjs") && packager.includes("docs/DESKTOP_SERVER_PROFILE_ISOLATION.md"));
});

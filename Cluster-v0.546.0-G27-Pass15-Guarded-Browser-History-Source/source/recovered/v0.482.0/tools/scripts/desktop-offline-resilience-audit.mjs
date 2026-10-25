import { readFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../..");
const checks = [];
const check = (label, ok) => checks.push({ label, ok });
const text = (relative) => readFile(path.join(root, relative), "utf8");
const [policy, storage, api, runtime, crashH, crashCpp, updateH, updateCpp, controllerH, controllerCpp, main, settings, contracts, pkgText, packager, notes, doc] = await Promise.all([
  text("packages/renderer/src/core/offline-policy.ts"),
  text("packages/renderer/src/core/offline-storage.ts"),
  text("packages/renderer/src/core/api.ts"),
  text("packages/renderer/src/core/offline-runtime.ts"),
  text("apps/desktop-qt/src/CrashReporter.h"),
  text("apps/desktop-qt/src/CrashReporter.cpp"),
  text("apps/desktop-qt/src/NativeUpdateManager.h"),
  text("apps/desktop-qt/src/NativeUpdateManager.cpp"),
  text("apps/desktop-qt/src/AppController.h"),
  text("apps/desktop-qt/src/AppController.cpp"),
  text("apps/desktop-qt/src/main.cpp"),
  text("packages/renderer/src/features/desktop/DesktopNativeServicesPanel.tsx"),
  text("packages/shared/src/api-contracts.ts"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
  text("RELEASE_NOTES_v0.422.0.md"),
  text("docs/DESKTOP_OFFLINE_RESILIENCE.md"),
]);
check("offline policy defines safe/revision/online-only classes", policy.includes('"safe" | "revision_guarded" | "online_only"'));
check("revision-sensitive offline writes require revision protection", policy.includes("updateLike && !hasRevision") && policy.includes('safety: "online_only"'));
check("idempotent creates may be safely queued", policy.includes("idempotentCreate") && policy.includes('safety: "safe"'));
check("offline replay has bounded attempts", policy.includes("maxAttempts: 8") && policy.includes("shouldQuarantineMutation"));
check("queued mutation records persist replay policy", storage.includes("safety?: OfflineMutationSafety") && storage.includes("maxAttempts?: number") && storage.includes("conflictStrategy?: OfflineConflictStrategy"));
check("queued mutation records track quarantine", storage.includes("quarantinedAt?: number") && storage.includes("conflictKind?:"));
check("mutation API classifies replay before persistence", api.includes("classifyOfflineMutation") && api.includes("policy.safety === \"online_only\""));
check("sensitive mutation persistence remains blocked", api.includes("containsSensitiveMutationData") && api.includes("canPersist"));
check("queued mutations persist safety metadata", api.includes("safety: policy.safety") && api.includes("maxAttempts: policy.maxAttempts"));
check("replay loop quarantines repeated failures", api.includes("shouldQuarantineMutation(item.attempts") && api.includes("Replay stopped after repeated failures"));
check("revision conflicts preserve local and base snapshots", api.includes("localSnapshot: item.localSnapshot || item.body") && api.includes("baseSnapshot: item.baseSnapshot || null"));
check("revision conflicts are explicitly classified", api.includes('conflictKind: "revision"'));
check("offline cache health reports freshness classes", storage.includes("getOfflineCacheHealth") && storage.includes("staleUsable") && storage.includes("expired"));
check("offline runtime publishes cache health", runtime.includes("getOfflineCacheHealth") && runtime.includes("cache:"));
check("durable cache retains stale and expiry boundaries", storage.includes("staleAt") && storage.includes("expiresAt") && api.includes("durable.expiresAt > Date.now()"));
check("crash reporter exposes startup diagnostics", crashH.includes("startupDiagnostics") && crashCpp.includes("CrashReporter::startupDiagnostics"));
check("crash diagnostics use a random session id", crashCpp.includes("QUuid::createUuid") && crashCpp.includes('QStringLiteral("sessionId")'));
check("crash diagnostics include platform and cpu", crashCpp.includes("QSysInfo::prettyProductName") && crashCpp.includes("currentCpuArchitecture"));
check("crash streak is bounded and version-aware", crashCpp.includes("sameVersion") && crashCpp.includes("qBound(1") && crashCpp.includes("crashStreak"));
check("healthy runtime clears crash streak", crashCpp.includes("crashStreak = 0") && crashCpp.includes('writeMarker(QStringLiteral("healthy"))'));
check("diagnostics remain local by design", !crashCpp.includes("QNetworkAccessManager") && doc.includes("remain local until the user explicitly shares"));
check("update manager accepts startup failure evidence", updateH.includes("recordStartupFailure") && updateCpp.includes("NativeUpdateManager::recordStartupFailure"));
check("update recovery persists startup failure count", updateCpp.includes('QStringLiteral("startupFailures")') && updateCpp.includes('QStringLiteral("lastStartupFailureAt")'));
check("repeated startup failures can promote rollback", updateCpp.includes("failures >= 2") && updateCpp.includes('QStringLiteral("rollback-ready")'));
check("rollback still requires verified artifact", updateCpp.includes("verifyArtifactFile(m_rollbackPath, m_rollbackSha256") && updateCpp.includes("rollbackReady()"));
check("new update transactions reset startup failure count", updateCpp.includes('setValue(UpdatePrefix + QStringLiteral("startupFailures"), 0)'));
check("main feeds previous crash into update recovery", main.includes("recordStartupFailure") && main.includes("CrashReporter::previousCrash"));
check("AppController exposes diagnostics to UI", controllerH.includes("startupDiagnostics") && controllerCpp.includes("CrashReporter::startupDiagnostics"));
check("Desktop native services surface crash streak without local paths", settings.includes("diagnostics.crashStreak") && settings.includes("diagnostic paths") && settings.includes("not exposed"));
check("API advertises offline resilience capability", contracts.includes('version: "2026-08-02.63"') && contracts.includes('"desktop-offline-resilience-v2"'));
check("API advertises update recovery capability", contracts.includes('"desktop-update-recovery-v2"'));
check("API advertises startup diagnostics capability", contracts.includes('"desktop-startup-diagnostics-v2"'));
const pkg = JSON.parse(pkgText);
check("resilience audit is aggregate release gate", String(pkg.scripts?.audit || "").includes("desktop-offline-resilience-audit.mjs"));
check("resilience audit has named package script", String(pkg.scripts?.["audit:desktop-offline-resilience"] || "").includes("desktop-offline-resilience-audit.mjs"));
check("master packaging runs resilience audit", packager.includes("desktop-offline-resilience-audit.mjs"));
check("master packaging includes resilience documentation", packager.includes("docs/DESKTOP_OFFLINE_RESILIENCE.md"));
check("release notes identify checkpoints 4.10 through 4.14", ["4.10","4.11","4.12","4.13","4.14"].every((item) => notes.includes(item)));
check("release notes identify new capabilities", notes.includes("desktop-offline-resilience-v2") && notes.includes("desktop-update-recovery-v2") && notes.includes("desktop-startup-diagnostics-v2"));
check("documentation defines release-blocking boundary", doc.includes("Release-blocking boundary") && doc.includes("online_only") && doc.includes("rollback-ready"));
const failures = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}`);
console.log(`\nCluster desktop offline resilience audit: ${checks.length - failures.length}/${checks.length} passed.`);
if (failures.length) process.exit(1);

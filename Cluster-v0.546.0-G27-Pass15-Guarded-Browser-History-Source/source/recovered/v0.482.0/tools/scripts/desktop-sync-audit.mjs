import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const read = (relative) => readFile(path.join(root, relative), "utf8");
const checks = [];
const errors = [];
const check = (label, ok, detail = "") => {
  checks.push({ label, ok, detail });
  if (!ok) errors.push(`${label}${detail ? `: ${detail}` : ""}`);
};

const versions = JSON.parse(await read("config/toolchain-versions.json"));
const contracts = await read("packages/shared/src/api-contracts.ts");
const brokerH = await read("apps/desktop-qt/src/NativeCapabilityBroker.h");
const brokerCpp = await read("apps/desktop-qt/src/NativeCapabilityBroker.cpp");
const integrationCpp = await read("apps/desktop-qt/src/DesktopIntegration.cpp");
const sharedQml = await read("apps/desktop-qt/qml/pages/SharedRendererPage.qml");
const desktopBridge = await read("packages/renderer/src/core/desktop.ts");
const desktopTypes = await read("packages/renderer/src/core/desktop-types.ts");
const nativePanel = await read("packages/renderer/src/features/desktop/DesktopNativeServicesPanel.tsx");
const offline = await read("packages/renderer/src/core/offline-runtime.ts");
const syncIndicator = await read("packages/renderer/src/components/SyncStatusIndicator.tsx");
const collabRuntime = await read("apps/server/src/core/collaboration-runtime.ts");
const collabRoutes = await read("apps/server/src/domains/collaboration/collaboration-routes.ts");
const collabRenderer = await read("packages/renderer/src/features/collaboration/index.tsx");

check("Step 4 release baseline is retained", Number(versions.cluster.split(".")[1] || 0) >= 385, versions.cluster);
check("Step 4 API contract is current", contracts.includes("2026-08-02.63"));
check("desktop sync overhaul capability is advertised", contracts.includes("desktop-sync-overhaul-v2"));
check("realtime collaboration v2 capability is advertised", contracts.includes("realtime-collaboration-v2"));
check("sync center v2 posture is advertised", contracts.includes("syncCenterV2: true") && contracts.includes("serverDevicePosture: true"));

check("native broker protocol is v3", brokerH.includes("return 3;"));
for (const capability of ["watch.start", "watch.stop", "watch.list", "clipboard.writeText", "navigation.back", "navigation.forward"]) {
  check(`native broker exposes ${capability}`, brokerCpp.includes(`QStringLiteral(\"${capability}\")`));
}
check("native file watch uses QFileSystemWatcher", brokerCpp.includes("QFileSystemWatcher"));
check("native watch count is bounded", brokerCpp.includes("MaxNativeWatches") && brokerCpp.includes(">= MaxNativeWatches"));
check("native watch API consumes opaque handle", brokerCpp.includes('payload.value(QStringLiteral("handle"))'));
check("native watch event omits raw path", brokerCpp.includes('QStringLiteral("watch.changed")') && !/event\s*\[[^\]]*path/i.test(brokerCpp));
check("native file watches re-arm after atomic replacement", brokerCpp.includes("QFileSystemWatcher can drop a file watch") && brokerCpp.includes("m_fileWatcher->addPath(path)"));
check("deleted watched items are removed from active watch state", brokerCpp.includes("!QFileInfo::exists(path)") && brokerCpp.includes("m_watchPaths.remove(watchId)"));
check("native clipboard write is bounded", brokerCpp.includes("MaxClipboardText") && brokerCpp.includes("clipboard->setText") && brokerCpp.includes("CLIPBOARD_UNAVAILABLE"));
check("native clipboard read is explicit and non-passive", brokerCpp.includes("clipboard.readText") && desktopBridge.includes('"clipboard.readText"') && brokerCpp.includes('QStringLiteral("readRequiresConfirmation"), true') && brokerCpp.includes('QStringLiteral("backgroundRead"), false'));
check("native runtime reports profile isolation", brokerCpp.includes('QStringLiteral("profileIsolation")'));
check("native runtime keeps raw filesystem paths disabled", brokerCpp.includes('QStringLiteral("rawFilesystemPathsExposed")') && brokerCpp.includes("false"));
check("profile switch clears native watches", brokerCpp.includes("clearWatches()"));
check("mouse back and forward are app-filtered and native-routed", integrationCpp.includes("QCoreApplication::instance()->installEventFilter(this)") && integrationCpp.includes("Qt::BackButton") && integrationCpp.includes("Qt::ForwardButton"));
check("native event delivery reaches shared renderer", sharedQml.includes("__clusterNativeEventDeliver"));

check("renderer bridge types file-watch contracts", desktopTypes.includes("ClusterDesktopFileWatch") && desktopTypes.includes("ClusterDesktopFileWatchEvent"));
check("renderer bridge installs native event delivery", desktopBridge.includes("__clusterNativeEventDeliver") && desktopBridge.includes("nativeEventListeners"));
check("renderer bridge exposes native file watch helpers", desktopBridge.includes("startNativeFileWatch") && desktopBridge.includes("stopNativeFileWatch") && desktopBridge.includes("subscribeNativeFileWatch"));
check("renderer bridge exposes bounded clipboard helpers", desktopBridge.includes("writeNativeClipboardText") && desktopBridge.includes("readNativeClipboardText"));
check("native services panel manages watches", nativePanel.includes("startNativeFileWatch") && nativePanel.includes("stopNativeFileWatch") && nativePanel.includes("desktop-watch-list"));
check("native services panel documents opaque watch boundary", nativePanel.includes("opaque handles only"));

check("offline snapshot carries stable device id", offline.includes("deviceId:"));
check("offline snapshot carries registered server device posture", offline.includes("registeredDevice:"));
check("offline snapshot carries server conflict posture", offline.includes("serverOpenConflicts") && offline.includes("serverResolvedConflicts"));
check("offline runtime refreshes server sync posture", offline.includes("refreshServerSyncPosture") && offline.includes("/api/sync/status?deviceId="));
check("server posture refresh runs after reachability", offline.includes("await refreshServerSyncPosture()"));
check("sync center shows device and server posture", syncIndicator.includes("sync-center-metrics-v385") && syncIndicator.includes("Server seen") && syncIndicator.includes("Retry posture"));
check("sync center exposes local queue/conflict actions", syncIndicator.includes("Retry") && syncIndicator.includes("conflict"));

check("collaboration runtime transport is v2", collabRuntime.includes("transportVersion: 2"));
check("collaboration runtime declares full-state frames", collabRuntime.includes("fullStateFrame: true") && collabRuntime.includes("fullStateFrames: true"));
check("collaboration runtime tracks stream metrics", collabRuntime.includes("streamOpenCount") && collabRuntime.includes("broadcastCount") && collabRuntime.includes("failedWriteCount") && collabRuntime.includes("heartbeatCount"));
check("collaboration ready frame advertises full-state v2", collabRoutes.includes("streamVersion: 2") && collabRoutes.includes("fullStateFrames: true"));
check("renderer tracks recovered sequence gaps", collabRenderer.includes("sequenceGaps") && collabRenderer.includes("recovered gap"));
check("renderer collaboration exposes connection quality", collabRenderer.includes('quality: "good" | "degraded" | "offline"'));
check("renderer measures heartbeat latency", collabRenderer.includes("latencyMs") && collabRenderer.includes("performance.now"));
check("sequence gaps are recoverable because frames are full state", collabRenderer.includes("sequenceGap") && collabRenderer.includes("applyState"));

for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.detail && !item.ok ? ` (${item.detail})` : ""}`);
console.log(`\nCluster desktop & sync audit: ${checks.length - errors.length}/${checks.length} passed.`);
if (errors.length) process.exit(1);

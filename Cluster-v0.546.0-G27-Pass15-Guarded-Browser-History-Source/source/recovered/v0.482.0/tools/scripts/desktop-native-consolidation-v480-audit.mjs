import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const checks = [];
const check = (label, ok, detail = "") => checks.push({ label, ok, detail });
const text = (relative) => readFile(path.join(root, relative), "utf8");
const exists = async (relative) => { try { await access(path.join(root, relative)); return true; } catch { return false; } };

const [pkgText, versionsText, cmake, main, brokerH, brokerCpp, transferH, transferCpp, desktopCore, nativePanel, readme, doc, changelog, packager] = await Promise.all([
  text("package.json"),
  text("config/toolchain-versions.json"),
  text("apps/desktop-qt/CMakeLists.txt"),
  text("apps/desktop-qt/qml/Main.qml"),
  text("apps/desktop-qt/src/NativeCapabilityBroker.h"),
  text("apps/desktop-qt/src/NativeCapabilityBroker.cpp"),
  text("apps/desktop-qt/src/TransferManager.h"),
  text("apps/desktop-qt/src/TransferManager.cpp"),
  text("packages/renderer/src/core/desktop.ts"),
  text("packages/renderer/src/features/desktop/DesktopNativeServicesPanel.tsx"),
  text("apps/desktop-qt/README.md"),
  text("docs/DESKTOP_NATIVE_CONSOLIDATION_V480.md"),
  text("packages/renderer/src/features/changelog/data/cluster-changelog.ts"),
  text("tools/scripts/package-cluster-master.mjs"),
]);
const pkg = JSON.parse(pkgText);
const versions = JSON.parse(versionsText);

const versionParts = String(pkg.version || "0.0.0").split(".").map((part) => Number.parseInt(part, 10) || 0);
const atLeast480 = versionParts[0] > 0 || versionParts[1] > 480 || (versionParts[1] === 480 && versionParts[2] >= 0);
check("v0.480 consolidation baseline is retained", atLeast480 && versions.cluster === pkg.version);
check("desktop CMake version tracks the release", cmake.includes(`project(ClusterDesktop VERSION ${pkg.version}`));
check("signed-in product surface remains shared renderer", main.includes("SharedRendererPage") && !main.includes("ProjectWindow") && !main.includes("WorkspacePage"));
check("desktop QML module contains only shell surfaces", ["ServerPage.qml","SharedRendererPage.qml","AppSettingsWindow.qml","ServerProfilesWindow.qml"].every((name) => cmake.includes(name)));

const retired = [
  "apps/desktop-qt/qml/pages/ProjectsPage.qml", "apps/desktop-qt/qml/pages/BoardsPage.qml", "apps/desktop-qt/qml/pages/WhiteboardsPage.qml",
  "apps/desktop-qt/qml/pages/BuildsPage.qml", "apps/desktop-qt/qml/pages/ProjectDetailPage.qml", "apps/desktop-qt/qml/pages/WorkspacePage.qml",
  "apps/desktop-qt/qml/components/ProjectWindow.qml", "apps/desktop-qt/qml/components/TransferCenterDialog.qml", "apps/desktop-qt/qml/components/FilePreviewDialog.qml",
  "apps/desktop-qt/src/BoardCanvas.cpp", "apps/desktop-qt/src/WhiteboardCanvas.cpp", "apps/desktop-qt/src/BuildFlowCanvas.cpp",
];
for (const file of retired) check(`retired ${path.basename(file)}`, !(await exists(file)));
check("retired business surfaces are absent from CMake graph", retired.every((file) => !cmake.includes(path.basename(file))));
check("desktop no longer depends on Qt Multimedia or PDF", !cmake.includes("Multimedia") && !cmake.includes("Qt6::Pdf") && !cmake.includes(" COMPONENTS ") || (!cmake.includes("Multimedia") && !cmake.includes(" Pdf")));
check("Windows psapi links the real desktop target", cmake.includes("target_link_libraries(cluster-desktop PRIVATE psapi)") && !cmake.includes("target_link_libraries(ClusterDesktop PRIVATE psapi)"));

const qmlRoot = path.join(root, "apps/desktop-qt/qml");
async function collectQml(dir, out = []) { for (const entry of await readdir(dir, { withFileTypes: true })) { const absolute = path.join(dir, entry.name); if (entry.isDirectory()) await collectQml(absolute, out); else if (entry.name.endsWith(".qml")) out.push(absolute); } return out; }
const qmlFiles = await collectQml(qmlRoot);
let qmlLines = 0;
for (const file of qmlFiles) qmlLines += (await readFile(file, "utf8")).split(/\r?\n/).length;
check("Qt QML surface is reduced to shell scale", qmlFiles.length <= 13, `${qmlFiles.length} files`);
check("Qt QML source stays below 1800 lines", qmlLines <= 1800, `${qmlLines} lines`);

for (const capability of ["transfer.list","transfer.pause","transfer.resume","transfer.retry","transfer.cancel","transfer.remove","transfer.retryAll","transfer.open","transfer.reveal","diagnostics.startup"]) {
  check(`broker exposes ${capability}`, brokerCpp.includes(`QStringLiteral("${capability}")`) && desktopCore.includes(`"${capability}"`));
}
check("broker emits live transfer changes", brokerCpp.includes('QStringLiteral("transfer.changed")') && desktopCore.includes('event: "transfer.changed"'));
check("runtime advertises retained transfer and diagnostic advantages", brokerCpp.includes('QStringLiteral("native-transfer-queue")') && brokerCpp.includes('QStringLiteral("native-startup-diagnostics")'));
check("transfer manager opens completed downloads without renderer paths", transferH.includes("openResult") && transferH.includes("revealResult") && transferCpp.includes("QDesktopServices::openUrl"));
check("broker transfer payload is sanitized", brokerCpp.includes("safeTransferItems") && !/fields\s*\{[^}]*filePath/s.test(brokerCpp) && !/fields\s*\{[^}]*remotePath/s.test(brokerCpp));
check("startup diagnostics omit local log directory", brokerCpp.includes('QStringLiteral("cpuArchitecture")') && !/diagnostics\.startup[\s\S]{0,1800}logDirectory/.test(brokerCpp));
check("renderer manages native transfer queue", nativePanel.includes("Native transfers") && nativePanel.includes("pauseNativeTransfer") && nativePanel.includes("retryAllNativeTransfers") && nativePanel.includes("revealNativeTransferResult"));
check("renderer documents opaque native transfer boundary", nativePanel.includes("never local paths") && nativePanel.includes("diagnostic paths") && nativePanel.includes("not exposed"));
check("desktop README declares one shared-renderer product path", readme.includes("older native QML business-workspace stack was removed") && readme.includes("resumable native transfers"));
check("consolidation documentation defines release blocking boundary", doc.includes("Release-blocking boundary") && doc.includes("second signed-in content loader") && doc.includes("raw paths"));
check("changelog contains v0.480.0", changelog.includes('version: "v0.480.0"') && changelog.includes("Desktop native consolidation"));
check("aggregate audit includes v0.480 gate", String(pkg.scripts?.audit || "").includes("desktop-native-consolidation-v480-audit.mjs"));
check("named v0.480 audit exists", String(pkg.scripts?.["audit:desktop-native-consolidation-v480"] || "").includes("desktop-native-consolidation-v480-audit.mjs"));
check("master packager runs v0.480 gate", packager.includes("desktop-native-consolidation-v480-audit.mjs"));
check("master packager carries v0.480 documentation", packager.includes("docs/DESKTOP_NATIVE_CONSOLIDATION_V480.md"));

const failures = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.detail && !item.ok ? ` (${item.detail})` : ""}`);
console.log(`\nCluster Desktop native consolidation v0.480 audit: ${checks.length - failures.length}/${checks.length} passed.`);
if (failures.length) process.exit(1);

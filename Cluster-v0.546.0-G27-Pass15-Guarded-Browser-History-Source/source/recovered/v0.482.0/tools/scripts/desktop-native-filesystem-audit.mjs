import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const checks = [];
const check = (label, ok) => checks.push({ label, ok });
const text = (relative) => readFile(path.join(root, relative), "utf8");

const [header, broker, qml, desktop, types, contracts, pkgText, packager, notes, doc] = await Promise.all([
  text("apps/desktop-qt/src/NativeCapabilityBroker.h"),
  text("apps/desktop-qt/src/NativeCapabilityBroker.cpp"),
  text("apps/desktop-qt/qml/pages/SharedRendererPage.qml"),
  text("packages/renderer/src/core/desktop.ts"),
  text("packages/renderer/src/core/desktop-types.ts"),
  text("packages/shared/src/api-contracts.ts"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
  text("RELEASE_NOTES_v0.422.0.md"),
  text("docs/DESKTOP_NATIVE_FILESYSTEM.md"),
]);

check("native broker advertises file picker", broker.includes('QStringLiteral("dialog.pickFiles")'));
check("native broker advertises folder picker", broker.includes('QStringLiteral("dialog.pickDirectory")'));
check("native broker advertises save picker", broker.includes('QStringLiteral("dialog.saveFile")'));
check("save dialog uses operating-system AcceptSave mode", broker.includes("QFileDialog::AcceptSave"));
check("save destination receives a dedicated handle", broker.includes("issueDestinationHandle"));
check("save destination canonicalizes its parent", broker.includes("canonicalExistingPath(info.absolutePath(), true)"));
check("save handle is explicitly destination-scoped", header.includes("writableDestination = false") && broker.includes("record.writableDestination = true"));
check("local handles remain profile bound", broker.includes("record.profileId") && broker.includes("activeProfileId()"));
check("local handles remain time bounded", broker.includes("HandleLifetimeMs = 30 * 60 * 1000"));
check("selected files remain bounded", broker.includes("MaxSelectedFiles = 16"));
check("filesystem drops remain bounded", broker.includes("MaxDroppedItems = 16"));
check("drop ingress is native-only QML entrypoint", header.includes("Q_INVOKABLE void acceptDroppedUrls(const QVariantList &urls)"));
check("drop ingress accepts local URLs only", broker.includes("!url.isLocalFile()"));
check("drop ingress verifies files and directories", broker.includes("!info.exists()") && broker.includes("!info.isFile() && !info.isDir()"));
check("drop ingress issues opaque handles", broker.includes("issueHandle(path, info.isDir())"));
check("drop event does not serialize local paths", broker.includes('QStringLiteral("filesystem.drop")') && !broker.match(/filesystem\.drop[\s\S]{0,800}toLocalFile\(\)[\s\S]{0,800}QStringLiteral\("path"\)/));
check("runtime advertises native save dialogs", broker.includes('QStringLiteral("nativeSaveDialogs"), true'));
check("runtime advertises native filesystem drop", broker.includes('QStringLiteral("nativeFilesystemDrop"), true'));
check("renderer capability type includes save picker", desktop.includes('| "dialog.saveFile"'));
check("renderer runtime type includes save flag", desktop.includes("nativeSaveDialogs: true"));
check("renderer runtime type includes drop flag", desktop.includes("nativeFilesystemDrop: true"));
check("renderer exposes save-destination helper", desktop.includes("pickNativeSaveDestination"));
check("desktop bridge exposes save destination", types.includes("pickSaveDestination?:"));
check("desktop bridge exposes filesystem drop subscription", types.includes("onFilesystemDrop?:"));
check("renderer receives typed filesystem drop event", desktop.includes('event: "filesystem.drop"'));
check("renderer converts dropped handles to opaque tokens", desktop.includes("opaqueHandleToken(item.handle)"));
check("QML owns a native DropArea", qml.includes("DropArea {") && qml.includes("id: nativeDropArea"));
check("QML sends drops to native broker", qml.includes("clusterApp.nativeCapabilities.acceptDroppedUrls(urls)"));
check("WebView local file access stays disabled", qml.includes("settings.allowFileAccess = false") && qml.includes("settings.localContentCanAccessFileUrls = false"));
check("drop overlay explains opaque native handling", qml.includes("temporary handles"));
check("filesystem API capability is current", contracts.includes('version: "2026-08-02.63"') && contracts.includes('"desktop-native-filesystem-v1"'));
const pkg = JSON.parse(pkgText);
check("filesystem audit is aggregate release gate", String(pkg.scripts?.audit || "").includes("desktop-native-filesystem-audit.mjs"));
check("filesystem audit has named package script", String(pkg.scripts?.["audit:desktop-native-filesystem"] || "").includes("desktop-native-filesystem-audit.mjs"));
check("filesystem audit is invoked by master packaging", packager.includes("desktop-native-filesystem-audit.mjs"));
check("filesystem documentation is packaged", packager.includes("docs/DESKTOP_NATIVE_FILESYSTEM.md"));
check("release notes identify Phase 4.6 and 4.7", notes.includes("4.6") && notes.includes("4.7") && notes.includes("desktop-native-filesystem-v1"));
check("documentation defines trust and release boundaries", doc.includes("Trust boundary") && doc.includes("Release-blocking boundary") && doc.includes("raw filesystem path"));

const failures = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}`);
console.log(`\nCluster desktop-native filesystem audit: ${checks.length - failures.length}/${checks.length} passed.`);
if (failures.length) process.exit(1);

import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const checks = [];
const errors = [];
const check = (label, ok, detail = "") => {
  checks.push({ label, ok, detail });
  if (!ok) errors.push(`${label}${detail ? `: ${detail}` : ""}`);
};
const read = (relative) => readFile(path.join(root, relative), "utf8");
const exists = async (relative) => { try { await access(path.join(root, relative)); return true; } catch { return false; } };

const manifestPath = "config/desktop-parity-surfaces.json";
check("desktop parity manifest exists", await exists(manifestPath));
const manifest = JSON.parse(await read(manifestPath));
const navigation = await read("packages/renderer/src/core/navigation.ts");
const mainQml = await read("apps/desktop-qt/qml/Main.qml");
const sharedQml = await read("apps/desktop-qt/qml/pages/SharedRendererPage.qml");
const integrationCpp = await read("apps/desktop-qt/src/DesktopIntegration.cpp");
const rendererStyles = await read("packages/renderer/src/styles.css");

check("parity manifest schema is v1", manifest.schema === 1);
check("parity contract uses the shared web renderer", manifest.renderer === "shared-web-renderer");
check("desktop entry is SharedRendererPage", manifest.desktopEntry === "apps/desktop-qt/qml/pages/SharedRendererPage.qml");
check("desktop mode query flag is explicit", manifest.queryFlag === "clusterDesktop=1");
check("parity contract covers at least twelve representative surfaces", Array.isArray(manifest.surfaces) && manifest.surfaces.length >= 12, `${manifest.surfaces?.length || 0} surfaces`);
check("parity contract covers project workspace", manifest.surfaces.some((item) => item.screen === "project"));
check("parity contract covers board", manifest.surfaces.some((item) => item.screen === "board"));
check("parity contract covers whiteboard", manifest.surfaces.some((item) => item.screen === "whiteboard"));
check("parity contract covers account settings", manifest.surfaces.some((item) => item.screen === "settings"));
check("parity contract covers admin operations", manifest.surfaces.some((item) => item.screen === "admin" && item.admin === true));
check("parity contract covers server configuration", manifest.surfaces.some((item) => item.screen === "serverConfig" && item.admin === true));

for (const surface of manifest.surfaces) {
  check(`renderer navigation owns parity screen ${surface.screen}`, new RegExp(`(?:\\"|')${surface.screen}(?:\\"|')`).test(navigation));
}

check("Qt desktop loads SharedRendererPage", mainQml.includes("SharedRendererPage"));
check("Qt desktop does not load a second product renderer", !mainQml.includes("OperationsWorkspacePanels") && !mainQml.includes("ClusterApplication"));
check("shared renderer URL enables desktop mode", sharedQml.includes("clusterDesktop=1"));
check("shared renderer navigation uses WebView history", sharedQml.includes("function goBack()") && sharedQml.includes("webView.goBack()") && sharedQml.includes("function goForward()") && sharedQml.includes("webView.goForward()"));
check("Alt+Left is routed through shared renderer history", mainQml.includes('sequence: "Alt+Left"') && mainQml.includes("goBackSharedRenderer"));
check("Alt+Right is routed through shared renderer history", mainQml.includes('sequence: "Alt+Right"') && mainQml.includes("goForwardSharedRenderer"));
check("mouse back button is routed through shared renderer history", integrationCpp.includes("QCoreApplication::instance()->installEventFilter(this)") && integrationCpp.includes("Qt::BackButton") && integrationCpp.includes("goBackSharedRenderer"));
check("mouse forward button is routed through shared renderer history", integrationCpp.includes("Qt::ForwardButton") && integrationCpp.includes("goForwardSharedRenderer"));
check("desktop renderer receives native event channel", sharedQml.includes("__clusterNativeEventDeliver"));
check("desktop and web share canonical stylesheet entrypoint", rendererStyles.includes("application.css") && rendererStyles.includes("design-system"));

for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.detail && !item.ok ? ` (${item.detail})` : ""}`);
console.log(`\nCluster desktop parity audit: ${checks.length - errors.length}/${checks.length} passed.`);
if (errors.length) process.exit(1);

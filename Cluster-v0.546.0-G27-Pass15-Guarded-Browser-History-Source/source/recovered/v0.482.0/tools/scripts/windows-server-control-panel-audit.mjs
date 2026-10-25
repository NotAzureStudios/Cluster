import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const read = (file) => readFile(path.join(root, file), "utf8");
const [ui, configUi, launcher, childProcess, windowsRuntime, host, build, packaging, docs, rendererConfig] = await Promise.all([
  read("apps/server-launcher-go/launcher_ui_windows.go"),
  read("apps/server-launcher-go/server_config_windows.go"),
  read("apps/server-launcher-go/main.go"),
  read("apps/server-launcher-go/child_process_windows.go"),
  read("apps/server-launcher-go/runtime_windows.go"),
  read("apps/host-go/main.go"),
  read("tools/scripts/build-server-launcher.mjs"),
  read("tools/scripts/package-cluster-master.mjs"),
  read("docs/WINDOWS_SERVER_CONTROL_PANEL.md"),
  read("packages/renderer/src/features/settings/ServerConfigPage.tsx"),
]);

const failures = [];
const requireText = (source, needle, label) => { if (!source.includes(needle)) failures.push(`${label}: missing ${needle}`); };

requireText(ui, "//go:build windows", "native UI");
requireText(ui, "runtime.LockOSThread()", "Win32 message-pump thread affinity");
requireText(ui, "runtime.UnlockOSThread()", "Win32 message-pump thread affinity");
for (const token of ["CreateWindowExW", '"Start"', '"Stop"', '"Restart"', '"Open Web"', '"Open Logs"', '"Settings"', '"Check Updates"', '"DB Doctor"', '"Repair & Start"', '"Local command"', "windows-server.log", "updateMetrics", "wmTimer", "Use visual interface?", "logNotifyPending", "maxLinesPerFlush", "maxBytesPerFlush", "Preparing PostgreSQL and server environment", "Waiting for API and web readiness", "updateInFlight", "doctorInFlight"]) requireText(ui, token, "native UI");
for (const token of ["nativeServerSettings", "checkUpdateManifest", "GlobalMemoryStatusEx", "GetSystemTimes", "GetDiskFreeSpaceExW", "saveServerConfig", "native.updateManifestUrl", "native.useInterface", "native.startServerOnLaunch", "native.startWithWindows", "native.darkMode", "syncWindowsStartupRegistration"]) requireText(configUi, token, "native config/runtime tools");
for (const token of ["ensureWindowsAdministrator", 'utf16("runas")', "GetTokenInformation", "TokenIsElevated"]) requireText(childProcess, token, "automatic Windows elevation");
for (const token of ["schtasks.exe", '"/RL", "HIGHEST"', '"/SC", "ONLOGON"', "legacyRunKey"]) requireText(configUi, token, "elevated Windows startup");
for (const token of ["postgresql-bootstrap.log", "cmd.Stdout, cmd.Stderr = logFile, logFile", "extraction still running", "stageRuntimeDirectory"]) requireText(windowsRuntime, token, "PostgreSQL bootstrap responsiveness");

for (const forbidden of ["QWebEngine", "packages/renderer", "apps/web/dist", "WebView2", "Electron"] ) {
  if (ui.includes(forbidden) || configUi.includes(forbidden)) failures.push(`native UI: browser/renderer dependency leaked into control panel: ${forbidden}`);
}

const fieldBlock = rendererConfig.slice(rendererConfig.indexOf("const SERVER_CONFIG_FIELDS"), rendererConfig.indexOf("const SERVER_CONFIG_HELP"));
const rendererKeys = [...fieldBlock.matchAll(/key:\s*"([^"]+)"/g)].map((match) => match[1]);
for (const key of rendererKeys) {
  if (!configUi.includes(`{"${key}",`) && !configUi.includes(`Key: "${key}"`)) failures.push(`native config parity: renderer field ${key} is missing`);
}
if (rendererKeys.length !== 59) failures.push(`native config parity: expected 59 renderer server-config fields, found ${rendererKeys.length}`);

requireText(launcher, "no-autostart", "launcher flags");
requireText(launcher, "command-line", "single-launcher command-line mode");
requireText(launcher, "interface", "single-launcher interface mode");
requireText(launcher, "--control-file", "launcher managed-host command");
requireText(host, "watchControlFile", "managed host");
requireText(host, "Managed shutdown requested by Cluster Server control panel", "managed host");
requireText(host, `log.Printf("Ready:     %s", h.origin)`, "managed host readiness");
requireText(build, '"ClusterServer.exe", { windowsGui: true }', "native build");
requireText(ui, "statusDot", "compact native status indicator");
requireText(ui, "RICHEDIT50W", "colored native log control");
requireText(ui, "logSeverityColor", "colored native log severity");
requireText(ui, "applyTheme", "native dark mode");
requireText(ui, "loadClusterServerIcon", "Cluster native icon");
requireText(packaging, "cluster-icon.ico", "packaged Cluster native icon");
if (build.includes('build("windows", "ClusterServerCLI.exe"')) failures.push("native build: separate Windows CLI executable must not be built");
if (packaging.includes('path.join(stage, "ClusterServerCLI.exe")')) failures.push("release packaging: separate Windows CLI executable must not be packaged");
requireText(docs, "local-only", "control-panel security documentation");
requireText(docs, "no background update polling", "control-panel resource policy");
requireText(docs, "Use visual interface?", "first-run mode documentation");
requireText(docs, "Start Cluster Server with Windows", "Windows startup documentation");
requireText(docs, "every field exposed by the web Server Configuration page", "control-panel settings parity documentation");

if (failures.length) {
  console.error("Windows Server native control-panel audit failed:\n" + failures.map((entry) => `- ${entry}`).join("\n"));
  process.exit(1);
}
console.log(`Windows Server native control-panel audit passed (${rendererKeys.length} server-config fields mirrored).`);

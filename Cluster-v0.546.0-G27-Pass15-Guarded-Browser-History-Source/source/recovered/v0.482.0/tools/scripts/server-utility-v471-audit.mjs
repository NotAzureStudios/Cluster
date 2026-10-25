import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const pkg = JSON.parse(read("package.json"));
const ui = read("apps/server-launcher-go/launcher_ui_windows.go");
const config = read("apps/server-launcher-go/server_config_windows.go");
const packager = read("tools/scripts/package-cluster-master.mjs");
const notes = read("RELEASE_NOTES_v0.471.0.md");
const changelog = read("packages/renderer/src/features/changelog/data/cluster-changelog.ts");

const [, minor = 0] = String(pkg.version).split(".").map(Number);
const checks = [
  ["v0.471 utility contract is active", Number.isFinite(minor) && minor >= 471],
  ["uptime refresh timer runs every second", ui.includes("procSetTimer.Call(ui.hwnd, 1, 1000, 0)")],
  ["main server window exposes a theme toggle", ui.includes("idThemeToggle") && ui.includes('"Dark mode"') && ui.includes('"Light mode"')],
  ["main server window exposes a performance toggle", ui.includes("idPerformanceToggle") && ui.includes("performanceVisible")],
  ["performance state persists", config.includes('PerformanceView     bool   `json:"performanceView"`')],
  ["performance row covers CPU RAM process disk and PostgreSQL", ui.includes("Server RAM") && ui.includes("PostgreSQL") && ui.includes("Disk %s")],
  ["live logs can be copied", ui.includes("idCopyLogs") && (ui.includes('exec.Command("clip.exe")') || ui.includes("setUnicodeClipboardText(ui.hwnd, text)"))],
  ["auto-scroll is toggleable and persistent", ui.includes("idAutoScroll") && config.includes("AutoScrollLogs") && ui.includes("toggleAutoScroll")],
  ["auto-scroll uses RichEdit scroll-position preservation", ui.includes("emGetScrollPos") && ui.includes("emSetScrollPos")],
  ["log severity filters exist", ui.includes("idFilterInfo") && ui.includes("idFilterWarning") && ui.includes("idFilterError") && ui.includes("idFilterSuccess")],
  ["filtered live view retains bounded unfiltered history", ui.includes("logHistory") && ui.includes("len(ui.logHistory) > 4000")],
  ["log filters share the same classifier as semantic colors", ui.includes("classifyLogSeverity") && ui.includes("switch classifyLogSeverity(line)")],
  ["v0.471 utility work is documented", notes.includes("refreshes uptime every second") && changelog.includes('version: "v0.471.0"')],
  ["v0.471 utility gate participates in packaging", packager.includes("server-utility-v471-audit.mjs")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}
console.log(`Server utility v0.471: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);

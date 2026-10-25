import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const pkg = JSON.parse(read("package.json"));
const ui = read("apps/server-launcher-go/launcher_ui_windows.go");
const config = read("apps/server-launcher-go/server_config_windows.go");
const runtime = read("apps/server-launcher-go/runtime_windows.go");
const packager = read("tools/scripts/package-cluster-master.mjs");
const app = read("packages/renderer/src/features/application/ClusterApplication.tsx");
const shellCss = read("packages/renderer/src/features/shell/shell.css");
const workspacesCss = read("packages/renderer/src/styles/layers/application-workspaces.css");
const visualPolish = read("packages/renderer/src/styles/visual-polish.css");
const production = read("packages/renderer/src/styles/design-system/production-ui.css");
const changelog = read("packages/renderer/src/features/changelog/data/cluster-changelog.ts");
const notes = read("RELEASE_NOTES_v0.468.0.md");

const [, minor = 0] = pkg.version.split(".").map(Number);

const checks = [
  ["v0.468 product contract remains active", Number.isFinite(minor) && minor >= 468],
  ["first-run visual mode prompt is simple Yes/No", ui.includes('"Use visual interface?"') && ui.includes("mbYesNo")],
  ["native status uses a semantic dot and short activity line", ui.includes("statusDot") && ui.includes("activity") && ui.includes("panelStateColor")],
  ["live logs use RichEdit instead of a monochrome edit-only view", ui.includes('createControl("RICHEDIT50W"') && ui.includes("emSetCharFormat")],
  ["live logs classify severity color", ui.includes("logSeverityColor") && ui.includes("rgbColor(222, 68, 75)") && ui.includes("rgbColor(224, 161, 36)")],
  ["normal informational logs receive restrained color", ui.includes("rgbColor(123, 196, 230)") && ui.includes("rgbColor(37, 111, 151)")],
  ["native dark mode is persistent and user-selectable", config.includes('Key: "native.darkMode"') && config.includes('Options: []string{"No", "Yes"}') && ui.includes("applyTheme")],
  ["Cluster icon is loaded by the native UI", ui.includes("loadClusterServerIcon") && ui.includes("cluster-icon.ico")],
  ["Cluster icon is packaged with the Windows server", packager.includes('path.join(stage, "cluster-icon.ico")')],
  ["private runtime install tolerates Windows rename locks", runtime.includes("stageRuntimeDirectory") && runtime.includes("copy fallback") && runtime.includes("time.Sleep")],
  ["mobile sidebar trigger disappears while drawer is open", app.includes("{!mobileSidebarOpen && (")],
  ["phone project tabs are suppressed through 767px", shellCss.includes('@media (max-width: 767px) { .taskbar-left-v073') && production.includes("Eliminate the second project-tab row")],
  ["tablet compact mystery rail is overridden by a real drawer", production.includes("Tablets use the same real drawer model as phones") && production.includes("transform: translateX(-105%)")],
  ["drawer backdrop no longer uses a heavy blur", visualPolish.includes(".sidebar-backdrop-v289") && !visualPolish.includes(".sidebar-backdrop-v289 { position: fixed; inset: 0; z-index: 65; display: block; border: 0; background: color-mix(in srgb, var(--cluster-slate-950) 58%, transparent); backdrop-filter")],
  ["global focus ring is restrained to one pixel", production.includes("--cluster-focus-ring: 0 0 0 1px") && production.includes("outline: 1px solid color-mix")],
  ["semantic sidebar icon color contract exists", production.includes('[data-nav-icon="operations"]') && production.includes('[data-nav-icon="calendar"]') && production.includes('[data-nav-icon="project"]')],
  ["People presence dot cannot inherit full avatar sizing", !workspacesCss.includes('.profile-detail-avatar-v083 > span:not(.tiny-avatar-wrap-v083)') && workspacesCss.includes(".cluster-presence-avatar-fallback-v227")],
  ["People presence indicator has an explicit small-size safety rule", production.includes(".profile-detail-avatar-v083 > .cluster-presence-indicator-v227") && production.includes("width: 13px")],
  ["compact global search has bounded columns and ellipsis", production.includes("grid-template-columns: 68px minmax(0, 1fr) minmax(72px, auto)") && production.includes("text-overflow: ellipsis")],
  ["v0.468 release is documented", changelog.includes('version: "v0.468.0"') && notes.includes("Server control-panel QoL and shell cleanup")],
  ["v0.468 gate participates in master packaging", packager.includes("server-qol-shell-v468-audit.mjs")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}
console.log(`Server QoL + shell v0.468: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);

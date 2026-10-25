import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const pkg = JSON.parse(read("package.json"));
const shell = read("packages/renderer/src/components/WorkspacePageShell.tsx");
const admin = read("packages/renderer/src/features/admin/AdminWorkspacePage.tsx");
const studio = read("packages/renderer/src/features/settings/StudioSettingsPage.tsx");
const account = read("packages/renderer/src/features/settings/AccountSettingsPage.tsx");
const server = read("packages/renderer/src/features/settings/ServerConfigPage.tsx");
const workspaces = read("packages/renderer/src/features/application/modules/application-workspaces.tsx");
const production = read("packages/renderer/src/styles/design-system/production-ui.css");
const application = read("packages/renderer/src/features/application/ClusterApplication.tsx");
const packager = read("tools/scripts/package-cluster-master.mjs");
const changelog = read("packages/renderer/src/features/changelog/data/cluster-changelog.ts");
const notes = read("RELEASE_NOTES_v0.474.0.md");

const version = String(pkg.version || "0.0.0").split(".").map((part) => Number(part) || 0);
const atLeast474 = version[0] > 0 || version[1] > 474 || (version[1] === 474 && version[2] >= 0);
const sharedShellConsumers = [admin, studio, account, server, workspaces];

const checks = [
  ["v0.474 UX parity pass is active", atLeast474],
  ["shared WorkspacePageShell owns the primary page contract", shell.includes("cluster-primary-page-v474") && shell.includes("cluster-primary-header-v474") && shell.includes("<ToolPageHeader")],
  ["Operations and People Management use the shared shell", admin.includes("<WorkspacePageShell") && admin.includes('title={scope === "users" ? "People Management" : "Operations"}')],
  ["Studio Settings uses the shared shell", studio.includes("<WorkspacePageShell") && studio.includes('title="Studio Settings"')],
  ["Account Settings uses the shared shell", account.includes("<WorkspacePageShell") && account.includes('title="Account Settings"')],
  ["Server Configuration uses the shared shell", server.includes("<WorkspacePageShell") && server.includes('title="Server Configuration"')],
  ["Tool Infrastructure uses the shared shell", workspaces.includes("<WorkspacePageShell") && workspaces.includes('title="Tool Infrastructure"')],
  ["legacy page-specific header classes are no longer page owners", sharedShellConsumers.every((source) => !source.includes('className="admin-primary-header-v459"') && !source.includes('className="settings-primary-header-v469"'))],
  ["administration and settings section navs share one parity class", admin.includes("cluster-primary-section-nav-v474") && studio.includes("cluster-primary-section-nav-v474") && account.includes("cluster-primary-section-nav-v474") && server.includes("cluster-primary-section-nav-v474")],
  ["shared section navigation is not sticky admin chrome", production.includes(".cluster-primary-page-v474 > .cluster-primary-section-nav-v474") && production.includes("position: static;")],
  ["shared pages use the canonical page width and gutter", production.includes(".cluster-primary-page-v474 {") && production.includes("width: min(var(--cluster-page-max), 100%);") && production.includes("padding: var(--cluster-page-gutter);")],
  ["shared headers have one canonical boundary and spacing contract", production.includes(".cluster-primary-page-v474 > .cluster-primary-header-v474") && production.includes("border: 1.5px solid var(--cluster-border-strong);")],
  ["settings no longer wrap all content in a second giant panel", production.includes(".settings-primary-layout-v469 > :where(.settings-content-v092, .settings-console-content-v269)") && production.includes("background: transparent;")],
  ["settings cards retain explicit grouping boundaries", production.includes(".cluster-primary-page-v474.settings-workspace-v298 .settings-card-v092") && production.includes("border: 1px solid var(--cluster-border);")],
  ["top-level status messages use a shared placement contract", admin.includes("cluster-primary-status-v474") && studio.includes("cluster-primary-status-v474") && account.includes("cluster-primary-status-v474") && server.includes("cluster-primary-status-v474") && workspaces.includes("cluster-primary-status-v474")],
  ["admin status appears with the page controls rather than at the page tail", admin.indexOf("cluster-primary-status-v474") < admin.indexOf('adminSection === "approvals"')],
  ["Tool Infrastructure preserves master/detail while sharing page density", production.includes(".cluster-primary-page-v474.tool-infrastructure-page-v236 .tool-infrastructure-browser-v250") && production.includes("grid-template-columns: minmax(230px, 280px) minmax(0, 1fr);")],
  ["contextual admin children retain Back to Operations routing", application.includes('["userAdmin", "toolInfrastructure", "studioSettings", "serverConfig"].includes(screen)') && application.includes('"Back to Operations"')],
  ["phone parity is owned by the same shared page class", production.includes("@media (max-width: 767px)") && production.includes(".cluster-primary-page-v474 > .cluster-primary-header-v474")],
  ["production parity layer adds no priority overrides", !production.slice(production.indexOf("v0.474 Phase 2 / Pass 1")).includes("!important")],
  ["v0.474 release is documented", changelog.includes('version: "v0.474.0"') && notes.includes("Phase 2 Pass 1")],
  ["v0.474 parity gate participates in master packaging", packager.includes("ux-parity-pass1-v474-audit.mjs")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}
console.log(`UX parity Pass 1 v0.474: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);

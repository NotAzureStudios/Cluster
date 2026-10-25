import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const pkg = JSON.parse(read("package.json"));
const create = read("packages/renderer/src/features/create/shared-create-drawer.css");
const production = read("packages/renderer/src/styles/design-system/production-ui.css");
const shellCss = read("packages/renderer/src/styles/shell-unification.css");
const accessibility = read("packages/renderer/src/styles/accessibility.css");
const refinements = read("packages/renderer/src/features/application/styles/refinements-workspaces.css");
const timeline = read("packages/renderer/src/features/timeline/timeline-workspace.css");
const workspaces = read("packages/renderer/src/features/application/modules/application-workspaces.tsx");
const appShell = read("packages/renderer/src/features/application/modules/application-shell.tsx");
const application = read("packages/renderer/src/features/application/ClusterApplication.tsx");
const admin = read("packages/renderer/src/features/admin/AdminWorkspacePage.tsx");
const studio = read("packages/renderer/src/features/settings/StudioSettingsPage.tsx");
const account = read("packages/renderer/src/features/settings/AccountSettingsPage.tsx");
const footer = read("packages/renderer/src/components/AppVersionFooter.tsx");
const settingsCss = read("packages/renderer/src/features/settings/settings-workspace.css");
const fileButton = read("packages/renderer/src/components/ClusterFileButton.tsx");
const changelog = read("packages/renderer/src/features/changelog/data/cluster-changelog.ts");
const notes = read("RELEASE_NOTES_v0.470.0.md");
const packager = read("tools/scripts/package-cluster-master.mjs");

function cssFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith(".css")) out.push(full);
  }
  return out;
}
const rendererCss = ["packages/renderer/src/styles", "packages/renderer/src/features", "packages/renderer/src/components"]
  .flatMap((rel) => cssFiles(path.join(root, rel)))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
const nonZeroSideEdges = [
  ...[...rendererCss.matchAll(/border-(?:left|right)\s*:\s*([^;{}]+);/g)].filter((m) => !/^\s*(?:0|none)(?:\s*!important)?\s*$/.test(m[1])),
  ...[...rendererCss.matchAll(/border-(?:left|right)-width\s*:\s*([^;{}]+);/g)].filter((m) => !/^\s*(?:0|none)(?:\s*!important)?\s*$/.test(m[1])),
];

const versionParts = String(pkg.version || "0.0.0").split(".").map((part) => Number(part) || 0);
const atLeastV470 = versionParts[0] > 0 || versionParts[1] > 470 || (versionParts[1] === 470 && versionParts[2] >= 0);

const checks = [
  ["v0.470 parity contract remains active on later releases", atLeastV470],
  ["Create owns a compact picker instead of the legacy 1180px surface", create.includes("width: min(820px") && create.includes("height: min(520px") && !create.includes("width: min(1180px")],
  ["Create picker explicitly owns four rows", create.includes("grid-template-rows: auto 42px minmax(0, 1fr) 38px")],
  ["Create mobile picker preserves a footer row", production.includes("grid-template-rows: auto 48px minmax(0, 1fr) 44px")],
  ["focus color is independent from Studio branding", production.includes("--cluster-focus-color: var(--cluster-cyan-500)") && accessibility.includes("var(--cluster-focus-color")],
  ["purple-style selected box shadow is not restored", production.includes("box-shadow: none")],
  ["server status popup is fixed above sidebar clipping", production.includes(".server-status-popover-v390 { position: fixed") && shellCss.includes("overflow-x: visible")],
  ["bottom-left status still exposes the health dialog", footer.includes('aria-label="Cluster server status"') && footer.includes("onOpenOperations")],
  ["taskbar actions own semantic icon colors", shellCss.includes("my-work svg") && shellCss.includes("notifications svg") && shellCss.includes("quick-create-v111 svg") && shellCss.includes("taskbar-search-trigger-v143 svg")],
  ["timeline presets reserve readable Quarter width", timeline.includes("grid-template-columns: repeat(4, minmax(68px, 1fr))") && timeline.includes("min-width: 68px")],
  ["clock overlay uses the v0.470 compact structure", workspaces.includes("clock-intent-modal-v470") && workspaces.includes("clock-project-options-v470") && workspaces.includes("Work label")],
  ["clock label is no longer hard-coded at API submission", appShell.includes('payload.title || "Clock in"')],
  ["admin children always have a contextual Operations parent", application.includes('["userAdmin", "toolInfrastructure", "studioSettings", "serverConfig"].includes(screen)')],
  ["Tool Infrastructure uses the shared page header", workspaces.includes('title="Tool Infrastructure"') && workspaces.includes("<WorkspacePageShell")],
  ["People Management no longer repeats its page title inside the panel", admin.includes('className="user-management-head-v244 user-management-head-v470"') && !admin.includes('<h2>People Management</h2>')],
  ["Operations hides empty queue and portfolio surfaces", admin.includes("adminCriticalGapCount > 0 || adminStaleUserCount > 0") && admin.includes("adminPortfolioRows.length > 0")],
  ["background job monitoring moved to Maintenance", admin.includes("<BackgroundJobsPanel />") && admin.includes("maintenance-tools-stack-v470")],
  ["Studio branding uses a styled image upload and accepts PNG", studio.includes("<ClusterFileButton") && studio.includes('accept="image/png,.png,image/jpeg,image/webp,image/gif"') && fileButton.includes("cluster-file-input-v475")],
  ["Project Types is master detail instead of expanding every preset", studio.includes("project-type-workbench-v470") && studio.includes("selectedProjectTypePreset") && settingsCss.includes("project-type-list-v470")],
  ["Project Type niche fields are under Advanced behavior", studio.includes("project-type-advanced-v470") && studio.includes("Advanced behavior")],
  ["Account and Studio settings avoid duplicate Saved indicators", !studio.includes("settings-save-state-v469") && !account.includes("settings-save-state-v469")],
  ["shared section navigation hides accidental scrollbars", accessibility.includes("overflow-y: hidden") && refinements.includes("scrollbar-width:none")],
  ["one-sided accent borders remain absent", nonZeroSideEdges.length === 0],
  ["v0.470 release is documented", changelog.includes('version: "v0.470.0"') && notes.includes("Admin parity and interaction cleanup")],
  ["v0.470 parity audit participates in master packaging", packager.includes("admin-parity-v470-audit.mjs")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}
console.log(`Admin parity v0.470: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);

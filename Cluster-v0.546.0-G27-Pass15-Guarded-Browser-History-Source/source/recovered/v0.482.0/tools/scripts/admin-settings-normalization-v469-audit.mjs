import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const pkg = JSON.parse(read("package.json"));
const studio = read("packages/renderer/src/features/settings/StudioSettingsPage.tsx");
const account = read("packages/renderer/src/features/settings/AccountSettingsPage.tsx");
const server = read("packages/renderer/src/features/settings/ServerConfigPage.tsx");
const footer = read("packages/renderer/src/components/AppVersionFooter.tsx");
const shell = read("packages/renderer/src/features/application/modules/application-shell.tsx");
const createCss = read("packages/renderer/src/styles/design-system/production-ui.css");
const legacyAppCss = read("packages/renderer/src/features/application/admin-control-center.css");
const globalStyles = read("packages/renderer/src/styles.css");
const changelog = read("packages/renderer/src/features/changelog/data/cluster-changelog.ts");
const notes = read("RELEASE_NOTES_v0.469.0.md");
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
const nonZeroSideBorders = [...rendererCss.matchAll(/border-(?:left|right)\s*:\s*([^;{}]+);/g)]
  .filter((match) => !/^\s*(?:0|none)(?:\s*!important)?\s*$/.test(match[1]));
const sideSpecificBorderColors = [...rendererCss.matchAll(/border-(?:left|right)-color\s*:/g)];
const verticalInsetAccents = [...rendererCss.matchAll(/box-shadow\s*:\s*([^;{}]+);/g)]
  .filter((match) => /\binset\s+-?(?:\d*\.)?\d+(?:px|rem|em)\s+0(?:\s|,|$)/i.test(match[1]));

const checks = [
  ["v0.469 product version is active", Number(pkg.version.split(".")[1]) >= 469],
  ["canonical production UI remains the final global stylesheet", globalStyles.trimEnd().endsWith('@import "./styles/design-system/production-ui.css";') && createCss.includes("v0.469 admin/settings normalization")],
  ["Studio Settings uses the shared primary header", studio.includes('<WorkspacePageShell') && studio.includes('title="Studio Settings"')],
  ["Studio Settings uses compact shared section navigation", studio.includes('<CompactSectionNav') && studio.includes('label="Studio settings sections"')],
  ["Account Settings uses the shared primary header", account.includes('<WorkspacePageShell') && account.includes('title="Account Settings"')],
  ["Account Settings uses compact shared section navigation", account.includes('<CompactSectionNav') && account.includes('label="Account settings sections"')],
  ["Server Configuration uses the shared primary header", server.includes('<WorkspacePageShell') && server.includes('title="Server Configuration"')],
  ["Server Configuration uses compact shared section navigation", server.includes('<CompactSectionNav') && server.includes('label="Server configuration sections"')],
  ["settings use the full-width primary layout contract", createCss.includes('.settings-primary-layout-v469') && createCss.includes('display: block;')],
  ["admin dashboards share compact density rules", createCss.includes('.operations-dashboard-v245') && createCss.includes('.user-admin-detail-scroll-v244')],
  ["decorative explicit left/right borders are gone renderer-wide", nonZeroSideBorders.length === 0 && sideSpecificBorderColors.length === 0 && verticalInsetAccents.length === 0],
  ["light shell chrome uses readable light surfaces", legacyAppCss.includes('background: var(--cluster-sidebar-bg-v259) !important') && legacyAppCss.includes('background: var(--cluster-taskbar-bg-v259) !important')],
  ["light sidebar SVGs inherit semantic currentColor", createCss.includes(':root[data-theme="light"] .shell-sidebar-v3430 .sidebar-nav-icon-v289') && createCss.includes('stroke: currentColor;')],
  ["admin header icon tones are semantic", createCss.includes('[data-tool-icon="operations"]') && createCss.includes('[data-tool-icon="cloud"]') && createCss.includes('[data-tool-icon="settings"]')],
  ["context navigation is a breadcrumb instead of a route bar", createCss.includes('.contextual-navigation-v396 > span { display: none; }')],
  ["Create search is physically bounded", createCss.includes('height: 36px;') && createCss.includes('grid-template-rows: auto 44px minmax(0, 1fr) 40px')],
  ["Create picker gives more vertical space to choices", createCss.includes('height: min(540px, calc(100dvh - 40px))') && createCss.includes('.shared-create-picker-scroll-v458')],
  ["server status popover uses compact System Health styling", createCss.includes('.server-status-popover-v390') && createCss.includes('grid-template-columns: repeat(2, minmax(0, 1fr))')],
  ["server health popover links admins to Operations", footer.includes('onOpenOperations') && footer.includes('>Operations</ClusterButton>') && shell.includes('onOpenOperations={isAdmin ? () => navigate("admin") : undefined}')],
  ["v0.469 release is documented", changelog.includes('version: "v0.469.0"') && notes.includes("Admin and settings normalization")],
  ["v0.469 gate participates in master packaging", packager.includes("admin-settings-normalization-v469-audit.mjs")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}
console.log(`Admin/settings normalization v0.469: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);

import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const pkg = JSON.parse(read("package.json"));
const admin = read("packages/renderer/src/features/admin/AdminWorkspacePage.tsx");
const ops = read("packages/renderer/src/features/admin/ServerAdminExperiencePanel.tsx");
const opsCss = read("packages/renderer/src/features/admin/server-admin-experience.css");
const workspaces = read("packages/renderer/src/features/application/modules/application-workspaces.tsx");
const colors = read("packages/renderer/src/components/ColorField.tsx");
const production = read("packages/renderer/src/styles/design-system/production-ui.css");
const changelog = read("packages/renderer/src/features/changelog/data/cluster-changelog.ts");
const notes = read("RELEASE_NOTES_v0.467.0.md");
const packager = read("tools/scripts/package-cluster-master.mjs");

const contract = production.slice(production.indexOf("v0.467 Operations debloat + typography normalization"));
const versionParts = pkg.version.split(".").map(Number);
const atLeast467 = versionParts[0] > 0 || versionParts[1] > 467 || (versionParts[1] === 467 && versionParts[2] >= 0);
const checks = [
  ["v0.467 contract remains active in later releases", atLeast467],
  ["Operations typography contract is authoritative", contract.includes("v0.467 Operations debloat + typography normalization")],
  ["runtime panel is renamed to focused health language", ops.includes("Runtime health") && ops.includes("Server, database, jobs, and security.")],
  ["runtime status summary is reduced to four tiles", ops.includes("server-admin-kpis-v467") && ["Runtime", "Database", "Jobs", "Security"].every((label) => ops.includes(`<span>${label}</span>`))],
  ["duplicate runtime tiles are removed", !ops.includes("<span>Realtime</span>") && !ops.includes("<span>Logs / audit</span>") && !ops.includes("<span>Backups</span>")],
  ["neutral external-provider nag is removed", !ops.includes("No external providers configured")],
  ["runtime footer shortcut duplication is removed", !ops.includes("server-admin-actions-v420")],
  ["Overview removes duplicate Workforce side card", !admin.includes('<section className="panel operations-workforce-v245">')],
  ["Overview removes duplicate Tool Infrastructure side card", !admin.includes('<section className="panel operations-tools-v245">')],
  ["Action Queue only renders real gaps", admin.includes("operations-actions-v467") && !admin.includes("No operational gaps.") && admin.includes("adminCriticalGapCount > 0 || adminStaleUserCount > 0") && admin.includes("adminPendingApprovals ? <button")],
  ["Operations summary labels have a readable floor", contract.includes(".operations-kpis-v245 span") && contract.includes("font-size: 11px")],
  ["Operations status metadata is normalized", contract.includes(".operations-runtime-issues-v245 em") && contract.includes("font-size: 10px")],
  ["clock dialog has a dedicated compact contract", workspaces.includes("clock-intent-modal-v467") && contract.includes("width: min(560px, calc(100vw - 28px))")],
  ["redundant clock session card is removed", !workspaces.includes("clock-fixed-label-v115") && !workspaces.includes("Project context is picked below")],
  ["clock no-project choice uses production wording", workspaces.includes("Studio / admin") && workspaces.includes("No project attribution")],
  ["clock picker rows use restrained typography", contract.includes(".clock-project-picker-v467 button strong") && contract.includes("font-size: 12px")],
  ["color picker has the v467 bounded workbench", colors.includes("cluster-color-popover-v467") && contract.includes("width: min(380px, calc(100vw - 28px))")],
  ["Studio color metadata cannot wrap", colors.includes("Workspace accent") && contract.includes("white-space: nowrap") && contract.includes("minmax(132px, 1fr)")],
  ["v0.467 release is documented", changelog.includes('version: "v0.467.0"') && notes.includes("Operations debloat and typography normalization")],
  ["v0.467 regression gate participates in master packaging", packager.includes("operations-typography-v467-audit.mjs")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}
console.log(`Operations typography v0.467: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);

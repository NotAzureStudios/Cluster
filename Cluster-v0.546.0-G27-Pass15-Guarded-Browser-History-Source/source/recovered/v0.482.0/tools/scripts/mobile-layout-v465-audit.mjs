import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const pkg = JSON.parse(read("package.json"));
const production = read("packages/renderer/src/styles/design-system/production-ui.css");
const shell = read("packages/renderer/src/features/shell/shell.css");
const projects = read("packages/renderer/src/features/projects/projects.css");
const appShell = read("packages/renderer/src/features/application/modules/application-shell.tsx");
const workspaces = read("packages/renderer/src/features/application/modules/application-workspaces.tsx");
const changelog = read("packages/renderer/src/features/changelog/data/cluster-changelog.ts");
const notes = read("RELEASE_NOTES_v0.465.0.md");
const packager = read("tools/scripts/package-cluster-master.mjs");

const mobileContract = production.slice(production.indexOf("v0.465 Mobile layout correction"));
const checks = [
  ["v0.465 product version is active", Number(pkg.version.split(".")[1] || 0) >= 465],
  ["phone contract is defined in authoritative production CSS", mobileContract.includes("v0.465 Mobile layout correction") && mobileContract.includes("@media (max-width: 767px)")],
  ["phone taskbar is two-lane rather than stacked desktop chrome", mobileContract.includes("grid-template-columns: minmax(0, 1fr) auto") && mobileContract.includes("height: 50px")],
  ["project tabs are removed from phone chrome", shell.includes(".taskbar-tabs-shell-v073 { display: none !important; }") && mobileContract.includes(".taskbar-v073 .taskbar-tabs-shell-v073 { display: none; }")],
  ["phone chrome hides desktop-only My Work and ticket controls", mobileContract.includes(".taskbar-v073 .taskbar-left-v073 > .my-work") && mobileContract.includes(".taskbar-v073 .taskbar-ticket-menu-v254 { display: none; }")],
  ["legacy phone taskbar stays two columns", projects.includes("@media (max-width: 760px) { .project-tabs-bar-v047.taskbar-v073, .taskbar-v073, .workspace-taskbar-v073 { position: sticky !important; top: 6px !important; grid-template-columns: minmax(0, 1fr) auto !important; height: 50px !important; min-height: 50px !important; padding: 5px 5px 5px 50px !important; } }")],
  ["taskbar controls no longer flex into giant phone rows", !shell.includes("flex: 1 1 150px !important") && !shell.includes("flex: 1 1 160px")],
  ["Home actions use a bounded phone grid", mobileContract.includes("grid-template-columns: repeat(3, minmax(0, 1fr))") && mobileContract.includes("min-height: 40px")],
  ["Home header metrics use a 2x2 phone grid", mobileContract.includes(".home-page-v091 > .cluster-tool-header-v228 .cluster-tool-metrics-v228") && mobileContract.includes("grid-template-columns: repeat(2, minmax(0, 1fr))")],
  ["resume card actions collapse into a clean two-column row", mobileContract.includes(".smart-resume-actions-v276") && mobileContract.includes("grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)")],
  ["Focus and schedule uses a deliberate mobile layout", mobileContract.includes(".home-personal-brief-v414") && mobileContract.includes(".home-personal-heading-v414")],
  ["floating chat is a compact icon launcher on phone", workspaces.includes('ClusterIcon name="comment" className="chat-launcher-icon-v465"') && mobileContract.includes(".chat-launcher-icon-v465") && mobileContract.includes("width: 44px")],
  ["phone chat opens as a bounded full-screen sheet", mobileContract.includes(".chat-dock.open") && mobileContract.includes(".chat-panel { width: 100%; height: 100%")],
  ["home copy is production-neutral", appShell.includes('detail: needsAttentionItems[0]?.title || "No critical alerts"') && appShell.includes('<p className="muted">No assigned work.</p>') && !appShell.includes("Suspiciously peaceful")],
  ["My Work resume labels normalize correctly", appShell.includes('replace(/mywork/gi, "my work")')],
  ["v0.465 release is in changelog", changelog.includes('version: "v0.465.0"') && changelog.includes("Mobile layout correction")],
  ["v0.465 release notes document the phone fixes", notes.includes("Mobile layout correction") && notes.includes("taskbar") && notes.includes("Home")],
  ["mobile regression audit participates in master packaging", packager.includes("mobile-layout-v465-audit.mjs")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}
console.log(`Mobile layout v0.465: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);

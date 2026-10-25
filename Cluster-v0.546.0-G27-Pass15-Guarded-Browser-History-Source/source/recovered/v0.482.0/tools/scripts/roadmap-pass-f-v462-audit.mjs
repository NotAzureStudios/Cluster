import { readFile } from "node:fs/promises";
const root = process.cwd();
const read = (p) => readFile(`${root}/${p}`, "utf8");
const [pkgText, production, createCss, app, changelog, notes, packager, cssBaseline] = await Promise.all([
  read("package.json"),
  read("packages/renderer/src/styles/design-system/production-ui.css"),
  read("packages/renderer/src/features/create/shared-create-drawer.css"),
  read("packages/renderer/src/features/application/ClusterApplication.tsx"),
  read("packages/renderer/src/features/changelog/data/cluster-changelog.ts"),
  read("RELEASE_NOTES_v0.462.0.md"),
  read("tools/scripts/package-cluster-master.mjs"),
  read("config/css-architecture-baseline.json"),
]);
const pkg = JSON.parse(pkgText);
const baseline = JSON.parse(cssBaseline);
const checks = [
  ["Pass F version lineage is preserved", Number(pkg.version.split(".")[1] || 0) >= 462],
  ["production contract owns Pass F repairs", production.includes("v0.462 Roadmap Pass F")],
  ["headers keep a complete perimeter", production.includes("border: 1.5px solid var(--cluster-border-strong)")],
  ["shared searches own their full lane", production.includes(".projects-search-v146") && production.includes("max-width: none")],
  ["horizontal data regions contain overflow", production.includes(".data-table-shell") && production.includes("overscroll-behavior-inline: contain")],
  ["mobile metrics use scan lanes", production.includes("grid-auto-columns: minmax(124px, 1fr)")],
  ["phone project tabs are removed below 520px", production.includes("@media (max-width: 520px)") && production.includes("taskbar-tabs-shell-v073")],
  ["320px chrome has an explicit contract", production.includes("@media (max-width: 360px)")],
  ["short landscape has an explicit contract", production.includes("max-height: 620px") && production.includes("orientation: landscape")],
  ["mobile drawer closes when navigation becomes persistent", app.includes("persistentNavigation") && app.includes("setMobileSidebarOpen(false)")],
  ["Create no longer depends on 100dvw", !createCss.includes("width: 100dvw")],
  ["Create keeps safe full-height mobile flow", createCss.includes("height: 100dvh") && createCss.includes("env(safe-area-inset-bottom)")],
  ["Pass F adds no important to production contract", !production.slice(production.indexOf("v0.462 Roadmap Pass F")).includes("!important")],
  ["Pass F adds no raw hex colors to production contract", !/#(?:[0-9a-fA-F]{3,8})\b/.test(production.slice(production.indexOf("v0.462 Roadmap Pass F")))],
  ["CSS forced-style debt stays at or below the v0.461 ceiling", Number(baseline.summary?.important) <= 6534],
  ["Pass F is documented in changelog", changelog.includes('version: "v0.462.0"') && changelog.includes("viewport hardening")],
  ["Pass F release notes exist", notes.includes("Roadmap Pass F") && notes.includes("viewport QA")],
  ["Pass F participates in master packaging", packager.includes("roadmap-pass-f-v462-audit.mjs")],
];
let failed=0;
for (const [name,ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"} ${name}`); if(!ok) failed++; }
console.log(`Roadmap Pass F v0.462: ${checks.length-failed}/${checks.length} passed.`);
if (failed) process.exit(1);

import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const pkg = JSON.parse(read("package.json"));
const liquid = read("packages/renderer/src/styles/liquid-glass.css");
const glass = read("packages/renderer/src/styles/glass-polish-v311.css");
const projectCss = read("packages/renderer/src/features/projects/project-detail-workspace.css");
const projectPrimitives = read("packages/renderer/src/features/projects/ProjectWorkspacePrimitives.tsx");
const production = read("packages/renderer/src/styles/design-system/production-ui.css");
const changelog = read("packages/renderer/src/features/changelog/data/cluster-changelog.ts");
const notes = read("RELEASE_NOTES_v0.478.0.md");
const doc = read("docs/UX_PARITY_PASS_5_FINAL_POLISH.md");
const architecture = read("packages/renderer/src/styles/ARCHITECTURE.md");
const packager = read("tools/scripts/package-cluster-master.mjs");
const rawColorPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\brgb\([^)]*\)|\bhsl\([^)]*\)/g;
const count = (source, needle) => source.split(needle).length - 1;

const checks = [
  ["v0.478 product version is active", Number(pkg.version.split(".")[1] || 0) >= 478],
  ["legacy liquid glass no longer owns global shell/workspace surfaces", !/\b(?:body|\.content-shell|\.sidebar|\.taskbar|\.setup-shell|\.projects-page-v146)\b/.test(liquid)],
  ["legacy liquid glass contains no forced or decorative debt", !liquid.includes("!important") && !liquid.includes("gradient(") && !liquid.includes("backdrop-filter") && !(liquid.match(rawColorPattern) || []).length],
  ["legacy liquid glass only preserves compact color compatibility", liquid.includes("cluster-compact-color-v448") && liquid.includes("compatibility bridge")],
  ["explicit glass mode remains opt in", glass.includes(':root[data-card-style="glass"]') && !/\bbody\s*\{/.test(glass) && !glass.includes("!important")],
  ["explicit glass mode respects reduced transparency", glass.includes("prefers-reduced-transparency") && glass.includes("backdrop-filter: none")],
  ["project detail has no raw CSS colors", !(projectCss.match(rawColorPattern) || []).length],
  ["project detail decorative debt is reduced", (projectCss.match(/\b(?:linear|radial|conic)-gradient\(/g) || []).length <= 4 && (projectCss.match(/(?<!-)\bbackdrop-filter\s*:/g) || []).length <= 1],
  ["routine project section prose is hidden by default", projectPrimitives.includes('description && compact ? <p className="muted">{description}</p> : null')],
  ["normal project cards omit narration but preserve warning context", projectPrimitives.includes('description && (tone === "warning" || tone === "danger") ? <p>{description}</p> : null')],
  ["semantic title icon mappings are consolidated", count(production, '.cluster-tool-title-icon-v448[data-tool-icon="home"]') === 1 && count(production, '.cluster-tool-title-icon-v448[data-tool-icon="timeline"]') === 1],
  ["production UI remains under its source budget", production.split(/\r?\n/).length <= 4000],
  ["architecture documents the retired global glass layer", architecture.includes("Phase 2 final-polish cleanup (v0.478)") && architecture.includes("must not regain ownership")],
  ["v0.478 release is documented", changelog.includes('version: "v0.478.0"') && notes.includes("final debloat and visual QA") && doc.includes("Final Debloat and Visual QA")],
  ["final polish audit participates in master packaging", packager.includes("ux-parity-pass5-v478-audit.mjs")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}
console.log(`UX parity Pass 5 v0.478: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);

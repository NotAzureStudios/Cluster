import { readFile } from "node:fs/promises";

const root = process.cwd();
const read = (path) => readFile(`${root}/${path}`, "utf8");

const [
  packageJson,
  packager,
  cssBaselineText,
  colorBaselineText,
  consistency,
  controls,
  adaptive,
  applicationTools,
  applicationWorkspaces,
  timeline,
  library,
  pdf,
  changelog,
  releaseNotes,
] = await Promise.all([
  read("package.json"),
  read("tools/scripts/package-cluster-master.mjs"),
  read("config/css-architecture-baseline.json"),
  read("config/design-system-color-baseline.json"),
  read("packages/renderer/src/styles/consistency.css"),
  read("packages/renderer/src/styles/controls.css"),
  read("packages/renderer/src/styles/layers/application-adaptive.css"),
  read("packages/renderer/src/styles/layers/application-tools.css"),
  read("packages/renderer/src/styles/layers/application-workspaces.css"),
  read("packages/renderer/src/features/timeline/timeline-workspace.css"),
  read("packages/renderer/src/features/library/library-workspace.css"),
  read("packages/renderer/src/features/library/cluster-pdf-viewer.css"),
  read("packages/renderer/src/features/changelog/data/cluster-changelog.ts"),
  read("RELEASE_NOTES_v0.461.0.md"),
]);

const cssBaseline = JSON.parse(cssBaselineText);
const colorBaseline = JSON.parse(colorBaselineText);
const checks = [
  ["Pass E remains in the release lineage", /^0\.(?:46[1-9]|4[7-9]\d|[5-9]\d\d)\./.test(JSON.parse(packageJson).version)],
  ["CSS debt baseline is ratcheted for v0.461", cssBaseline.ratchetedFor === "0.461.0"],
  ["forced-style debt is lower than the pre-roadmap baseline", Number(cssBaseline.summary?.important) <= 6534 && Number(cssBaseline.summary?.important) < 6576],
  ["gradient debt is lower than the pre-roadmap baseline", Number(cssBaseline.summary?.gradient) <= 509 && Number(cssBaseline.summary?.gradient) < 517],
  ["raw CSS color debt is ratcheted below the prior budget", Number(cssBaseline.summary?.rawColor) <= 1538 && Object.values(colorBaseline.files || {}).reduce((sum, value) => sum + Number(value || 0), 0) <= 1538],
  ["obsolete Create menu compatibility CSS is gone", !applicationWorkspaces.includes("create-menu-v071") && !timeline.includes("create-menu-v071")],
  ["obsolete pre-redesign color swatch CSS is gone", !consistency.includes("cluster-color-swatches-v227") && !consistency.includes("cluster-color-custom-v227") && !consistency.includes("cluster-color-value-v227")],
  ["shared sliders no longer scale or glow on focus", !controls.includes("scale(1.08)") && !controls.includes("0 0 0 4px") && controls.includes("box-shadow: none")],
  ["shared progress bars no longer emit accent glow", !controls.includes("0 0 14px color-mix(in srgb, var(--accent)")],
  ["legacy form focus is keyboard-aware", adaptive.includes("input:focus-visible, textarea:focus-visible, select:focus-visible") && applicationTools.includes("input:focus-visible, select:focus-visible, textarea:focus-visible")],
  ["routine global control hover no longer moves controls", applicationTools.includes("transform: none; filter: none !important")],
  ["library viewer identity follows Studio color", library.includes("var(--studio-primary, var(--accent))") && !library.includes("accent-color: #6fa2f5") && !library.includes("background: #5d96ef; box-shadow")],
  ["PDF text selection follows Studio color", pdf.includes("::selection { background: color-mix(in srgb, var(--studio-primary, var(--accent)) 30%, transparent); }")],
  ["Pass E is documented in the changelog", changelog.includes('version: "v0.461.0"') && changelog.includes("Release-candidate polish")],
  ["Pass E release notes exist", releaseNotes.includes("Roadmap Pass E") && releaseNotes.includes("release-candidate")],
  ["Pass E audit participates in normal audit", packageJson.includes("roadmap-pass-e-v461-audit.mjs")],
  ["Pass E audit participates in packaging", packager.includes("roadmap-pass-e-v461-audit.mjs")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}
console.log(`Roadmap Pass E v0.461: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);

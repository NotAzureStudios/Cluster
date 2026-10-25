import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const pkg = JSON.parse(read("package.json"));
const entry = read("packages/renderer/src/styles.css");
const responsive = read("packages/renderer/src/styles/responsive-v477.css");
const changelog = read("packages/renderer/src/features/changelog/data/cluster-changelog.ts");
const notes = read("RELEASE_NOTES_v0.477.0.md");
const doc = read("docs/UX_PARITY_PASS_4_RESPONSIVE.md");
const packager = read("tools/scripts/package-cluster-master.mjs");
const rawColorPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\brgb\([^)]*\)|\bhsl\([^)]*\)/g;

const checks = [
  ["v0.477 product version is active", Number(pkg.version.split(".")[1] || 0) >= 477],
  ["responsive v0.477 layer is imported", entry.includes('@import "./styles/responsive-v477.css";')],
  ["responsive v0.477 stays after legacy responsive passes", entry.indexOf("responsive-v460.css") < entry.indexOf("responsive-v477.css")],
  ["production UI remains the final global contract", entry.indexOf("responsive-v477.css") < entry.indexOf("production-ui.css") && entry.trimEnd().endsWith('@import "./styles/design-system/production-ui.css";')],
  ["compact desktop and iPad landscape contract exists", responsive.includes("@media (min-width: 900px) and (max-width: 1199px)")],
  ["iPad portrait contract exists", responsive.includes("@media (min-width: 768px) and (max-width: 899px)")],
  ["phone contract exists", responsive.includes("@media (max-width: 767px)")],
  ["shared primary navigation remains touch-scrollable", responsive.includes(".cluster-primary-section-nav-v474") && responsive.includes("overflow-x: auto")],
  ["tablet primary header actions avoid crushed wrapping", responsive.includes("max-width: min(48vw, 560px)") && responsive.includes("flex-wrap: nowrap")],
  ["tablet master detail promotes inspectors to safe-area sheets", responsive.includes(".cluster-master-detail-v429.detail-open .cluster-detail-pane-v429") && responsive.includes("env(safe-area-inset-top)")],
  ["profile tablet parity is explicit", responsive.includes(".profile-content-columns-v250") && responsive.includes(".profile-editor-grid-v473")],
  ["notification delivery parity is explicit", responsive.includes(".notification-delivery-select-v473") && responsive.includes(".notification-delivery-legend-v473")],
  ["phone data toolbar and filters collapse deliberately", responsive.includes(".cluster-data-toolbar-v289") && responsive.includes("repeat(2, minmax(0, 1fr))") && responsive.includes("@media (max-width: 430px)")],
  ["phone forms use iOS-safe input sizing", responsive.includes("font-size: 16px") && responsive.includes(".setup-card-v473") && responsive.includes(".profile-editor-v473")],
  ["coarse pointer touch contract exists", responsive.includes("@media (pointer: coarse)") && responsive.includes("touch-action: manipulation")],
  ["short landscape contract exists", responsive.includes("max-height: 620px") && responsive.includes("orientation: landscape")],
  ["responsive layer adds no forced or decorative debt", !responsive.includes("!important") && !(responsive.match(rawColorPattern) || []).length && !responsive.includes("linear-gradient(") && !responsive.includes("radial-gradient(") && !responsive.includes("backdrop-filter")],
  ["v0.477 release is documented", changelog.includes('version: "v0.477.0"') && notes.includes("Phase 2 Pass 4") && doc.includes("Responsive, Mobile, and Tablet")],
  ["responsive parity audit participates in master packaging", packager.includes("ux-parity-pass4-v477-audit.mjs")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}
console.log(`UX parity Pass 4 v0.477: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);

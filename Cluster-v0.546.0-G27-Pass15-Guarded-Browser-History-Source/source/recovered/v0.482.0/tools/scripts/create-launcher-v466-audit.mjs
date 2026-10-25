import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const pkg = JSON.parse(read("package.json"));
const create = read("packages/renderer/src/features/create/SharedCreateDrawer.tsx");
const createCss = read("packages/renderer/src/features/create/shared-create-drawer.css");
const production = read("packages/renderer/src/styles/design-system/production-ui.css");
const changelog = read("packages/renderer/src/features/changelog/data/cluster-changelog.ts");
const notes = read("RELEASE_NOTES_v0.466.0.md");
const packager = read("tools/scripts/package-cluster-master.mjs");
const contract = production.slice(production.indexOf("v0.466 Create launcher refinement"));

const checks = [
  ["v0.466 product version lineage is preserved", Number(pkg.version.split(".")[1] || 0) >= 466],
  ["Create refinement contract is in authoritative production CSS", contract.includes("v0.466 Create launcher refinement")],
  ["picker explicitly models header search catalog and footer rows", contract.includes("grid-template-rows: auto auto minmax(0, 1fr) auto")],
  ["desktop Create launcher has a bounded command-surface footprint", contract.includes("width: min(860px, calc(100dvw - 48px))") && contract.includes("height: min(610px, calc(100dvh - 48px))")],
  ["legacy creator sizing no longer force-overrides desktop dimensions", !createCss.includes("width: min(1180px, calc(100dvw - 36px)) !important") && !createCss.includes("height: min(820px, calc(100dvh - 36px)) !important")],
  ["mobile creator uses one full-height workspace row", createCss.includes("grid-template-rows: minmax(0, 1fr) !important")],
  ["search displays a live match count", create.includes("shared-create-search-count-v466") && create.includes('aria-live="polite"')],
  ["visible item types drive keyboard selection", create.includes("visibleCreateModeIds") && create.includes("moveCreatePickerSelection")],
  ["arrow-key navigation is supported", create.includes('event.key === "ArrowDown"') && create.includes('event.key === "ArrowUp"')],
  ["Enter selects the active search result", create.includes('event.key === "Enter"') && create.includes("changeCreateMode(activeCreateMode)")],
  ["Escape closes the shared creator", create.includes('event.key === "Escape"') && create.includes("onClose();")],
  ["pointer and focus states synchronize the active item", create.includes("onMouseEnter={() => setActiveCreateMode(item.id)}") && create.includes("onFocus={() => setActiveCreateMode(item.id)}")],
  ["active item receives a restrained edge indicator", contract.includes('button[data-active="true"]::before') && contract.includes("background: var(--studio-primary, var(--accent))")],
  ["group descriptions are visible outside narrow phone layouts", contract.includes(".shared-create-type-group-v458 > header span") && contract.includes("display: block")],
  ["redundant footer Cancel action is removed", !create.includes('<button type="button" className="button secondary" onClick={onClose}>Cancel</button>')],
  ["footer exposes real keyboard hints", create.includes("shared-create-picker-hints-v466") && create.includes("<kbd>Enter</kbd>") && create.includes("<kbd>Esc</kbd>")],
  ["tablet Create uses a two-column catalog while narrow screens use one", contract.includes("@media (max-width: 900px) and (min-width: 700px)") && contract.includes("grid-template-columns: repeat(2, minmax(0, 1fr))") && contract.includes("@media (max-width: 699px)")],
  ["phone hides nonessential footer hints", contract.includes(".shared-create-picker-footer-v466") && contract.includes("display: none")],
  ["v0.466 release is present in changelog and notes", changelog.includes('version: "v0.466.0"') && notes.includes("Create launcher refinement")],
  ["Create regression gate participates in master packaging", packager.includes("create-launcher-v466-audit.mjs")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}
console.log(`Create launcher v0.466: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);

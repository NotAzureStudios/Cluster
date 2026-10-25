import { readFile } from "node:fs/promises";
const root = process.cwd();
const read = (p) => readFile(`${root}/${p}`, "utf8");
const css = await read("packages/renderer/src/styles/responsive-v457.css");
const create = await read("packages/renderer/src/features/create/SharedCreateDrawer.tsx");
const color = await read("packages/renderer/src/components/ColorField.tsx");
const entry = await read("packages/renderer/src/styles.css");
const checks = [
  ["v457 responsive layer imported", entry.includes("responsive-v457.css")],
  ["iPad compact rail", css.includes("min-width: 900px") && css.includes("grid-template-columns: 72px")],
  ["phone full perimeter header", css.includes("border: 1px solid var(--cluster-border-strong)")],
  ["very small taskbar trim", css.includes("max-width: 430px") && css.includes("taskbar-tabs-shell-v073")],
  ["create search", create.includes("Search item types") && create.includes("createTypeQuery")],
  ["create recent modes", create.includes("cluster.recent-create-modes.v457")],
  ["create empty state", create.includes("No matching item type")],
  ["color workbench", color.includes("cluster-color-plane-v457")],
  ["color contrast", color.includes("contrastRatio") && color.includes("Low contrast")],
  ["studio color action", color.includes("Studio color")],
  ["mobile color backdrop", color.includes("cluster-color-sheet-backdrop-v457") && css.includes("cluster-color-sheet-backdrop-v457")],
  ["no native color input", !color.includes('type="color"')],
  ["no new important debt", !css.includes("!important")],
];
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"} ${name}`); if (!ok) failed++; }
console.log(`Responsive Pass A v0.457: ${checks.length-failed}/${checks.length} passed.`);
if (failed) process.exit(1);

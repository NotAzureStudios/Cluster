import { readFile } from "node:fs/promises";
const root = process.cwd();
const read = (path) => readFile(`${root}/${path}`, "utf8");
const create = await read("packages/renderer/src/features/create/SharedCreateDrawer.tsx");
const color = await read("packages/renderer/src/components/ColorField.tsx");
const css = await read("packages/renderer/src/styles/design-system/production-ui.css");
const icons = await read("packages/renderer/src/components/ClusterIcon.tsx");
const passBStart = css.indexOf("v0.458 Pass B");
const passBEnd = css.indexOf("v0.459 Pass C", passBStart);
const passB = css.slice(passBStart, passBEnd > passBStart ? passBEnd : undefined);
const checks = [
  ["create launcher uses compact grouped command lists", create.includes("shared-create-type-list-v458") && create.includes("shared-create-type-groups-v458")],
  ["create form removes the obsolete hidden rail", !create.includes('<aside className="shared-create-rail-v254">')],
  ["create forms are required-first with optional disclosure", create.includes("shared-create-advanced-toggle-v458") && create.includes("showAdvanced")],
  ["create required guidance is compact", create.includes("create-guidance-v458") && create.includes("Required:")],
  ["color picker has palette and custom modes", color.includes('"palette" | "custom"') && color.includes("cluster-color-mode-v458")],
  ["color picker retains Studio and recent colors", color.includes("Studio color") && color.includes("Recent colors")],
  ["color picker keeps contrast guidance", color.includes("contrastRatio") && color.includes("Low contrast for text")],
  ["shared color system has no native color input", !color.includes('type="color"')],
  ["palette icon exists in shared icon set", icons.includes('| "palette"') && icons.includes("palette: <>")],
  ["workspace headers use complete stronger boundaries", css.includes("v0.458 Pass B") && css.includes("border: 1.5px solid")],
  ["selection uses Studio color without decorative side edges", css.includes("border-color: var(--studio-primary") && css.includes("border-bottom-color: var(--studio-primary") && !css.includes("border-left-color: var(--studio-primary")],
  ["sidebar semantic overrides avoid blue/cyan/sky tokens", !passB.match(/sidebar-icon-slot[^}]+cluster-(?:blue|cyan|sky)-/s)],
  ["colored control shadows are neutralized", css.includes("Decorative colored control shadows") && css.includes("box-shadow: none")],
];
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"} ${name}`); if (!ok) failed++; }
console.log(`Responsive Pass B v0.458: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);

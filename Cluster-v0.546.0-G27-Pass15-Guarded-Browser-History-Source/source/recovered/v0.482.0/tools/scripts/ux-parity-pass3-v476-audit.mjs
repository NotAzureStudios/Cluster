import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const pkg = JSON.parse(read("package.json"));
const tokens = read("packages/renderer/src/styles/design-system/tokens.css");
const production = read("packages/renderer/src/styles/design-system/production-ui.css");
const icon = read("packages/renderer/src/components/ClusterIcon.tsx");
const changelog = read("packages/renderer/src/features/changelog/data/cluster-changelog.ts");
const notes = read("RELEASE_NOTES_v0.476.0.md");
const packager = read("tools/scripts/package-cluster-master.mjs");

const version = String(pkg.version || "0.0.0").split(".").map((part) => Number(part) || 0);
const atLeast476 = version[0] > 0 || version[1] > 476 || (version[1] === 476 && version[2] >= 0);
const pass3 = production.slice(production.indexOf("v0.476 Phase 2 / Pass 3"));

const semanticTokens = [
  "--cluster-icon-home:", "--cluster-icon-project:", "--cluster-icon-timeline:", "--cluster-icon-ticket:",
  "--cluster-icon-calendar:", "--cluster-icon-time:", "--cluster-icon-library:", "--cluster-icon-packet:",
  "--cluster-icon-operations:", "--cluster-icon-people:", "--cluster-icon-tools:", "--cluster-icon-settings:",
  "--cluster-icon-server:", "--cluster-icon-work:", "--cluster-icon-notification:", "--cluster-icon-create:",
  "--cluster-icon-search:", "--cluster-icon-success:", "--cluster-icon-warning:", "--cluster-icon-danger:",
];
const checks = [
  ["v0.476 UX parity pass is active", atLeast476],
  ["semantic icon vocabulary is centralized in tokens", semanticTokens.every((token) => tokens.includes(token))],
  ["semantic icon colors adapt through active theme text", tokens.includes("color-mix(in srgb, var(--cluster-sky-500) 82%, var(--text))") && tokens.includes("color-mix(in srgb, var(--danger) 88%, var(--text))")],
  ["canonical ClusterIcon exposes a stable semantic hook", icon.includes("data-cluster-icon={name}")],
  ["sidebar domains use semantic aliases", pass3.includes('data-nav-icon="project"') && pass3.includes("--cluster-nav-semantic: var(--cluster-icon-project)") && pass3.includes("--cluster-nav-semantic: var(--cluster-icon-settings)")],
  ["page-title domains use the same semantic aliases", pass3.includes("--cluster-title-icon-color: var(--cluster-icon-project)") && pass3.includes("--cluster-title-icon-color: var(--cluster-icon-server)")],
  ["taskbar semantic identity flows through compatibility variable", pass3.includes("--cluster-taskbar-icon-v259: var(--cluster-icon-work)") && pass3.includes("--cluster-taskbar-icon-v259: var(--cluster-icon-create)") && pass3.includes("--cluster-taskbar-icon-v259: var(--cluster-icon-search)")],
  ["notification severity changes glyph intent", pass3.includes("notifications.severity-critical") && pass3.includes("var(--cluster-icon-danger)") && pass3.includes("notifications.severity-important") && pass3.includes("var(--cluster-icon-warning)") && pass3.includes("notifications.severity-good") && pass3.includes("var(--cluster-icon-success)")],
  ["Create modes reuse the semantic vocabulary", pass3.includes('data-create-mode="project"') && pass3.includes("--cluster-create-icon-color: var(--cluster-icon-project)") && pass3.includes('data-create-mode="bug"') && pass3.includes("--cluster-create-icon-color: var(--cluster-icon-danger)")],
  ["operational and upload glyphs have explicit semantic hooks", pass3.includes('[data-cluster-icon="warning"]') && pass3.includes('.cluster-file-button-v475 [data-cluster-icon="upload"]')],
  ["Pass 3 adds no priority overrides", !pass3.includes("!important")],
  ["Pass 3 adds no raw CSS colors", !/(?:#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\brgb\(|\bhsl\()/.test(pass3)],
  ["v0.476 release is documented", changelog.includes('version: "v0.476.0"') && notes.includes("Phase 2 Pass 3")],
  ["v0.476 parity gate participates in master packaging", packager.includes("ux-parity-pass3-v476-audit.mjs")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}
console.log(`UX parity Pass 3 v0.476: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);

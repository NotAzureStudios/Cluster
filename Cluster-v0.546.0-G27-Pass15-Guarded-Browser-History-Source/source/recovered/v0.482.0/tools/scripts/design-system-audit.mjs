import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const rendererRoot = path.join(root, "packages", "renderer", "src");
const cssRoot = path.join(rendererRoot);
const failures = [];
const checks = [];

function record(label, ok, detail = "") {
  checks.push({ label, ok, detail });
  if (!ok) failures.push(`${label}${detail ? `: ${detail}` : ""}`);
}

async function read(relative) {
  return readFile(path.join(root, relative), "utf8");
}

async function cssFiles(directory, out = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await cssFiles(absolute, out);
    else if (entry.name.endsWith(".css")) out.push(absolute);
  }
  return out;
}

const files = await cssFiles(cssRoot);
const relativeCss = new Set(files.map((file) => path.relative(root, file).replaceAll("\\", "/")));
let largest = { relative: "", bytes: 0, lines: 0 };

for (const absolute of files) {
  const info = await stat(absolute);
  const source = await readFile(absolute, "utf8");
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  const lines = source.split(/\r?\n/).length;
  if (info.size > largest.bytes) largest = { relative, bytes: info.size, lines };
  record(`css source budget ${relative}`, info.size <= 150_000 && lines <= 4_000, `${info.size} bytes / ${lines} lines`);
  record(`css braces balance ${relative}`, (source.match(/{/g) || []).length === (source.match(/}/g) || []).length);
}

const stylesEntry = await read("packages/renderer/src/styles.css");
const rendererIndex = await read("packages/renderer/src/index.tsx");
const appBarrel = await read("packages/renderer/src/styles/application.css");
const refinementBarrel = await read("packages/renderer/src/features/application/application-refinements.css");
const tokens = await read("packages/renderer/src/styles/design-system/tokens.css");
const primitives = await read("packages/renderer/src/styles/design-system/primitives.css");
const productionUi = await read("packages/renderer/src/styles/design-system/production-ui.css");

const orderedImports = [
  './styles/design-system/tokens.css',
  './styles/application.css',
  './styles/glass-polish-v311.css',
  './styles/shell-unification.css',
  './styles/parity-v344.css',
  './styles/controls.css',
  './styles/accessibility.css',
  './styles/consistency.css',
  './styles/visual-polish.css',
  './styles/liquid-glass.css',
  './styles/design-system/primitives.css',
];
let previous = -1;
for (const importPath of orderedImports) {
  const current = stylesEntry.indexOf(`@import "${importPath}";`);
  record(`ordered style entry includes ${importPath}`, current >= 0 && current > previous);
  previous = current;
}
record("design tokens load first", stylesEntry.trimStart().startsWith('@import "./styles/design-system/tokens.css";'));
record("shared primitives remain the canonical base before product polish layers",
  stylesEntry.indexOf('@import "./styles/design-system/primitives.css";') < stylesEntry.indexOf('@import "./styles/design-system/phase-a-polish.css";') &&
  stylesEntry.indexOf('@import "./styles/design-system/phase-k-polish.css";') < stylesEntry.indexOf('@import "./styles/design-system/production-ui.css";') &&
  stylesEntry.trimEnd().endsWith('@import "./styles/design-system/production-ui.css";'));
record("renderer index has one system stylesheet entrypoint",
  rendererIndex.includes('import "./styles.css";') &&
  !rendererIndex.includes('import "./styles/controls.css";') &&
  !rendererIndex.includes('import "./styles/consistency.css";') &&
  !rendererIndex.includes('import "./styles/visual-polish.css";') &&
  !rendererIndex.includes('import "./styles/liquid-glass.css";'));

const appInfo = await stat(path.join(root, "packages/renderer/src/styles/application.css"));
const refinementsInfo = await stat(path.join(root, "packages/renderer/src/features/application/application-refinements.css"));
record("application stylesheet entry is a thin compatibility barrel", appInfo.size <= 1_500 && (appBarrel.match(/@import/g) || []).length === 6);
record("application refinements entry is a thin compatibility barrel", refinementsInfo.size <= 1_000 && (refinementBarrel.match(/@import/g) || []).length === 4);

for (const required of [
  "--cluster-font-sans:", "--space-1:", "--space-7:", "--cluster-radius-control:", "--cluster-radius-dialog:",
  "--cluster-control-height:", "--ds-bg:", "--ds-surface:", "--ds-text:", "--ds-text-muted:", "--ds-border:",
  "--ds-accent:", "--ds-danger:", "--ds-success:", "--cluster-shadow-panel:", "--cluster-focus-ring:", "--cluster-motion-fast:",
]) record(`canonical token ${required.slice(0, -1)}`, tokens.includes(required));
record("tokens define explicit light and dark theme contracts", tokens.includes(':root[data-theme="light"]') && tokens.includes(':root[data-theme="dark"]'));
record("design-system primitives contain no raw colors", !/(?:#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\brgb\(|\bhsl\()/.test(primitives));
record("design-system layers avoid important overrides", !tokens.includes("!important") && !primitives.includes("!important"));
record("production UI layer avoids important overrides", !productionUi.includes("!important"));
record("production UI layer avoids decorative blur", !productionUi.includes("backdrop-filter"));
record("production UI layer reserves elevation for overlays", productionUi.includes("Ordinary surfaces are defined by boundaries") && productionUi.includes("Dialogs and menus are the places where elevation is useful"));

// ds-* is the new semantic namespace. It may only be declared in the canonical token file.
for (const absolute of files) {
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  if (relative === "packages/renderer/src/styles/design-system/tokens.css") continue;
  const source = await readFile(absolute, "utf8");
  record(`semantic ds tokens are not redefined by ${relative}`, !/--ds-[a-z0-9-]+\s*:/.test(source));
}

// Resolve every CSS @import in the renderer and reject import cycles.
const importGraph = new Map();
for (const absolute of files) {
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  const source = await readFile(absolute, "utf8");
  const imports = [];
  for (const match of source.matchAll(/@import\s+["']([^"']+)["']/g)) {
    if (!match[1].startsWith(".")) continue;
    let candidate = path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1]));
    if (!candidate.endsWith(".css")) candidate += ".css";
    record(`css import resolves ${relative} -> ${candidate}`, relativeCss.has(candidate));
    if (relativeCss.has(candidate)) imports.push(candidate);
  }
  importGraph.set(relative, imports);
}
const visiting = new Set();
const visited = new Set();
let cycle = null;
function visit(node, stack = []) {
  if (cycle) return;
  if (visiting.has(node)) {
    const start = stack.indexOf(node);
    cycle = [...stack.slice(Math.max(0, start)), node];
    return;
  }
  if (visited.has(node)) return;
  visiting.add(node);
  for (const next of importGraph.get(node) || []) visit(next, [...stack, node]);
  visiting.delete(node);
  visited.add(node);
}
for (const node of importGraph.keys()) visit(node, []);
record("renderer css imports remain cycle-free", !cycle, cycle ? cycle.join(" -> ") : "");

// Raw color debt is frozen at the post-Step-2 baseline. Existing files can improve, new files must use tokens.
const baseline = JSON.parse(await read("config/design-system-color-baseline.json"));
const rawColorPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\brgb\([^)]*\)|\bhsl\([^)]*\)/g;
let currentRawColors = 0;
let baselineRawColors = 0;
for (const value of Object.values(baseline.files)) baselineRawColors += Number(value) || 0;
for (const absolute of files) {
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  const source = await readFile(absolute, "utf8");
  const count = (source.match(rawColorPattern) || []).length;
  currentRawColors += count;
  const allowed = Number(baseline.files[relative] || 0);
  record(`raw color budget ${relative}`, count <= allowed, `${count}/${allowed}`);
}
record("raw color debt does not increase globally", currentRawColors <= baselineRawColors, `${currentRawColors}/${baselineRawColors}`);

for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.detail && !item.ok ? ` (${item.detail})` : ""}`);
console.log(`\nDesign-system audit: ${checks.length - failures.length}/${checks.length} passed. Largest CSS: ${largest.relative} (${largest.bytes} bytes / ${largest.lines} lines). Raw colors: ${currentRawColors}/${baselineRawColors}.`);
if (failures.length) process.exitCode = 1;

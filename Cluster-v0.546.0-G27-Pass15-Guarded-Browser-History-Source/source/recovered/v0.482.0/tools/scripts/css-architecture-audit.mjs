import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const rendererRoot = path.join(root, "packages", "renderer", "src");
const baselinePath = path.join(root, "config", "css-architecture-baseline.json");
const checks = [];
const failures = [];

function record(label, ok, detail = "") {
  checks.push({ label, ok, detail });
  if (!ok) failures.push(`${label}${detail ? `: ${detail}` : ""}`);
}

async function collectCss(directory, out = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectCss(absolute, out);
    else if (entry.name.endsWith(".css")) out.push(absolute);
  }
  return out;
}

const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const cssFiles = await collectCss(rendererRoot);
const rawColorPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\brgb\([^)]*\)|\bhsl\([^)]*\)/g;
const metrics = new Map();

function measure(source) {
  return {
    important: (source.match(/!important/g) || []).length,
    boxShadow: (source.match(/(?<!-)\bbox-shadow\s*:/g) || []).length,
    textShadow: (source.match(/(?<!-)\btext-shadow\s*:/g) || []).length,
    gradient: (source.match(/\b(?:linear|radial|conic)-gradient\(/g) || []).length,
    backdropFilter: (source.match(/(?<!-)\bbackdrop-filter\s*:/g) || []).length,
    rawColor: (source.match(rawColorPattern) || []).length,
  };
}

for (const absolute of cssFiles) {
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  const source = await readFile(absolute, "utf8");
  metrics.set(relative, measure(source));
}

const summaryKeys = ["important", "boxShadow", "textShadow", "gradient", "backdropFilter", "rawColor"];
const summary = Object.fromEntries(summaryKeys.map((key) => [key, 0]));
for (const value of metrics.values()) for (const key of summaryKeys) summary[key] += value[key];

record("CSS architecture documentation exists", await readFile(path.join(rendererRoot, "styles", "ARCHITECTURE.md"), "utf8").then((s) => s.includes("The cascade is an API"), () => false));

const globalEntry = await readFile(path.join(rendererRoot, "styles.css"), "utf8");
const productionImport = '@import "./styles/design-system/production-ui.css";';
record("production UI contract remains the final global import", globalEntry.trimEnd().endsWith(productionImport));
record("global stylesheet entry documents deliberate import order", globalEntry.includes("Import order is deliberate"));

const appRefinementImports = [];
async function collectTs(directory, out = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectTs(absolute, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(absolute);
  }
  return out;
}
for (const absolute of await collectTs(rendererRoot)) {
  const source = await readFile(absolute, "utf8");
  if (source.includes("application-refinements.css")) appRefinementImports.push(path.relative(root, absolute).replaceAll("\\", "/"));
}
record(
  "application refinement compatibility CSS has one owning import",
  appRefinementImports.length === 1 && appRefinementImports[0].endsWith("features/application/ClusterApplication.tsx"),
  appRefinementImports.join(", "),
);

const appModulesDir = path.join(rendererRoot, "features", "application", "modules");
const appModuleCssImports = [];
for (const entry of await readdir(appModulesDir)) {
  if (!entry.endsWith(".tsx") && !entry.endsWith(".ts")) continue;
  const source = await readFile(path.join(appModulesDir, entry), "utf8");
  if (/import\s+["'][^"']+\.css["']/.test(source)) appModuleCssImports.push(entry);
}
record("application decomposition modules do not own side-effect CSS imports", appModuleCssImports.length === 0, appModuleCssImports.join(", "));

const compatibilityBarrel = await readFile(path.join(rendererRoot, "features", "application", "application-refinements.css"), "utf8");
const barrelWithoutComments = compatibilityBarrel.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@import\s+["'][^"']+["'];?/g, "").trim();
record("application refinement compatibility barrel contains imports only", barrelWithoutComments.length === 0);

const canonicalDesignSystemFiles = new Set([
  "packages/renderer/src/styles/design-system/tokens.css",
  "packages/renderer/src/styles/design-system/primitives.css",
  "packages/renderer/src/styles/design-system/production-ui.css",
]);
const designSystemImportant = [];
for (const [relative, value] of metrics) {
  if (canonicalDesignSystemFiles.has(relative) && value.important > 0) designSystemImportant.push(`${relative}:${value.important}`);
}
record("canonical design-system CSS stays free of important overrides", designSystemImportant.length === 0, designSystemImportant.join(", "));

const baselineFiles = baseline.files || {};
const newDebtFiles = [];
const regressions = [];
for (const [relative, value] of metrics) {
  const allowed = baselineFiles[relative];
  if (!allowed) {
    if (value.important || value.rawColor || value.backdropFilter) newDebtFiles.push(`${relative} important=${value.important} rawColor=${value.rawColor} backdrop=${value.backdropFilter}`);
    continue;
  }
  // Phase 1 freezes the highest-risk cascade/decorative debt per file. Counts may decrease, never increase.
  for (const key of ["important", "gradient", "backdropFilter", "rawColor"]) {
    if (value[key] > Number(allowed[key] || 0)) regressions.push(`${relative} ${key} ${value[key]}/${allowed[key] || 0}`);
  }
}
record("existing CSS debt never increases per file", regressions.length === 0, regressions.slice(0, 12).join("; "));
record("new CSS files start without forced/raw/blur debt", newDebtFiles.length === 0, newDebtFiles.slice(0, 12).join("; "));

for (const key of ["important", "gradient", "backdropFilter", "rawColor"]) {
  record(`global CSS ${key} debt stays at or below Phase 1 baseline`, summary[key] <= Number(baseline.summary?.[key] || 0), `${summary[key]}/${baseline.summary?.[key] || 0}`);
}

const legacyNamePattern = /(?:^|\/)(?:[^/]*(?:polish|parity|override|fix)[^/]*)\.css$/i;
const untrackedLegacyFiles = [...metrics.keys()].filter((relative) => legacyNamePattern.test(relative) && !baselineFiles[relative]);
record("no new patch-named CSS layers are introduced", untrackedLegacyFiles.length === 0, untrackedLegacyFiles.join(", "));

const topImportant = [...metrics.entries()]
  .filter(([, value]) => value.important > 0)
  .sort((a, b) => b[1].important - a[1].important)
  .slice(0, 8)
  .map(([relative, value]) => `${relative}=${value.important}`)
  .join(", ");

for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.detail && !item.ok ? ` (${item.detail})` : ""}`);
console.log(`\nCSS architecture audit: ${checks.length - failures.length}/${checks.length} passed. !important ${summary.important}/${baseline.summary.important}; gradients ${summary.gradient}/${baseline.summary.gradient}; backdrop-filter ${summary.backdropFilter}/${baseline.summary.backdropFilter}.`);
console.log(`Top remaining !important owners: ${topImportant || "none"}.`);
if (failures.length) process.exitCode = 1;

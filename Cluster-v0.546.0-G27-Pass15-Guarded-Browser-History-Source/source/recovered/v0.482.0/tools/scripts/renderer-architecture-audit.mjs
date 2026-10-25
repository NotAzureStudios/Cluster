import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const rendererRoot = path.join(root, "packages", "renderer", "src");
const failures = [];
const checks = [];

function record(label, ok, detail = "") {
  checks.push({ label, ok, detail });
  if (!ok) failures.push(`${label}${detail ? `: ${detail}` : ""}`);
}

async function read(relative) {
  return readFile(path.join(root, relative), "utf8");
}

async function sourceFiles(directory, out = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await sourceFiles(absolute, out);
    else if (/\.(?:ts|tsx)$/.test(entry.name)) out.push(absolute);
  }
  return out;
}

const rendererFiles = await sourceFiles(rendererRoot);
let largest = { relative: "", bytes: 0, lines: 0 };
for (const absolute of rendererFiles) {
  const info = await stat(absolute);
  const content = await readFile(absolute, "utf8");
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  const lines = content.split(/\r?\n/).length;
  if (info.size > largest.bytes) largest = { relative, bytes: info.size, lines };
  record(`renderer source budget ${relative}`, info.size <= 180_000 && lines <= 4_000, `${info.size} bytes / ${lines} lines`);
}

const applicationEntry = "packages/renderer/src/features/application/ClusterApplication.tsx";
const operationsBarrel = "packages/renderer/src/features/operations/OperationsWorkspacePanels.tsx";
const settingsBarrel = "packages/renderer/src/features/settings/SettingsWorkspacePages.tsx";
const appSource = await read(applicationEntry);
const opsSource = await read(operationsBarrel);
const settingsSource = await read(settingsBarrel);
const appStat = await stat(path.join(root, applicationEntry));
const opsStat = await stat(path.join(root, operationsBarrel));
const settingsStat = await stat(path.join(root, settingsBarrel));

record("ClusterApplication stays composition-sized", appStat.size <= 75_000 && appSource.split(/\r?\n/).length <= 1_500, `${appStat.size} bytes`);
record("operations workspace entry is a compatibility barrel", opsStat.size <= 5_000 && opsSource.includes('export * from "./modules/operations-foundation"'));
record("settings workspace entry is a compatibility barrel", settingsStat.size <= 5_000 && settingsSource.includes('export { AccountSettingsPage } from "./AccountSettingsPage"'));
record("settings pages lazy-load independently", !appSource.includes('import("../settings/SettingsWorkspacePages")'));
record("application decomposition modules are explicit", [
  "application-foundation.tsx",
  "application-shell.tsx",
  "application-operations.tsx",
  "application-workspaces.tsx",
].every((name) => rendererFiles.some((file) => file.endsWith(path.join("application", "modules", name)))));
record("operations decomposition modules are explicit", [
  "operations-foundation.tsx",
  "operations-workflows.tsx",
  "operations-admin.tsx",
  "operations-delivery.tsx",
  "operations-dashboard.tsx",
].every((name) => rendererFiles.some((file) => file.endsWith(path.join("operations", "modules", name)))));

function relativeModuleImports(relative, source) {
  const directory = path.posix.dirname(relative);
  const result = [];
  const pattern = /(?:from\s+|import\s*\()(["'])(\.\.?\/[^"']+)\1/g;
  for (const match of source.matchAll(pattern)) {
    const raw = match[2];
    let resolved = path.posix.normalize(path.posix.join(directory, raw));
    const candidates = [resolved, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}/index.ts`, `${resolved}/index.tsx`];
    const hit = candidates.find((candidate) => rendererFiles.some((file) => path.relative(root, file).replaceAll("\\", "/") === candidate));
    if (hit) result.push(hit);
  }
  return result;
}

const graph = new Map();
for (const absolute of rendererFiles) {
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  if (!relative.includes("/features/application/modules/") && !relative.includes("/features/operations/modules/")) continue;
  const source = await readFile(absolute, "utf8");
  graph.set(relative, relativeModuleImports(relative, source).filter((target) => graph.has(target) || target.includes("/modules/")));
}
// Rebuild after all nodes are known so forward references are included.
for (const relative of [...graph.keys()]) {
  const source = await read(relative);
  graph.set(relative, relativeModuleImports(relative, source).filter((target) => graph.has(target)));
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
  for (const next of graph.get(node) || []) visit(next, [...stack, node]);
  visiting.delete(node);
  visited.add(node);
}
for (const node of graph.keys()) visit(node, []);
record("decomposed renderer modules remain cycle-free", !cycle, cycle ? cycle.join(" -> ") : "");

for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.detail && !item.ok ? ` (${item.detail})` : ""}`);
console.log(`\nRenderer architecture audit: ${checks.length - failures.length}/${checks.length} passed. Largest TS/TSX: ${largest.relative} (${largest.bytes} bytes / ${largest.lines} lines).`);
if (failures.length) process.exitCode = 1;

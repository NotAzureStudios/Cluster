import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const checks = [];
const check = (label, ok, detail = "") => checks.push({ label, ok, detail });
const text = (relative) => readFile(path.join(root, relative), "utf8");

async function cssFiles(directory, out = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await cssFiles(absolute, out);
    else if (entry.name.endsWith(".css")) out.push(absolute);
  }
  return out;
}

function rawRgbBase(value) {
  const hex = value.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) return h.slice(0, 3).split("").map((part) => Number.parseInt(part + part, 16)).join(",");
    if (h.length === 6 || h.length === 8) return [0, 2, 4].map((offset) => Number.parseInt(h.slice(offset, offset + 2), 16)).join(",");
  }
  const fn = value.match(/^rgba?\((.*)\)$/i);
  if (!fn) return "";
  const channels = fn[1].match(/\d+(?:\.\d+)?/g) || [];
  if (channels.length < 3) return "";
  const rgb = channels.slice(0, 3).map(Number);
  if (rgb.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) return "";
  return rgb.join(",");
}

const [tokens, baselineText, apiContracts, notes, doc, packageText, packager, uxDebtText] = await Promise.all([
  text("packages/renderer/src/styles/design-system/tokens.css"),
  text("config/design-system-color-baseline.json"),
  text("packages/shared/src/api-contracts.ts"),
  text("RELEASE_NOTES_v0.392.0.md"),
  text("docs/UX_POLISH_PASS_3.md"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
  text("config/ux-debt-baseline.json"),
]);

const baseline = JSON.parse(baselineText);
const uxDebt = JSON.parse(uxDebtText);
const baselineTotal = Object.values(baseline.files || {}).reduce((sum, value) => sum + Number(value || 0), 0);
check("pass 3 color baseline uses schema v3", baseline.version === 3);
check("pass 3 lowers raw color debt to 1,576 or less", baselineTotal <= 1576, `${baselineTotal}/1576`);
check("zero native-dialog debt remains locked", uxDebt.nativeDialogCallsMaximum === 0);
check("zero implicit-button debt remains locked", uxDebt.buttonWithoutExplicitTypeMaximum === 0);
check("zero ad-hoc JSX style debt remains locked", uxDebt.inlineStyleObjectMaximum === 0);

for (const token of [
  "--cluster-white:", "--cluster-black:", "--cluster-slate-50:", "--cluster-slate-200:", "--cluster-slate-300:",
  "--cluster-slate-500:", "--cluster-slate-900:", "--cluster-slate-950:", "--cluster-gray-900:", "--cluster-blue-100:",
  "--cluster-blue-200:", "--cluster-blue-300:", "--cluster-blue-700:", "--cluster-red-200:", "--cluster-red-400:",
  "--cluster-violet-400:", "--cluster-violet-500:", "--cluster-sky-500:",
]) check(`canonical migration token ${token.slice(0, -1)}`, tokens.includes(token));

const centralizedRgb = new Set([
  "255,255,255", "0,0,0", "248,250,252", "226,232,240", "203,213,225", "148,163,184", "100,116,139", "15,23,42", "2,6,23", "17,24,39",
  "219,234,254", "191,219,254", "147,197,253", "96,165,250", "59,130,246", "37,99,235", "29,78,216", "14,165,233", "34,197,94", "245,158,11",
  "254,202,202", "248,113,113", "239,68,68", "167,139,250", "139,92,246", "76,125,255", "34,199,235",
]);
const rawColorPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\brgb\([^)]*\)/g;
const rendererCss = await cssFiles(path.join(root, "packages", "renderer", "src"));
let leakedCentralizedColors = 0;
let alphaMixes = 0;
for (const absolute of rendererCss) {
  if (absolute.endsWith(path.join("design-system", "tokens.css"))) continue;
  const source = await readFile(absolute, "utf8");
  alphaMixes += (source.match(/color-mix\(in srgb, var\(--cluster-[a-z0-9-]+\) [\d.]+%, transparent\)/g) || []).length;
  for (const value of source.match(rawColorPattern) || []) {
    if (centralizedRgb.has(rawRgbBase(value))) leakedCentralizedColors += 1;
  }
}
check("centralized palette no longer leaks as raw renderer colors", leakedCentralizedColors === 0, `${leakedCentralizedColors} leaks`);
check("legacy alpha colors derive from canonical tokens", alphaMixes >= 500, `${alphaMixes} token-derived alpha mixes`);

check("pass 3 API capability is current", apiContracts.includes('version: "2026-08-02.63"') && apiContracts.includes('"ux-polish-pass-3-v1"'));
check("pass 3 release notes record the color ratchet", notes.includes("3,428") && notes.includes("1,576") && notes.includes("ux-polish-pass-3-v1"));
check("pass 3 documentation explains semantic review boundary", doc.includes("1,576") && doc.includes("semantic review") && doc.includes("schema version 3"));
const pkg = JSON.parse(packageText);
check("pass 3 audit is in the aggregate audit command", String(pkg.scripts?.audit || "").includes("ux-polish-pass-three-audit.mjs"));
check("pass 3 audit is invoked by master packaging", packager.includes("ux-polish-pass-three-audit.mjs"));
check("pass 3 documentation is packaged", packager.includes("docs/UX_POLISH_PASS_3.md"));

const failures = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.detail ? ` (${item.detail})` : ""}`);
console.log(`\nCluster UX polish pass 3 audit: ${checks.length - failures.length}/${checks.length} passed.`);
if (failures.length) process.exit(1);

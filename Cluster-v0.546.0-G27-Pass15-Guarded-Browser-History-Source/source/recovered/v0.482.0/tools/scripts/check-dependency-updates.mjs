import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compareVersions } from "./toolchain-lib.mjs";

const root = process.cwd();
const manifestFile = path.join(root, "config", "toolchain-versions.json");
const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
const writeSafe = process.argv.includes("--write-safe");

async function text(url) {
  const response = await fetch(url, { headers: { "user-agent": "Cluster dependency monitor" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}
async function json(url) { return JSON.parse(await text(url)); }

function sameParts(current, latest, count) {
  const a = current.split(".").map(Number);
  const b = latest.split(".").map(Number);
  return a.slice(0, count).every((value, index) => value === b[index]);
}
function safePatch(current, latest, ecosystem) {
  if (compareVersions(latest, current) <= 0) return false;
  if (ecosystem === "postgresql") return current.split(".")[0] === latest.split(".")[0];
  if (ecosystem === "revision") return Number(latest) > Number(current);
  return sameParts(current, latest, 2);
}

const checks = [
  {
    name: "Prisma",
    current: () => manifest.prisma.version,
    latest: async () => (await json("https://registry.npmjs.org/prisma/latest")).version,
    set: (version) => { manifest.prisma.version = version; },
  },
  {
    name: "Three.js",
    current: () => manifest.three.version,
    latest: async () => (await json("https://registry.npmjs.org/three/latest")).version,
    set: (version) => { manifest.three.version = version; },
  },
  {
    name: "Node.js LTS",
    current: () => manifest.node.version,
    latest: async () => {
      const releases = await json("https://nodejs.org/dist/index.json");
      const major = Number(manifest.node.version.split(".")[0]);
      return releases.find((item) => item.lts && Number(item.version.replace(/^v/, "").split(".")[0]) === major)?.version?.replace(/^v/, "") || manifest.node.version;
    },
    set: (version) => { manifest.node.version = version; },
  },
  {
    name: "Qt",
    current: () => manifest.qt.version,
    latest: async () => {
      const html = await text(`https://download.qt.io/official_releases/qt/${manifest.qt.majorMinor}/`);
      const versions = [...html.matchAll(/href="(\d+\.\d+\.\d+)\//g)].map((match) => match[1]).sort((a, b) => compareVersions(b, a));
      return versions[0] || manifest.qt.version;
    },
    set: (version) => { manifest.qt.version = version; },
  },
  {
    name: "PostgreSQL",
    ecosystem: "postgresql",
    current: () => manifest.postgresql.version,
    latest: async () => {
      const html = await text("https://www.postgresql.org/support/versioning/");
      const major = String(manifest.postgresql.major);
      const match = html.match(new RegExp(`>${major}<[\\s\\S]{0,500}?>(?:${major}\\.)(\\d+)<`));
      return match ? `${major}.${match[1]}` : manifest.postgresql.version;
    },
    set: (version) => { manifest.postgresql.version = version; },
  },
  {
    name: "PostgreSQL Windows installer revision",
    ecosystem: "revision",
    current: () => String(manifest.postgresql.installerRevision),
    latest: async () => {
      const items = await json(`https://api.github.com/repos/microsoft/winget-pkgs/contents/manifests/p/PostgreSQL/PostgreSQL/${manifest.postgresql.major}`);
      const prefix = `${manifest.postgresql.version}-`;
      const revisions = Array.isArray(items)
        ? items.map((item) => String(item.name || "")).filter((name) => name.startsWith(prefix)).map((name) => Number(name.slice(prefix.length))).filter(Number.isFinite)
        : [];
      return revisions.length ? String(Math.max(...revisions)) : String(manifest.postgresql.installerRevision);
    },
    set: (revision) => { manifest.postgresql.installerRevision = Number(revision); },
  },
  {
    name: "CMake",
    current: () => manifest.cmake.recommended,
    latest: async () => {
      const html = await text("https://cmake.org/download/");
      const versions = [...html.matchAll(/Latest Release \((\d+\.\d+\.\d+)\)/g)].map((match) => match[1]);
      return versions.sort((a, b) => compareVersions(b, a))[0] || manifest.cmake.recommended;
    },
    set: (version) => { manifest.cmake.recommended = version; },
  },
  {
    name: "Go",
    current: () => manifest.go.recommended,
    latest: async () => {
      const releases = await json("https://go.dev/dl/?mode=json");
      return String(releases[0]?.version || "").replace(/^go/, "") || manifest.go.recommended;
    },
    set: (version) => { manifest.go.recommended = version; },
  },
];

const report = [];
for (const check of checks) {
  const current = check.current();
  try {
    const latest = await check.latest();
    const update = compareVersions(latest, current) > 0;
    const safe = update && safePatch(current, latest, check.ecosystem || check.name.toLowerCase());
    report.push({ name: check.name, current, latest, update, safe });
    if (writeSafe && safe) check.set(latest);
  } catch (error) {
    report.push({ name: check.name, current, latest: null, update: false, safe: false, error: error instanceof Error ? error.message : String(error) });
  }
}

console.table(report.map(({ name, current, latest, update, safe, error }) => ({ name, current, latest: latest || "check failed", update, safePatch: safe, error: error || "" })));
if (writeSafe) {
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log("Safe patch-level toolchain updates were written to config/toolchain-versions.json. Run npm run versions:sync next.");
}
if (report.some((item) => item.error)) process.exitCode = 2;
else if (!writeSafe && report.some((item) => item.update)) process.exitCode = 10;

import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { sourceRevision } from "./release-evidence-lib.mjs";

const root = process.cwd();
const outArg = process.argv.find((item) => item.startsWith("--out="));
const inventoryArg = process.argv.find((item) => item.startsWith("--inventory="));
const requireLock = process.argv.includes("--require-lock");
const out = path.resolve(outArg?.slice(6) || path.join(root, "release", "SBOM.spdx.json"));
const inventoryOut = path.resolve(inventoryArg?.slice(12) || path.join(root, "release", "RELEASE_INVENTORY.json"));
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const toolchain = JSON.parse(await readFile(path.join(root, "config", "toolchain-versions.json"), "utf8"));
const lockPath = path.join(root, "package-lock.json");
async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function sha256(file) { return createHash("sha256").update(await readFile(file)).digest("hex"); }
function safeId(value) { return String(value).replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "component"; }
function packageNameFromPath(key, entry) {
  if (entry?.name) return entry.name;
  const marker = "node_modules/";
  const index = key.lastIndexOf(marker);
  return index >= 0 ? key.slice(index + marker.length) : key || pkg.name || "cluster";
}

const packages = [];
const relationships = [];
const seen = new Set();
function addPackage({ name, version, supplier = "NOASSERTION", downloadLocation = "NOASSERTION", checksums = [] }, parent = "SPDXRef-Cluster") {
  const identity = `${name}@${version}`;
  if (seen.has(identity)) return;
  seen.add(identity);
  const id = `SPDXRef-Package-${safeId(name)}-${safeId(version)}`;
  packages.push({ SPDXID: id, name, versionInfo: String(version || "NOASSERTION"), supplier, downloadLocation, filesAnalyzed: false, checksums });
  relationships.push({ spdxElementId: parent, relationshipType: "DEPENDS_ON", relatedSpdxElement: id });
}

let dependencyLock = null;
let completeDependencyGraph = false;
if (await exists(lockPath)) {
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  dependencyLock = { path: "package-lock.json", sha256: await sha256(lockPath), lockfileVersion: lock.lockfileVersion || null };
  for (const [key, entry] of Object.entries(lock.packages || {})) {
    if (!key || !entry?.version) continue;
    const integrity = typeof entry.integrity === "string" && entry.integrity.startsWith("sha512-")
      ? [{ algorithm: "SHA512", checksumValue: Buffer.from(entry.integrity.slice(7), "base64").toString("hex") }]
      : [];
    addPackage({ name: packageNameFromPath(key, entry), version: entry.version, downloadLocation: entry.resolved || "NOASSERTION", checksums: integrity });
  }
  completeDependencyGraph = true;
} else {
  if (requireLock) throw new Error("Certified SBOM generation requires package-lock.json.");
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, version] of Object.entries(pkg[section] || {})) addPackage({ name, version });
  }
}

for (const goMod of ["apps/host-go/go.mod", "apps/server-launcher-go/go.mod", "apps/update-helper-go/go.mod"]) {
  const text = await readFile(path.join(root, goMod), "utf8");
  const block = text.match(/require\s*\(([^]*?)\)/m)?.[1] || "";
  for (const line of block.split(/\r?\n/)) {
    const match = line.trim().match(/^([^\s]+)\s+(v[^\s]+)/);
    if (match) addPackage({ name: match[1], version: match[2] });
  }
  for (const match of text.matchAll(/^require\s+([^\s]+)\s+(v[^\s]+)/gm)) addPackage({ name: match[1], version: match[2] });
}

const toolPackages = [
  ["Node.js", toolchain.node.version], ["PostgreSQL", toolchain.postgresql.version], ["Qt", toolchain.qt.version],
  ["Go", toolchain.go.recommended], ["CMake", toolchain.cmake.recommended], ["Prisma", toolchain.prisma.version], ["Three.js", toolchain.three.version],
];
for (const [name, version] of toolPackages) addPackage({ name, version });

const revision = sourceRevision(root);
const document = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: `Cluster-v${pkg.version}`,
  documentNamespace: `https://cluster.invalid/spdx/v${pkg.version}/${revision === "unavailable" ? `local-${Date.now()}` : revision}`,
  creationInfo: { created: new Date().toISOString(), creators: ["Tool: Cluster release-sbom.mjs"] },
  packages: [
    { SPDXID: "SPDXRef-Cluster", name: "Cluster", versionInfo: pkg.version, supplier: "Organization: Cluster", downloadLocation: "NOASSERTION", filesAnalyzed: false },
    ...packages,
  ],
  relationships: [
    { spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: "SPDXRef-Cluster" },
    ...relationships,
  ],
};
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(document, null, 2)}\n`);
const sbomSha256 = await sha256(out);
const inventory = {
  schema: 1,
  clusterVersion: pkg.version,
  sourceRevision: revision,
  generatedAt: new Date().toISOString(),
  completeDependencyGraph,
  dependencyLock,
  sbom: { format: "SPDX-2.3", path: path.basename(out), sha256: sbomSha256, packageCount: document.packages.length },
  toolchain,
};
await writeFile(inventoryOut, `${JSON.stringify(inventory, null, 2)}\n`);
console.log(`Cluster release SBOM written to ${out} (${document.packages.length} packages; ${completeDependencyGraph ? "locked" : "partial"} dependency graph).`);

// Release gate for npm workspaces and the resolved public dependency graph.
// This is intentionally dependency-free so CI can check the lockfile before npm ci.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const lockPath = path.join(root, "package-lock.json");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const failures = [];
function check(ok, message) { if (!ok) failures.push(message); }
check(fs.existsSync(lockPath), "Tracked package-lock.json is missing");
if (!fs.existsSync(lockPath)) {
  console.error("Cluster reproducible npm build BLOCKED: " + failures.join("; "));
  process.exit(1);
}

const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
check(lock.lockfileVersion === 3, "Require npm lockfile v3");
check(lock.name === manifest.name && lock.version === manifest.version, "Root lockfile identity drift");
check(lock.packages && typeof lock.packages === "object", "Missing npm lockfile packages graph");
const packages = lock.packages || {};
const rootEntry = packages[""] || {};
check(rootEntry.name === manifest.name && rootEntry.version === manifest.version, "Root package graph drift");

function matchingManifest(pathname, actual, label) {
  for (const key of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const wanted = actual[key] || {};
    const locked = pathname[key] || {};
    const wantedEntries = Object.entries(wanted);
    check(JSON.stringify(Object.entries(locked).sort()) === JSON.stringify(wantedEntries.sort()),
      `${label} ${key} changed without refreshing lockfile`);
  }
}
matchingManifest(rootEntry, manifest, "root");

const workspaces = manifest.workspaces || [];
check(Array.isArray(workspaces) && workspaces.length === 6, "Unexpected workspace identity list");
for (const workspace of workspaces) {
  const name = workspace.replaceAll("\\", "/");
  const child = JSON.parse(fs.readFileSync(path.join(root, name, "package.json"), "utf8"));
  const locked = packages[name];
  check(!!locked, `Lockfile missing workspace entry: ${name}`);
  if (!locked) continue;
  check(locked.name === child.name && locked.version === child.version,
    `Workspace name/version mismatch: ${name}`);
  check(child.version === manifest.version, `Workspace/source version mismatch: ${name}`);
  matchingManifest(locked, child, name);
  const link = packages[`node_modules/${child.name}`];
  check(link?.link === true && link.resolved === name,
    `Missing local workspace link: ${child.name}`);
}
for (const [p, pkg] of Object.entries(packages)) {
  if (pkg?.link === true) {
    check(workspaces.includes(pkg.resolved) && p.startsWith("node_modules/@cluster/"),
      `Unexpected package link: ${p}`);
    continue;
  }
  if (p.startsWith("node_modules/")) {
    check(typeof pkg.version === "string" && pkg.version.length > 0, `Missing resolved version: ${p}`);
    check(typeof pkg.integrity === "string" && /^sha(512|256|1)-/.test(pkg.integrity),
      `Missing npm tarball integrity: ${p}`);
    check(typeof pkg.resolved === "string" && pkg.resolved.startsWith("https://registry.npmjs.org/"),
      `Non-canonical or non-public npm resolution: ${p}`);
  }
}
const summary = {
  status: failures.length ? "FAIL" : "PASS",
  rootVersion: manifest.version,
  workspaces: workspaces.length,
  resolvedPackages: Object.keys(packages).filter(p => p.startsWith("node_modules/")).length,
  failures,
};
console.log(JSON.stringify(summary, null, 2));
if (failures.length) process.exitCode = 1;

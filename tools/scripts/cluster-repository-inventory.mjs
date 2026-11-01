// Read-only source inventory. Run in a Git working tree; never scans local data roots.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0").filter(Boolean).map((name) => name.replaceAll("\\", "/"));
const groups = {};
const namesByCase = new Map();
const collisions = [];
const duplicates = new Map();
const large = [];
let totalBytes = 0;
for (const name of tracked) {
  const dir = name.split("/").slice(0, 2).join("/");
  const group = name.includes("/") ? dir : "(root)";
  groups[group] = (groups[group] || 0) + 1;
  const lower = name.toLowerCase();
  const previous = namesByCase.get(lower);
  if (previous && previous !== name) collisions.push([previous, name]);
  else namesByCase.set(lower, name);
  const file = path.join(root, name);
  const stat = statSync(file);
  if (!stat.isFile()) continue;
  totalBytes += stat.size;
  if (stat.size >= 256 * 1024) large.push({ path: name, bytes: stat.size });
  // Hash small, authored files only; avoid loading large model/media assets.
  if (stat.size < 128 || stat.size > 1024 * 1024) continue;
  const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
  const key = String(stat.size) + ":" + digest;
  const same = duplicates.get(key) || [];
  same.push(name);
  duplicates.set(key, same);
}
const duplicateGroups = [...duplicates.values()].filter((list) => list.length > 1)
  .sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
const report = {
  trackedFiles: tracked.length, trackedBytes: totalBytes,
  largeSourceFiles: large.sort((a, b) => b.bytes - a.bytes).slice(0, 30),
  duplicateGroups: duplicateGroups.slice(0, 30),
  caseCollisions: collisions,
  groupCounts: Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))),
  notes: ["Content duplicates are candidates for review, not automatic deletion.", "Git-tracked files only. No user data, databases or running server are inspected."],
};
console.log(JSON.stringify(report, null, 2));
if (collisions.length) process.exitCode = 1;

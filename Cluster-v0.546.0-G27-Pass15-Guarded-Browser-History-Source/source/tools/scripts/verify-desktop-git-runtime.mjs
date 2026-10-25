import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const versions = JSON.parse(readFileSync(path.join(root, "config", "toolchain-versions.json"), "utf8"));
const runtimeRoot = path.join(root, "bin", "runtime");
const git = process.platform === "win32"
  ? path.join(runtimeRoot, "git", "cmd", "git.exe")
  : path.join(runtimeRoot, "git", "bin", "git");
const lfs = process.platform === "win32"
  ? path.join(runtimeRoot, "git-lfs", "git-lfs.exe")
  : path.join(runtimeRoot, "git-lfs", "git-lfs");
for (const [label, file] of [["Git", git], ["Git LFS", lfs]]) {
  if (!existsSync(file)) throw new Error(`${label} private runtime is missing: ${file}`);
}
function output(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout || result.status}`);
  return `${result.stdout || ""}\n${result.stderr || ""}`.trim();
}
const gitVersion = output(git, ["--version"]);
const lfsVersion = output(lfs, ["version"]);
if (!gitVersion.includes(versions.git.version)) throw new Error(`Private Git version drift: expected ${versions.git.version}, got ${gitVersion}`);
if (!lfsVersion.includes(versions.gitLfs.version)) throw new Error(`Private Git LFS version drift: expected ${versions.gitLfs.version}, got ${lfsVersion}`);
console.log(`Cluster private Git runtime verified: ${gitVersion}; ${lfsVersion}.`);

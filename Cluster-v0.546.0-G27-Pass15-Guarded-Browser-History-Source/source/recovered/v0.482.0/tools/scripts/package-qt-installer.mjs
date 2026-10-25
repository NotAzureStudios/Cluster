import path from "node:path";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const build = path.join(root, "apps", "desktop-qt", "build");
const fromExisting = process.argv.includes("--from-existing");

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env, windowsHide: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? "unknown"}.`);
}

if (!fromExisting) {
  run(process.execPath, [path.join(root, "tools", "scripts", "build-update-helper.mjs")]);
  run(process.execPath, [path.join(root, "tools", "scripts", "build-qt-desktop.mjs"), "--package"]);
}
if (process.platform === "win32") run("cpack", ["-G", "NSIS", "-C", "Release"], build);
else run("cpack", ["-G", "ZIP", "-C", "Release"], build);
console.log(`Cluster Desktop ${manifest.version} installer package created from ${build}.`);

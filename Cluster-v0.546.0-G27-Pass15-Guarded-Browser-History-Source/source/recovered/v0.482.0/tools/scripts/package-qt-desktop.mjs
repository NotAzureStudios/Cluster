import { access, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadDesktopToolchain } from "./toolchain-lib.mjs";

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
const architecture = process.arch === "x64" ? "x64" : process.arch;
const releaseRoot = path.join(root, "apps", "desktop-qt", "release");
const deployed = path.join(releaseRoot, process.platform === "win32" ? "windows-x64" : `${process.platform}-${process.arch}`);
const archive = path.join(releaseRoot, `Cluster-Desktop-${manifest.version}-${platform}-${architecture}.zip`);

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: false, env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status ?? "unknown"}.`);
}

run(process.execPath, [path.join(root, "tools", "scripts", "build-qt-desktop.mjs"), "--clean", "--package"]);
await access(deployed);
await rm(archive, { force: true });
await mkdir(releaseRoot, { recursive: true });
const toolchain = await loadDesktopToolchain();
run(toolchain?.cmake || "cmake", ["-E", "tar", "cf", archive, "--format=zip", "."], deployed);
await access(archive);
console.log(`Cluster Qt Desktop package created: ${archive}`);

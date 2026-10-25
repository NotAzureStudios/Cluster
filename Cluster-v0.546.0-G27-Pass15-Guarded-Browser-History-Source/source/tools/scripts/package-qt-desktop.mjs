import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
// The independently pinned, nonprivileged Go Package stager is part of the
// Desktop distribution, but is NEVER started by the renderer or treated as an
// OS installer. A future authenticated native agent must revalidate current
// server entitlement before selecting any staged content.
const packageStager = path.join(deployed, process.platform === "win32" ? "cluster-package-stager.exe" : "cluster-package-stager");
const goArgs = ["-C", path.join(root, "tools", "native", "package-stager-go"), "build", "-trimpath", "-o", packageStager, "."];
run("go", goArgs);
await access(packageStager);
await writeFile(path.join(deployed, "PACKAGE_STAGER_SECURITY.txt"), [
  "Cluster Package stager: signed content verification and staging ONLY.",
  "This helper does not install, execute, automatically activate or attest software.",
  "It requires a SHA-256 DER/SPKI signing key fingerprint provisioned independently",
  "of the Cluster server's release feed or downloaded staging kit.",
  "Current server entitlement and revocations must be rechecked before stage/select.",
  "Do not run Package content directly from the staging directory.",
  "See tools/native/package-stager-go/README.md in the development source.",
  "",
].join("\n"));
await rm(archive, { force: true });
await mkdir(releaseRoot, { recursive: true });
const toolchain = await loadDesktopToolchain();
run(toolchain?.cmake || "cmake", ["-E", "tar", "cf", archive, "--format=zip", "."], deployed);
await access(archive);
console.log(`Cluster Qt Desktop package created: ${archive}`);

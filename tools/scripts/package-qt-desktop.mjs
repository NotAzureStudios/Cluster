import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { readFileSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadDesktopToolchain } from "./toolchain-lib.mjs";

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
const architecture = process.arch === "x64" ? "x64" : process.arch;
const releaseRoot = path.join(root, "apps", "desktop-qt", "release");
const deployed = path.join(releaseRoot, process.platform === "win32" ? "windows-x64" : `${process.platform}-${process.arch}`);
const nativeVersion = (JSON.parse(await readFile(path.join(root, "config", "toolchain-versions.json"), "utf8"))).desktop?.parityVersionHold;
if (!/^\d+\.\d+\.\d+$/.test(nativeVersion || "")) throw new Error("Native Desktop package version is not configured");
// Desktop update semantics use the independently installed Qt application
// version. The shared server source version is not a Desktop release version.
const archive = path.join(releaseRoot, `Cluster-Desktop-${nativeVersion}-${platform}-${architecture}.zip`);

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: false, env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status ?? "unknown"}.`);
}

// Stage the Go helper BEFORE CMake configure/install. CPack replays CMake's
// install rules, so adding a file only to the portable folder would omit it
// from the actual NSIS installer.
const stagerName = process.platform === "win32" ? "cluster-package-stager.exe" : "cluster-package-stager";
const packageStager = path.join(root, "bin", stagerName);
await mkdir(path.dirname(packageStager), { recursive: true });
run("go", ["-C", path.join(root, "tools", "native", "package-stager-go"), "build", "-trimpath", "-o", packageStager, "."]);
await access(packageStager);
const stagerNotice = path.join(root, "bin", "PACKAGE_STAGER_SECURITY.txt");
await writeFile(stagerNotice, [
  "Cluster Package stager: signed content verification and staging ONLY.",
  "This helper does not install, execute, automatically activate or attest software.",
  "It requires a SHA-256 DER/SPKI signing key fingerprint provisioned independently",
  "of the Cluster server's release feed or downloaded staging kit.",
  "Current server entitlement and revocations must be rechecked before stage/select.",
  "Do not run Package content directly from the staging directory.",
  "See tools/native/package-stager-go/README.md in the development source.",
  "",
].join("\n"));
run(process.execPath, [path.join(root, "tools", "scripts", "build-qt-desktop.mjs"), "--clean", "--package"]);
await access(deployed);
if (process.platform === "win32") {
  // Confirm the portable install tree contains the same product-owned pieces
  // required by CMake/CPack. No Server service/database/installer may leak in.
  const required = [
    "bin/Cluster.exe",
    "bin/cluster-update-helper.exe",
    "bin/cluster-workstation-service.exe",
    "bin/cluster-workstation-service.manifest.json",
    "bin/cluster-package-stager.exe",
    "bin/PACKAGE_STAGER_SECURITY.txt",
    "bin/update-public-key.pem",
    "bin/runtime/git/cmd/git.exe",
    "bin/runtime/git-lfs/git-lfs.exe",
  ];
  for (const relative of required) await access(path.join(deployed, ...relative.split("/")));
  for (const relative of ["bin/cluster-host.exe", "bin/ClusterServer.exe", "bin/Cluster Server.exe"]) {
    try {
      await access(path.join(deployed, ...relative.split("/")));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    throw new Error("Server executable leaked into the Desktop distribution: " + relative);
  }
}
await rm(archive, { force: true });
await mkdir(releaseRoot, { recursive: true });
const toolchain = await loadDesktopToolchain();
run(toolchain?.cmake || "cmake", ["-E", "tar", "cf", archive, "--format=zip", "."], deployed);
await access(archive);
console.log(`Cluster Qt Desktop portable package created: ${archive}`);

// Windows Desktop is an independent installed product. Generate its NSIS
// installer from the Qt/CPack install rules, not the Server source ZIP.
// CPack must fail the release build if NSIS is not provisioned; never silently
// substitute a portable ZIP for an installable update.
if (process.platform === "win32") {
  const versions = JSON.parse(await readFile(path.join(root, "config", "toolchain-versions.json"), "utf8"));
  if (versions.desktop?.parityVersionHold !== nativeVersion) throw new Error("Desktop native version drifted during packaging");
  if (!/^\d+\.\d+\.\d+$/.test(nativeVersion || "")) throw new Error("Native Desktop version hold is invalid");
  const cmakeSource = readFileSync(path.join(root, "apps", "desktop-qt", "CMakeLists.txt"), "utf8");
  if (!cmakeSource.includes(`project(ClusterDesktop VERSION ${nativeVersion} LANGUAGES CXX)`)) {
    throw new Error("Qt Desktop package identity must match its native CMake project version");
  }
  const cpackConfig = path.join(root, "apps", "desktop-qt", "build", "CPackConfig.cmake");
  await access(cpackConfig);
  const cpack = toolchain?.cpack || (toolchain?.cmake && path.isAbsolute(toolchain.cmake)
    ? path.join(path.dirname(toolchain.cmake), "cpack.exe") : "cpack");
  const prefix = `Cluster-Desktop-${nativeVersion}-`;
  for (const entry of await readdir(releaseRoot)) {
    if (entry.startsWith(prefix) && entry.toLowerCase().endsWith(".exe")) await rm(path.join(releaseRoot, entry), {force:true});
  }
  run(cpack, ["--config", cpackConfig, "-G", "NSIS", "-C", "Release", "-B", releaseRoot]);
  const executables = (await readdir(releaseRoot)).filter(p=>p.startsWith(prefix) && p.toLowerCase().endsWith(".exe"));
  if (executables.length !== 1) throw new Error("CPack must produce exactly one native Desktop installer");
  const installer = path.join(releaseRoot, `Cluster-Desktop-Installer-${nativeVersion}-windows-x64.exe`);
  if (path.join(releaseRoot, executables[0]) !== installer) {
    await rm(installer,{force:true});
    await rename(path.join(releaseRoot, executables[0]),installer);
  }
  await access(installer);
  const handle = openSync(installer, "r");
  const header = Buffer.alloc(2);
  try { readSync(handle, header, 0, 2, 0); } finally { closeSync(handle); }
  const mz = header.toString("ascii");
  if (mz !== "MZ") throw new Error("Desktop installer is not a Windows PE executable");
  console.log(`Cluster Qt Desktop native installer created: ${installer}`);
}

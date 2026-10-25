import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];
const notes = [];
const requirePath = (relative, label = relative) => {
  if (!existsSync(path.join(root, relative))) failures.push(`Missing ${label}: ${relative}`);
};
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

for (const relative of [
  "apps/server/src",
  "apps/web/src",
  "apps/desktop-qt/src",
  "apps/desktop-qt/src/WorkstationServiceManager.cpp",
  "apps/host-go/go.mod",
  "apps/server-launcher-go/go.mod",
  "apps/update-helper-go/go.mod",
  "apps/workstation-go/go.mod",
  "apps/workstation-go/main.go",
  "packages/shared/src",
  "packages/api-client/src",
  "packages/renderer/src",
  "integrations/unreal/ClusterSourceControl/ClusterSourceControl.uplugin",
  "integrations/discord-bot/package.json",
  "packages/shared/src/workstation-source-control-contracts.ts",
  "config/toolchain-versions.json",
  "tools/scripts/toolchain-versions.mjs",
  "SOURCE_TOOLCHAIN.md",
  "SOURCE_PROVENANCE.json",
  "SOURCE_RECONSTRUCTION.md",
]) requirePath(relative);

const packageJson = JSON.parse(read("package.json"));
const toolchain = JSON.parse(read("config/toolchain-versions.json"));
if (packageJson.version !== toolchain.cluster) failures.push(`Root package ${packageJson.version} does not match toolchain Cluster ${toolchain.cluster}.`);
if (packageJson.engines?.node !== `>=${toolchain.node.version} <25`) failures.push(`Root Node engine does not match toolchain Node ${toolchain.node.version}.`);
const sharedIndex = read("packages/shared/src/index.ts");
if (!sharedIndex.includes("workstation-source-control-contracts")) failures.push("@cluster/shared does not export the workstation source-control contract.");

for (const relative of ["apps/host-go/go.mod", "apps/server-launcher-go/go.mod", "apps/update-helper-go/go.mod", "apps/workstation-go/go.mod"]) {
  if (!/^go 1\.27(?:\.\d+)?$/m.test(read(relative))) failures.push(`${relative} is not on the Go 1.27 source baseline.`);
}

const desktopCmake = read("apps/desktop-qt/CMakeLists.txt");
const nativeVersion = desktopCmake.match(/project\(ClusterDesktop VERSION ([0-9.]+)/)?.[1] || "unknown";
if (nativeVersion !== toolchain.desktop.parityVersionHold) failures.push(`Qt Desktop version hold is ${nativeVersion}; expected ${toolchain.desktop.parityVersionHold}.`);
else notes.push(`Recovered Qt Desktop intentionally remains ${nativeVersion} until forward-port parity is runtime-certified; root application is ${packageJson.version}.`);
if (!desktopCmake.includes(`find_package(Qt6 ${toolchain.qt.majorMinor} REQUIRED`)) failures.push(`Qt Desktop does not require Qt ${toolchain.qt.majorMinor}.`);
if (!desktopCmake.includes(`cmake_minimum_required(VERSION ${toolchain.cmake.minimum}...${toolchain.cmake.policyMaximum})`)) failures.push("Desktop CMake policy range does not match the active toolchain manifest.");

const launcher = read("apps/server-launcher-go/main.go");
const launcherWindows = read("apps/server-launcher-go/runtime_windows.go");
if (!launcher.includes(`privateNodeVersion = "${toolchain.node.version}"`)) failures.push("Server launcher Node runtime pin does not match the toolchain manifest.");
if (!launcherWindows.includes(`postgresVersion = "${toolchain.postgresql.version}"`) || !launcherWindows.includes(`postgresInstallerRevision = "${toolchain.postgresql.installerRevision}"`)) failures.push("Server launcher PostgreSQL runtime pin does not match the toolchain manifest.");

const integrationPackage = JSON.parse(read("integrations/discord-bot/package.json"));
if (integrationPackage.version !== packageJson.version) failures.push(`Discord integration version ${integrationPackage.version} does not match root ${packageJson.version}.`);

if (failures.length) {
  console.error("Reconstructed source audit failed:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log("Reconstructed source audit passed.");
for (const note of notes) console.log(`NOTE: ${note}`);

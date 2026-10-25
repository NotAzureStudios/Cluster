import { access } from "node:fs/promises";
import path from "node:path";
import { compareVersions, detectDesktopToolchain, saveDesktopToolchain, versions } from "./toolchain-lib.mjs";

const requiredQtModules = ["Core", "Gui", "Quick", "QuickControls2", "Network", "Widgets", "Concurrent", "Multimedia", "Pdf", "WebView"];
async function exists(file) { try { await access(file); return true; } catch { return false; } }

const toolchain = await detectDesktopToolchain();
const problems = [];
if (!toolchain.cmake) problems.push(`CMake ${versions.cmake.minimum}+ is not installed or not on PATH.`);
else if (compareVersions(toolchain.cmakeVersion, versions.cmake.minimum) < 0) problems.push(`CMake ${toolchain.cmakeVersion} is too old; Cluster requires ${versions.cmake.minimum}+.`);
if (!toolchain.qtRoot) problems.push(`Qt ${versions.qt.majorMinor}.x was not found. Install Qt ${versions.qt.version} (MSVC 2022 x64 or MinGW x64 on Windows).`);
else if (compareVersions(toolchain.qtVersion, versions.qt.majorMinor) < 0) problems.push(`Qt ${toolchain.qtVersion} is too old; Cluster requires ${versions.qt.majorMinor}+.`);
if (process.platform === "win32" && toolchain.qtKit === "mingw_64" && !toolchain.mingwBin) problems.push("Qt MinGW is installed, but its compiler toolchain was not found under C:\\Qt\\Tools.");

const missingQtModules = [];
if (toolchain.qtRoot) {
  for (const module of requiredQtModules) {
    const config = path.join(toolchain.qtRoot, "lib", "cmake", `Qt6${module}`, `Qt6${module}Config.cmake`);
    if (!(await exists(config))) missingQtModules.push(module);
  }
  if (missingQtModules.length) problems.push(`Missing required Qt modules: ${missingQtModules.join(", ")}. Add them with the Qt Maintenance Tool for the same ${toolchain.qtVersion} ${toolchain.qtKit} kit.`);
}

console.log("Cluster Desktop toolchain");
console.log(`  Qt:        ${toolchain.qtRoot ? `${toolchain.qtVersion} (${toolchain.qtKit})` : "not found"}`);
console.log(`  Qt root:   ${toolchain.qtRoot || "not found"}`);
console.log(`  CMake:     ${toolchain.cmakeVersion || "not found"}`);
console.log(`  Generator: ${toolchain.generator || "CMake default"}`);
if (toolchain.mingwBin) console.log(`  MinGW:     ${toolchain.mingwBin}`);
if (toolchain.qtRoot) console.log(`  Qt modules:${missingQtModules.length ? ` missing ${missingQtModules.join(", ")}` : " all required modules found"}`);
if (problems.length) {
  console.error("\nDesktop setup is incomplete:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
await saveDesktopToolchain(toolchain);
console.log("\nDesktop toolchain detected, validated, and cached in .cluster/desktop-toolchain.json.");

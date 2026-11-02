import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packager = readFileSync("tools/scripts/package-qt-desktop.mjs", "utf8");
const cmake = readFileSync("apps/desktop-qt/CMakeLists.txt", "utf8");
let checks = 0;
function check(condition, description) { assert.ok(condition, description); checks++; }

const goBuild = packager.indexOf('run("go", ["-C", path.join(root, "tools", "native", "package-stager-go")');
const qtBuild = packager.indexOf('run(process.execPath, [path.join(root, "tools", "scripts", "build-qt-desktop.mjs")');
check(goBuild !== -1 && qtBuild !== -1 && goBuild < qtBuild,
  "Package Stager must be compiled before CMake configures the Qt installation");
check(packager.includes('path.join(root, "bin", stagerName)'),
  "Go helper must be staged at the shared CMake input location");
check(packager.includes('path.join(root, "bin", "PACKAGE_STAGER_SECURITY.txt")'),
  "Helper security notice must be staged for CMake/CPack");
check(cmake.includes('install(PROGRAMS "${CLUSTER_PACKAGE_STAGER_SOURCE}" DESTINATION ${CMAKE_INSTALL_BINDIR})'),
  "CPack must install the helper using the same rules as the portable distribution");
check(cmake.includes('install(FILES "${CLUSTER_PACKAGE_STAGER_NOTICE}" DESTINATION ${CMAKE_INSTALL_BINDIR})'),
  "CPack must install the helper notice");
check(cmake.includes('CLUSTER_REQUIRE_PRIVATE_GIT_RUNTIME AND') && cmake.includes('NOT EXISTS "${CLUSTER_PACKAGE_STAGER_SOURCE}"'),
  "Distributable Qt builds must fail when the helper is missing");
check(packager.includes('"bin/cluster-package-stager.exe"') &&
      packager.includes('"bin/PACKAGE_STAGER_SECURITY.txt"'),
  "Portable distribution must verify installed helper and notice");
check(packager.includes('"bin/cluster-update-helper.exe"') &&
      packager.includes('"bin/cluster-workstation-service.exe"') &&
      packager.includes('"bin/Cluster.exe"'),
  "Qt distribution must verify its key native components");
check(packager.includes('"bin/runtime/git/cmd/git.exe"') &&
      packager.includes('"bin/runtime/git-lfs/git-lfs.exe"'),
  "Qt package must include its private Git and Git LFS runtime");
check(packager.includes("Server executable leaked into the Desktop distribution:"),
  "Desktop distribution must reject Server binaries");
check(packager.includes('run(cpack, ["--config", cpackConfig, "-G", "NSIS"'),
  "Windows Desktop packaging must actually run CPack NSIS");
check(packager.includes('if (mz !== "MZ") throw new Error'),
  "Native Desktop installer must have a valid Windows executable header");

console.log(`${checks}/${checks} Qt Desktop portable/NSIS parity checks passed`);

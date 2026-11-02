import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isDesktopOnlyDistributionPath } from "./cluster-distribution-scope.mjs";

let checks = 0;
function check(condition, reason) { assert.ok(condition, reason); checks++; }

for (const path of [
  "apps/desktop-qt",
  "apps/desktop-qt/CMakeLists.txt",
  "apps\\desktop-qt\\release\\Cluster-Desktop.exe",
  "bin/Cluster.exe",
  "bin/cluster-package-stager.exe",
  "bin/PACKAGE_STAGER_SECURITY.txt",
  "tools/native/package-stager-go",
  "tools/native/package-stager-go/main.go",
]) check(isDesktopOnlyDistributionPath(path), "Desktop-only path must not ship with Server: " + path);

for (const path of [
  "apps/server",
  "apps/server/dist/index.js",
  "apps/web/dist/index.html",
  "bin/ClusterServer.exe",
  "bin/Cluster Server.exe",
  "bin/cluster-host.exe",
  "bin/cluster-workstation-service.exe",
  "bin/runtime/git/cmd/git.exe",
  "packages/renderer/dist/index.js",
]) check(!isDesktopOnlyDistributionPath(path), "Required Server path must be preserved: " + path);

const builder = readFileSync("tools/scripts/build-cluster-installer.mjs", "utf8");
check(builder.includes("import { isDesktopOnlyDistributionPath } from './cluster-distribution-scope.mjs';"),
  "Server packager must import the shared scope guard");
check(builder.includes("if(prebuilt&&isDesktopOnlyDistributionPath(rel))return true;"),
  "Desktop files must be filtered only from real prebuilt Server distributions");
check(builder.includes("!excludedFolders.has(entry.name)&&!omit(rel)"),
  "Desktop directories must be pruned before recursive packaging");
check(builder.includes("const mode=process.env.CLUSTER_INSTALLER_PAYLOAD||'prebuilt';"),
  "Production Server packaging must remain prebuilt by default");
check(builder.includes("package-lock.json is missing"),
  "Missing release lockfile must still fail closed");
console.log(`${checks}/${checks} Server/Desktop distribution-scope checks passed`);

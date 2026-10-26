import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const write = process.argv.includes("--write");
const manifestPath = path.join(root, "config", "toolchain-versions.json");
const versions = JSON.parse(await readFile(manifestPath, "utf8"));
const failures = [];

async function jsonFile(relative, mutate) {
  const file = path.join(root, relative);
  const parsed = JSON.parse(await readFile(file, "utf8"));
  const next = structuredClone(parsed);
  mutate(next);
  const desired = `${JSON.stringify(next, null, 2)}\n`;
  const current = await readFile(file, "utf8");
  if (current !== desired) {
    if (write) await writeFile(file, desired);
    else failures.push(relative);
  }
}

async function textFile(relative, mutate) {
  const file = path.join(root, relative);
  const current = await readFile(file, "utf8");
  const desired = mutate(current);
  if (current !== desired) {
    if (write) await writeFile(file, desired);
    else failures.push(relative);
  }
}

await jsonFile("package.json", (pkg) => {
  pkg.version = versions.cluster;
  pkg.engines ??= {};
  pkg.engines.node = `>=${versions.node.version} <${Number(versions.node.version.split(".")[0]) + 1}`;
});
for (const relative of [
  "apps/server/package.json",
  "apps/web/package.json",
  "packages/shared/package.json",
  "packages/api-client/package.json",
  "packages/renderer/package.json",
  "integrations/discord-bot/package.json",
]) {
  await jsonFile(relative, (pkg) => { pkg.version = versions.cluster; });
}
await jsonFile("apps/server/package.json", (pkg) => {
  pkg.dependencies["@prisma/client"] = versions.prisma.version;
  pkg.dependencies["@prisma/adapter-pg"] = versions.prisma.version;
  pkg.dependencies.prisma = versions.prisma.version;
});
await jsonFile("packages/renderer/package.json", (pkg) => { pkg.dependencies.three = versions.three.version; });

await textFile("apps/server-launcher-go/main.go", (text) => text
  .replace(/var version = "[^"]+"/, `var version = "${versions.cluster}-dev"`)
  .replace(/const privateNodeVersion = "[^"]+"/, `const privateNodeVersion = "${versions.node.version}"`));
await textFile("apps/server-launcher-go/runtime_windows.go", (text) => text
  .replace(/const postgresVersion = "[^"]+"/, `const postgresVersion = "${versions.postgresql.version}"`)
  .replace(/const postgresInstallerRevision = "[^"]+"/, `const postgresInstallerRevision = "${versions.postgresql.installerRevision}"`));
await textFile("apps/host-go/main.go", (text) => text.replace(/var version = "[^"]+"/, `var version = "${versions.cluster}-dev"`));
await textFile("apps/workstation-go/main.go", (text) => text.replace(/var buildVersion = "[^"]+"/, `var buildVersion = "${versions.cluster}-dev"`));
await textFile("packages/shared/src/index.ts", (text) => text.replace(/export const CLUSTER_SHARED_VERSION = "[^"]+";/, `export const CLUSTER_SHARED_VERSION = "${versions.cluster}";`));
await textFile("apps/server/src/core/runtime-config.ts", (text) => text.replace(/const clusterVersion = options\.version \?\? "[^"]+";/, `const clusterVersion = options.version ?? "${versions.cluster}";`));

await textFile("apps/desktop-qt/CMakeLists.txt", (text) => text
  .replace(/cmake_minimum_required\(VERSION [^)]+\)/, `cmake_minimum_required(VERSION ${versions.cmake.minimum}...${versions.cmake.policyMaximum})`)
  .replace(/find_package\(Qt6 [^ ]+ REQUIRED/, `find_package(Qt6 ${versions.qt.majorMinor} REQUIRED`)
  .replace(/qt_standard_project_setup\(REQUIRES [^)]+\)/, `qt_standard_project_setup(REQUIRES ${versions.qt.majorMinor})`)
  .replace(/set\(CLUSTER_RUNTIME_VERSION "[^"]+" CACHE STRING/, `set(CLUSTER_RUNTIME_VERSION "${versions.cluster}" CACHE STRING`));

for (const relative of ["apps/host-go/go.mod", "apps/server-launcher-go/go.mod", "apps/native-alerts-go/go.mod", "apps/native-process-job-go/go.mod", "apps/update-helper-go/go.mod", "apps/workstation-go/go.mod"]) {
  await textFile(relative, (text) => text.replace(/^go\s+\S+/m, `go ${versions.go.minimum}`));
}

const desktopCmake = await readFile(path.join(root, "apps/desktop-qt/CMakeLists.txt"), "utf8");
const desktopVersion = desktopCmake.match(/project\(ClusterDesktop VERSION ([0-9.]+)/)?.[1];
if (desktopVersion !== versions.desktop.parityVersionHold) failures.push(`apps/desktop-qt/CMakeLists.txt (expected certified-version hold ${versions.desktop.parityVersionHold}, found ${desktopVersion || "missing"})`);

if (write) {
  console.log(`Cluster toolchain contracts synchronized from ${path.relative(root, manifestPath)}. Desktop parity version hold preserved at ${versions.desktop.parityVersionHold}.`);
} else if (failures.length) {
  console.error("Toolchain version drift detected:");
  for (const file of [...new Set(failures)].sort()) console.error(`- ${file}`);
  process.exit(1);
} else {
  console.log(`Cluster toolchain contract is synchronized (${versions.cluster}); Desktop parity hold remains ${versions.desktop.parityVersionHold}.`);
}

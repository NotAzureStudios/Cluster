import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const write = process.argv.includes("--write");
const check = process.argv.includes("--check") || !write;
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
  let current;
  try { current = await readFile(file, "utf8"); } catch (error) {
    if (relative.startsWith(".github/") && error?.code === "ENOENT") return;
    throw error;
  }
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
]) {
  await jsonFile(relative, (pkg) => { pkg.version = versions.cluster; });
}
await jsonFile("apps/server/package.json", (pkg) => {
  pkg.version = versions.cluster;
  pkg.dependencies["@prisma/client"] = versions.prisma.version;
  pkg.dependencies["@prisma/adapter-pg"] = versions.prisma.version;
  pkg.devDependencies.prisma = versions.prisma.version;
});
await jsonFile("packages/renderer/package.json", (pkg) => {
  pkg.version = versions.cluster;
  pkg.dependencies.three = versions.three.version;
});

await textFile("apps/server-launcher-go/main.go", (text) => text
  .replace(/const version = "[^"]+"/, `const version = "${versions.cluster}"`)
  .replace(/const privateNodeVersion = "[^"]+"/, `const privateNodeVersion = "${versions.node.version}"`));
await textFile("apps/server-launcher-go/runtime_windows.go", (text) => text
  .replace(/const postgresVersion = "[^"]+"/, `const postgresVersion = "${versions.postgresql.version}"`)
  .replace(/const postgresInstallerRevision = "[^"]+"/, `const postgresInstallerRevision = "${versions.postgresql.installerRevision}"`));
await textFile("deployment/postgresql/docker-compose.yml", (text) => text
  .replace(/image: postgres:[^\s]+/, `image: postgres:${versions.postgresql.version}-alpine`));
await textFile("apps/host-go/main.go", (text) => text
  .replace(/const version = "[^"]+"/, `const version = "${versions.cluster}"`));
await textFile("packages/shared/src/index.ts", (text) => text
  .replace(/export const CLUSTER_SHARED_VERSION = "[^"]+";/, `export const CLUSTER_SHARED_VERSION = "${versions.cluster}";`));
await textFile("apps/server/src/core/runtime-config.ts", (text) => text
  .replace(/const clusterVersion = options\.version \?\? "[^"]+";/, `const clusterVersion = options.version ?? "${versions.cluster}";`));
await textFile("apps/desktop-qt/CMakeLists.txt", (text) => text
  .replace(/cmake_minimum_required\(VERSION [^)]+\)/, `cmake_minimum_required(VERSION ${versions.cmake.minimum})`)
  .replace(/project\(ClusterDesktop VERSION [^ ]+/, `project(ClusterDesktop VERSION ${versions.cluster}`)
  .replace(/find_package\(Qt6 [^ ]+ REQUIRED/, `find_package(Qt6 ${versions.qt.majorMinor} REQUIRED`)
  .replace(/qt_standard_project_setup\(REQUIRES [^)]+\)/, `qt_standard_project_setup(REQUIRES ${versions.qt.majorMinor})`));

for (const relative of ["apps/host-go/go.mod", "apps/server-launcher-go/go.mod", "apps/update-helper-go/go.mod"]) {
  await textFile(relative, (text) => text.replace(/^go\s+\S+/m, `go ${versions.go.minimum.replace(/\.0$/, "")}`));
}

for (const relative of [".github/workflows/ci.yml", ".github/workflows/dependency-monitor.yml", ".github/workflows/release.yml"]) {
  await textFile(relative, (text) => text
    .replace(/node-version: ["']?\d+\.\d+\.\d+["']?/g, `node-version: ${versions.node.version}`)
    .replace(/go-version: ["']?\d+\.\d+(?:\.\d+|\.x)["']?/g, `go-version: "${versions.go.recommended}"`)
    .replace(/version: ["']?6\.\d+\.\d+["']?/g, `version: "${versions.qt.version}"`)
    .replace(/image: postgres:\d+\.\d+-alpine/g, `image: postgres:${versions.postgresql.version}-alpine`));
}

if (write) {
  console.log(`Cluster toolchain versions synchronized from ${path.relative(root, manifestPath)}.`);
} else if (failures.length) {
  console.error("Toolchain version drift detected:");
  for (const file of [...new Set(failures)].sort()) console.error(`- ${file}`);
  process.exit(1);
} else if (check) {
  console.log(`Cluster toolchain version contract is synchronized (${versions.cluster}).`);
}

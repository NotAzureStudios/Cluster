import { access, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { desktopEnvironment, detectDesktopToolchain, loadDesktopToolchain, saveDesktopToolchain, versions } from "./toolchain-lib.mjs";

const root = process.cwd();
const source = path.join(root, "apps", "desktop-qt");
const build = path.join(source, "build");
const install = path.join(source, "release", process.platform === "win32" ? "windows-x64" : `${process.platform}-${process.arch}`);
const args = new Set(process.argv.slice(2));
const configuration = args.has("--debug") ? "Debug" : "Release";

async function qmlFiles(directory, out = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await qmlFiles(file, out);
    else if (entry.isFile() && entry.name.endsWith(".qml")) out.push(file);
  }
  return out;
}
async function validateQmlSource() {
  const failures = [];
  for (const file of await qmlFiles(path.join(source, "qml"))) {
    const contents = await readFile(file, "utf8");
    const lines = contents.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (/\}\s*;\s*[A-Z][A-Za-z0-9_]*\s*\{/.test(lines[index])) {
        failures.push(`${path.relative(root, file)}:${index + 1}: child QML objects must not be separated with semicolons`);
      }
    }
  }
  if (failures.length) throw new Error(`QML source validation failed:\n${failures.join("\n")}`);
}
const setupResult = spawnSync(process.execPath, [path.join(root, "tools", "scripts", "desktop-setup.mjs")], { cwd: root, stdio: "inherit", windowsHide: false, env: process.env });
if (setupResult.error) throw setupResult.error;
if (setupResult.status !== 0) throw new Error(`Desktop toolchain validation failed with code ${setupResult.status ?? "unknown"}.`);
let toolchain = await loadDesktopToolchain();
if (!toolchain?.qtRoot) { toolchain = await detectDesktopToolchain(); await saveDesktopToolchain(toolchain); }
if (!toolchain.qtRoot) throw new Error(`Qt ${versions.qt.majorMinor}+ was not found. Run npm run desktop:setup first.`);
const environment = desktopEnvironment(toolchain);
await validateQmlSource();

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit", windowsHide: false, env: environment });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status ?? "unknown"}.`);
}

if (args.has("--clean")) {
  await rm(build, { recursive: true, force: true });
  await rm(path.dirname(install), { recursive: true, force: true });
}
await mkdir(build, { recursive: true });
const configureArgs = ["-S", source, "-B", build, `-DCMAKE_INSTALL_PREFIX=${install}`, "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON"];
if (toolchain.generator) configureArgs.push("-G", toolchain.generator);
if (toolchain.generatorArchitecture) configureArgs.push("-A", toolchain.generatorArchitecture);
if (!/^Visual Studio/i.test(toolchain.generator || "")) configureArgs.push(`-DCMAKE_BUILD_TYPE=${configuration}`);
run(toolchain.cmake || "cmake", configureArgs);
if (args.has("--configure-only")) { console.log(`Cluster Qt Desktop configured in ${build}`); process.exit(0); }
run(toolchain.cmake || "cmake", ["--build", build, "--config", configuration, "--parallel"]);
if (args.has("--install") || args.has("--package")) {
  await rm(install, { recursive: true, force: true });
  await mkdir(install, { recursive: true });
  run(toolchain.cmake || "cmake", ["--install", build, "--config", configuration]);
  console.log(`Cluster Qt Desktop deployed to ${install}`);
}
const binaryCandidates = process.platform === "win32"
  ? [path.join(build, "bin", "Cluster.exe"), path.join(build, "bin", configuration, "Cluster.exe")]
  : [path.join(build, "bin", "Cluster")];
let binary = null;
for (const candidate of binaryCandidates) { try { await access(candidate); binary = candidate; break; } catch {} }
if (!binary) throw new Error("The Qt desktop build completed without producing the expected Cluster executable.");
console.log(`Cluster Qt Desktop built: ${binary}`);

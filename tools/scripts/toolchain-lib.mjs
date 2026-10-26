import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const root = process.cwd();
export const versions = JSON.parse(await readFile(path.join(root, "config", "toolchain-versions.json"), "utf8"));

export function parseVersion(value) {
  return String(value || "").replace(/^v/, "").match(/\d+(?:\.\d+){0,3}/)?.[0] || "0";
}
export function compareVersions(a, b) {
  const aa = parseVersion(a).split(".").map(Number);
  const bb = parseVersion(b).split(".").map(Number);
  for (let i = 0; i < Math.max(aa.length, bb.length); i += 1) {
    const delta = (aa[i] || 0) - (bb[i] || 0);
    if (delta) return delta;
  }
  return 0;
}
export function commandPath(command, env = process.env) {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [command], { encoding: "utf8", windowsHide: true, env });
  if (probe.status !== 0) return "";
  return String(probe.stdout || "").split(/\r?\n/).map((v) => v.trim()).find(Boolean) || "";
}
export function commandVersion(command, args = ["--version"], env = process.env) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, env });
  if (result.status !== 0) return "";
  return parseVersion(`${result.stdout || ""}\n${result.stderr || ""}`);
}
async function exists(file) { try { await access(file); return true; } catch { return false; } }

async function qtCandidates() {
  const out = [];
  const override = String(process.env.QT_ROOT || "").trim();
  if (override) out.push(override);
  const bases = process.platform === "win32"
    ? ["C:\\Qt", path.join(os.homedir(), "Qt")]
    : process.platform === "darwin"
      ? [path.join(os.homedir(), "Qt"), "/opt/Qt"]
      : [path.join(os.homedir(), "Qt"), "/opt/Qt", "/opt/qt"];
  for (const base of bases) {
    let versionsOnDisk = [];
    try { versionsOnDisk = (await readdir(base, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); } catch { continue; }
    versionsOnDisk.sort((a, b) => compareVersions(b, a));
    const preferred = [versions.qt.version, ...versionsOnDisk.filter((v) => v.startsWith(`${versions.qt.majorMinor}.`)), ...versionsOnDisk];
    for (const version of [...new Set(preferred)]) {
      const prefix = path.join(base, version);
      const kits = process.platform === "win32" ? ["msvc2022_64", "mingw_64"] : process.platform === "darwin" ? ["macos"] : ["gcc_64"];
      for (const kit of kits) out.push(path.join(prefix, kit));
    }
  }
  return [...new Set(out)];
}

async function findMinGwBin(qtRoot) {
  if (process.platform !== "win32" || !qtRoot.toLowerCase().includes("mingw")) return "";
  const qtBase = path.parse(qtRoot).root + "Qt";
  const tools = path.join(qtBase, "Tools");
  let entries = [];
  try { entries = await readdir(tools, { withFileTypes: true }); } catch { return ""; }
  const candidates = entries.filter((e) => e.isDirectory() && /^mingw/i.test(e.name)).map((e) => path.join(tools, e.name, "bin"));
  for (const candidate of candidates) if (await exists(path.join(candidate, "g++.exe"))) return candidate;
  return "";
}

export async function detectDesktopToolchain() {
  const cmake = commandPath("cmake");
  const cmakeVersion = cmake ? commandVersion(cmake) : "";
  let qtRoot = "";
  for (const candidate of await qtCandidates()) {
    if (await exists(path.join(candidate, "lib", "cmake", "Qt6", "Qt6Config.cmake"))) { qtRoot = candidate; break; }
  }
  const qtVersion = qtRoot ? path.basename(path.dirname(qtRoot)) : "";
  const kit = qtRoot ? path.basename(qtRoot) : "";
  const mingwBin = await findMinGwBin(qtRoot);
  const env = { ...process.env };
  if (mingwBin) env.PATH = `${mingwBin}${path.delimiter}${env.PATH || ""}`;
  const ninja = commandPath("ninja", env);
  let generator = String(process.env.CMAKE_GENERATOR || "").trim();
  let architecture = "";
  if (!generator && process.platform === "win32") {
    if (/^msvc/i.test(kit)) { generator = "Visual Studio 17 2022"; architecture = "x64"; }
    else if (/^mingw/i.test(kit)) generator = ninja ? "Ninja" : "MinGW Makefiles";
  } else if (!generator && ninja) generator = "Ninja";
  return {
    detectedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    cmake,
    cmakeVersion,
    qtRoot,
    qtVersion,
    qtKit: kit,
    mingwBin,
    generator,
    generatorArchitecture: architecture,
    ninja,
  };
}

export async function saveDesktopToolchain(toolchain) {
  const directory = path.join(root, ".cluster");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "desktop-toolchain.json"), `${JSON.stringify(toolchain, null, 2)}\n`);
}
export async function loadDesktopToolchain() {
  try { return JSON.parse(await readFile(path.join(root, ".cluster", "desktop-toolchain.json"), "utf8")); } catch { return null; }
}
export function desktopEnvironment(toolchain) {
  const env = { ...process.env };
  if (toolchain?.qtRoot) {
    const current = String(env.CMAKE_PREFIX_PATH || "").trim();
    env.CMAKE_PREFIX_PATH = current ? `${toolchain.qtRoot}${path.delimiter}${current}` : toolchain.qtRoot;
    env.QT_ROOT = toolchain.qtRoot;
    env.PATH = `${path.join(toolchain.qtRoot, "bin")}${path.delimiter}${env.PATH || ""}`;
  }
  if (toolchain?.mingwBin) env.PATH = `${toolchain.mingwBin}${path.delimiter}${env.PATH || ""}`;
  return env;
}

import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

if (process.platform !== "win32") {
  console.log("Desktop launch smoke is Windows-only; skipped on this platform.");
  process.exit(0);
}
const root = process.cwd();
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const candidates = [
  path.join(root, "apps", "desktop-qt", "release", "windows-x64", "bin", "Cluster.exe"),
  path.join(root, "apps", "desktop-qt", "build", "bin", "Release", "Cluster.exe"),
  path.join(root, "apps", "desktop-qt", "build", "bin", "Cluster.exe"),
];
let binary = "";
for (const candidate of candidates) {
  try { await access(candidate); binary = candidate; break; } catch {}
}
if (!binary) throw new Error("Desktop smoke test could not find Cluster.exe. Run npm run desktop:package first.");
const result = spawnSync(binary, ["--smoke-test"], {
  cwd: path.dirname(binary),
  env: { ...process.env, CLUSTER_DESKTOP_SMOKE_TEST: "1" },
  stdio: "inherit",
  windowsHide: false,
  timeout: 30_000,
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Cluster Desktop v${pkg.version} smoke test failed with ${result.status ?? "unknown"}.`);
console.log(`Cluster Desktop v${pkg.version} launch smoke passed.`);

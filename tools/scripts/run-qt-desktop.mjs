import { access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const build = path.join(root, "apps", "desktop-qt", "build");
const candidates = process.platform === "win32"
  ? [path.join(build, "bin", "Cluster.exe"), path.join(build, "bin", "Release", "Cluster.exe"), path.join(build, "bin", "Debug", "Cluster.exe")]
  : [path.join(build, "bin", "Cluster")];

let binary = null;
for (const candidate of candidates) {
  try { await access(candidate); binary = candidate; break; } catch { /* continue */ }
}
if (!binary) {
  console.error("Cluster Qt Desktop has not been built. Run npm run desktop:build first.");
  process.exit(1);
}

const child = spawn(binary, process.argv.slice(2), { cwd: path.dirname(binary), stdio: "inherit", windowsHide: false });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = signal ? 1 : code ?? 0; });

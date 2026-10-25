import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export async function exists(file) { try { await access(file); return true; } catch { return false; } }

export async function windowsReleaseSigningTargets(root = process.cwd()) {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const targets = [
    path.join(root, "bin", "ClusterServer.exe"),
    path.join(root, "bin", "cluster-host.exe"),
    path.join(root, "bin", "cluster-update-helper.exe"),
    path.join(root, "apps", "desktop-qt", "release", "windows-x64", "bin", "Cluster.exe"),
    path.join(root, "apps", "desktop-qt", "release", "windows-x64", "bin", "cluster-update-helper.exe"),
  ];
  const build = path.join(root, "apps", "desktop-qt", "build");
  for (const candidate of [
    path.join(build, "bin", "Release", "Cluster.exe"),
    path.join(build, "bin", "Cluster.exe"),
  ]) if (await exists(candidate)) targets.push(candidate);
  let entries = [];
  try { entries = await readdir(build); } catch {}
  const escaped = pkg.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const installer = entries.find((entry) => new RegExp(`^Cluster-Desktop-${escaped}-.*\\.exe$`, "i").test(entry));
  if (installer) targets.push(path.join(build, installer));
  return [...new Set(targets.filter(Boolean))];
}

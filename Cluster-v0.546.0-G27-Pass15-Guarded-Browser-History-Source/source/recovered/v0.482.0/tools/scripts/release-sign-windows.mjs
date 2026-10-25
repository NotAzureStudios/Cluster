import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { windowsReleaseSigningTargets, exists } from "./windows-signing-lib.mjs";

if (process.platform !== "win32") throw new Error("Windows release signing must run on Windows.");
const root = process.cwd();
const pfxBase64 = String(process.env.CLUSTER_WINDOWS_SIGNING_PFX_BASE64 || "").trim();
const password = String(process.env.CLUSTER_WINDOWS_SIGNING_PFX_PASSWORD || "");
const timestampUrl = String(process.env.CLUSTER_WINDOWS_TIMESTAMP_URL || "https://timestamp.digicert.com").trim();
if (!pfxBase64 || !password) throw new Error("CLUSTER_WINDOWS_SIGNING_PFX_BASE64 and CLUSTER_WINDOWS_SIGNING_PFX_PASSWORD are required for public release signing.");
if (!/^https:\/\//i.test(timestampUrl)) throw new Error("CLUSTER_WINDOWS_TIMESTAMP_URL must use HTTPS.");

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with ${result.status ?? "unknown"}.`);
}
function findSignTool() {
  const probe = spawnSync("where.exe", ["signtool.exe"], { encoding: "utf8", windowsHide: true });
  if (probe.status === 0) return String(probe.stdout || "").split(/\r?\n/).find(Boolean)?.trim() || "signtool.exe";
  throw new Error("signtool.exe was not found. Install the Windows SDK on the release runner.");
}
const targets = (await windowsReleaseSigningTargets(root)).filter((file) => file.toLowerCase().endsWith(".exe") && file.includes(`${path.sep}bin${path.sep}`));
if (targets.length < 5) throw new Error(`Expected the native/server/desktop executables to exist before signing; found ${targets.length}.`);
const temp = await mkdtemp(path.join(os.tmpdir(), "cluster-sign-"));
const pfx = path.join(temp, "cluster-release.pfx");
try {
  await writeFile(pfx, Buffer.from(pfxBase64, "base64"), { mode: 0o600 });
  const tool = findSignTool();
  for (const target of targets) {
    if (!(await exists(target))) throw new Error(`Signing target is missing: ${target}`);
    run(tool, ["sign", "/fd", "SHA256", "/td", "SHA256", "/tr", timestampUrl, "/f", pfx, "/p", password, target]);
  }
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const deployed = path.join(root, "apps", "desktop-qt", "release", "windows-x64");
  const archive = path.join(root, "apps", "desktop-qt", "release", `Cluster-Desktop-${pkg.version}-windows-x64.zip`);
  run("cmake", ["-E", "rm", "-f", archive]);
  run("cmake", ["-E", "tar", "cf", archive, "--format=zip", "."], deployed);
  console.log(`Signed ${targets.length} Cluster Windows executables and rebuilt the signed desktop runtime archive.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { windowsReleaseSigningTargets } from "./windows-signing-lib.mjs";

if (process.platform !== "win32") throw new Error("Windows installer signing must run on Windows.");
const root = process.cwd();
const pfxBase64 = String(process.env.CLUSTER_WINDOWS_SIGNING_PFX_BASE64 || "").trim();
const password = String(process.env.CLUSTER_WINDOWS_SIGNING_PFX_PASSWORD || "");
const timestampUrl = String(process.env.CLUSTER_WINDOWS_TIMESTAMP_URL || "https://timestamp.digicert.com").trim();
if (!pfxBase64 || !password) throw new Error("Windows signing credentials are required.");
const installer = (await windowsReleaseSigningTargets(root)).find((file) => !file.includes(`${path.sep}bin${path.sep}`) && file.toLowerCase().endsWith(".exe"));
if (!installer) throw new Error("Cluster Desktop installer was not found after packaging.");
const probe = spawnSync("where.exe", ["signtool.exe"], { encoding: "utf8", windowsHide: true });
const tool = probe.status === 0 ? String(probe.stdout || "").split(/\r?\n/).find(Boolean)?.trim() : "";
if (!tool) throw new Error("signtool.exe was not found.");
const temp = await mkdtemp(path.join(os.tmpdir(), "cluster-installer-sign-"));
try {
  const pfx = path.join(temp, "cluster-release.pfx");
  await writeFile(pfx, Buffer.from(pfxBase64, "base64"), { mode: 0o600 });
  const result = spawnSync(tool, ["sign", "/fd", "SHA256", "/td", "SHA256", "/tr", timestampUrl, "/f", pfx, "/p", password, installer], { stdio: "inherit", windowsHide: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`signtool failed with ${result.status ?? "unknown"}.`);
  console.log(`Signed Cluster Desktop installer: ${installer}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}

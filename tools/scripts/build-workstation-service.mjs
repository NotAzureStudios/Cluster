import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildGoBinary, requireSupportedGo } from "./go-toolchain.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const source = path.join(root, "apps", "workstation-go");
const bin = path.join(root, "bin");
const releaseVersion = process.env.CLUSTER_VERSION || JSON.parse(readFileSync(path.join(root, "config", "toolchain-versions.json"), "utf8")).cluster;
const protocol = 1;
mkdirSync(bin, { recursive: true });
const windows = path.join(bin, "cluster-workstation-service.exe");
const linux = path.join(bin, "cluster-workstation-service");
const manifestPath = path.join(bin, "cluster-workstation-service.manifest.json");
const current = process.platform === "win32" ? windows : linux;
function usable(file) { try { return existsSync(file) && statSync(file).size > 0; } catch { return false; } }
function artifact(file, os) {
  const bytes = readFileSync(file);
  return {
    os,
    arch: "amd64",
    file: path.basename(file),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
const version = requireSupportedGo({ allowPrebuilt: process.env.CLUSTER_ALLOW_PREBUILT_WORKSTATION === "1", prebuiltUsable: usable(current), label: "Cluster Workstation" });
if (!version) process.exit(0);
const flags = [`-X=main.buildVersion=${releaseVersion}`];
buildGoBinary({ source, goos: "windows", output: windows, ldflags: flags });
buildGoBinary({ source, goos: "linux", output: linux, ldflags: flags });
const manifest = {
  schema: 1,
  clusterVersion: releaseVersion,
  protocol,
  toolchain: version.raw,
  generatedAt: new Date().toISOString(),
  artifacts: [artifact(windows, "windows"), artifact(linux, "linux")],
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Cluster Workstation helpers built with ${version.raw}.`);
console.log(`Workstation integrity manifest: ${manifestPath}`);

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const versions = JSON.parse(readFileSync(path.join(root, "config", "toolchain-versions.json"), "utf8"));
const bin = path.join(root, "bin");
const manifestPath = path.join(bin, "cluster-workstation-service.manifest.json");
if (!existsSync(manifestPath)) throw new Error(`Workstation manifest missing: ${manifestPath}`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.schema !== 1) throw new Error(`Unsupported Workstation manifest schema ${manifest.schema}`);
if (manifest.clusterVersion !== versions.cluster) throw new Error(`Workstation manifest version ${manifest.clusterVersion} != Cluster ${versions.cluster}`);
if (manifest.protocol !== 1) throw new Error(`Workstation manifest protocol ${manifest.protocol} != 1`);
if (!String(manifest.toolchain || "").startsWith("go1.27")) throw new Error(`Workstation manifest was not produced by Go 1.27.x: ${manifest.toolchain || "missing"}`);
if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length < 2) throw new Error("Workstation manifest is missing cross-platform artifacts.");
for (const artifact of manifest.artifacts) {
  const file = path.join(bin, artifact.file);
  if (!existsSync(file)) throw new Error(`Workstation artifact missing: ${artifact.file}`);
  const stat = statSync(file);
  if (stat.size !== artifact.bytes) throw new Error(`Workstation artifact size mismatch: ${artifact.file}`);
  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (actual !== artifact.sha256) throw new Error(`Workstation artifact SHA-256 mismatch: ${artifact.file}`);
}
console.log(`Cluster Workstation helper manifest verified (${manifest.clusterVersion}, ${manifest.toolchain}, protocol ${manifest.protocol}).`);

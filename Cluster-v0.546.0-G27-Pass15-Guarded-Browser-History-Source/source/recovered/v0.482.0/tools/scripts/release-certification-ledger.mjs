import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, evidenceDirectory, sha256Text, sourceRevision, verifyGateEvidence } from "./release-evidence-lib.mjs";

const root = process.cwd();
const certified = process.env.CLUSTER_RELEASE_CERTIFIED === "1";
const publicRelease = process.env.CLUSTER_RELEASE_PUBLIC === "1";
const outArg = process.argv.find((item) => item.startsWith("--out="));
const inventoryArg = process.argv.find((item) => item.startsWith("--inventory="));
const out = path.resolve(outArg?.slice(6) || path.join(root, ".cluster", "release-certification-ledger.json"));
const inventoryPath = path.resolve(inventoryArg?.slice(12) || path.join(root, "release", "RELEASE_INVENTORY.json"));
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const revision = sourceRevision(root);
async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function sha256(file) { return createHash("sha256").update(await readFile(file)).digest("hex"); }

if (certified && revision === "unavailable") throw new Error("Certified release ledger requires an immutable Git source revision.");
if (!(await exists(inventoryPath))) throw new Error("Release inventory is missing. Generate the SBOM/inventory before certification.");
const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
if (inventory.clusterVersion !== pkg.version) throw new Error("Release inventory version does not match Cluster.");
if (certified && !inventory.completeDependencyGraph) throw new Error("Certified releases require a complete package-lock-backed dependency inventory.");
if (certified && inventory.sourceRevision !== revision) throw new Error("Release inventory source revision does not match certification source revision.");

const requiredGates = ["preflight", "dependency-audit", "legal-readiness", "accessibility", "ux-consistency", "production-e2e", "integration", "backup-restore", "upgrade-drill", "desktop-smoke", "bundle-budget", "performance-microbench", "performance-runtime", "production-ux", "production-readiness"];
if (publicRelease) requiredGates.push("windows-signatures");
const evidence = {};
for (const gate of requiredGates) {
  const file = path.join(evidenceDirectory(root), `${gate}.json`);
  if (!(await exists(file))) {
    if (certified || publicRelease) throw new Error(`Required certification evidence gate is missing: ${gate}.`);
    continue;
  }
  const record = JSON.parse(await readFile(file, "utf8"));
  verifyGateEvidence(record, { gate, clusterVersion: pkg.version, sourceRevision: revision });
  evidence[gate] = { path: `.cluster/release-evidence/${gate}.json`, sha256: await sha256(file), recordHash: record.recordHash, generatedAt: record.generatedAt };
}
if (publicRelease && process.platform !== "win32") throw new Error("Public distribution certification must be assembled on Windows so Authenticode evidence can be verified.");

const roadmapEvidencePath = path.join(root, ".cluster", "legal-readiness", "legal-privacy-accessibility-roadmap-evidence.json");
let roadmapEvidence = null;
if (await exists(roadmapEvidencePath)) {
  const record = JSON.parse(await readFile(roadmapEvidencePath, "utf8"));
  const { recordHash, ...unsigned } = record;
  if (record.schema !== 1 || record.clusterVersion !== pkg.version || record.roadmap?.totalSteps !== 20 || record.roadmap?.completedSteps !== 20 || record.roadmap?.implementationStatus !== "complete" || record.roadmap?.legalCertification !== false) {
    throw new Error("Legal/privacy/accessibility roadmap evidence is incomplete or version-drifted.");
  }
  if (recordHash !== sha256Text(canonicalJson(unsigned))) throw new Error("Legal/privacy/accessibility roadmap evidence failed its integrity hash.");
  roadmapEvidence = { path: "Evidence/legal-privacy-accessibility-roadmap.json", sha256: await sha256(roadmapEvidencePath), recordHash, generatedAt: record.generatedAt, completedSteps: record.roadmap.completedSteps };
} else if (certified || publicRelease) {
  throw new Error("Certified releases require consolidated legal/privacy/accessibility roadmap evidence.");
}

const accessibilityReportPath = path.join(root, ".cluster", "accessibility", "accessibility-report.json");
let accessibilityReport = null;
if (await exists(accessibilityReportPath)) {
  const report = JSON.parse(await readFile(accessibilityReportPath, "utf8"));
  if (report.clusterVersion !== pkg.version) throw new Error("Accessibility report version does not match Cluster.");
  if (report.passed !== true || !Array.isArray(report.surfaces) || report.surfaces.length < 3 || !Array.isArray(report.keyboardChecks) || !report.keyboardChecks.length) {
    throw new Error("Accessibility report is incomplete or did not pass.");
  }
  accessibilityReport = { path: "Evidence/accessibility-report.json", sha256: await sha256(accessibilityReportPath), generatedAt: report.generatedAt || null };
} else if (certified) {
  throw new Error("Certified releases require a passing runtime accessibility report.");
}

const productionReadinessPath = path.join(root, ".cluster", "production-readiness.json");
let productionReadiness = null;
if (await exists(productionReadinessPath)) {
  const report = JSON.parse(await readFile(productionReadinessPath, "utf8"));
  if (report.clusterVersion !== pkg.version || report.sourceRevision !== revision) throw new Error("Production readiness report version/revision drift.");
  if (certified && report.certifiedReady !== true) throw new Error("Certified release ledger requires a passing production readiness report.");
  if (publicRelease && report.publicDistributionReady !== true) throw new Error("Public release ledger requires a public-ready production readiness report.");
  productionReadiness = { path: "PRODUCTION_READINESS.json", sha256: await sha256(productionReadinessPath), generatedAt: report.generatedAt, classification: report.classification };
} else if (certified || publicRelease) {
  throw new Error("Certified releases require a production readiness report.");
}

const ledger = {
  schema: 1,
  clusterVersion: pkg.version,
  sourceRevision: revision,
  generatedAt: new Date().toISOString(),
  certificationLevel: publicRelease ? "public-signed" : certified ? "ci-certified" : "local-unattested",
  certified,
  publicDistributionReady: Boolean(certified && publicRelease && evidence["windows-signatures"] && evidence["legal-readiness"] && roadmapEvidence),
  dependencyInventory: { path: path.basename(inventoryPath), sha256: await sha256(inventoryPath), complete: Boolean(inventory.completeDependencyGraph), sbomSha256: inventory.sbom?.sha256 || null },
  accessibilityReport,
  productionReadiness,
  roadmapEvidence,
  gates: evidence,
  policy: {
    sourceRevisionBound: true,
    exactDependencyGraphRequiredForCertification: true,
    publicReleaseRequiresAuthenticode: true,
    finalArtifactProvenanceRequiredByTaggedWorkflow: true,
    legalRoadmapEvidenceRequiredForCertification: true,
    productionReadinessRequiredForCertification: true,
    runtimePerformanceEvidenceRequiredForCertification: true,
    bundleBudgetEvidenceRequiredForCertification: true,
  },
};
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
console.log(`Release certification ledger written: ${ledger.certificationLevel}.`);

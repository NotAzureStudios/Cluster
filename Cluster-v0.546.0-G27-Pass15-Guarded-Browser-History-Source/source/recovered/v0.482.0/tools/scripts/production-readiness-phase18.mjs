import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { evidenceDirectory, sourceRevision, verifyGateEvidence } from "./release-evidence-lib.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const requireCertified = args.includes("--require-certified") || process.env.CLUSTER_RELEASE_CERTIFIED === "1";
const requirePublic = args.includes("--require-public") || process.env.CLUSTER_RELEASE_PUBLIC === "1";
const outArg = args.find((item) => item.startsWith("--out="));
const out = path.resolve(outArg?.slice(6) || path.join(root, ".cluster", "production-readiness.json"));
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const revision = sourceRevision(root);

async function sha256(file) { return createHash("sha256").update(await readFile(file)).digest("hex"); }
async function exists(relativeOrAbsolute) {
  const file = path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.join(root, relativeOrAbsolute);
  try { await access(file); return true; } catch { return false; }
}

const certifiedGates = [
  "preflight",
  "dependency-audit",
  "legal-readiness",
  "accessibility",
  "ux-consistency",
  "production-e2e",
  "integration",
  "backup-restore",
  "upgrade-drill",
  "desktop-smoke",
  "bundle-budget",
  "performance-microbench",
  "performance-runtime",
  "production-ux",
];
const publicGates = [...certifiedGates, "windows-signatures"];
const gateNames = requirePublic ? publicGates : certifiedGates;
const gates = {};
const missing = [];
const invalid = [];
for (const gate of gateNames) {
  const file = path.join(evidenceDirectory(root), `${gate}.json`);
  if (!(await exists(file))) {
    missing.push(`evidence:${gate}`);
    gates[gate] = { status: "missing" };
    continue;
  }
  try {
    const record = JSON.parse(await readFile(file, "utf8"));
    verifyGateEvidence(record, { gate, clusterVersion: pkg.version, sourceRevision: revision });
    gates[gate] = { status: record.status, generatedAt: record.generatedAt, recordHash: record.recordHash };
  } catch (error) {
    invalid.push(`evidence:${gate}:${error instanceof Error ? error.message : String(error)}`);
    gates[gate] = { status: "invalid" };
  }
}

const built = {
  server: await exists("apps/server/dist/index.js"),
  web: await exists("apps/web/dist/index.html"),
  shared: await exists("packages/shared/dist/index.js"),
};
const dependencyLock = await exists("package-lock.json");
const accessibilityReport = await exists(path.join(root, ".cluster", "accessibility", "accessibility-report.json"));
const performanceFiles = {
  bundleBudget: path.join(root, ".cluster", "performance", "bundle-budget.json"),
  searchMicrobench: path.join(root, ".cluster", "performance", "search-microbench.json"),
  clientRuntime: path.join(root, ".cluster", "performance", "client-phase18.json"),
  serverRuntime: path.join(root, ".cluster", "performance", "server-phase18.json"),
};
const performanceArtifacts = {};
for (const [key, file] of Object.entries(performanceFiles)) {
  if (await exists(file)) performanceArtifacts[key] = { path: `Evidence/performance/${path.basename(file)}`, sha256: await sha256(file) };
}
const bundleBudgetReport = Boolean(performanceArtifacts.bundleBudget);
const searchMicrobenchReport = Boolean(performanceArtifacts.searchMicrobench);
const clientPerformanceReport = Boolean(performanceArtifacts.clientRuntime);
const serverPerformanceReport = Boolean(performanceArtifacts.serverRuntime);
const desktopRuntime = await exists(path.join(root, "apps", "desktop-qt", "release", `Cluster-Desktop-${pkg.version}-windows-x64.zip`));
const desktopBuildDirectory = path.join(root, "apps", "desktop-qt", "build");
let desktopInstaller = false;
if (await exists(desktopBuildDirectory)) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(desktopBuildDirectory).catch(() => []);
  const escapedVersion = pkg.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const installerMatcher = new RegExp(`^Cluster-Desktop-${escapedVersion}-.*\\.exe$`, "i");
  desktopInstaller = entries.some((entry) => installerMatcher.test(String(entry)));
}
const publicInputs = { desktopInstaller, windowsSignatures: gates["windows-signatures"]?.status === "passed" };

const certifiedInputs = {
  immutableRevision: /^[a-f0-9]{40}$/i.test(revision),
  dependencyLock,
  built,
  accessibilityReport,
  performanceReports: { client: clientPerformanceReport, server: serverPerformanceReport },
  desktopRuntime,
};
for (const [label, ok] of Object.entries({
  "immutable source revision": certifiedInputs.immutableRevision,
  "package lock": dependencyLock,
  "server build": built.server,
  "web build": built.web,
  "shared build": built.shared,
  "runtime accessibility report": accessibilityReport,
  "bundle budget report": bundleBudgetReport,
  "search microbenchmark report": searchMicrobenchReport,
  "client performance report": clientPerformanceReport,
  "server performance report": serverPerformanceReport,
  "desktop runtime": desktopRuntime,
})) if (!ok) missing.push(label);
if (requirePublic) {
  if (!desktopInstaller) missing.push("signed installer candidate");
  if (!publicInputs.windowsSignatures) missing.push("windows signature evidence");
}

const certifiedReady = missing.length === 0 && invalid.length === 0 && certifiedGates.every((gate) => gates[gate]?.status === "passed");
const publicReady = certifiedReady && publicGates.every((gate) => gates[gate]?.status === "passed") && desktopInstaller;
const classification = publicReady ? "public-signed" : certifiedReady ? "ci-certified" : "local-unattested";
const report = {
  schema: 1,
  clusterVersion: pkg.version,
  sourceRevision: revision,
  generatedAt: new Date().toISOString(),
  classification,
  certifiedReady,
  publicDistributionReady: publicReady,
  requirements: { certifiedGates, publicGates },
  gates,
  inputs: { certified: certifiedInputs, public: publicInputs, performanceArtifacts },
  missing: [...new Set(missing)].sort(),
  invalid: [...new Set(invalid)].sort(),
  policy: {
    localUnattestedIsNotCertification: true,
    missingRuntimeEvidenceFailsCertifiedRelease: true,
    missingBuildEvidenceFailsCertifiedRelease: true,
    publicReleaseRequiresAuthenticode: true,
    noCertificationByEnvironmentFlagAlone: true,
  },
};
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(`Production readiness: ${classification}.`);
if (report.missing.length) console.log(`Unavailable requirements: ${report.missing.join(", ")}`);
if (report.invalid.length) report.invalid.forEach((item) => console.error(`INVALID ${item}`));
if (requireCertified && !certifiedReady) throw new Error("Certified production readiness requirements are incomplete.");
if (requirePublic && !publicReady) throw new Error("Public production readiness requirements are incomplete.");

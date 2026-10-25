import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { spawnPortableSync } from "./command-invocation.mjs";
import path from "node:path";

const root = process.cwd();
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const versions = JSON.parse(await readFile(path.join(root, "config", "toolchain-versions.json"), "utf8"));
const version = pkg.version;
const certified = process.env.CLUSTER_RELEASE_CERTIFIED === "1";
const requirePrebuilt = process.env.CLUSTER_RELEASE_REQUIRE_PREBUILT === "1";
const requireDesktopPackage = process.env.CLUSTER_RELEASE_REQUIRE_DESKTOP_PACKAGE === "1";
const publicRelease = process.env.CLUSTER_RELEASE_PUBLIC === "1";
const requireCodeSigning = process.env.CLUSTER_RELEASE_REQUIRE_CODE_SIGNING === "1" || publicRelease;
const reuseNative = process.env.CLUSTER_RELEASE_REUSE_NATIVE === "1";
const releaseRoot = path.join(root, "release", "master");
const master = path.join(releaseRoot, `Cluster-Master-v${version}`);
const staging = path.join(root, "release", "staging-v" + version);
const forbiddenNames = new Set(["node_modules", "release", "dist", "build", ".cluster", ".git", ".github", ".gitignore", ".gitattributes", ".gitmodules", ".env", ".env.local", ".env.production", ".env.development", "embedded-postgres.env"]);
const forbiddenSecretFile = /\.(?:pfx|p12|key|jks)$/i;
const rootGeneratedNames = new Set(["data", "runtime", "bin"]);

function run(command, args, cwd = root) {
  const result = spawnPortableSync(command, args, { cwd, stdio: "inherit", windowsHide: false, env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status}.`);
}
async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function hash(file) { return createHash("sha256").update(await readFile(file)).digest("hex"); }
async function findDesktopInstaller() {
  const buildDirectory = path.join(root, "apps", "desktop-qt", "build");
  let entries = [];
  try { entries = await readdir(buildDirectory); } catch { return ""; }
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`^Cluster-Desktop-${escapedVersion}-.*\\.exe$`, "i");
  const candidate = entries.find((entry) => matcher.test(entry));
  return candidate ? path.join(buildDirectory, candidate) : "";
}
function sourceRevision() {
  if (String(process.env.GITHUB_SHA || "").trim()) return String(process.env.GITHUB_SHA).trim();
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? String(result.stdout || "").trim() : "unavailable";
}
async function copyTree(source, destination, options = {}) {
  let info; try { info = await stat(source); } catch { return; }
  const name = path.basename(source);
  const sourceParent = path.resolve(path.dirname(source));
  const isRootGenerated = sourceParent === path.resolve(root) && rootGeneratedNames.has(name);
  if (!options.allowGenerated && (forbiddenNames.has(name) || forbiddenSecretFile.test(name) || isRootGenerated)) return;
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const entry of await readdir(source)) await copyTree(path.join(source, entry), path.join(destination, entry), options);
  } else {
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { force: true });
  }
}
async function copyList(destination, entries) {
  for (const entry of entries) await copyTree(path.join(root, entry), path.join(destination, entry));
}
function archiveZip(source, target) {
  run("cmake", ["-E", "tar", "cf", target, "--format=zip", path.basename(source)], path.dirname(source));
}
function archiveTarGz(source, target) {
  run("cmake", ["-E", "tar", "czf", target, path.basename(source)], path.dirname(source));
}

run(process.execPath, [path.join(root, "tools", "scripts", "toolchain-versions.mjs"), "--check"]);
run(process.execPath, [path.join(root, "tools", "scripts", "source-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "server-build-compat-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "renderer-build-compat-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "renderer-architecture-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "design-system-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "css-architecture-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "shared-components-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "interaction-state-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "information-density-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "contextual-actions-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "master-detail-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "desktop-productivity-phase7-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "search-command-phase8-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "perceived-performance-phase9-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "connectivity-operational-status-phase10-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "error-recovery-phase11-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "project-workspace-phase12-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "empty-loading-first-use-phase13-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "accessibility-input-phase14-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "motion-microinteractions-phase15-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "visual-qa-consistency-phase16-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "performance-architecture-phase17-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "performance-microbench-phase17.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "production-ux-gate-phase18.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "server-architecture-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "windows-server-control-panel-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "desktop-parity-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "desktop-sync-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "project-intelligence-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "operations-performance-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "ux-consistency-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "ux-polish-pass-two-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "ux-polish-pass-three-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "ux-polish-pass-four-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "ux-polish-pass-five-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "navigation-recovery-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "desktop-profile-isolation-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "desktop-startup-reconnect-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "desktop-native-notifications-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "desktop-native-filesystem-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "desktop-native-shell-productivity-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "desktop-offline-resilience-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "desktop-phase4-completion-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "renderer-performance-phase5-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "renderer-scalability-phase5-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "performance-scalability-phase5-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "integration-e2e-phase6-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "integration-e2e-phase6-workflows-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "integration-e2e-phase6-resilience-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "production-build-foundation-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "release-lifecycle-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "responsive-layout-v456-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "responsive-pass-a-v457-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "responsive-pass-b-v458-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "roadmap-pass-c-v459-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "roadmap-pass-d-v460-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "roadmap-pass-e-v461-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "roadmap-pass-f-v462-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "roadmap-pass-g-v463-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "roadmap-pass-h-v464-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "mobile-layout-v465-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "create-launcher-v466-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "operations-typography-v467-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "server-qol-shell-v468-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "admin-settings-normalization-v469-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "admin-parity-v470-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "startup-resilience-v471-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "server-utility-v471-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "startup-build-darkmode-v472-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "identity-profiles-notifications-v473-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "ux-parity-pass1-v474-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "ux-parity-pass2-v475-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "ux-parity-pass3-v476-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "ux-parity-pass4-v477-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "ux-parity-pass5-v478-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "create-refinement-v479-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "desktop-native-consolidation-v480-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "desktop-native-product-surfaces-v481-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "desktop-native-runtime-v482-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "polish-enhancement-phase-a-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "polish-enhancement-phase-b-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "polish-enhancement-phase-c-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "polish-enhancement-phase-d-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "polish-enhancement-phase-e-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "polish-enhancement-phase-f-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "polish-enhancement-phase-g-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "polish-enhancement-phase-h-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "polish-enhancement-phase-i-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "polish-enhancement-phase-j-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "polish-enhancement-phase-k-audit.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "release-security-scan.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "bundle-budget.mjs")]);
run(process.execPath, [path.join(root, "tools", "scripts", "platform-production-audit.mjs")]);
if (!reuseNative) {
  run(process.execPath, [path.join(root, "tools", "scripts", "build-native-host.mjs")]);
  run(process.execPath, [path.join(root, "tools", "scripts", "build-server-launcher.mjs")]);
  run(process.execPath, [path.join(root, "tools", "scripts", "build-update-helper.mjs")]);
}
for (const requiredNative of ["ClusterServer.exe", "cluster-host.exe", "cluster-update-helper.exe", "cluster-server", "cluster-host", "cluster-update-helper"]) {
  if (!(await exists(path.join(root, "bin", requiredNative)))) throw new Error(`Native release binary is missing: bin/${requiredNative}.`);
}
const sbomPath = path.join(root, "release", "SBOM.spdx.json");
const inventoryPath = path.join(root, "release", "RELEASE_INVENTORY.json");
run(process.execPath, [path.join(root, "tools", "scripts", "release-sbom.mjs"), `--out=${sbomPath}`, `--inventory=${inventoryPath}`, ...(certified ? ["--require-lock"] : [])]);

const desktopRuntimeSource = path.join(root, "apps", "desktop-qt", "release", `Cluster-Desktop-${version}-windows-x64.zip`);
const desktopInstallerSource = await findDesktopInstaller();
const prebuilt = {
  server: await exists(path.join(root, "apps", "server", "dist", "index.js")),
  web: await exists(path.join(root, "apps", "web", "dist", "index.html")),
  shared: await exists(path.join(root, "packages", "shared", "dist", "index.js")),
  desktop: await exists(desktopRuntimeSource),
  desktopInstaller: Boolean(desktopInstallerSource) && await exists(desktopInstallerSource),
};
if (requirePrebuilt && (!prebuilt.server || !prebuilt.web || !prebuilt.shared)) {
  throw new Error("Certified release packaging requires prebuilt server, web, and shared outputs. Run the release build before packaging.");
}
if (requireDesktopPackage && !prebuilt.desktop) {
  throw new Error("Certified release packaging requires a packaged Windows desktop runtime that passed the launch smoke test.");
}
if (publicRelease && !prebuilt.desktopInstaller) {
  throw new Error("Public release packaging requires a signed Windows desktop installer candidate.");
}
if (certified && (!requirePrebuilt || !requireDesktopPackage)) {
  throw new Error("CLUSTER_RELEASE_CERTIFIED requires both prebuilt server/web output and a smoke-tested desktop runtime package.");
}
let certificationEvidence = null;
if (certified) {
  const evidencePath = path.join(root, ".cluster", "release-preflight.json");
  if (!(await exists(evidencePath))) throw new Error("Certified packaging requires .cluster/release-preflight.json from the full release preflight.");
  certificationEvidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const revision = sourceRevision();
  if (certificationEvidence.clusterVersion !== version ||
      certificationEvidence.sourceRevision !== revision ||
      !certificationEvidence.gates?.database ||
      !certificationEvidence.gates?.build ||
      !certificationEvidence.gates?.native ||
      !certificationEvidence.gates?.unitTests) {
    throw new Error("Release preflight evidence does not match this source revision or is missing required gates.");
  }
}
if (requireCodeSigning && process.platform !== "win32") throw new Error("Code-signing-required release packaging must run on Windows.");
const legalRoadmapEvidencePath = path.join(root, ".cluster", "legal-readiness", "legal-privacy-accessibility-roadmap-evidence.json");
run(process.execPath, [path.join(root, "tools", "scripts", "legal-roadmap-evidence.mjs"), `--out=${legalRoadmapEvidencePath}`]);
const productionReadinessPath = path.join(root, ".cluster", "production-readiness.json");
run(process.execPath, [path.join(root, "tools", "scripts", "production-readiness-phase18.mjs"), `--out=${productionReadinessPath}`, ...(certified ? ["--require-certified"] : []), ...(publicRelease ? ["--require-public"] : [])]);
const ledgerPath = path.join(root, ".cluster", "release-certification-ledger.json");
run(process.execPath, [path.join(root, "tools", "scripts", "release-certification-ledger.mjs"), `--out=${ledgerPath}`, `--inventory=${inventoryPath}`]);
const certificationLedger = JSON.parse(await readFile(ledgerPath, "utf8"));
if (certified && !certificationLedger.certified) throw new Error("Certified packaging requires a certified release ledger.");
if (publicRelease && !certificationLedger.publicDistributionReady) throw new Error("Public release packaging requires a public-signed certification ledger.");
const releaseInventory = JSON.parse(await readFile(inventoryPath, "utf8"));
const releaseMetadata = {
  schema: 3,
  clusterVersion: version,
  sourceRevision: sourceRevision(),
  generatedAt: new Date().toISOString(),
  certified,
  certificationLevel: certificationLedger.certificationLevel,
  publicDistributionReady: certificationLedger.publicDistributionReady,
  prebuilt,
  dependencyPolicy: "exact-direct-versions+runtime-lock",
  preflight: certificationEvidence,
  certificationLedger,
  productionReadiness: { path: "PRODUCTION_READINESS.json", sha256: await hash(productionReadinessPath) },
  legalRoadmapEvidence: { path: "Evidence/legal-privacy-accessibility-roadmap.json", sha256: await hash(legalRoadmapEvidencePath) },
  supplyChain: {
    sbom: { path: "SBOM.spdx.json", sha256: await hash(sbomPath) },
    inventory: { path: "RELEASE_INVENTORY.json", sha256: await hash(inventoryPath), completeDependencyGraph: releaseInventory.completeDependencyGraph },
  },
  dependencyLock: false,
  runtimeDependencyLockSha256: null,
};

await rm(master, { recursive: true, force: true });
await rm(staging, { recursive: true, force: true });
await mkdir(path.join(master, "Source"), { recursive: true });
await mkdir(path.join(master, "Evidence"), { recursive: true });
for (const product of ["Windows-Server", "Linux-Server", "Docker-Server", "Desktop-App"]) await mkdir(path.join(master, "Packages", product), { recursive: true });
await mkdir(staging, { recursive: true });

// One canonical full-source archive. No duplicated Windows/Linux/Desktop source trees.
const sourceStage = path.join(staging, `Cluster-Source-v${version}`);
await copyTree(root, sourceStage);
const sourceArchive = path.join(master, "Source", `Cluster-Source-v${version}.zip`);
archiveZip(sourceStage, sourceArchive);

await cp(sbomPath, path.join(master, "SBOM.spdx.json"), { force: true });
await cp(inventoryPath, path.join(master, "RELEASE_INVENTORY.json"), { force: true });
for (const gate of Object.keys(certificationLedger.gates || {})) {
  const source = path.join(root, ".cluster", "release-evidence", `${gate}.json`);
  if (await exists(source)) await cp(source, path.join(master, "Evidence", `${gate}.json`), { force: true });
}
const accessibilityReportSource = path.join(root, ".cluster", "accessibility", "accessibility-report.json");
if (await exists(accessibilityReportSource)) await cp(accessibilityReportSource, path.join(master, "Evidence", "accessibility-report.json"), { force: true });
await cp(legalRoadmapEvidencePath, path.join(master, "Evidence", "legal-privacy-accessibility-roadmap.json"), { force: true });
const securityScanEvidence = path.join(root, ".cluster", "release-security-scan.json");
if (await exists(securityScanEvidence)) await cp(securityScanEvidence, path.join(master, "Evidence", "release-security-scan.json"), { force: true });
const performanceEvidenceDirectory = path.join(root, ".cluster", "performance");
if (await exists(performanceEvidenceDirectory)) await cp(performanceEvidenceDirectory, path.join(master, "Evidence", "performance"), { recursive: true, force: true });

const serverEntries = [
  "apps/server",
  "apps/web",
  "packages/shared",
  "packages/api-client",
  "packages/renderer",
  "config/toolchain-versions.json",
  "prisma.config.ts",
  "tools/scripts/command-invocation.mjs",
  "tools/scripts/database-config.mjs",
  "tools/scripts/database-command.mjs",
  "tools/scripts/database-doctor.mjs",
  "tools/scripts/postgresql-backup-restore-drill.mjs",
  "docs/SECURITY_ARCHITECTURE.md",
  "docs/NATIVE_CAPABILITY_BROKER.md",
  "docs/WINDOWS_SERVER_CONTROL_PANEL.md",
  "docs/AUTH_SESSION_SECURITY.md",
  "docs/AUTHORIZATION_ARCHITECTURE.md",
  "docs/UPLOAD_CONTENT_SECURITY.md",
  "docs/OUTBOUND_NETWORK_SECURITY.md",
  "docs/SECRET_CONFIGURATION_SECURITY.md",
  "docs/SECURITY_AUDIT_TRAIL.md",
  "docs/API_ABUSE_RESOURCE_SECURITY.md",
  "docs/MUTATION_DATA_INTEGRITY.md",
  "docs/SYNC_INTEGRITY_SECURITY.md",
  "docs/DATABASE_RECOVERY_RESILIENCE.md",
  "docs/OPERATIONAL_HEALTH_RESILIENCE.md",
  "docs/RELEASE_CERTIFICATION_SUPPLY_CHAIN.md",
  "docs/PRIVACY_POLICY_SYSTEM.md",
  "docs/TERMS_OF_SERVICE_SYSTEM.md",
  "docs/SERVER_OPERATOR_AGREEMENT.md",
  "docs/COPYRIGHT_DMCA_POLICY.md",
  "docs/COPYRIGHT_REPORTING_WORKFLOW.md",
  "docs/APP_WIDE_ACCESSIBILITY.md",
  "docs/ACCESSIBILITY_SETTINGS.md",
  "docs/AUTOMATED_ACCESSIBILITY_CI.md",
  "docs/DIRECT_RESOURCE_AUTHORIZATION_REGRESSION.md",
  "docs/LOGOUT_SESSION_REPLAY_REGRESSION.md",
  "docs/SECURITY_VULNERABILITY_DISCLOSURE_POLICY.md",
  "docs/LEGAL_COMPLIANCE_CENTER.md",
  "docs/THIRD_PARTY_DISCLOSURE_GENERATION.md",
  "docs/AUDITABLE_POLICY_ACCEPTANCE.md",
  "docs/BEHAVIORAL_ANALYTICS_CONSENT.md",
  "docs/PRIVACY_ERASURE_FULFILLMENT.md",
  "docs/LEGAL_PRIVACY_ACCESSIBILITY_RELEASE_READINESS.md",
  "docs/RENDERER_ARCHITECTURE.md",
  "docs/DESIGN_SYSTEM.md",
  "docs/PRODUCTION_UI_STANDARD.md",
  "docs/CSS_ARCHITECTURE_PHASE1.md",
  "docs/SHARED_COMPONENTS_PHASE2.md",
  "docs/INTERACTION_STATE_PHASE3.md",
  "docs/INFORMATION_DENSITY_PHASE4.md",
  "docs/CONTEXTUAL_ACTIONS_PHASE5.md",
  "docs/MASTER_DETAIL_PHASE6.md",
  "docs/DESKTOP_PRODUCTIVITY_PHASE7.md",
  "docs/SEARCH_COMMAND_PHASE8.md",
  "docs/PERCEIVED_PERFORMANCE_PHASE9.md",
  "docs/CONNECTIVITY_OPERATIONAL_STATUS_PHASE10.md",
  "docs/ERROR_RECOVERY_PHASE11.md",
  "docs/PROJECT_WORKSPACE_PHASE12.md",
  "docs/EMPTY_LOADING_FIRST_USE_PHASE13.md",
  "docs/ACCESSIBILITY_INPUT_PHASE14.md",
  "docs/MOTION_MICROINTERACTIONS_PHASE15.md",
  "docs/VISUAL_QA_CONSISTENCY_PHASE16.md",
  "docs/PERFORMANCE_ARCHITECTURE_PHASE17.md",
  "docs/PRODUCTION_UX_GATE_PHASE18.md",
  "docs/BACKEND_ARCHITECTURE_OVERHAUL.md",
  "docs/DESKTOP_SYNC_OVERHAUL.md",
  "docs/PROJECT_INTELLIGENCE_OVERHAUL.md",
  "docs/OPERATIONS_PERFORMANCE_OVERHAUL.md",
  "docs/PLATFORM_PRODUCTION_RELEASE.md",
  "docs/UX_TECH_DEBT_CLEANUP.md",
  "docs/UX_POLISH_PASS_1.md",
  "docs/UX_POLISH_PASS_2.md",
  "docs/UX_POLISH_PASS_3.md",
  "docs/UX_POLISH_PASS_4.md",
  "docs/UX_POLISH_PASS_5.md",
  "docs/POLISH_ENHANCEMENT_PHASE_A.md",
  "docs/NAVIGATION_SESSION_RECOVERY.md",
  "docs/DESKTOP_SERVER_PROFILE_ISOLATION.md",
  "docs/DESKTOP_STARTUP_RECONNECT.md",
  "docs/DESKTOP_NATIVE_NOTIFICATIONS.md",
  "docs/DESKTOP_NATIVE_FILESYSTEM.md",
  "docs/DESKTOP_NATIVE_SHELL_PRODUCTIVITY.md",
  "docs/DESKTOP_OFFLINE_RESILIENCE.md",
  "docs/DESKTOP_PHASE4_COMPLETION.md",
  "docs/DESKTOP_NATIVE_CONSOLIDATION_V480.md",
  "docs/DESKTOP_NATIVE_FEATURE_STATUS_V480.md",
  "docs/DESKTOP_NATIVE_PRODUCT_SURFACES_V481.md",
  "docs/DESKTOP_NATIVE_FEATURE_STATUS_V481.md",
  "docs/DESKTOP_NATIVE_RUNTIME_COMPLETION_V482.md",
  "docs/DESKTOP_NATIVE_FEATURE_STATUS_V482.md",
  "RELEASE_NOTES_v0.387.0.md",
  "docs/PRIVACY_CONSENT_STORAGE.md",
  "docs/PRIVACY_DATA_CONTROL_CENTER.md",
  "docs/DATA_INVENTORY_RETENTION.md",
  "docs/DESKTOP_UPDATE_SECURITY.md",
  `RELEASE_NOTES_v${version}.md`,
];
const runtimePackage = {
  name: "cluster-server-runtime",
  version,
  private: true,
  type: "module",
  engines: { node: `>=${versions.node.version} <${Number(versions.node.version.split(".")[0]) + 1}` },
  workspaces: ["apps/server", "apps/web", "packages/shared", "packages/api-client", "packages/renderer"],
  scripts: {
    "build:server": "npm run build -w @cluster/shared && npm run build -w @cluster/server",
    "build:web": "npm run build -w @cluster/shared && npm run build -w @cluster/api-client && npm run build -w @cluster/renderer && npm run build -w @cluster/web",
    "db:generate": "node tools/scripts/database-command.mjs generate",
    "db:validate": "node tools/scripts/database-command.mjs validate",
    "db:status": "node tools/scripts/database-command.mjs status",
    "db:deploy": "node tools/scripts/database-command.mjs deploy",
    "db:doctor": "node tools/scripts/database-doctor.mjs"
  }
};

async function stageServer(platform) {
  const stage = path.join(staging, platform === "windows" ? "Cluster-Windows-Server" : "Cluster-Linux-Server");
  await mkdir(stage, { recursive: true });
  await copyList(stage, serverEntries);
  if (prebuilt.server) await copyTree(path.join(root, "apps", "server", "dist"), path.join(stage, "apps", "server", "dist"), { allowGenerated: true });
  if (prebuilt.web) await copyTree(path.join(root, "apps", "web", "dist"), path.join(stage, "apps", "web", "dist"), { allowGenerated: true });
  if (prebuilt.shared) await copyTree(path.join(root, "packages", "shared", "dist"), path.join(stage, "packages", "shared", "dist"), { allowGenerated: true });
  await writeFile(path.join(stage, "CLUSTER_RELEASE.json"), `${JSON.stringify(releaseMetadata, null, 2)}\n`);
  if (platform === "linux") await copyTree(path.join(root, "deployment"), path.join(stage, "deployment"));
  await mkdir(path.join(stage, "bin"), { recursive: true });
  if (platform === "windows") {
    await cp(path.join(root, "bin", "ClusterServer.exe"), path.join(stage, "ClusterServer.exe"));
    await cp(path.join(root, "apps", "desktop-qt", "assets", "cluster-icon.ico"), path.join(stage, "cluster-icon.ico"));
    await cp(path.join(root, "bin", "cluster-host.exe"), path.join(stage, "bin", "cluster-host.exe"));
  } else {
    await cp(path.join(root, "bin", "cluster-server"), path.join(stage, "cluster-server"));
    await cp(path.join(root, "bin", "cluster-host"), path.join(stage, "bin", "cluster-host"));
  }
  await writeFile(path.join(stage, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`);
  await writeFile(path.join(stage, "README.md"), `# Cluster ${platform === "windows" ? "Windows" : "Linux"} Server v${version}\n\n${platform === "windows" ? "Run `ClusterServer.exe`. On first launch it asks `Use visual interface?` with a simple Yes/No choice, then remembers that choice. The interface provides Start/Stop/Restart, live logs, settings, update checks, system metrics, Open Web/Open Logs, and a local command field. Use `ClusterServer.exe --interface` or `ClusterServer.exe --command-line` for a one-run override. Node.js and PostgreSQL are provisioned privately under this server directory." : "Run `./cluster-server`. Node.js is provisioned privately; Docker PostgreSQL is used by default when no external DATABASE_URL is configured."}\n\nCertified release packages include prebuilt server/web output, apply Prisma migrations, then start the native managed host. A source-only/local package may compile once on first launch as a repair fallback.\n`);
  return stage;
}

const windowsStage = await stageServer("windows");
const linuxStage = await stageServer("linux");
if (certified || requirePrebuilt) {
  console.log("Resolving exact runtime dependency lock for certified server packages...");
  run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], windowsStage);
  const runtimeLock = path.join(windowsStage, "package-lock.json");
  if (!(await exists(runtimeLock))) throw new Error("Certified server packaging did not produce package-lock.json.");
  await cp(runtimeLock, path.join(linuxStage, "package-lock.json"), { force: true });
  releaseMetadata.dependencyLock = true;
  releaseMetadata.runtimeDependencyLockSha256 = await hash(runtimeLock);
  await writeFile(path.join(windowsStage, "CLUSTER_RELEASE.json"), `${JSON.stringify(releaseMetadata, null, 2)}\n`);
  await writeFile(path.join(linuxStage, "CLUSTER_RELEASE.json"), `${JSON.stringify(releaseMetadata, null, 2)}\n`);
}
const windowsArchive = path.join(master, "Packages", "Windows-Server", `Cluster-Windows-Server-v${version}-x64.zip`);
// Docker Server distribution: source/build context + Compose deployment, with no embedded secrets.
const dockerStage = path.join(staging, `Cluster-Docker-Server-v${version}`);
await mkdir(dockerStage, { recursive: true });
await copyTree(path.join(root, "deployment", "server"), path.join(dockerStage, "deployment", "server"));
for (const entry of ["apps/server", "apps/web", "packages/shared", "packages/api-client", "packages/renderer", "config", "prisma.config.ts", "package.json"]) await copyTree(path.join(root, entry), path.join(dockerStage, entry));
if (await exists(path.join(root, "package-lock.json"))) await cp(path.join(root, "package-lock.json"), path.join(dockerStage, "package-lock.json"), { force: true });
await writeFile(path.join(dockerStage, "README.md"), `# Cluster Docker Server v${version}\n\nRun from this directory with \`POSTGRES_PASSWORD=<secret> docker compose -f deployment/server/docker-compose.yml up -d --build\`. Production certification requires the registry-backed npm lock and prebuilt application output.\n`);
const dockerArchive = path.join(master, "Packages", "Docker-Server", `Cluster-Docker-Server-v${version}.tar.gz`);
archiveTarGz(dockerStage, dockerArchive);

const linuxArchive = path.join(master, "Packages", "Linux-Server", `Cluster-Linux-Server-v${version}-x64.tar.gz`);
archiveZip(windowsStage, windowsArchive);
archiveTarGz(linuxStage, linuxArchive);

// Desktop package build kit. A release host with Qt can turn this directly into Cluster.exe/NSIS via npm run desktop:package/installer.
const desktopStage = path.join(staging, `Cluster-Desktop-v${version}-Build-Kit`);
await mkdir(desktopStage, { recursive: true });
await copyList(desktopStage, [
  "apps/desktop-qt",
  "apps/update-helper-go",
  "config/toolchain-versions.json",
  "tools/scripts/toolchain-lib.mjs",
  "tools/scripts/desktop-setup.mjs",
  "tools/scripts/build-update-helper.mjs",
  "tools/scripts/build-qt-desktop.mjs",
  "tools/scripts/package-qt-desktop.mjs",
  "tools/scripts/package-qt-installer.mjs",
  "tools/scripts/run-qt-desktop.mjs",
  "tools/scripts/desktop-smoke.mjs",
  "tools/scripts/release-update-manifest.mjs",
  "docs/SECURITY_ARCHITECTURE.md",
  "docs/NATIVE_CAPABILITY_BROKER.md",
  "docs/AUTH_SESSION_SECURITY.md",
  "docs/AUTHORIZATION_ARCHITECTURE.md",
  "docs/UPLOAD_CONTENT_SECURITY.md",
  "docs/OUTBOUND_NETWORK_SECURITY.md",
  "docs/SECRET_CONFIGURATION_SECURITY.md",
  "docs/SECURITY_AUDIT_TRAIL.md",
  "docs/API_ABUSE_RESOURCE_SECURITY.md",
  "docs/MUTATION_DATA_INTEGRITY.md",
  "docs/SYNC_INTEGRITY_SECURITY.md",
  "docs/DATABASE_RECOVERY_RESILIENCE.md",
  "docs/OPERATIONAL_HEALTH_RESILIENCE.md",
  "docs/RELEASE_CERTIFICATION_SUPPLY_CHAIN.md",
  "docs/PRIVACY_POLICY_SYSTEM.md",
  "docs/TERMS_OF_SERVICE_SYSTEM.md",
  "docs/SERVER_OPERATOR_AGREEMENT.md",
  "docs/COPYRIGHT_DMCA_POLICY.md",
  "docs/COPYRIGHT_REPORTING_WORKFLOW.md",
  "docs/APP_WIDE_ACCESSIBILITY.md",
  "docs/ACCESSIBILITY_SETTINGS.md",
  "docs/AUTOMATED_ACCESSIBILITY_CI.md",
  "docs/DIRECT_RESOURCE_AUTHORIZATION_REGRESSION.md",
  "docs/LOGOUT_SESSION_REPLAY_REGRESSION.md",
  "docs/SECURITY_VULNERABILITY_DISCLOSURE_POLICY.md",
  "docs/LEGAL_COMPLIANCE_CENTER.md",
  "docs/THIRD_PARTY_DISCLOSURE_GENERATION.md",
  "docs/AUDITABLE_POLICY_ACCEPTANCE.md",
  "docs/BEHAVIORAL_ANALYTICS_CONSENT.md",
  "docs/PRIVACY_ERASURE_FULFILLMENT.md",
  "docs/LEGAL_PRIVACY_ACCESSIBILITY_RELEASE_READINESS.md",
  "docs/RENDERER_ARCHITECTURE.md",
  "docs/DESIGN_SYSTEM.md",
  "docs/PRODUCTION_UI_STANDARD.md",
  "docs/CSS_ARCHITECTURE_PHASE1.md",
  "docs/SHARED_COMPONENTS_PHASE2.md",
  "docs/INTERACTION_STATE_PHASE3.md",
  "docs/INFORMATION_DENSITY_PHASE4.md",
  "docs/CONTEXTUAL_ACTIONS_PHASE5.md",
  "docs/MASTER_DETAIL_PHASE6.md",
  "docs/DESKTOP_PRODUCTIVITY_PHASE7.md",
  "docs/SEARCH_COMMAND_PHASE8.md",
  "docs/PERCEIVED_PERFORMANCE_PHASE9.md",
  "docs/CONNECTIVITY_OPERATIONAL_STATUS_PHASE10.md",
  "docs/ERROR_RECOVERY_PHASE11.md",
  "docs/PROJECT_WORKSPACE_PHASE12.md",
  "docs/EMPTY_LOADING_FIRST_USE_PHASE13.md",
  "docs/ACCESSIBILITY_INPUT_PHASE14.md",
  "docs/MOTION_MICROINTERACTIONS_PHASE15.md",
  "docs/VISUAL_QA_CONSISTENCY_PHASE16.md",
  "docs/PERFORMANCE_ARCHITECTURE_PHASE17.md",
  "docs/PRODUCTION_UX_GATE_PHASE18.md",
  "docs/BACKEND_ARCHITECTURE_OVERHAUL.md",
  "docs/DESKTOP_SYNC_OVERHAUL.md",
  "docs/PROJECT_INTELLIGENCE_OVERHAUL.md",
  "docs/OPERATIONS_PERFORMANCE_OVERHAUL.md",
  "docs/PLATFORM_PRODUCTION_RELEASE.md",
  "docs/UX_TECH_DEBT_CLEANUP.md",
  "docs/UX_POLISH_PASS_1.md",
  "docs/UX_POLISH_PASS_2.md",
  "docs/UX_POLISH_PASS_3.md",
  "docs/UX_POLISH_PASS_4.md",
  "docs/UX_POLISH_PASS_5.md",
  "docs/POLISH_ENHANCEMENT_PHASE_A.md",
  "docs/NAVIGATION_SESSION_RECOVERY.md",
  "docs/DESKTOP_SERVER_PROFILE_ISOLATION.md",
  "docs/DESKTOP_STARTUP_RECONNECT.md",
  "docs/DESKTOP_NATIVE_NOTIFICATIONS.md",
  "docs/DESKTOP_NATIVE_FILESYSTEM.md",
  "docs/DESKTOP_NATIVE_SHELL_PRODUCTIVITY.md",
  "docs/DESKTOP_OFFLINE_RESILIENCE.md",
  "docs/DESKTOP_PHASE4_COMPLETION.md",
  "docs/DESKTOP_NATIVE_CONSOLIDATION_V480.md",
  "docs/DESKTOP_NATIVE_FEATURE_STATUS_V480.md",
  "docs/DESKTOP_NATIVE_PRODUCT_SURFACES_V481.md",
  "docs/DESKTOP_NATIVE_FEATURE_STATUS_V481.md",
  "docs/DESKTOP_NATIVE_RUNTIME_COMPLETION_V482.md",
  "docs/DESKTOP_NATIVE_FEATURE_STATUS_V482.md",
  "RELEASE_NOTES_v0.387.0.md",
  "docs/PRIVACY_CONSENT_STORAGE.md",
  "docs/PRIVACY_DATA_CONTROL_CENTER.md",
  "docs/DATA_INVENTORY_RETENTION.md",
  "docs/DESKTOP_UPDATE_SECURITY.md",
  `RELEASE_NOTES_v${version}.md`,
]);
await mkdir(path.join(desktopStage, "bin"), { recursive: true });
for (const helper of ["cluster-update-helper.exe", "cluster-update-helper"]) await cp(path.join(root, "bin", helper), path.join(desktopStage, "bin", helper));
const desktopPackage = {
  name: "cluster-desktop-build-kit",
  version,
  private: true,
  type: "module",
  scripts: {
    "desktop:setup": "node tools/scripts/desktop-setup.mjs",
    "desktop:build-helper": "node tools/scripts/build-update-helper.mjs",
    "desktop:build": "node tools/scripts/build-update-helper.mjs && node tools/scripts/build-qt-desktop.mjs",
    "desktop:package": "node tools/scripts/build-update-helper.mjs && node tools/scripts/package-qt-desktop.mjs",
    "desktop:installer": "node tools/scripts/package-qt-installer.mjs",
    "desktop:start": "node tools/scripts/run-qt-desktop.mjs",
    "desktop:smoke": "node tools/scripts/desktop-smoke.mjs",
    "release:update-manifest": "node tools/scripts/release-update-manifest.mjs"
  }
};
await writeFile(path.join(desktopStage, "package.json"), `${JSON.stringify(desktopPackage, null, 2)}\n`);
await writeFile(path.join(desktopStage, "README.md"), `# Cluster Desktop v${version} build kit\n\nInstall Qt ${versions.qt.majorMinor}.x with the WebView and Pdf modules, plus CMake ${versions.cmake.minimum}+. On Windows either MSVC 2022 x64 or MinGW x64 is supported for local builds.\n\nRun:\n\n\`\`\`powershell\nnpm.cmd run desktop:setup\nnpm.cmd run desktop:package\n\`\`\`\n`);
const desktopArchive = path.join(master, "Packages", "Desktop-App", `Cluster-Desktop-v${version}-Build-Kit.zip`);
archiveZip(desktopStage, desktopArchive);
let desktopRuntimeArchive = null;
let desktopInstallerArchive = null;
if (prebuilt.desktop) {
  desktopRuntimeArchive = path.join(master, "Packages", "Desktop-App", `Cluster-Desktop-v${version}-Windows-x64.zip`);
  await cp(desktopRuntimeSource, desktopRuntimeArchive, { force: true });
}
if (prebuilt.desktopInstaller) {
  desktopInstallerArchive = path.join(master, "Packages", "Desktop-App", `Cluster-Desktop-v${version}-Windows-x64-Setup.exe`);
  await cp(desktopInstallerSource, desktopInstallerArchive, { force: true });
}

await cp(path.join(root, `RELEASE_NOTES_v${version}.md`), path.join(master, "RELEASE_NOTES.md"));
await cp(path.join(root, "config", "toolchain-versions.json"), path.join(master, "TOOLCHAIN_VERSIONS.json"));
await writeFile(path.join(master, "README.md"), `# Cluster Master v${version}\n\nOne archive contains the canonical full source plus independent Windows Server, Linux Server, and Desktop artifacts. The source exists once; product packages are generated from it to prevent cross-platform drift.\n\n- Windows Server: native launcher package${prebuilt.server && prebuilt.web ? " with prebuilt application output" : ""}\n- Linux Server: native launcher package${prebuilt.server && prebuilt.web ? " with prebuilt application output" : ""}\n- Docker Server: Compose + Dockerfile distribution with PostgreSQL health gating\n- Desktop App: native Qt packaging build kit${prebuilt.desktop ? " plus smoke-tested Windows runtime package" : ""}${prebuilt.desktopInstaller ? " and installer candidate" : ""}\n\nThe desktop kit auto-detects Qt ${versions.qt.majorMinor}.x MSVC or MinGW on Windows and validates the required WebView/Pdf modules before building.\n\nRelease certification: ${certificationLedger.certificationLevel}${publicRelease ? " (public distribution signing verified)" : ""}. Production readiness details are recorded in PRODUCTION_READINESS.json.\n`);

const artifacts = [sourceArchive, windowsArchive, linuxArchive, desktopArchive, ...(desktopRuntimeArchive ? [desktopRuntimeArchive] : []), ...(desktopInstallerArchive ? [desktopInstallerArchive] : [])];
const sums = [];
for (const file of artifacts) sums.push(`${await hash(file)}  ${path.relative(master, file).replaceAll("\\", "/")}`);
await writeFile(path.join(master, "SHA256SUMS.txt"), `${sums.join("\n")}\n`);
await writeFile(path.join(master, "MASTER_MANIFEST.json"), `${JSON.stringify({ schema: 3, clusterVersion: version, generatedAt: new Date().toISOString(), certification: releaseMetadata, toolchain: versions, supplyChain: releaseMetadata.supplyChain, artifacts: await Promise.all(artifacts.map(async (file) => ({ path: path.relative(master, file).replaceAll("\\", "/"), sha256: await hash(file), bytes: (await stat(file)).size }))) }, null, 2)}\n`);
await writeFile(path.join(master, "RELEASE_CERTIFICATION.json"), `${JSON.stringify(releaseMetadata, null, 2)}\n`);
await cp(ledgerPath, path.join(master, "CERTIFICATION_EVIDENCE.json"), { force: true });
await cp(productionReadinessPath, path.join(master, "PRODUCTION_READINESS.json"), { force: true });

const masterArchive = path.join(root, "release", `Cluster-Master-v${version}.zip`);
await rm(masterArchive, { force: true });
archiveZip(master, masterArchive);
const masterHash = await hash(masterArchive);
await writeFile(`${masterArchive}.sha256`, `${masterHash}  ${path.basename(masterArchive)}\n`);
if (process.env.CLUSTER_SKIP_RELEASE_VERIFY !== "1") {
  run(process.execPath, [path.join(root, "tools", "scripts", "release-verify-artifacts.mjs"), `--master=${masterArchive}`, ...(requirePrebuilt ? ["--require-prebuilt"] : []), ...(requireDesktopPackage ? ["--require-desktop-package"] : []), ...(requireCodeSigning ? ["--require-code-signing"] : [])]);
}
await rm(staging, { recursive: true, force: true });
console.log(`Cluster Master created: ${masterArchive}`);
console.log(`SHA-256: ${masterHash}`);

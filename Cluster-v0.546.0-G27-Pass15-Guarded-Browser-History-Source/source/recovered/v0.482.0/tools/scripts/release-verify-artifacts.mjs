import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { canonicalJson, sha256Text, verifyGateEvidence } from "./release-evidence-lib.mjs";

const root = process.cwd();
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const requirePrebuilt = process.argv.includes("--require-prebuilt") || process.env.CLUSTER_RELEASE_REQUIRE_PREBUILT === "1";
const requireDesktopPackage = process.argv.includes("--require-desktop-package") || process.env.CLUSTER_RELEASE_REQUIRE_DESKTOP_PACKAGE === "1";
const requireCodeSigning = process.argv.includes("--require-code-signing") || process.env.CLUSTER_RELEASE_REQUIRE_CODE_SIGNING === "1" || process.env.CLUSTER_RELEASE_PUBLIC === "1";
const archiveArg = process.argv.find((item) => item.startsWith("--master="));
const masterArchive = path.resolve(archiveArg?.slice("--master=".length) || path.join(root, "release", `Cluster-Master-v${pkg.version}.zip`));

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status}.`);
}
async function sha256(file) { return createHash("sha256").update(await readFile(file)).digest("hex"); }
async function exists(file) { try { await stat(file); return true; } catch { return false; } }
async function requirePath(base, relative) {
  const file = path.join(base, ...relative.split("/"));
  if (!(await exists(file))) throw new Error(`Release artifact is missing ${relative}.`);
  return file;
}
async function extract(archive, destination) {
  await rm(destination, { recursive: true, force: true });
  run("cmake", ["-E", "make_directory", destination]);
  run("cmake", ["-E", "tar", "xf", archive], destination);
}
async function onlyDirectory(directory) {
  const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  if (entries.length !== 1) throw new Error(`Expected one root directory in ${directory}, found ${entries.length}.`);
  return path.join(directory, entries[0].name);
}
async function assertMagic(file, expected, label) {
  const bytes = await readFile(file);
  if (!bytes.subarray(0, expected.length).equals(Buffer.from(expected))) throw new Error(`${label} has an unexpected executable header.`);
}
async function assertAuthenticode(file, label) {
  if (!requireCodeSigning) return;
  if (process.platform !== "win32") throw new Error("Code-signing release verification must run on Windows.");
  const escaped = file.replace(/'/g, "''");
  const script = `$s=Get-AuthenticodeSignature -LiteralPath '${escaped}'; [pscustomobject]@{Status=[string]$s.Status; Thumbprint=[string]$s.SignerCertificate.Thumbprint} | ConvertTo-Json -Compress`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Authenticode inspection failed for ${label}.`);
  const signature = JSON.parse(String(result.stdout || "{}").trim() || "{}");
  if (signature.Status !== "Valid" || !String(signature.Thumbprint || "").trim()) throw new Error(`${label} does not have a valid Authenticode signature.`);
}

const temp = await mkdtemp(path.join(os.tmpdir(), "cluster-release-verify-"));
try {
  console.log(`Verifying ${masterArchive}`);
  const masterExtract = path.join(temp, "master");
  await extract(masterArchive, masterExtract);
  const master = await onlyDirectory(masterExtract);
  const manifest = JSON.parse(await readFile(await requirePath(master, "MASTER_MANIFEST.json"), "utf8"));
  if (manifest.clusterVersion !== pkg.version) throw new Error(`Master manifest version ${manifest.clusterVersion} != ${pkg.version}.`);
  if (manifest.schema < 3) throw new Error("Master manifest does not contain the final release-certification schema.");
  const certification = JSON.parse(await readFile(await requirePath(master, "RELEASE_CERTIFICATION.json"), "utf8"));
  const ledger = JSON.parse(await readFile(await requirePath(master, "CERTIFICATION_EVIDENCE.json"), "utf8"));
  if (certification.clusterVersion !== pkg.version || ledger.clusterVersion !== pkg.version) throw new Error("Release certification version drift.");
  if (certification.sourceRevision !== ledger.sourceRevision) throw new Error("Release certification source revision is inconsistent.");
  if (certification.certified && (!/^[a-f0-9]{40}$/i.test(certification.sourceRevision) || certification.sourceRevision === "unavailable")) throw new Error("Certified release is not bound to an immutable Git source revision.");
  if (certification.certificationLevel !== ledger.certificationLevel || certification.publicDistributionReady !== ledger.publicDistributionReady) throw new Error("Certification ledger and release metadata disagree.");
  const inventoryPath = await requirePath(master, "RELEASE_INVENTORY.json");
  const sbomPath = await requirePath(master, "SBOM.spdx.json");
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const sbom = JSON.parse(await readFile(sbomPath, "utf8"));
  if (inventory.clusterVersion !== pkg.version || sbom.spdxVersion !== "SPDX-2.3") throw new Error("Release supply-chain inventory is invalid.");
  if (certification.supplyChain?.inventory?.sha256 !== await sha256(inventoryPath) || certification.supplyChain?.sbom?.sha256 !== await sha256(sbomPath)) throw new Error("Release supply-chain hashes do not match packaged inventory/SBOM files.");
  if (inventory.sbom?.sha256 !== await sha256(sbomPath)) throw new Error("Release inventory SBOM hash mismatch.");
  for (const [gate, descriptor] of Object.entries(ledger.gates || {})) {
    const evidenceFile = await requirePath(master, `Evidence/${gate}.json`);
    if (descriptor.sha256 !== await sha256(evidenceFile)) throw new Error(`Certification evidence hash mismatch for ${gate}.`);
    const record = JSON.parse(await readFile(evidenceFile, "utf8"));
    verifyGateEvidence(record, { gate, clusterVersion: pkg.version, sourceRevision: ledger.sourceRevision });
    if (record.recordHash !== descriptor.recordHash) throw new Error(`Certification evidence record hash mismatch for ${gate}.`);
  }
  if (!ledger.roadmapEvidence) throw new Error("Release certification ledger is missing legal/privacy/accessibility roadmap evidence metadata.");
  const roadmapEvidenceFile = await requirePath(master, "Evidence/legal-privacy-accessibility-roadmap.json");
  if (ledger.roadmapEvidence.sha256 !== await sha256(roadmapEvidenceFile)) throw new Error("Legal/privacy/accessibility roadmap evidence hash mismatch.");
  const roadmapEvidence = JSON.parse(await readFile(roadmapEvidenceFile, "utf8"));
  const { recordHash: roadmapRecordHash, ...roadmapUnsigned } = roadmapEvidence;
  if (roadmapEvidence.schema !== 1 || roadmapEvidence.clusterVersion !== pkg.version || roadmapEvidence.roadmap?.totalSteps !== 20 || roadmapEvidence.roadmap?.completedSteps !== 20 || roadmapEvidence.roadmap?.implementationStatus !== "complete" || roadmapEvidence.roadmap?.legalCertification !== false) {
    throw new Error("Packaged legal/privacy/accessibility roadmap evidence is invalid or incomplete.");
  }
  if (roadmapRecordHash !== ledger.roadmapEvidence.recordHash || roadmapRecordHash !== sha256Text(canonicalJson(roadmapUnsigned))) throw new Error("Legal/privacy/accessibility roadmap evidence record hash mismatch.");

  const readinessFile = await requirePath(master, "PRODUCTION_READINESS.json");
  const readiness = JSON.parse(await readFile(readinessFile, "utf8"));
  if (readiness.clusterVersion !== pkg.version || readiness.sourceRevision !== ledger.sourceRevision) throw new Error("Production readiness report version/revision drift.");
  if (ledger.productionReadiness?.sha256 !== await sha256(readinessFile)) throw new Error("Production readiness report hash mismatch.");
  if (requirePrebuilt) {
    for (const key of ["bundleBudget", "searchMicrobench", "clientRuntime", "serverRuntime"]) {
      const descriptor = readiness.inputs?.performanceArtifacts?.[key];
      if (!descriptor?.path || !descriptor?.sha256) throw new Error(`Certified master production readiness is missing ${key} performance evidence metadata.`);
      const file = await requirePath(master, descriptor.path);
      if (descriptor.sha256 !== await sha256(file)) throw new Error(`Certified master ${key} performance evidence hash mismatch.`);
    }
  }
  if (requirePrebuilt && (!readiness.certifiedReady || !["ci-certified", "public-signed"].includes(readiness.classification))) throw new Error("Certified master does not have a certified production readiness verdict.");
  if (requireCodeSigning && (!readiness.publicDistributionReady || readiness.classification !== "public-signed")) throw new Error("Public master does not have a public-signed production readiness verdict.");

  if (ledger.accessibilityReport) {
    const accessibilityReportFile = await requirePath(master, "Evidence/accessibility-report.json");
    if (ledger.accessibilityReport.sha256 !== await sha256(accessibilityReportFile)) throw new Error("Accessibility report hash mismatch.");
    const accessibilityReport = JSON.parse(await readFile(accessibilityReportFile, "utf8"));
    if (accessibilityReport.clusterVersion !== pkg.version || accessibilityReport.passed !== true || !Array.isArray(accessibilityReport.surfaces) || accessibilityReport.surfaces.length < 3) {
      throw new Error("Packaged accessibility report is invalid or incomplete.");
    }
  } else if (requirePrebuilt) {
    throw new Error("Certified master is missing its runtime accessibility report.");
  }
  if (requirePrebuilt) {
    if (!manifest.certification?.certified) throw new Error("Required certified master is not marked certified.");
    if (!manifest.certification?.dependencyLock) throw new Error("Certified master is missing its exact runtime dependency lock contract.");
    if (!inventory.completeDependencyGraph || !inventory.dependencyLock?.sha256) throw new Error("Certified master is missing its complete lock-backed dependency inventory.");
    for (const gate of ["preflight", "dependency-audit", "legal-readiness", "accessibility", "ux-consistency", "production-e2e", "integration", "backup-restore", "upgrade-drill", "desktop-smoke", "bundle-budget", "performance-microbench", "performance-runtime", "production-ux", "production-readiness"]) {
      if (!ledger.gates?.[gate]) throw new Error(`Certified master is missing ${gate} evidence.`);
    }
    if (!manifest.certification?.preflight?.gates?.database ||
        !manifest.certification?.preflight?.gates?.build ||
        !manifest.certification?.preflight?.gates?.native ||
        !manifest.certification?.preflight?.gates?.unitTests) {
      throw new Error("Certified master is missing complete release-preflight evidence.");
    }
  }
  if (requireCodeSigning) {
    if (!certification.publicDistributionReady || certification.certificationLevel !== "public-signed") throw new Error("Code-signing verification requires public-signed certification metadata.");
    if (!ledger.gates?.["windows-signatures"]) throw new Error("Public release is missing Windows signature evidence.");
  }
  const sumsText = await readFile(await requirePath(master, "SHA256SUMS.txt"), "utf8");
  const sums = new Map(sumsText.split(/\r?\n/).filter(Boolean).map((line) => {
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i);
    if (!match) throw new Error(`Invalid SHA256SUMS line: ${line}`);
    return [match[2].replaceAll("\\", "/"), match[1].toLowerCase()];
  }));
  for (const artifact of manifest.artifacts || []) {
    const relative = String(artifact.path).replaceAll("\\", "/");
    const file = await requirePath(master, relative);
    const actual = await sha256(file);
    if (actual !== String(artifact.sha256).toLowerCase()) throw new Error(`Manifest hash mismatch for ${relative}.`);
    if (sums.get(relative) !== actual) throw new Error(`SHA256SUMS mismatch for ${relative}.`);
  }

  const sourceArchive = await requirePath(master, `Source/Cluster-Source-v${pkg.version}.zip`);
  const windowsArchive = await requirePath(master, `Packages/Windows-Server/Cluster-Windows-Server-v${pkg.version}-x64.zip`);
  const linuxArchive = await requirePath(master, `Packages/Linux-Server/Cluster-Linux-Server-v${pkg.version}-x64.tar.gz`);
  const desktopArchive = await requirePath(master, `Packages/Desktop-App/Cluster-Desktop-v${pkg.version}-Build-Kit.zip`);
  const desktopRuntimeRelative = `Packages/Desktop-App/Cluster-Desktop-v${pkg.version}-Windows-x64.zip`;
  const desktopRuntimeArchive = path.join(master, ...desktopRuntimeRelative.split("/"));
  const desktopInstallerRelative = `Packages/Desktop-App/Cluster-Desktop-v${pkg.version}-Windows-x64-Setup.exe`;
  const desktopInstaller = path.join(master, ...desktopInstallerRelative.split("/"));
  if (requireDesktopPackage && !(await exists(desktopRuntimeArchive))) throw new Error(`Release artifact is missing ${desktopRuntimeRelative}.`);
  if (requireCodeSigning && !(await exists(desktopInstaller))) throw new Error(`Public release artifact is missing ${desktopInstallerRelative}.`);

  const sourceExtract = path.join(temp, "source");
  await extract(sourceArchive, sourceExtract);
  const source = await onlyDirectory(sourceExtract);
  const sourceVersions = JSON.parse(await readFile(await requirePath(source, "config/toolchain-versions.json"), "utf8"));
  if (sourceVersions.cluster !== pkg.version) throw new Error("Canonical source archive has version drift.");
  for (const gitScaffold of [".github", ".git", ".gitignore", ".gitattributes", ".gitmodules"]) {
    if (await exists(path.join(source, gitScaffold))) throw new Error(`Canonical source archive contains Git scaffolding: ${gitScaffold}.`);
  }
  await requirePath(source, "tools/scripts/release-preflight.mjs");
  await requirePath(source, "tools/scripts/release-verify-artifacts.mjs");
  await requirePath(source, "tools/scripts/legal-roadmap-evidence.mjs");
  await requirePath(source, "tools/scripts/production-readiness-phase18.mjs");
  await requirePath(source, "tools/scripts/production-ux-gate-phase18.mjs");
  await requirePath(source, "tools/scripts/performance-ci-phase18.mjs");
  await requirePath(source, "docs/LEGAL_PRIVACY_ACCESSIBILITY_RELEASE_READINESS.md");
  await requirePath(source, "docs/PRODUCTION_UX_GATE_PHASE18.md");

  const windowsExtract = path.join(temp, "windows");
  await extract(windowsArchive, windowsExtract);
  const windows = await onlyDirectory(windowsExtract);
  const windowsRelease = JSON.parse(await readFile(await requirePath(windows, "CLUSTER_RELEASE.json"), "utf8"));
  if (windowsRelease.clusterVersion !== pkg.version) throw new Error("Windows server release metadata version drift.");
  const windowsServerExe = await requirePath(windows, "ClusterServer.exe");
  const windowsHostExe = await requirePath(windows, "bin/cluster-host.exe");
  await assertMagic(windowsServerExe, [0x4d, 0x5a], "ClusterServer.exe");
  await assertMagic(windowsHostExe, [0x4d, 0x5a], "cluster-host.exe");
  await assertAuthenticode(windowsServerExe, "ClusterServer.exe");
  await assertAuthenticode(windowsHostExe, "cluster-host.exe");
  await requirePath(windows, "apps/server/prisma/migrations");
  if (requirePrebuilt || windowsRelease.prebuilt?.server || windowsRelease.prebuilt?.web) {
    await requirePath(windows, "apps/server/dist/index.js");
    await requirePath(windows, "apps/web/dist/index.html");
    await requirePath(windows, "packages/shared/dist/index.js");
    if (requirePrebuilt) {
      const windowsLockPath = await requirePath(windows, "package-lock.json");
      const windowsLock = JSON.parse(await readFile(windowsLockPath, "utf8"));
      if (windowsLock.packages?.[""]?.version !== pkg.version) throw new Error("Windows runtime lock version drift.");
      if (!windowsRelease.dependencyLock) throw new Error("Windows certified server metadata does not declare a runtime dependency lock.");
      if (!windowsRelease.runtimeDependencyLockSha256 || windowsRelease.runtimeDependencyLockSha256 !== await sha256(windowsLockPath)) throw new Error("Windows runtime dependency lock hash mismatch.");
    }
  }

  const linuxExtract = path.join(temp, "linux");
  await extract(linuxArchive, linuxExtract);
  const linux = await onlyDirectory(linuxExtract);
  const linuxRelease = JSON.parse(await readFile(await requirePath(linux, "CLUSTER_RELEASE.json"), "utf8"));
  if (linuxRelease.clusterVersion !== pkg.version) throw new Error("Linux server release metadata version drift.");
  await assertMagic(await requirePath(linux, "cluster-server"), [0x7f, 0x45, 0x4c, 0x46], "cluster-server");
  await assertMagic(await requirePath(linux, "bin/cluster-host"), [0x7f, 0x45, 0x4c, 0x46], "cluster-host");
  if (requirePrebuilt || linuxRelease.prebuilt?.server || linuxRelease.prebuilt?.web) {
    await requirePath(linux, "apps/server/dist/index.js");
    await requirePath(linux, "apps/web/dist/index.html");
    await requirePath(linux, "packages/shared/dist/index.js");
    if (requirePrebuilt) {
      const linuxLockPath = await requirePath(linux, "package-lock.json");
      const linuxLock = JSON.parse(await readFile(linuxLockPath, "utf8"));
      if (linuxLock.packages?.[""]?.version !== pkg.version) throw new Error("Linux runtime lock version drift.");
      if (!linuxRelease.dependencyLock) throw new Error("Linux certified server metadata does not declare a runtime dependency lock.");
      if (!linuxRelease.runtimeDependencyLockSha256 || linuxRelease.runtimeDependencyLockSha256 !== await sha256(linuxLockPath)) throw new Error("Linux runtime dependency lock hash mismatch.");
      if (windowsRelease.runtimeDependencyLockSha256 !== linuxRelease.runtimeDependencyLockSha256) throw new Error("Windows/Linux runtime dependency locks are not identical.");
    }
  }

  const desktopExtract = path.join(temp, "desktop");
  await extract(desktopArchive, desktopExtract);
  const desktop = await onlyDirectory(desktopExtract);
  await requirePath(desktop, "apps/desktop-qt/CMakeLists.txt");
  await requirePath(desktop, "apps/desktop-qt/qml/pages/SharedRendererPage.qml");
  await requirePath(desktop, "tools/scripts/desktop-smoke.mjs");
  const desktopPkg = JSON.parse(await readFile(await requirePath(desktop, "package.json"), "utf8"));
  if (desktopPkg.version !== pkg.version) throw new Error("Desktop build kit version drift.");

  if (await exists(desktopRuntimeArchive)) {
    const desktopRuntimeExtract = path.join(temp, "desktop-runtime");
    await extract(desktopRuntimeArchive, desktopRuntimeExtract);
    const desktopExe = await requirePath(desktopRuntimeExtract, "bin/Cluster.exe");
    const updateHelperExe = await requirePath(desktopRuntimeExtract, "bin/cluster-update-helper.exe");
    await assertMagic(desktopExe, [0x4d, 0x5a], "desktop bin/Cluster.exe");
    await assertMagic(updateHelperExe, [0x4d, 0x5a], "desktop update helper");
    await assertAuthenticode(desktopExe, "desktop bin/Cluster.exe");
    await assertAuthenticode(updateHelperExe, "desktop update helper");
  }
  if (await exists(desktopInstaller)) {
    await assertMagic(desktopInstaller, [0x4d, 0x5a], "desktop installer");
    await assertAuthenticode(desktopInstaller, "desktop installer");
  }

  console.log(`Cluster v${pkg.version} release artifact verification passed.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}

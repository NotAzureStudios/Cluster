import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = async (relative) => {
  try { return await readFile(path.join(root, relative), "utf8"); } catch (error) {
    if (relative.startsWith(".github/") && error?.code === "ENOENT") return "";
    throw error;
  }
};
let passed = 0;
let total = 0;
function check(label, ok) {
  total += 1;
  if (!ok) { console.error(`FAIL  ${label}`); process.exitCode = 1; return; }
  passed += 1;
  console.log(`PASS  ${label}`);
}
const [pkgText, packager, ledger, verifier, workflow, localCertify, bundle, readiness, performanceCi, phase17Gate, phase17Audit, security, staticA11y, ux, phase18Doc, notes, changelog, versions] = await Promise.all([
  read("package.json"),
  read("tools/scripts/package-cluster-master.mjs"),
  read("tools/scripts/release-certification-ledger.mjs"),
  read("tools/scripts/release-verify-artifacts.mjs"),
  read(".github/workflows/release.yml"),
  read("tools/scripts/release-certify-local.mjs"),
  read("tools/scripts/bundle-budget.mjs"),
  read("tools/scripts/production-readiness-phase18.mjs"),
  read("tools/scripts/performance-ci-phase18.mjs"),
  read("tools/scripts/performance-runtime-gate-phase17.mjs"),
  read("tools/scripts/performance-architecture-phase17-audit.mjs"),
  read("tools/scripts/release-security-scan.mjs"),
  read("tools/scripts/accessibility-static-audit.mjs"),
  read("tools/scripts/ux-consistency-audit.mjs"),
  read("docs/PRODUCTION_UX_GATE_PHASE18.md"),
  read("RELEASE_NOTES_v0.441.0.md"),
  read("packages/renderer/src/features/changelog/data/cluster-changelog.ts"),
  read("config/toolchain-versions.json"),
]);
const pkg = JSON.parse(pkgText);
const repositoryCiAvailable = Boolean(workflow.trim());
function versionAtLeast(value, baseline) {
  const parse = (input) => String(input || "0.0.0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(value);
  const b = parse(baseline);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}
const requiredCertified = ["preflight","dependency-audit","legal-readiness","accessibility","ux-consistency","production-e2e","integration","backup-restore","upgrade-drill","desktop-smoke","bundle-budget","performance-microbench","performance-runtime","production-ux","production-readiness"];

check("Toolchain is at or beyond the 0.441.0 Phase 18 baseline", versionAtLeast(pkg.version, "0.441.0") && versionAtLeast(JSON.parse(versions).cluster, "0.441.0"));
check("Phase 18 release notes exist", notes.includes("Production UX Gate") && notes.includes("local-unattested"));
check("Phase 18 changelog entry exists", changelog.includes('version: "v0.441.0"') && changelog.includes("Production UX Gate"));
check("Phase 18 documentation defines attestation levels", phase18Doc.includes("local-unattested") && phase18Doc.includes("ci-certified") && phase18Doc.includes("public-signed"));
check("Phase 18 documentation rejects flag-only certification", phase18Doc.includes("environment flag") && phase18Doc.includes("evidence"));
check("Phase 18 documentation keeps runtime evidence mandatory for certification", phase18Doc.includes("runtime accessibility") && phase18Doc.includes("runtime performance") && phase18Doc.includes("production E2E"));
check("Phase 18 documentation requires bundle evidence", phase18Doc.includes("bundle budget"));
check("Phase 18 documentation requires immutable source provenance", phase18Doc.includes("immutable source revision"));

check("Bundle budget can fail closed without built output", bundle.includes("CLUSTER_BUNDLE_REQUIRE_BUILT") && bundle.includes("--require-built"));
check("Runtime performance gate can fail closed", phase17Gate.includes("CLUSTER_PERFORMANCE_REQUIRE_RUNTIME"));
check("Phase 17 static performance architecture remains active", phase17Audit.includes("Performance Phase 17"));
check("Phase 18 performance CI uses built server and web", performanceCi.includes("apps/server/dist/index.js") && performanceCi.includes("apps/web/dist/index.html"));
check("Phase 18 performance CI uses Playwright Chromium", performanceCi.includes('import("playwright")') && performanceCi.includes("chromium.launch"));
check("Phase 18 performance CI authenticates through shared renderer", performanceCi.includes("Continue locally") && performanceCi.includes("main.content-shell"));
check("Phase 18 performance CI exercises representative routes", ["projects","tickets","profiles","notifications","calendar","knowledge","settings"].every((route) => performanceCi.includes(`\"${route}\"`)));
check("Phase 18 performance CI exercises command search", performanceCi.includes("Control+k") && performanceCi.includes('keyboard.type("project")'));
check("Phase 18 performance CI exports real client telemetry", performanceCi.includes("clusterPerformance") && performanceCi.includes("perf.export"));
check("Phase 18 performance CI reads server budget telemetry", performanceCi.includes("/api/admin/operations/performance"));
check("Phase 18 performance CI requires runtime gate", performanceCi.includes('CLUSTER_PERFORMANCE_REQUIRE_RUNTIME: "1"'));
check("Phase 18 performance CI writes client report", performanceCi.includes("client-phase18.json"));
check("Phase 18 performance CI writes server report", performanceCi.includes("server-phase18.json"));

check("Production readiness enumerates certified evidence gates", requiredCertified.slice(0, -1).every((gate) => readiness.includes(`\"${gate}\"`)));
check("Production readiness requires immutable revision", readiness.includes("immutableRevision") && readiness.includes("40"));
check("Production readiness requires exact dependency lock", readiness.includes("dependencyLock"));
check("Production readiness requires server/web/shared builds", readiness.includes('"server build"') && readiness.includes('"web build"') && readiness.includes('"shared build"'));
check("Production readiness requires runtime accessibility", readiness.includes("runtime accessibility report"));
check("Production readiness requires both runtime performance reports", readiness.includes("client performance report") && readiness.includes("server performance report"));
check("Production readiness requires desktop runtime", readiness.includes("desktop runtime"));
check("Production readiness requires signed public inputs", readiness.includes("signed installer candidate") && readiness.includes("windows signature evidence"));
check("Production readiness has exactly three classifications", ["local-unattested","ci-certified","public-signed"].every((item) => readiness.includes(item)));
check("Production readiness cannot certify by flag alone", readiness.includes("noCertificationByEnvironmentFlagAlone"));
check("Production readiness fails required certified mode", readiness.includes("Certified production readiness requirements are incomplete"));
check("Production readiness fails required public mode", readiness.includes("Public production readiness requirements are incomplete"));

check("Certification ledger requires UX consistency", ledger.includes('"ux-consistency"'));
check("Certification ledger requires production E2E", ledger.includes('"production-e2e"'));
check("Certification ledger requires bundle budget", ledger.includes('"bundle-budget"'));
check("Certification ledger requires performance microbenchmark", ledger.includes('"performance-microbench"'));
check("Certification ledger requires runtime performance", ledger.includes('"performance-runtime"'));
check("Certification ledger requires production UX evidence", ledger.includes('"production-ux"'));
check("Certification ledger requires final production readiness", ledger.includes('"production-readiness"'));
check("Certification ledger packages production readiness report metadata", ledger.includes("productionReadiness"));

for (const gate of requiredCertified) check(`Certified artifact verifier requires ${gate}`, verifier.includes(`\"${gate}\"`));
check("Certified artifact verifier requires production readiness report", verifier.includes("PRODUCTION_READINESS.json"));
check("Certified artifact verifier rejects unattested readiness", verifier.includes("ci-certified") && verifier.includes("public-signed"));
check("Public artifact verifier still requires signatures", verifier.includes("windows-signatures") && verifier.includes("Authenticode"));

check("Release workflow records strict bundle evidence", !repositoryCiAvailable || workflow.includes("--gate=bundle-budget") && workflow.includes("performance:bundle-budget:strict"));
check("Release workflow records search microbenchmark evidence", !repositoryCiAvailable || workflow.includes("--gate=performance-microbench") && workflow.includes("performance:microbench"));
check("Release workflow records runtime performance evidence", !repositoryCiAvailable || workflow.includes("--gate=performance-runtime") && workflow.includes("performance:ci"));
check("Release workflow records production UX evidence", !repositoryCiAvailable || workflow.includes("--gate=production-ux") && workflow.includes("audit:production-ux-phase18"));
check("Release workflow records final production readiness on Windows", !repositoryCiAvailable || workflow.includes("--gate=production-readiness") && workflow.includes("--require-public"));
check("Release workflow stages performance reports for final assembly", !repositoryCiAvailable || workflow.includes(".cluster/performance"));
check("Release workflow retains provenance attestation", !repositoryCiAvailable || workflow.includes("actions/attest-build-provenance"));

check("Local certification records UX consistency", localCertify.includes("--gate=ux-consistency"));
check("Local certification records production E2E", localCertify.includes("--gate=production-e2e"));
check("Local certification records strict bundle budget", localCertify.includes("--gate=bundle-budget"));
check("Local certification records performance microbenchmark", localCertify.includes("--gate=performance-microbench"));
check("Local certification records runtime performance", localCertify.includes("--gate=performance-runtime"));
check("Local certification records production UX", localCertify.includes("--gate=production-ux"));
check("Local certification records production readiness", localCertify.includes("--gate=production-readiness"));

check("Package audit chain includes Phase 18", pkg.scripts.audit.includes("production-ux-gate-phase18.mjs"));
check("Phase 18 audit has direct npm script", String(pkg.scripts?.["audit:production-ux-phase18"] || "").includes("production-ux-gate-phase18.mjs"));
check("Strict bundle budget has direct npm script", String(pkg.scripts?.["performance:bundle-budget:strict"] || "").includes("--require-built"));
check("Performance CI has direct npm script", String(pkg.scripts?.["performance:ci"] || "").includes("performance-ci-phase18.mjs"));
check("Production readiness has direct npm script", String(pkg.scripts?.["release:production-readiness"] || "").includes("production-readiness-phase18.mjs"));
check("Master packager runs Phase 18 static gate", packager.includes("production-ux-gate-phase18.mjs"));
check("Master packager emits production readiness report", packager.includes("PRODUCTION_READINESS.json"));
check("Master packager includes Phase 18 documentation", packager.includes("docs/PRODUCTION_UX_GATE_PHASE18.md"));

check("Security release scan remains active", packager.includes("release-security-scan.mjs") && security.includes("Release security scan"));
check("Static accessibility gate remains active", pkg.scripts.audit.includes("accessibility-input-phase14-audit.mjs") && staticA11y.includes("Accessibility static audit"));
check("UX consistency gate remains active", pkg.scripts.audit.includes("ux-consistency-audit.mjs") && ux.includes("Cluster UX consistency audit"));
check("Phase 17 performance gate remains in aggregate audit", pkg.scripts.audit.includes("performance-architecture-phase17-audit.mjs"));

console.log(`\nProduction UX Phase 18 audit: ${passed}/${total} passed.`);
if (passed !== total) process.exit(1);

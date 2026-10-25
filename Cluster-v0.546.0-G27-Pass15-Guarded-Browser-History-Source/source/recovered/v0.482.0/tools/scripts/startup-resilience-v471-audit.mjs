import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const pkg = JSON.parse(read("package.json"));
const launcher = read("apps/server-launcher-go/main.go");
const runtime = read("apps/server-launcher-go/runtime_windows.go");
const ui = read("apps/server-launcher-go/launcher_ui_windows.go");
const diagnostics = read("apps/server/src/core/database-diagnostics.ts");
const tests = read("apps/server-launcher-go/main_test.go");
const changelog = read("packages/renderer/src/features/changelog/data/cluster-changelog.ts");
const packager = read("tools/scripts/package-cluster-master.mjs");
const notes = read("RELEASE_NOTES_v0.471.0.md");

const versionParts = String(pkg.version || "0.0.0").split(".").map((part) => Number(part) || 0);
const atLeastV471 = versionParts[0] > 0 || versionParts[1] > 471 || (versionParts[1] === 471 && versionParts[2] >= 0);

const checks = [
  ["v0.471 startup resilience contract is active", atLeastV471],
  ["dependency fingerprint is manifest-section based", launcher.includes("type dependencyManifestFingerprint struct") && launcher.includes("dependencyManifestPaths()")],
  ["product version is excluded from dependency fingerprint", launcher.includes("Dependency readiness must be driven by the dependency graph") && !launcher.includes('filepath.Join("config", "toolchain-versions.json")')],
  ["private Node runtime participates in dependency fingerprint", launcher.includes('hash.Write([]byte("node-runtime"))') && launcher.includes("privateNodeVersion")],
  ["healthy installed dependencies migrate without npm reinstall", launcher.includes("installedDependencyGraphHealthy(root)") && launcher.includes("skipping redundant install")],
  ["installed packages are validated against pinned direct versions", launcher.includes("installedPackageVersion") && launcher.includes("installed != expected")],
  ["dependency fingerprint version invariance has a Go regression test", tests.includes("TestDependencyFingerprintIgnoresProductVersion")],
  ["installed dependency validation has a Go regression test", tests.includes("TestInstalledDependencyGraphHealthyValidatesPinnedPackages")],
  ["Windows Node runtime verifies its actual version before reuse", runtime.includes('exec.Command(node, "--version")') && runtime.includes('"v"+privateNodeVersion')],
  ["optional pg_stat_statements is probed before querying", diagnostics.includes("FROM pg_extension WHERE extname = 'pg_stat_statements'") && diagnostics.includes("if (!Boolean((extensionRows as any[])?.[0]?.available)) return []")],
  ["startup failure stage is persisted", ui.includes("last-startup-failure.log") && ui.includes("Startup failure summary")],
  ["startup failure status includes the active stage", ui.includes('message := fmt.Sprintf("%s failed: %v", stage, err)')],
  ["v0.471 release is documented", changelog.includes('version: "v0.471.0"') && notes.includes("Startup resilience")],
  ["v0.471 startup audit participates in master packaging", packager.includes("startup-resilience-v471-audit.mjs")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}
console.log(`Startup resilience v0.471: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);

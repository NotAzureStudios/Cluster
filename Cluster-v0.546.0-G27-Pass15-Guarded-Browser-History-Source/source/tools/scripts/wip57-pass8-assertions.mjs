import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));

const toolchain = json("config/toolchain-versions.json");
const pkg = json("package.json");
const goMod = read("apps/workstation-go/go.mod");
const workstation = read("apps/workstation-go/main.go");
const workstationTests = read("apps/workstation-go/main_test.go");
const workstationBuild = read("tools/scripts/build-workstation-service.mjs");
const workstationVerify = read("tools/scripts/verify-workstation-helper.mjs");
const runtimeVerify = read("tools/scripts/verify-desktop-git-runtime.mjs");
const cmake = read("apps/desktop-qt/CMakeLists.txt");
const qtHeader = read("apps/desktop-qt/src/WorkstationServiceManager.h");
const qt = read("apps/desktop-qt/src/WorkstationServiceManager.cpp");
const desktopSetup = read("tools/scripts/desktop-setup.mjs");
const desktopBuild = read("tools/scripts/build-qt-desktop.mjs");
const runtimeReadme = read("bin/runtime/README.md");

const checks = [
  ["Go official source floor is pinned to 1.27.1", toolchain.go?.minimum === "1.27.1" && /^go 1\.27\.1$/m.test(goMod)],
  ["Go recommended toolchain is 1.27.1", toolchain.go?.recommended === "1.27.1"],
  ["Private Git source baseline is pinned", toolchain.git?.version === "2.56.0" && toolchain.git?.provider === "git-for-windows"],
  ["Private Git LFS source baseline is pinned", toolchain.gitLfs?.version === "3.8.0"],
  ["Workstation build emits integrity manifest", workstationBuild.includes("cluster-workstation-service.manifest.json") && workstationBuild.includes('createHash("sha256")')],
  ["Workstation manifest records Cluster version, protocol and Go toolchain", workstationBuild.includes("clusterVersion") && workstationBuild.includes("protocol") && workstationBuild.includes("toolchain: version.raw")],
  ["Standalone Workstation verifier checks size and SHA-256", workstationVerify.includes("artifact size mismatch") && workstationVerify.includes("SHA-256 mismatch")],
  ["Desktop package verifies Workstation helper before packaging", pkg.scripts?.["desktop:reconstruction:package"]?.includes("verify-workstation-helper.mjs")],
  ["Qt Desktop carries separate current runtime version while source version hold remains", cmake.includes('project(ClusterDesktop VERSION 0.482.0') && cmake.includes(`CLUSTER_RUNTIME_VERSION "${JSON.parse(fs.readFileSync("package.json", "utf8")).version}"`)],
  ["Qt Desktop compiles the Workstation protocol from one definition", cmake.includes("CLUSTER_WORKSTATION_PROTOCOL=${CLUSTER_WORKSTATION_PROTOCOL}") && qtHeader.includes("return CLUSTER_WORKSTATION_PROTOCOL")],
  ["CMake refuses helper manifest version drift", cmake.includes("CLUSTER_WORKSTATION_MANIFEST_VERSION") && cmake.includes("does not match Cluster runtime")],
  ["CMake refuses helper protocol drift", cmake.includes("CLUSTER_WORKSTATION_MANIFEST_PROTOCOL") && cmake.includes("does not match Desktop protocol")],
  ["Qt verifies helper SHA-256 before launch", qt.includes("helperIntegrityValid") && qt.includes("QCryptographicHash::Sha256") && qt.includes("failed SHA-256 integrity verification")],
  ["Qt rejects mismatched discovery helper versions", qt.includes("state.version != expectedVersion()")],
  ["Qt health-probes stale discovery before reuse", qt.includes("probeDiscovery(existing, HealthProbeTimeoutMs)") && qt.includes('QStringLiteral("/health")')],
  ["Workstation health publishes schema/protocol/version", workstation.includes('"schema": 1') && workstation.includes('"protocol": serviceProtocol') && workstationTests.includes("TestHealthIncludesVersionAndProtocol")],
  ["Workstation has deterministic version CLI", workstation.includes('os.Args[1] == "--version"') && workstation.includes("cluster-workstation-service %s protocol %d")],
  ["Workstation prefers private bundled Git runtime", workstation.includes("bundledGitRuntime") && workstation.includes('Kind: "bundled"')],
  ["System Git is only fallback after bundled runtime resolution", workstation.indexOf("bundledGitRuntime(filepath.Dir(executable))") < workstation.indexOf('exec.LookPath("git")')],
  ["Workstation can explicitly override Git for development/recovery", workstation.includes("CLUSTER_GIT_BIN") && workstation.includes("CLUSTER_GIT_LFS_BIN_DIR")],
  ["Workstation reports Git runtime provenance without exposing raw executable", workstation.includes('"gitRuntime": runtimeInfo.Kind') && workstation.includes('"bundledGitLfs"')],
  ["Bundled Git runtime layout is unit-tested", workstationTests.includes("TestBundledGitRuntimePreferredLayout")],
  ["Explicit Git override is unit-tested", workstationTests.includes("TestResolveGitRuntimeHonorsExplicitOverride")],
  ["Release package requires private Git runtime on Windows", cmake.includes("CLUSTER_REQUIRE_PRIVATE_GIT_RUNTIME") && desktopBuild.includes("-DCLUSTER_REQUIRE_PRIVATE_GIT_RUNTIME=ON")],
  ["Private Git runtime verifier checks both pinned tools", runtimeVerify.includes("versions.git.version") && runtimeVerify.includes("versions.gitLfs.version")],
  ["Desktop package wires private Git runtime verification", pkg.scripts?.["desktop:reconstruction:package"]?.includes("verify-desktop-git-runtime.mjs")],
  ["Qt setup no longer requires unused Multimedia/Pdf modules", !desktopSetup.includes('"Multimedia"') && !desktopSetup.includes('"Pdf"')],
  ["Private Git runtime layout is documented", runtimeReadme.includes("bin/runtime/") && runtimeReadme.includes('gitRuntime: "bundled"')],
  ["Pass 8 remains wired into source-foundation gate", pkg.scripts?.["verify:source-foundation"]?.includes("wip57:pass8:assertions")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} WIP57 Pass 8 assertions passed.`);
if (failed.length) process.exit(1);

import { spawnPortableSync } from "./command-invocation.mjs";
import path from "node:path";

const root = process.cwd();
const publicRelease = process.env.CLUSTER_RELEASE_PUBLIC === "1";

function run(command, args, env = {}) {
  const result = spawnPortableSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
    windowsHide: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status ?? "unknown"}.`);
}

if (process.platform !== "win32") {
  throw new Error("Full local release certification must run on Windows because the final Cluster Master requires a smoke-tested Windows desktop runtime.");
}
if (!/^postgres(?:ql)?:\/\//i.test(String(process.env.DATABASE_URL || ""))) {
  throw new Error("Full local release certification requires DATABASE_URL pointing at a disposable PostgreSQL database.");
}
if (!/^postgres(?:ql)?:\/\//i.test(String(process.env.POSTGRES_RESTORE_DATABASE_URL || ""))) {
  throw new Error("Full local release certification requires POSTGRES_RESTORE_DATABASE_URL pointing at a second disposable restore database.");
}
if (!String(process.env.CLUSTER_PREVIOUS_RELEASE_REF || "").trim()) {
  throw new Error("Full local release certification requires CLUSTER_PREVIOUS_RELEASE_REF for the database upgrade drill.");
}

console.log("Running full Cluster local release certification...");
run(process.execPath, [path.join("tools", "scripts", "release-preflight.mjs"), "--with-database", "--with-build", "--with-native", "--allow-dirty"]);
run(process.execPath, [path.join("tools", "scripts", "release-evidence.mjs"), "run", "--gate=dependency-audit", "--", "npm", "audit", "--audit-level=high"]);
run(process.execPath, [path.join("tools", "scripts", "release-evidence.mjs"), "run", "--gate=accessibility", "--", "npm", "run", "accessibility:ci"]);
run(process.execPath, [path.join("tools", "scripts", "release-evidence.mjs"), "run", "--gate=ux-consistency", "--", "npm", "run", "audit:ux-consistency"]);
run(process.execPath, [path.join("tools", "scripts", "release-evidence.mjs"), "run", "--gate=production-e2e", "--", "npm", "run", "e2e:ci"]);
run(process.execPath, [path.join("tools", "scripts", "release-evidence.mjs"), "run", "--gate=bundle-budget", "--", "npm", "run", "performance:bundle-budget:strict"]);
run(process.execPath, [path.join("tools", "scripts", "release-evidence.mjs"), "run", "--gate=performance-microbench", "--", "npm", "run", "performance:microbench"]);
run(process.execPath, [path.join("tools", "scripts", "release-evidence.mjs"), "run", "--gate=performance-runtime", "--", "npm", "run", "performance:ci"]);
run(process.execPath, [path.join("tools", "scripts", "release-evidence.mjs"), "run", "--gate=production-ux", "--", "npm", "run", "audit:production-ux-phase18"]);
run(process.execPath, [path.join("tools", "scripts", "release-evidence.mjs"), "run", "--gate=integration", "--", "npm", "run", "test:integration"]);
run(process.execPath, [path.join("tools", "scripts", "release-evidence.mjs"), "run", "--gate=backup-restore", "--", "npm", "run", "db:backup:drill"]);
run(process.execPath, [path.join("tools", "scripts", "release-evidence.mjs"), "run", "--gate=upgrade-drill", "--", process.execPath, path.join("tools", "scripts", "release-upgrade-drill.mjs"), `--previous-ref=${process.env.CLUSTER_PREVIOUS_RELEASE_REF}`]);
run("npm", ["run", "desktop:package"]);
if (publicRelease) {
  run("npm", ["run", "release:sign-windows"]);
}
run(process.execPath, [path.join("tools", "scripts", "release-evidence.mjs"), "run", "--gate=desktop-smoke", "--", "npm", "run", "desktop:smoke"]);
run(process.execPath, [path.join("tools", "scripts", "release-evidence.mjs"), "run", "--gate=production-readiness", "--", process.execPath, path.join("tools", "scripts", "production-readiness-phase18.mjs"), "--require-certified", ...(publicRelease ? ["--require-public"] : [])]);
if (publicRelease) {
  run(process.execPath, [path.join("tools", "scripts", "package-qt-installer.mjs"), "--from-existing"]);
  run("npm", ["run", "release:sign-installer"]);
  run("npm", ["run", "release:verify-windows-signatures"]);
}
const certificationEnv = {
  CLUSTER_RELEASE_CERTIFIED: "1",
  CLUSTER_RELEASE_REQUIRE_PREBUILT: "1",
  CLUSTER_RELEASE_REQUIRE_DESKTOP_PACKAGE: "1",
  CLUSTER_RELEASE_REUSE_NATIVE: publicRelease ? "1" : "0",
  ...(publicRelease ? { CLUSTER_RELEASE_PUBLIC: "1", CLUSTER_RELEASE_REQUIRE_CODE_SIGNING: "1" } : {}),
};
run(process.execPath, [path.join("tools", "scripts", "package-cluster-master.mjs")], certificationEnv);
run(process.execPath, [path.join("tools", "scripts", "release-verify-artifacts.mjs"), "--require-prebuilt", "--require-desktop-package", ...(publicRelease ? ["--require-code-signing"] : [])], certificationEnv);
console.log(`Cluster local release certification passed (${publicRelease ? "public-signed" : "ci-certified"}).`);

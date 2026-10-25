import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const previousRefArg = process.argv.find((item) => item.startsWith("--previous-ref="));
const previousRef = previousRefArg?.slice("--previous-ref=".length) || process.env.CLUSTER_PREVIOUS_RELEASE_REF || "";
const databaseUrl = String(process.env.DATABASE_URL || "").trim();
const directDatabaseUrl = String(process.env.DIRECT_DATABASE_URL || databaseUrl).trim();
if (!previousRef) throw new Error("Set --previous-ref=vX.Y.Z or CLUSTER_PREVIOUS_RELEASE_REF.");
if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) throw new Error("DATABASE_URL must point at a disposable PostgreSQL database.");

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit", windowsHide: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status}.`);
}
function npmInstallArgs(cwd) {
  const probe = spawnSync(process.execPath, ["-e", "require('fs').accessSync('package-lock.json')"], { cwd, stdio: "ignore" });
  return probe.status === 0 ? ["ci", "--no-audit", "--no-fund"] : ["install", "--no-audit", "--no-fund"];
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cluster-upgrade-drill-"));
const previousRoot = path.join(tempRoot, "previous");
const env = { ...process.env, DATABASE_URL: databaseUrl, DIRECT_DATABASE_URL: directDatabaseUrl, CLUSTER_AUTO_SEED: "false", CLUSTER_DEV_LOGIN: "false" };
try {
  console.log(`Preparing previous Cluster release ${previousRef}...`);
  run("git", ["worktree", "add", "--detach", previousRoot, previousRef], root);
  run("npm", npmInstallArgs(previousRoot), previousRoot, env);
  run("npm", ["run", "db:generate"], previousRoot, env);
  run("npm", ["run", "db:deploy"], previousRoot, env);
  console.log(`Previous release ${previousRef} database state created.`);

  console.log("Applying current Cluster migrations over the previous release database...");
  run("npm", ["run", "db:generate"], root, env);
  run("npm", ["run", "db:deploy"], root, env);
  run("npm", ["run", "db:status"], root, env);
  run("npm", ["run", "db:deploy"], root, env);
  console.log(`Upgrade drill ${previousRef} -> current passed.`);
} finally {
  spawnSync("git", ["worktree", "remove", "--force", previousRoot], { cwd: root, stdio: "ignore" });
  await rm(tempRoot, { recursive: true, force: true });
}

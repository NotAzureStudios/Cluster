import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { spawnPortableSync } from "./command-invocation.mjs";
import path from "node:path";
import { writeGateEvidence } from "./release-evidence-lib.mjs";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const withBuild = args.has("--with-build");
const withNative = args.has("--with-native");
const withDatabase = args.has("--with-database");
const allowDirty = args.has("--allow-dirty");

function run(command, commandArgs, options = {}) {
  const result = spawnPortableSync(command, commandArgs, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: options.capture ? "utf8" : undefined,
    windowsHide: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `\n${String(result.stdout || "")}${String(result.stderr || "")}` : "";
    throw new Error(`${command} ${commandArgs.join(" ")} failed with ${result.status}.${detail}`);
  }
  return result;
}

async function exists(relative) {
  try { await access(path.join(root, relative)); return true; } catch { return false; }
}

function sourceRevision() {
  if (String(process.env.GITHUB_SHA || "").trim()) return String(process.env.GITHUB_SHA).trim();
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? String(result.stdout || "").trim() : "unavailable";
}

const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const releaseNotes = `RELEASE_NOTES_v${pkg.version}.md`;
if (!(await exists(releaseNotes))) throw new Error(`Missing ${releaseNotes}. A release cannot be certified without release notes.`);

if (!allowDirty && await exists(".git")) {
  const status = run("git", ["status", "--porcelain"], { capture: true });
  if (String(status.stdout || "").trim()) throw new Error("Release preflight requires a clean Git working tree. Commit/stash changes or pass --allow-dirty for a deliberate local dry run.");
}

console.log(`Cluster v${pkg.version} release preflight`);
run(process.execPath, ["tools/scripts/toolchain-versions.mjs", "--check"]);
run(process.execPath, ["tools/scripts/source-audit.mjs"]);
run(process.execPath, ["tools/scripts/run-tests.mjs", "tools/tests/unit", "--require-tsx"]);

if (withDatabase) {
  if (!/^postgres(?:ql)?:\/\//i.test(String(process.env.DATABASE_URL || ""))) {
    throw new Error("--with-database requires DATABASE_URL pointing at a disposable PostgreSQL database.");
  }
  run(process.execPath, ["tools/scripts/database-command.mjs", "generate"]);
  run(process.execPath, ["tools/scripts/database-command.mjs", "validate"]);
  run(process.execPath, ["tools/scripts/database-command.mjs", "deploy"]);
  run(process.execPath, ["tools/scripts/database-command.mjs", "deploy"]); // migration idempotency gate
  run(process.execPath, ["tools/scripts/database-command.mjs", "status"]);
}

if (withBuild) {
  run("npm", ["run", "build:server"]);
  run("npm", ["run", "build:web"]);
}
if (withNative) run("npm", ["run", "build:native"]);

if (withDatabase && withBuild && withNative) {
  const certificationDirectory = path.join(root, ".cluster");
  await mkdir(certificationDirectory, { recursive: true });
  const evidence = {
    schema: 1,
    clusterVersion: pkg.version,
    sourceRevision: sourceRevision(),
    generatedAt: new Date().toISOString(),
    gates: { database: true, build: true, native: true, unitTests: true },
    node: process.version,
  };
  await writeFile(path.join(certificationDirectory, "release-preflight.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  await writeGateEvidence({ gate: "preflight", extra: { gates: evidence.gates, node: evidence.node } });
  console.log("Release certification evidence written to .cluster/release-preflight.json and the evidence ledger.");
}

console.log(`Cluster v${pkg.version} release preflight passed.`);

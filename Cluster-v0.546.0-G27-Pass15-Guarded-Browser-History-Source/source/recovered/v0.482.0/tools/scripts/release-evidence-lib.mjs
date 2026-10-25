import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

export function canonicalJson(value) {
  if (value === null) return "null";
  if (["boolean", "number", "string"].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error(`Unsupported evidence value type: ${typeof value}`);
}

export function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sourceRevision(root = process.cwd()) {
  const githubSha = String(process.env.GITHUB_SHA || "").trim();
  if (/^[a-f0-9]{40}$/i.test(githubSha)) return githubSha.toLowerCase();
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const revision = result.status === 0 ? String(result.stdout || "").trim() : "";
  return /^[a-f0-9]{40}$/i.test(revision) ? revision.toLowerCase() : "unavailable";
}

export async function packageVersion(root = process.cwd()) {
  return JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
}

export function evidenceDirectory(root = process.cwd()) {
  return path.join(root, ".cluster", "release-evidence");
}

export async function writeGateEvidence({ root = process.cwd(), gate, status = "passed", command = [], durationMs = 0, detail = null, extra = {} }) {
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(gate)) throw new Error(`Invalid release evidence gate: ${gate}`);
  if (!new Set(["passed", "not-applicable"]).has(status)) throw new Error(`Invalid release evidence status: ${status}`);
  const record = {
    schema: 1,
    gate,
    status,
    clusterVersion: await packageVersion(root),
    sourceRevision: sourceRevision(root),
    generatedAt: new Date().toISOString(),
    durationMs: Math.max(0, Math.round(Number(durationMs) || 0)),
    command: Array.isArray(command) ? command.map(String) : [],
    runner: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      hostname: os.hostname(),
      githubActions: process.env.GITHUB_ACTIONS === "true",
      workflow: String(process.env.GITHUB_WORKFLOW || "") || null,
      runId: String(process.env.GITHUB_RUN_ID || "") || null,
      runAttempt: String(process.env.GITHUB_RUN_ATTEMPT || "") || null,
      job: String(process.env.GITHUB_JOB || "") || null,
      ref: String(process.env.GITHUB_REF || "") || null,
    },
    detail: detail == null ? null : String(detail).slice(0, 2048),
    ...extra,
  };
  const recordHash = sha256Text(canonicalJson(record));
  const complete = { ...record, recordHash };
  const directory = evidenceDirectory(root);
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, `${gate}.json`);
  await writeFile(target, `${JSON.stringify(complete, null, 2)}\n`, { mode: 0o600 });
  return complete;
}

export function verifyGateEvidence(record, { gate, clusterVersion, sourceRevision: revision, allowNotApplicable = false } = {}) {
  if (!record || record.schema !== 1) throw new Error(`Release evidence ${gate || "record"} has an unsupported schema.`);
  if (gate && record.gate !== gate) throw new Error(`Release evidence gate ${record.gate} != ${gate}.`);
  if (clusterVersion && record.clusterVersion !== clusterVersion) throw new Error(`Release evidence ${record.gate} version ${record.clusterVersion} != ${clusterVersion}.`);
  if (revision && revision !== "unavailable" && record.sourceRevision !== revision) throw new Error(`Release evidence ${record.gate} source revision does not match.`);
  if (record.status !== "passed" && !(allowNotApplicable && record.status === "not-applicable")) {
    throw new Error(`Release evidence ${record.gate} is ${record.status}, expected passed.`);
  }
  const { recordHash, ...unsigned } = record;
  const expected = sha256Text(canonicalJson(unsigned));
  if (recordHash !== expected) throw new Error(`Release evidence ${record.gate} failed its integrity hash.`);
  return true;
}

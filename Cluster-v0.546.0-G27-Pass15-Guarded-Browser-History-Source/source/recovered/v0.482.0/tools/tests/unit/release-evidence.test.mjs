import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalJson, sha256Text, verifyGateEvidence, writeGateEvidence } from "../../scripts/release-evidence-lib.mjs";

test("release evidence canonical JSON is key-order independent", () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
});

test("release gate evidence is integrity hashed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cluster-evidence-test-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "9.9.9" }));
    const record = await writeGateEvidence({ root, gate: "integration", command: ["test"], durationMs: 42 });
    assert.equal(record.clusterVersion, "9.9.9");
    assert.equal(record.recordHash, sha256Text(canonicalJson(Object.fromEntries(Object.entries(record).filter(([key]) => key !== "recordHash")))));
    assert.equal(verifyGateEvidence(record, { gate: "integration", clusterVersion: "9.9.9" }), true);
    const stored = JSON.parse(await readFile(path.join(root, ".cluster", "release-evidence", "integration.json"), "utf8"));
    assert.equal(stored.recordHash, record.recordHash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tampered release evidence fails closed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cluster-evidence-test-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "9.9.9" }));
    const record = await writeGateEvidence({ root, gate: "backup-restore" });
    record.status = "not-applicable";
    assert.throws(() => verifyGateEvidence(record, { gate: "backup-restore", clusterVersion: "9.9.9", allowNotApplicable: true }), /integrity hash/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release evidence cannot cross source revisions", () => {
  const record = {
    schema: 1,
    gate: "upgrade-drill",
    status: "passed",
    clusterVersion: "9.9.9",
    sourceRevision: "a".repeat(40),
    generatedAt: new Date(0).toISOString(),
    durationMs: 1,
    command: [],
    runner: {},
    detail: null,
  };
  record.recordHash = sha256Text(canonicalJson(record));
  assert.throws(() => verifyGateEvidence(record, { gate: "upgrade-drill", clusterVersion: "9.9.9", sourceRevision: "b".repeat(40) }), /source revision/);
});

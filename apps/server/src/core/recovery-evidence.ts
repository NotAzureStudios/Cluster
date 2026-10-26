import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { signWithClusterSecret, verifyClusterSecretSignature } from "./setting-crypto.js";

export type RecoveryEvidence = {
  schemaVersion: 1;
  generationId: string;
  manifestFileName: string;
  updatedAt: string;
  verification?: {
    checkedAt: string;
    ok: boolean;
    schemaVersion?: number | null;
  } | null;
  restoreDrill?: {
    checkedAt: string;
    ok: boolean;
    databaseOk: boolean;
    filesystemOk: boolean;
    mismatchCount: number;
  } | null;
  signature: {
    algorithm: "hmac-sha256";
    keyId: string;
    digest: string;
  };
};

type UnsignedRecoveryEvidence = Omit<RecoveryEvidence, "signature">;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>)
      .filter((key) => key !== "signature")
      .sort()
      .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function canonicalEvidence(value: Record<string, unknown>) {
  return JSON.stringify(canonicalize(value));
}

function evidenceFileName(generationId: string) {
  const digest = crypto.createHash("sha256").update(String(generationId)).digest("hex").slice(0, 24);
  return `cluster-recovery-evidence-${digest}.json`;
}

function signedEvidence(value: UnsignedRecoveryEvidence) {
  return { ...value, signature: signWithClusterSecret("recovery-evidence-v1", canonicalEvidence(value)) } as RecoveryEvidence;
}

export async function readRecoveryEvidence(backupsRoot: string, generationId: string) {
  const filePath = path.join(path.resolve(backupsRoot), evidenceFileName(generationId));
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as RecoveryEvidence;
    if (!parsed || parsed.schemaVersion !== 1 || parsed.generationId !== generationId) return null;
    if (!verifyClusterSecretSignature("recovery-evidence-v1", canonicalEvidence(parsed as unknown as Record<string, unknown>), parsed.signature)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function recordRecoveryEvidence(input: {
  backupsRoot: string;
  generationId: string;
  manifestFileName: string;
  verification?: UnsignedRecoveryEvidence["verification"];
  restoreDrill?: UnsignedRecoveryEvidence["restoreDrill"];
}) {
  const backupsRoot = path.resolve(input.backupsRoot);
  await fs.mkdir(backupsRoot, { recursive: true });
  const existing = await readRecoveryEvidence(backupsRoot, input.generationId);
  const updated: UnsignedRecoveryEvidence = {
    schemaVersion: 1,
    generationId: input.generationId,
    manifestFileName: path.basename(input.manifestFileName),
    updatedAt: new Date().toISOString(),
    verification: input.verification !== undefined ? input.verification : existing?.verification || null,
    restoreDrill: input.restoreDrill !== undefined ? input.restoreDrill : existing?.restoreDrill || null,
  };
  const value = signedEvidence(updated);
  const filePath = path.join(backupsRoot, evidenceFileName(input.generationId));
  const temporary = `${filePath}.partial-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await fs.rename(temporary, filePath);
  await fs.chmod(filePath, 0o600).catch(() => undefined);
  return value;
}

export async function deleteRecoveryEvidence(backupsRoot: string, generationId: string) {
  await fs.rm(path.join(path.resolve(backupsRoot), evidenceFileName(generationId)), { force: true });
}

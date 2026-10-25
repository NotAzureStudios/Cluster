import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { assertRealDirectoryChain } from "../../core/storage/local-storage-provider.js";

/**
 * Retain direct-upload objects rather than invoking unfenced provider deletion.
 * This is recovery evidence, NOT authority to delete or quarantine remote bytes.
 * Reconciliation requires a provider generation fence, ownership review and
 * verified retention. Every exit that discards the database session records
 * this pointer first. A failed journal write must leave that session intact.
 */
export const DEFERRED_DIRECT_UPLOAD_JOURNAL = ".cluster-deferred-direct-uploads.jsonl";
export type DeferredDirectUploadReason = "consumed" | "aborted" | "expired" | "checksum-mismatch" | "size-mismatch" | "idempotency-replaced";

export async function recordDeferredDirectUpload(input: {
  dataRoot: string;
  session: {
    id: string;
    mode: string;
    status: string;
    storageProvider?: string | null;
    storageTier?: string | null;
    storageKey?: string | null;
    checksumSha256?: string | null;
    totalBytes?: number | bigint | null;
  };
  reason: DeferredDirectUploadReason;
}) {
  const session = input.session;
  if (session.mode !== "direct") return false;
  const id = String(session.id);
  const provider = String(session.storageProvider || "");
  const tier = String(session.storageTier || "");
  const key = String(session.storageKey || "");
  const expectedId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const match = /^uploads\/([a-zA-Z0-9_-]{1,128})\/([0-9a-f-]{36})\/([^/\\\u0000-\u001f]{1,240})$/.exec(key);
  if (!expectedId.test(id) || !match || match[2] !== id || !/^[a-zA-Z0-9_-]{1,64}$/.test(provider) || tier !== "temporary" ||
      match[3] === "." || match[3] === ".." || match[3].includes("\\")) {
    throw new Error("Direct-upload ownership pointer is invalid; preserving the session for operator recovery.");
  }
  const bytes = Number(session.totalBytes ?? 0);
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 20 * 1024 ** 3) throw new Error("Invalid deferred direct-upload size.");
  const checksum = session.checksumSha256 == null ? null : String(session.checksumSha256).toLowerCase();
  if (checksum && !/^[0-9a-f]{64}$/.test(checksum)) throw new Error("Invalid deferred direct-upload checksum.");
  const root = path.resolve(input.dataRoot);
  await assertRealDirectoryChain(root);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Deferred upload evidence root is not a real directory.");
  const journal = path.join(root, DEFERRED_DIRECT_UPLOAD_JOURNAL);
  const handle = await open(journal, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW || 0), 0o600);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) throw new Error("Direct-upload journal is not an exclusive regular file.");
    const record = {
      schemaVersion: 1,
      evidenceId: randomUUID(),
      recordedAt: new Date().toISOString(),
      uploadId: id,
      priorStatus: String(session.status),
      reason: input.reason,
      provider, tier, key,
      sizeBytes: bytes,
      checksumSha256: checksum,
      outcome: "remote-bytes-retained; deletion-not-authorized",
    };
    const buffer = Buffer.from(`${JSON.stringify(record)}\n`);
    const result = await handle.write(buffer, 0, buffer.length, null);
    if (result.bytesWritten !== buffer.length) throw new Error("Deferred direct-upload evidence write was incomplete.");
    await handle.sync();
  } finally {
    await handle.close();
  }
  // POSIX can sync the containing directory after creating the journal.
  // Windows does not reliably allow opening directories with fs.open(); the
  // journal's file handle has already been fsynced there, and disposal stays
  // disabled regardless. Actual NTFS durability remains an acceptance gate.
  if (process.platform !== "win32") {
    const rootHandle = await open(root, constants.O_RDONLY);
    try { await rootHandle.sync(); } finally { await rootHandle.close(); }
  }
  return true;
}

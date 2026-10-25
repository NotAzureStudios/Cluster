import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { assertRealDirectoryChain } from "./local-storage-provider.js";

/**
 * Durable evidence for remote backup objects that MUST NOT be unlinked until a
 * provider-generation, backup-retention and independent recovery protocol exists.
 * This journal is informational; it never grants deletion authority.
 */
export type BackupMirrorPlan = {
  provider: string;
  objects: Array<{ fileName: string; key: string }>;
};
export type DeferredMirrorReason = "failed-generation" | "manual-backup-removal" | "retention-expired";
export const DEFERRED_BACKUP_MIRROR_JOURNAL = ".cluster-deferred-backup-mirrors.jsonl";

export async function recordDeferredBackupMirrors(input: {
  backupsRoot: string;
  generationId: string;
  reason: DeferredMirrorReason;
  plan: BackupMirrorPlan | null | undefined;
}) {
  if (!input.plan) return false;
  const { provider, objects } = input.plan;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(provider) || !Array.isArray(objects) || objects.length < 1 || objects.length > 32) {
    throw new Error("Invalid deferred backup-mirror plan.");
  }
  if (!/^cluster-backup-[a-zA-Z0-9_.-]{1,180}$/.test(input.generationId)) {
    throw new Error("Invalid backup generation identity for deferred cleanup.");
  }
  const seen = new Set<string>();
  const pointers = objects.map((object) => {
    const key = String(object?.key ?? "");
    const fileName = String(object?.fileName ?? "");
    const segments = key.split("/");
    if (!key || key.length > 1024 || segments.some((part) => !part || part === "." || part === ".." || part.includes("\\") || part.includes("\0")) ||
      fileName !== path.posix.basename(fileName) || !/^[a-zA-Z0-9_.-]{1,240}$/.test(fileName) || seen.has(key)) {
      throw new Error("Invalid or duplicate remote backup-mirror pointer.");
    }
    seen.add(key);
    return { fileName, key };
  });
  const root = path.resolve(input.backupsRoot);
  await assertRealDirectoryChain(root);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Backup journal root is not a real directory.");
  const journal = path.join(root, DEFERRED_BACKUP_MIRROR_JOURNAL);
  const flags = constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (constants.O_NOFOLLOW || 0);
  const handle = await open(journal, flags, 0o600);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) throw new Error("Deferred backup-mirror journal is not an exclusive regular file.");
    const evidence = {
      schemaVersion: 1,
      eventId: randomUUID(),
      recordedAt: new Date().toISOString(),
      generationId: input.generationId,
      reason: input.reason,
      provider,
      objects: pointers,
      outcome: "remote-bytes-retained; no deletion attempted",
    };
    const bytes = Buffer.from(`${JSON.stringify(evidence)}\n`, "utf8");
    const written = await handle.write(bytes, 0, bytes.length, null);
    if (written.bytesWritten !== bytes.length) throw new Error("Deferred backup-mirror evidence was not fully written.");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return true;
}

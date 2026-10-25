import fs, { constants as fsConstants } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";

export type LibraryStoredFile = { id: string; parentId: string | null; fileName: string | null; checksumSha256?: string | null };
export type LibraryStoredFileOutcome = "already" | "normalized" | "unresolved";

type RelocationInput = {
  root: string;
  item: LibraryStoredFile;
  directory: string;
  /** Only change the pointer if the original pointer and parent are unchanged. */
  claim: (currentFileName: string, desiredFileName: string, parentId: string | null) => Promise<boolean>;
  /** Detect a different Library record already owning the proposed destination. */
  ownedByOther: (desiredFileName: string, itemId: string) => Promise<boolean>;
};

function inside(root: string, candidate: string) {
  const base = path.resolve(root);
  const value = path.resolve(candidate);
  const normalizedBase = process.platform === "win32" ? base.toLowerCase() : base;
  const normalizedValue = process.platform === "win32" ? value.toLowerCase() : value;
  return normalizedValue.startsWith(`${normalizedBase}${path.sep}`);
}

async function hashFile(filename: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * Reconcile one DB-owned file without ever replacing an existing destination.
 * The original bytes remain recoverable even after the pointer changes. This
 * is deliberate: deleting the previous copy cannot be made atomic with a DB
 * move, and another rapid move could otherwise point back at deleted bytes.
 * Orphan cleanup is a separate, audited storage-maintenance operation.
 */
export async function relocateLibraryStoredFile(input: RelocationInput): Promise<LibraryStoredFileOutcome> {
  const { item, root, claim, ownedByOther } = input;
  const originalName = String(item.fileName || "");
  if (!originalName || path.isAbsolute(originalName)) return "unresolved";
  const source = path.resolve(root, originalName);
  const targetRelative = path.join(input.directory, path.basename(originalName));
  const target = path.resolve(root, targetRelative);
  if (!inside(root, source) || !inside(root, target)) return "unresolved";
  if (source === target) return "already";
  if (await ownedByOther(targetRelative, item.id)) return "unresolved";

  // Do not traverse a user-supplied symlink out of the Library root, even if
  // the lexical path stays inside it. A symlink at the source is not a file.
  const realRoot = await fs.realpath(root).catch(() => null);
  if (!realRoot) return "unresolved";
  const sourceStat = await fs.lstat(source).catch(() => null);
  const sourceAvailable = Boolean(sourceStat?.isFile() && !sourceStat?.isSymbolicLink());
  if (sourceAvailable) {
    const realSource = await fs.realpath(source).catch(() => null);
    if (!realSource || !inside(realRoot, realSource)) return "unresolved";
  }
  await fs.mkdir(path.dirname(target), { recursive: true }).catch(() => undefined);
  const realTargetDirectory = await fs.realpath(path.dirname(target)).catch(() => null);
  if (!realTargetDirectory || !(realTargetDirectory === realRoot || inside(realRoot, realTargetDirectory))) return "unresolved";

  const targetStat = await fs.lstat(target).catch(() => null);
  if (targetStat && (!targetStat.isFile() || targetStat.isSymbolicLink())) return "unresolved";
  if (!sourceAvailable && !targetStat) return "unresolved";

  let createdByThisCall = false;
  if (sourceAvailable && !targetStat) {
    // Copy to a unique file *within the destination directory*, verify that
    // copy, then claim the final name with an exclusive hard-link. A crash
    // during copy can never leave a partial file under the canonical name.
    // Using a copy instead of a hard-link to the source also prevents future
    // edits of a leftover old path from mutating the new canonical asset.
    const temporary = path.join(path.dirname(target), `.cluster-reconcile-${randomUUID()}.tmp`);
    try {
      await fs.copyFile(source, temporary, fsConstants.COPYFILE_EXCL);
      const expected = String(item.checksumSha256 || "").toLowerCase();
      const [sourceDigest, copyDigest] = await Promise.all([hashFile(source), hashFile(temporary)]);
      if (sourceDigest !== copyDigest || (/^[0-9a-f]{64}$/.test(expected) && copyDigest !== expected)) return "unresolved";
      await fs.link(temporary, target); // Exclusive name reservation, never overwrite.
      createdByThisCall = true;
    } catch { return "unresolved"; }
    finally { await fs.unlink(temporary).catch(() => undefined); }
  } else {
    // An interrupted earlier attempt may have completed an exclusive copy.
    // Compare both paths if possible. Without a source, only a persisted
    // content digest is enough evidence to recover the old DB pointer.
    const expected = String(item.checksumSha256 || "").toLowerCase();
    if (!sourceAvailable && !/^[0-9a-f]{64}$/.test(expected)) return "unresolved";
    const targetDigest = await hashFile(target).catch(() => null);
    if (!targetDigest || (/^[0-9a-f]{64}$/.test(expected) && targetDigest !== expected)) return "unresolved";
    if (sourceAvailable && await hashFile(source).catch(() => null) !== targetDigest) return "unresolved";
  }

  try {
    if (await ownedByOther(targetRelative, item.id) || !await claim(originalName, targetRelative, item.parentId)) {
      if (createdByThisCall) await fs.unlink(target).catch(() => undefined);
      return "unresolved";
    }
  } catch {
    // A DB timeout may mean the CAS committed. Leave the duplicate in place
    // rather than deleting the now-authoritative new destination.
    return "unresolved";
  }
  // Do not delete `source`: file deletion and DB pointer changes cannot
  // share a transaction, and a concurrent move could return to that path.
  return "normalized";
}

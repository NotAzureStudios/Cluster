import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { inspectRelatedLibraryStorageAuthority } from "./library-disposition-related-authority.js";

/** R64: Read-only, intentionally fail-closed inventory of *known* Library
 * filesystem ownership. This is not a snapshot lock, quarantine authorization,
 * proof of backup expiry, or permission to remove an object. */
export const LIBRARY_OWNERSHIP_LIMITS = { candidates: 128, databaseReferences: 250_000, matchingReferences: 4_096, pageSize: 500, scanDeadlineMs: 15_000 } as const;
export type LibraryOwnershipSource = "libraryItem" | "libraryVersion" | "libraryDerivative";
type Owner = { source: LibraryOwnershipSource; id: string; itemId: string };
type Candidate = { source: LibraryOwnershipSource; id: string; raw: string; key: string | null };

// Check both Windows and POSIX grammars, including when tests run on Linux but
// the production server is Windows. Never accept an absolute external path as
// proof that an object is owned by the local Library root.
export function canonicalDispositionKey(root: string, value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\x00-\x1f\x7f]/.test(value) ||
      path.isAbsolute(value) || path.win32.isAbsolute(value) || /^[a-zA-Z]:/.test(value) || value.includes("\\")) return null;
  const pieces = value.split("/");
  if (pieces.some((part) => !part || part === "." || part === "..")) return null;
  const rel = path.posix.normalize(value);
  if (rel !== value) return null;
  const absolute = path.resolve(root, ...pieces);
  const inside = path.relative(path.resolve(root), absolute);
  if (!inside || inside === ".." || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) return null;
  return process.platform === "win32" ? rel.toLowerCase() : rel;
}

async function readLocalFile(root: string, key: string) {
  try {
    const absoluteRoot = path.resolve(root);
    const base = await fs.lstat(absoluteRoot);
    if (!base.isDirectory() || base.isSymbolicLink() || await fs.realpath(absoluteRoot) !== absoluteRoot)
      return { state: "UNSAFE_ROOT" };
    let current = absoluteRoot;
    const segments = key.split("/");
    for (let i = 0; i < segments.length; i++) {
      current = path.join(current, segments[i]);
      const st = await fs.lstat(current);
      if (st.isSymbolicLink()) return { state: "SYMLINK_OR_JUNCTION" };
      if (await fs.realpath(current) !== current) return { state: "PATH_REDIRECTED" };
      if (i < segments.length - 1 && !st.isDirectory()) return { state: "UNSAFE_PARENT" };
      if (i === segments.length - 1) {
        if (!st.isFile()) return { state: "NOT_REGULAR_FILE" };
        return { state: st.nlink > 1 ? "HARDLINKED" : "PRESENT", sizeBytes: st.size,
          modifiedAt: st.mtime.toISOString(), links: st.nlink,
          // Device/inode are diagnostic identity only; they do not fence a later write.
          identity: `${st.dev}:${st.ino}` };
      }
    }
    return { state: "UNSAFE_PATH" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "MISSING" };
    return { state: "UNREADABLE", detail: (error as Error).message.slice(0, 120) };
  }
}

/** A complete cursor walk is required. Exceeding limits throws an explicit
 * failure; an incomplete inventory must never resemble an empty ownership set. */
async function walkOwners(prisma: any, check: () => Promise<void>, consume: (source: LibraryOwnershipSource, row: any) => void) {
  let scanned = 0;
  const models: Array<{ source: LibraryOwnershipSource; field: string }> = [
    { source: "libraryItem", field: "fileName" }, { source: "libraryVersion", field: "fileName" },
    { source: "libraryDerivative", field: "storagePath" },
  ];
  for (const { source, field } of models) {
    let after: string | null = null;
    for (;;) {
      await check();
      const rows = await prisma[source].findMany({
        where: { [field]: { not: null }, ...(after ? { id: { gt: after } } : {}) },
        select: { id: true, ...(source === "libraryItem" ? {} : { itemId: true }), [field]: true }, orderBy: { id: "asc" },
        take: Math.min(LIBRARY_OWNERSHIP_LIMITS.pageSize, LIBRARY_OWNERSHIP_LIMITS.databaseReferences - scanned + 1),
      });
      if (!rows.length) break;
      scanned += rows.length;
      if (scanned > LIBRARY_OWNERSHIP_LIMITS.databaseReferences)
        throw new Error("LIBRARY_OWNERSHIP_INVENTORY_LIMIT: no complete report produced");
      for (const row of rows) consume(source, row);
      const newLast = String(rows[rows.length - 1].id);
      if (!newLast || (after !== null && newLast <= after)) throw new Error("LIBRARY_OWNERSHIP_CURSOR_STALLED");
      after = newLast;
    }
  }
  return scanned;
}

export async function inspectLibraryStorageOwnership(input: {
  prisma: any; itemId: string; libraryRoot: string; check?: () => Promise<void>;
}) {
  const { prisma, itemId, libraryRoot } = input;
  const item = await prisma.libraryItem.findUnique({ where: { id: itemId },
    select: { id: true, fileName: true, checksumSha256: true, revision: true, status: true, retentionUntil: true, legalHold: true } });
  if (!item) throw new Error("LIBRARY_NOT_FOUND");
  const startedAt = Date.now();
  const check = async () => {
    if (Date.now() - startedAt > LIBRARY_OWNERSHIP_LIMITS.scanDeadlineMs)
      throw new Error("LIBRARY_OWNERSHIP_DEADLINE: no complete report produced");
    await input.check?.();
  };
  const candidates: Candidate[] = [];
  const candidateDigests: Array<{source: string; id: string; checksum: unknown}> = [];
  const push = (source: LibraryOwnershipSource, id: string, raw: unknown) => {
    if (raw === null || raw === undefined) return;
    if (candidates.length >= LIBRARY_OWNERSHIP_LIMITS.candidates)
      throw new Error("LIBRARY_OWNERSHIP_CANDIDATE_LIMIT: no complete report produced");
    candidates.push({ source, id, raw: typeof raw === "string" ? raw : "", key: canonicalDispositionKey(libraryRoot, raw) });
  };
  push("libraryItem", item.id, item.fileName);
  if (item.fileName) candidateDigests.push({ source: "libraryItem", id: item.id, checksum: item.checksumSha256 });
  // Candidate discovery is bounded separately; do not silently truncate the
  // source revisions or derivatives (even if the current item has no file).
  for (const [model, field] of [["libraryVersion", "fileName"], ["libraryDerivative", "storagePath"]] as const) {
    const rows = await prisma[model].findMany({ where: { itemId, [field]: { not: null } }, select: { id: true, [field]: true, ...(model === "libraryVersion" ? { checksumSha256: true } : { contentChecksumSha256: true }) },
      orderBy: { id: "asc" }, take: LIBRARY_OWNERSHIP_LIMITS.candidates + 1 });
    if (rows.length > LIBRARY_OWNERSHIP_LIMITS.candidates)
      throw new Error("LIBRARY_OWNERSHIP_CANDIDATE_LIMIT: no complete report produced");
    for (const row of rows) {
      push(model, row.id, row[field]);
      if (row[field]) candidateDigests.push({ source: model, id: row.id,
        checksum: model === "libraryVersion" ? row.checksumSha256 : row.contentChecksumSha256 });
    }
  }
  const keys = new Set(candidates.map((c) => c.key).filter((key): key is string => !!key));
  const owners = new Map<string, Owner[]>();
  let matchingReferences = 0;
  for (const key of keys) owners.set(key, []);
  const scanned = keys.size ? await walkOwners(prisma, check, (source, row) => {
    const field = source === "libraryDerivative" ? "storagePath" : "fileName";
    const key = canonicalDispositionKey(libraryRoot, row[field]);
    if (key && keys.has(key)) {
      if (++matchingReferences > LIBRARY_OWNERSHIP_LIMITS.matchingReferences)
        throw new Error("LIBRARY_OWNERSHIP_MATCH_LIMIT: no complete report produced");
      owners.get(key)!.push({ source, id: row.id, itemId: source === "libraryItem" ? row.id : row.itemId });
    }
  }) : 0;
  const relatedAuthority = await inspectRelatedLibraryStorageAuthority({ prisma, itemId, content: candidateDigests, check });
  const blockers = new Set<string>(["BACKUP_RETENTION_UNVERIFIED", "PROVIDER_GENERATION_UNVERIFIED", "CONCURRENT_WRITES_UNFENCED", ...relatedAuthority.blockers]);
  const objects = [];
  for (const candidate of candidates) {
    await check();
    if (!candidate.key) { blockers.add("UNSAFE_OR_EXTERNAL_PATH"); objects.push({ source: candidate.source, id: candidate.id, storage: "unknown", state: "UNSAFE_OR_EXTERNAL_PATH" }); continue; }
    const objectOwners = owners.get(candidate.key) || [];
    if (!objectOwners.some((owner) => owner.id === candidate.id && owner.source === candidate.source)) blockers.add("SOURCE_POINTER_CHANGED_DURING_AUDIT");
    if (objectOwners.some((owner) => owner.itemId !== itemId)) blockers.add("SHARED_LIBRARY_OWNERSHIP");
    if (objectOwners.length > 1) blockers.add("MULTIPLE_RECORD_REFERENCES");
    const state = await readLocalFile(libraryRoot, candidate.key);
    if (state.state !== "PRESENT") blockers.add(`STORAGE_${state.state}`);
    objects.push({ source: candidate.source, id: candidate.id,
      // Never expose filesystem absolute paths, signed storage URLs, or credentials.
      storage: "library-local", relativeKey: candidate.key, state, owners: objectOwners });
  }
  // Recheck the *entire* selected item pointer inventory, not only its root
  // record. Revisions or derivatives can appear/disappear while the global
  // keyset inventory is running. Such evidence cannot be considered fresh.
  for (const [model, field] of [["libraryVersion", "fileName"], ["libraryDerivative", "storagePath"]] as const) {
    await check();
    const current = await prisma[model].findMany({ where: { itemId, [field]: { not: null } },
      select: { id: true, [field]: true, ...(model === "libraryVersion" ? { checksumSha256: true } : { contentChecksumSha256: true }) },
      orderBy: { id: "asc" }, take: LIBRARY_OWNERSHIP_LIMITS.candidates + 1 });
    if (current.length > LIBRARY_OWNERSHIP_LIMITS.candidates)
      throw new Error("LIBRARY_OWNERSHIP_CANDIDATE_LIMIT: no complete report produced");
    const first = candidates.filter((candidate) => candidate.source === model).map((candidate) => ({
      id: candidate.id, raw: candidate.raw,
      digest: candidateDigests.find((value) => value.source === model && value.id === candidate.id)?.checksum ?? null,
    }));
    const second = current.map((row: any) => ({ id: row.id, raw: row[field],
      digest: (model === "libraryVersion" ? row.checksumSha256 : row.contentChecksumSha256) ?? null }));
    if (JSON.stringify(first) !== JSON.stringify(second)) blockers.add("CHILD_POINTERS_CHANGED_DURING_AUDIT");
  }
  const reread = await prisma.libraryItem.findUnique({ where: { id: itemId },
    select: { id: true, fileName: true, checksumSha256: true, revision: true, status: true, retentionUntil: true, legalHold: true } });
  if (!reread || item.revision !== reread.revision || item.fileName !== reread.fileName ||
      item.status !== reread.status || item.legalHold !== reread.legalHold ||
      item.checksumSha256 !== reread.checksumSha256 ||
      String(item.retentionUntil ?? "") !== String(reread.retentionUntil ?? "")) blockers.add("ITEM_CHANGED_DURING_AUDIT");
  const proof = { itemId, revision: item.revision, status: item.status, legalHold: item.legalHold,
    retentionUntil: item.retentionUntil, objects, ownerRecordsScanned: scanned, relatedAuthority };
  return { ...proof, fingerprint: createHash("sha256").update(JSON.stringify(proof)).digest("hex"),
    blockers: [...blockers].sort(), databaseInventoryComplete: true, providerInventoryComplete: false,
    readOnly: true, quarantineAllowed: false, physicalDisposalAllowed: false,
    limitation: "Known Library pointers plus SQL evidence of checksum-related managed blobs, uploads and immutable Packet releases. External provider object generations, backups, leases, deduplication and concurrent writers remain unverified." };
}

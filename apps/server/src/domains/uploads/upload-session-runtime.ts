import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import type { ClusterDataLayout } from "../../core/data-layout.js";
import type { ClusterStorageRuntime } from "../../core/storage/storage-runtime.js";
import type { StorageLocator, StorageMultipartPart } from "../../core/storage/storage-types.js";
import { safeFileName } from "../../core/uploads.js";
import { recordEfficiencyMetric } from "../../core/efficiency-metrics.js";
import { recordDeferredDirectUpload } from "./deferred-direct-upload-journal.js";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024 * 1024;
export const MAX_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const DEFAULT_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
const DEFAULT_DIRECT_PART_BYTES = 16 * 1024 * 1024;
const MAX_UPLOAD_SESSIONS_PER_USER = 8;
const MAX_RESERVED_UPLOAD_BYTES_PER_USER = 40 * 1024 * 1024 * 1024;
const MIN_FREE_SPACE_RESERVE_BYTES = 512 * 1024 * 1024;
const UPLOAD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_SESSION_STATUSES = ["INITIALIZING", "OPEN", "PAUSED", "COMPLETED"] as const;
const RECOVERY_SESSION_STATUSES = ["FINALIZING", "ABORTING", "CLEANING", "REVIEW_REQUIRED"] as const;
/** Recovery holds remain in quota accounting even after TTL, until an
 * authorized disposition releases the remote/staged bytes and database row.
 */
function uploadCapacityWhere() {
  return { OR: [
    { status: { in: [...ACTIVE_SESSION_STATUSES] }, expiresAt: { gt: new Date() } },
    { status: { in: [...RECOVERY_SESSION_STATUSES] } },
  ] };
}

export type UploadRuntimeDependencies = {
  prisma: any;
  storageRuntime: ClusterStorageRuntime;
  dataLayout: ClusterDataLayout;
};

export type CompletedUpload = {
  metadata: {
    id: string;
    ownerId: string;
    workspaceId: string | null;
    fileName: string;
    totalBytes: number;
    receivedBytes: number;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    checksumSha256?: string;
    mode: "cluster" | "direct";
  };
  filePath: string | null;
  storage: StorageLocator | null;
  /** Verified during upload authorization; reuse for streaming headers so
   * an object-store download does not issue a second remote HEAD. */
  resourceStat?: { size: number; modifiedAt: Date };
};

function configuredUploadLimit(name: string, fallback: number, minimum: number) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? Math.max(minimum, Math.floor(value)) : fallback;
}

export function workspaceSessionLimit() {
  return configuredUploadLimit("CLUSTER_UPLOAD_WORKSPACE_SESSION_LIMIT", 32, 1);
}
export function workspaceReservedByteLimit() {
  return configuredUploadLimit("CLUSTER_UPLOAD_WORKSPACE_RESERVED_BYTES", 200 * 1024 * 1024 * 1024, MAX_UPLOAD_BYTES);
}
export function globalReservedByteLimit() {
  return configuredUploadLimit("CLUSTER_UPLOAD_GLOBAL_RESERVED_BYTES", 512 * 1024 * 1024 * 1024, MAX_UPLOAD_BYTES);
}
export function workspaceByteRateLimit() {
  return configuredUploadLimit("CLUSTER_UPLOAD_WORKSPACE_BYTES_PER_MINUTE", 8 * 1024 * 1024 * 1024, MAX_UPLOAD_CHUNK_BYTES);
}
export function directPartSize(totalBytes: number) {
  const configured = configuredUploadLimit("CLUSTER_UPLOAD_DIRECT_PART_BYTES", DEFAULT_DIRECT_PART_BYTES, 5 * 1024 * 1024);
  const minimumForPartCount = Math.ceil(Math.max(1, totalBytes) / 10_000);
  return Math.max(5 * 1024 * 1024, Math.min(workspaceByteRateLimit(), Math.max(configured, minimumForPartCount)));
}

function stagingRoot(layout: ClusterDataLayout) {
  const explicit = String(process.env.CLUSTER_UPLOAD_STAGING_ROOT || "").trim();
  if (explicit) return path.resolve(explicit);
  const sharedRoot = String(process.env.CLUSTER_STORAGE_SHARED_ROOT || "").trim();
  if (sharedRoot) return path.join(path.resolve(sharedRoot), ".cluster-upload-staging");
  return path.join(layout.runtimeRoot, "uploads");
}

function sharedFilesystemStagingConfigured() {
  return Boolean(String(process.env.CLUSTER_UPLOAD_STAGING_ROOT || "").trim() || String(process.env.CLUSTER_STORAGE_SHARED_ROOT || "").trim());
}

function localSessionDirectory(layout: ClusterDataLayout, id: string) {
  return path.join(stagingRoot(layout), id);
}
function localPartialPath(layout: ClusterDataLayout, id: string) {
  return path.join(localSessionDirectory(layout, id), "payload.cluster-part");
}
function localCompletePath(layout: ClusterDataLayout, id: string, name: string) {
  return path.join(localSessionDirectory(layout, id), safeFileName(name));
}
function localMutationLock(layout: ClusterDataLayout, id: string) {
  return path.join(localSessionDirectory(layout, id), ".mutation-lock");
}

export function uploadStagingTopology(deps: UploadRuntimeDependencies) {
  const root = stagingRoot(deps.dataLayout);
  const direct = deps.storageRuntime.directUploadTarget("upload-capability-probe");
  const sharedRoot = String(process.env.CLUSTER_STORAGE_SHARED_ROOT || "").trim();
  const explicit = String(process.env.CLUSTER_UPLOAD_STAGING_ROOT || "").trim();
  return {
    mode: direct ? "direct-object" : explicit || sharedRoot ? "shared-filesystem" : "local-filesystem",
    sharedAcrossNodes: Boolean(direct || explicit || sharedRoot),
    directMultipart: Boolean(direct),
    rootFingerprint: direct
      ? `object:${direct.provider}`
      : createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 16),
  };
}

function sessionLocator(session: any): StorageLocator | null {
  if (!session?.storageProvider || !session?.storageTier || !session?.storageKey) return null;
  return {
    provider: String(session.storageProvider),
    tier: session.storageTier,
    key: String(session.storageKey),
  } as StorageLocator;
}

async function deferDirectUpload(deps: UploadRuntimeDependencies, session: any, reason: Parameters<typeof recordDeferredDirectUpload>[0]["reason"]) {
  return recordDeferredDirectUpload({ dataRoot: deps.dataLayout.root, session, reason });
}

function sessionMetadata(session: any) {
  return {
    id: String(session.id),
    ownerId: String(session.ownerId),
    workspaceId: session.workspaceId ? String(session.workspaceId) : null,
    fileName: String(session.fileName),
    totalBytes: Number(session.totalBytes || 0),
    receivedBytes: Number(session.receivedBytes || 0),
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.updatedAt).toISOString(),
    ...(session.completedAt ? { completedAt: new Date(session.completedAt).toISOString() } : {}),
    ...(session.checksumSha256 ? { checksumSha256: String(session.checksumSha256) } : {}),
    mode: session.mode === "direct" ? "direct" as const : "cluster" as const,
    status: String(session.status),
  };
}

/**
 * A filesystem lock is advisory between processes, not a lease with a safe
 * cross-node fencing token. Never delete another process' lock based merely
 * on its age: a 20 GB checksum can legitimately run for several minutes.
 * Abandoned locks require explicit operator reconciliation of staging+DB.
 */
async function withLocalMutationLock<T>(layout: ClusterDataLayout, id: string, fn: () => Promise<T>) {
  const lock = localMutationLock(layout, id);
  try {
    await mkdir(lock);
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
    const info = await stat(lock).catch(() => null);
    throw Object.assign(new Error(info && Date.now() - info.mtimeMs > 2 * 60_000
      ? "Upload is locked by a prior operation. Reconcile staging state before manually clearing the lock."
      : "Upload session is already being modified."), {
      statusCode: 409,
      code: info && Date.now() - info.mtimeMs > 2 * 60_000 ? "UPLOAD_LOCK_RECOVERY_REQUIRED" : "UPLOAD_BUSY",
    });
  }
  try { return await fn(); }
  finally { await rm(lock, { recursive: true, force: true }).catch(() => undefined); }
}

/** No user-managed path, junction, symlink or hardlink may replace staging
 * bytes. This guard also applies to completed uploads reused by Library jobs.
 * Filesystem access remains confined to the configured, trusted staging root.
 */
async function verifyLocalUploadFile(layout: ClusterDataLayout, id: string, filePath: string) {
  const root = path.resolve(stagingRoot(layout));
  const directory = path.resolve(localSessionDirectory(layout, id));
  if (!directory.startsWith(`${root}${path.sep}`) || path.dirname(filePath) !== directory) {
    throw Object.assign(new Error("Upload staging location is invalid."), { statusCode: 409, code: "UPLOAD_STAGING_UNSAFE" });
  }
  for (const [candidate, kind] of [[root, "directory"], [directory, "directory"], [filePath, "file"]] as const) {
    const info = await lstat(candidate).catch(() => null);
    if (!info || info.isSymbolicLink() || (kind === "directory" ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)
      || await realpath(candidate).catch(() => null) !== candidate) {
      throw Object.assign(new Error("Upload staging contains an unsafe filesystem link or missing path."), { statusCode: 409, code: "UPLOAD_STAGING_UNSAFE" });
    }
  }
}

/** Database byte offsets describe durably committed data, not a pending write.
 * Remove a crash-left trailing fragment before accepting the next chunk.
 */
async function reconcileLocalCommittedOffset(filePath: string, receivedBytes: number) {
  const handle = await open(filePath, "r+");
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < receivedBytes) {
      throw Object.assign(new Error("Upload staging is shorter than its committed offset. Restart this transfer."), { statusCode: 409, code: "UPLOAD_STATE_INVALID" });
    }
    if (info.size > receivedBytes) {
      await handle.truncate(receivedBytes);
      await handle.sync();
    }
  } finally { await handle.close(); }
}

/** Node's FileHandle.write is permitted to write fewer bytes than requested. */
async function writeDurableChunk(filePath: string, offset: number, body: Buffer) {
  const handle = await open(filePath, "r+");
  try {
    let written = 0;
    while (written < body.length) {
      const result = await handle.write(body, written, body.length - written, offset + written);
      if (!Number.isInteger(result.bytesWritten) || result.bytesWritten <= 0) throw new Error("Upload write did not make forward progress.");
      written += result.bytesWritten;
    }
    await handle.sync();
  } finally { await handle.close(); }
}

async function hashReadable(stream: NodeJS.ReadableStream) {
  const hash = createHash("sha256");
  for await (const chunk of stream as any) hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return hash.digest("hex");
}

async function localFreeBytes(layout: ClusterDataLayout) {
  const root = stagingRoot(layout);
  await mkdir(root, { recursive: true });
  const fileSystem = await statfs(root);
  return Math.max(0, Number(fileSystem.bavail) * Number(fileSystem.bsize));
}

async function capacityReservation(deps: UploadRuntimeDependencies, input: {
  id: string;
  clientKey?: string | null;
  ownerId: string;
  workspaceId: string | null;
  fileName: string;
  totalBytes: number;
  mode: "cluster" | "direct";
  storage?: StorageLocator | null;
  partSize?: number | null;
}) {
  const expiresAt = new Date(Date.now() + UPLOAD_RETENTION_MS);
  return deps.prisma.$transaction(async (tx: any) => {
    await tx.uploadCapacityLock.upsert({
      where: { id: "global" },
      update: { revision: { increment: 1 } },
      create: { id: "global", revision: 1 },
    });

    const activeWhere = uploadCapacityWhere();
    const [ownerCount, ownerBytes, workspaceCount, workspaceBytes, globalBytes] = await Promise.all([
      tx.uploadSession.count({ where: { ...activeWhere, ownerId: input.ownerId } }),
      tx.uploadSession.aggregate({ where: { ...activeWhere, ownerId: input.ownerId }, _sum: { totalBytes: true } }),
      input.workspaceId ? tx.uploadSession.count({ where: { ...activeWhere, workspaceId: input.workspaceId } }) : 0,
      input.workspaceId ? tx.uploadSession.aggregate({ where: { ...activeWhere, workspaceId: input.workspaceId }, _sum: { totalBytes: true } }) : { _sum: { totalBytes: 0 } },
      tx.uploadSession.aggregate({ where: activeWhere, _sum: { totalBytes: true } }),
    ]);

    if (Number(ownerCount) >= MAX_UPLOAD_SESSIONS_PER_USER) {
      throw Object.assign(new Error(`A user can keep at most ${MAX_UPLOAD_SESSIONS_PER_USER} upload sessions.`), { statusCode: 429, code: "RATE_LIMITED" });
    }
    if (Number(ownerBytes?._sum?.totalBytes || 0) + input.totalBytes > MAX_RESERVED_UPLOAD_BYTES_PER_USER) {
      throw Object.assign(new Error("Upload staging quota exceeded."), { statusCode: 507, code: "UPLOAD_CAPACITY_EXCEEDED" });
    }
    if (input.workspaceId && Number(workspaceCount) >= workspaceSessionLimit()) {
      throw Object.assign(new Error("Workspace upload session capacity is currently full."), { statusCode: 429, code: "UPLOAD_WORKSPACE_BUSY" });
    }
    if (input.workspaceId && Number(workspaceBytes?._sum?.totalBytes || 0) + input.totalBytes > workspaceReservedByteLimit()) {
      throw Object.assign(new Error("Workspace upload staging byte budget exceeded."), { statusCode: 507, code: "UPLOAD_CAPACITY_EXCEEDED" });
    }
    if (Number(globalBytes?._sum?.totalBytes || 0) + input.totalBytes > globalReservedByteLimit()) {
      throw Object.assign(new Error("Server-wide upload staging byte budget exceeded."), { statusCode: 507, code: "UPLOAD_CAPACITY_EXCEEDED" });
    }

    return tx.uploadSession.create({
      data: {
        id: input.id,
        clientKey: input.clientKey || null,
        ownerId: input.ownerId,
        workspaceId: input.workspaceId,
        fileName: safeFileName(input.fileName),
        totalBytes: BigInt(input.totalBytes),
        receivedBytes: 0n,
        mode: input.mode,
        status: "INITIALIZING",
        storageProvider: input.storage?.provider || null,
        storageTier: input.storage?.tier || null,
        storageKey: input.storage?.key || null,
        partSize: input.partSize || null,
        expiresAt,
      },
    });
  });
}

export async function createUploadSession(deps: UploadRuntimeDependencies, input: {
  ownerId: string;
  workspaceId: string | null;
  fileName: string;
  totalBytes: number;
  contentType?: string | null;
  browserOrigin?: string | null;
  clientKey?: string | null;
}) {
  if (!Number.isInteger(input.totalBytes) || input.totalBytes < 0 || input.totalBytes > MAX_UPLOAD_BYTES) {
    throw Object.assign(new Error("Upload size is outside the supported range."), { statusCode: 413, code: "UPLOAD_TOO_LARGE" });
  }
  await pruneExpiredUploads(deps).catch(() => undefined);
  const safeName = safeFileName(input.fileName);
  const clientKey = String(input.clientKey || "").trim().slice(0, 200) || null;
  if (clientKey) {
    const existing = await deps.prisma.uploadSession.findUnique({
      where: { clientKey },
      include: { parts: { orderBy: { partNumber: "asc" } } },
    });
    if (existing) {
      const sameIntent = existing.ownerId === input.ownerId
        && (existing.workspaceId || null) === (input.workspaceId || null)
        && existing.fileName === safeName
        && Number(existing.totalBytes || 0) === input.totalBytes;
      if (!sameIntent) {
        throw Object.assign(new Error("Upload session idempotency key was reused for different content."), { statusCode: 409, code: "UPLOAD_SESSION_IDEMPOTENCY_CONFLICT" });
      }
      if (existing.status === "INITIALIZING") {
        throw Object.assign(new Error("Upload session initialization is still in progress. Retry shortly."), { statusCode: 409, code: "UPLOAD_SESSION_INITIALIZING" });
      }
      if (["OPEN", "COMPLETED"].includes(existing.status)) {
        const capability = await deps.storageRuntime.browserDirectUploadCapability(input.browserOrigin || null);
        if (existing.status === "OPEN" && existing.mode === "direct" && capability.state === "misconfigured") {
          if (!sharedFilesystemStagingConfigured()) {
            throw Object.assign(new Error(capability.detail), { statusCode: 503, code: "UPLOAD_DIRECT_CORS_MISCONFIGURED", browserUploadCapability: capability });
          }
          await abortUploadSession(deps, existing.id, input.ownerId, false);
        } else {
          return {
            session: existing,
            response: {
              ok: true,
              uploadId: existing.id,
              receivedBytes: Number(existing.receivedBytes || 0),
              chunkSize: existing.mode === "direct" ? Number(existing.partSize || DEFAULT_DIRECT_PART_BYTES) : DEFAULT_UPLOAD_CHUNK_BYTES,
              transferMode: existing.mode === "direct" ? "direct" as const : "cluster" as const,
              totalParts: existing.mode === "direct" ? Math.max(1, Math.ceil(Number(existing.totalBytes || 0) / Math.max(1, Number(existing.partSize || DEFAULT_DIRECT_PART_BYTES)))) : undefined,
              browserUploadCapability: capability,
              resumed: true,
            },
          };
        }
      } else {
        // An idempotency key binds to a single upload, even after pause,
        // quarantine or ambiguous provider completion. Never discard that
        // evidence to allow a different session to inherit its key.
        throw Object.assign(new Error("Existing upload requires resume or explicit operator recovery. Start a new transfer with a new client key."), { statusCode: 409, code: "UPLOAD_SESSION_RECOVERY_REQUIRED" });
      }
    }
  }
  const id = randomUUID();
  const directDecision = input.totalBytes > 0
    ? await deps.storageRuntime.directUploadTargetForBrowser(`uploads/${input.workspaceId || "unscoped"}/${id}/${safeName}`, input.browserOrigin || null)
    : { target: null, capability: await deps.storageRuntime.browserDirectUploadCapability(input.browserOrigin || null) };
  let direct = directDecision.target;
  if (direct && directDecision.capability.state === "misconfigured") {
    if (sharedFilesystemStagingConfigured()) direct = null;
    else {
      throw Object.assign(new Error(directDecision.capability.detail), {
        statusCode: 503,
        code: "UPLOAD_DIRECT_CORS_MISCONFIGURED",
        browserUploadCapability: directDecision.capability,
      });
    }
  }
  const partSize = direct ? directPartSize(input.totalBytes) : null;
  await capacityReservation(deps, {
    id,
    clientKey,
    ownerId: input.ownerId,
    workspaceId: input.workspaceId,
    fileName: safeName,
    totalBytes: input.totalBytes,
    mode: direct ? "direct" : "cluster",
    storage: direct,
    partSize,
  });

  let multipartUploadId: string | null = null;
  try {
    if (direct) {
      const created = await deps.storageRuntime.createMultipartUpload(direct, { contentType: input.contentType || "application/octet-stream" });
      multipartUploadId = created.uploadId;
      const session = await deps.prisma.uploadSession.update({
        where: { id },
        data: { multipartUploadId, status: "OPEN" },
        include: { parts: { orderBy: { partNumber: "asc" } } },
      });
      return {
        session,
        response: {
          ok: true,
          uploadId: id,
          receivedBytes: 0,
          chunkSize: partSize,
          transferMode: "direct" as const,
          totalParts: Math.max(1, Math.ceil(input.totalBytes / Math.max(1, partSize!))),
          browserUploadCapability: directDecision.capability,
        },
      };
    }

    if (await localFreeBytes(deps.dataLayout) < input.totalBytes + MIN_FREE_SPACE_RESERVE_BYTES) {
      throw Object.assign(new Error("Server storage cannot safely reserve this upload."), { statusCode: 507, code: "UPLOAD_CAPACITY_EXCEEDED" });
    }
    const directory = localSessionDirectory(deps.dataLayout, id);
    await mkdir(directory, { recursive: true });
    await writeFile(localPartialPath(deps.dataLayout, id), Buffer.alloc(0), { mode: 0o640 });
    const session = await deps.prisma.uploadSession.update({ where: { id }, data: { status: "OPEN" }, include: { parts: true } });
    return {
      session,
      response: { ok: true, uploadId: id, receivedBytes: 0, chunkSize: DEFAULT_UPLOAD_CHUNK_BYTES, transferMode: "cluster" as const, browserUploadCapability: directDecision.capability },
    };
  } catch (error) {
    if (direct && multipartUploadId) await deps.storageRuntime.abortMultipartUpload(direct, multipartUploadId).catch(() => undefined);
    await deps.prisma.uploadSession.delete({ where: { id } }).catch(() => undefined);
    if (!direct) {
      await rm(localSessionDirectory(deps.dataLayout, id), { recursive: true, force: true }).catch(() => undefined);
    }
    throw error;
  }
}

export async function getUploadSession(deps: UploadRuntimeDependencies, uploadId: string, ownerId: string, isAdmin = false, includeParts = true) {
  const session = await deps.prisma.uploadSession.findUnique({
    where: { id: uploadId },
    // Local buffered chunks never inspect multipart parts. Avoid loading a
    // child relation for every 4–8 MiB chunk while preserving the existing
    // fully populated session contract for status/direct multipart routes.
    ...(includeParts ? { include: { parts: { orderBy: { partNumber: "asc" } } } } : {}),
  });
  if (!session || (session.ownerId !== ownerId && !isAdmin)) return null;
  return session;
}

export function expectedPartSize(session: any, partNumber: number) {
  const partSize = Number(session.partSize || 0);
  const totalBytes = Number(session.totalBytes || 0);
  const totalParts = Math.max(1, Math.ceil(totalBytes / Math.max(1, partSize)));
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > totalParts) return null;
  if (partNumber < totalParts) return partSize;
  return Math.max(0, totalBytes - partSize * (totalParts - 1));
}

/** A provider URL is issued only after Cluster has persisted its authorization.
 * A pause/finalization after issuance still invalidates Cluster acknowledgment;
 * short-lived presigned URLs cannot be revoked by the application itself.
 */
export async function authorizeDirectPart(deps: UploadRuntimeDependencies, session: any, partNumber: number) {
  const part = await deps.prisma.$transaction(async (tx: any) => {
    await lockDirectUploadRow(tx, session.id);
    const fresh = await tx.uploadSession.findUnique({ where: { id: session.id }, include: { parts: true } });
    if (!fresh || fresh.mode !== "direct" || fresh.status !== "OPEN") throw uploadStateConflict("Upload is not accepting direct parts.");
    const sizeBytes = expectedPartSize(fresh, partNumber);
    if (sizeBytes == null) throw Object.assign(new Error("Upload part number is invalid."), { statusCode: 400, code: "UPLOAD_PART_INVALID" });
    const existing = (fresh.parts || []).find((row: any) => Number(row.partNumber) === partNumber);
    if (existing?.completedAt && existing?.etag) return { completed: true as const, partNumber, sizeBytes, etag: existing.etag };
    const storage = sessionLocator(fresh);
    if (!storage || !fresh.multipartUploadId) throw Object.assign(new Error("Direct upload storage state is incomplete."), { statusCode: 503, code: "UPLOAD_STORAGE_UNAVAILABLE" });
    await tx.uploadSessionPart.upsert({
      where: { uploadSessionId_partNumber: { uploadSessionId: fresh.id, partNumber } },
      update: { sizeBytes, authorizedAt: new Date() },
      create: { uploadSessionId: fresh.id, partNumber, sizeBytes, authorizedAt: new Date() },
    });
    return { completed: false as const, partNumber, sizeBytes, storage, uploadId: fresh.multipartUploadId };
  });
  if (part.completed) return part;
  const signed = await deps.storageRuntime.createMultipartPartUploadUrl(part.storage, part.uploadId, partNumber, 15 * 60);
  return { completed: false, partNumber, sizeBytes: part.sizeBytes, url: signed.url, expiresAt: signed.expiresAt.toISOString() };
}

function uploadStateConflict(message: string) {
  return Object.assign(new Error(message), { statusCode: 409, code: "UPLOAD_STATE_INVALID" });
}

/** PostgreSQL row lock serializes acknowledgement with pause, abort, prune,
 * and finalization claims. This operation is short: never call S3 in a DB tx.
 */
async function lockDirectUploadRow(tx: any, uploadId: string) {
  await tx.$queryRaw`SELECT "id" FROM "UploadSession" WHERE "id" = ${uploadId} FOR UPDATE`;
}

export async function acknowledgeDirectPart(deps: UploadRuntimeDependencies, session: any, input: { partNumber: number; sizeBytes: number; etag: string }) {
  const etag = String(input.etag || "").trim().replace(/^"|"$/g, "");
  if (!etag || etag.length > 256) throw Object.assign(new Error("Multipart ETag is missing or invalid."), { statusCode: 400, code: "UPLOAD_PART_ETAG_INVALID" });
  return deps.prisma.$transaction(async (tx: any) => {
    await lockDirectUploadRow(tx, session.id);
    const fresh = await tx.uploadSession.findUnique({ where: { id: session.id }, include: { parts: true } });
    if (!fresh || fresh.mode !== "direct" || fresh.status !== "OPEN") throw uploadStateConflict("Upload is not accepting direct parts.");
    const expected = expectedPartSize(fresh, input.partNumber);
    if (expected == null || expected !== input.sizeBytes) throw Object.assign(new Error("Uploaded part size does not match the expected multipart range."), { statusCode: 400, code: "UPLOAD_PART_INVALID" });
    const authorized = (fresh.parts || []).find((row: any) => Number(row.partNumber) === input.partNumber);
    if (!authorized?.authorizedAt) throw Object.assign(new Error("Upload part was not authorized by Cluster."), { statusCode: 409, code: "UPLOAD_PART_NOT_AUTHORIZED" });
    if (authorized.completedAt && authorized.etag && authorized.etag !== etag) {
      throw Object.assign(new Error("Uploaded part already has a different acknowledged ETag. Review the transfer instead of overwriting it."), { statusCode: 409, code: "UPLOAD_PART_CONFLICT" });
    }
    if (!authorized.completedAt || !authorized.etag) {
      await tx.uploadSessionPart.update({
        where: { uploadSessionId_partNumber: { uploadSessionId: fresh.id, partNumber: input.partNumber } },
        data: { sizeBytes: expected, etag, completedAt: new Date() },
      });
    }
    const aggregate = await tx.uploadSessionPart.aggregate({
      where: { uploadSessionId: fresh.id, completedAt: { not: null }, etag: { not: null } },
      _sum: { sizeBytes: true },
    });
    const receivedBytes = Number(aggregate?._sum?.sizeBytes || 0);
    if (receivedBytes > Number(fresh.totalBytes)) throw uploadStateConflict("Multipart progress exceeds declared size.");
    await tx.uploadSession.update({ where: { id: fresh.id, status: "OPEN" }, data: { receivedBytes: BigInt(receivedBytes) } });
    return { ok: true, receivedBytes };
  });
}

/** A DB claim fences all API operations while S3 has an unknown outcome.
 * FINALIZING/ABORTING/CLEANING/REVIEW_REQUIRED are deliberately not auto-retryable.
 */
async function claimUploadState(deps: UploadRuntimeDependencies, session: any, next: string, extraWhere: Record<string, unknown> = {}) {
  const changed = await deps.prisma.uploadSession.updateMany({
    where: { id: session.id, status: session.status, mode: session.mode, ...extraWhere },
    data: { status: next },
  });
  if (changed.count !== 1) throw uploadStateConflict("Upload was changed by another operation. Refresh its status before continuing.");
}

export async function appendClusterChunk(deps: UploadRuntimeDependencies, session: any, input: { start: number; end: number; total: number; body: Buffer }) {
  if (session.mode !== "cluster" || session.status !== "OPEN") throw Object.assign(new Error("Upload session is not accepting Cluster-proxied chunks."), { statusCode: 409, code: "UPLOAD_STATE_INVALID" });
  return withLocalMutationLock(deps.dataLayout, session.id, async () => {
    const fresh = await deps.prisma.uploadSession.findUnique({ where: { id: session.id } });
    if (!fresh || fresh.status !== "OPEN" || fresh.mode !== "cluster") throw Object.assign(new Error("Upload session is unavailable."), { statusCode: 409, code: "UPLOAD_STATE_INVALID" });
    const receivedBytes = Number(fresh.receivedBytes || 0);
    if (!input.body.length || input.body.length > MAX_UPLOAD_CHUNK_BYTES || !Number.isSafeInteger(input.start)
      || !Number.isSafeInteger(input.end) || !Number.isSafeInteger(input.total)
      || input.end - input.start + 1 !== input.body.length || input.total !== Number(fresh.totalBytes) || input.end >= input.total) {
      throw Object.assign(new Error("Upload chunk range is invalid."), { statusCode: 400, code: "UPLOAD_RANGE_INVALID" });
    }
    if (input.start !== receivedBytes) throw Object.assign(new Error("Upload offset conflict."), { statusCode: 409, code: "UPLOAD_OFFSET_CONFLICT", receivedBytes });
    const filePath = localPartialPath(deps.dataLayout, session.id);
    await verifyLocalUploadFile(deps.dataLayout, session.id, filePath);
    await reconcileLocalCommittedOffset(filePath, receivedBytes);
    if (await localFreeBytes(deps.dataLayout) < input.body.length + MIN_FREE_SPACE_RESERVE_BYTES) {
      throw Object.assign(new Error("Server storage is too full to accept another upload chunk."), { statusCode: 507, code: "UPLOAD_CAPACITY_EXCEEDED" });
    }
    try {
      await writeDurableChunk(filePath, input.start, input.body);
      const next = input.end + 1;
      // A conditional update is a second fence against non-participating DB
      // writers. The local lock serializes filesystem writers and finalization.
      const committed = await deps.prisma.uploadSession.updateMany({
        where: { id: session.id, status: "OPEN", mode: "cluster", receivedBytes: BigInt(receivedBytes) },
        data: { receivedBytes: BigInt(next) },
      });
      if (committed.count !== 1) throw Object.assign(new Error("Upload revision changed during chunk commit."), { statusCode: 409, code: "UPLOAD_OFFSET_CONFLICT", receivedBytes });
      return { ok: true, receivedBytes: next };
    } catch (error) {
      // The DB never owns speculative bytes. A failed rollback is surfaced as
      // an unsafe staging error; the next attempt will recheck the file length.
      await reconcileLocalCommittedOffset(filePath, receivedBytes);
      throw error;
    }
  });
}

async function changeUploadPauseState(deps: UploadRuntimeDependencies, uploadId: string, ownerId: string, isAdmin: boolean, desired: "OPEN" | "PAUSED") {
  const run = async () => {
    const session = await deps.prisma.uploadSession.findUnique({ where: { id: uploadId }, include: { parts: { orderBy: { partNumber: "asc" } } } });
    if (!session || (session.ownerId !== ownerId && !isAdmin)) return null;
    if (session.status === desired) return session;
    const expected = desired === "OPEN" ? "PAUSED" : "OPEN";
    if (session.status !== expected) throw Object.assign(new Error("Upload session cannot change pause state from its current state."), { statusCode: 409, code: "UPLOAD_STATE_INVALID" });
    try {
      return await deps.prisma.uploadSession.update({
        where: { id: uploadId, status: expected }, data: { status: desired },
        include: { parts: { orderBy: { partNumber: "asc" } } },
      });
    } catch (error: any) {
      if (error?.code === "P2025") throw Object.assign(new Error("Upload changed while updating pause state."), { statusCode: 409, code: "UPLOAD_STATE_INVALID" });
      throw error;
    }
  };
  // Cluster chunk writers and finalization share this lock with pause/resume.
  const session = await deps.prisma.uploadSession.findUnique({ where: { id: uploadId }, select: { mode: true, ownerId: true } });
  if (!session || (session.ownerId !== ownerId && !isAdmin)) return null;
  return session.mode === "cluster" ? withLocalMutationLock(deps.dataLayout, uploadId, run) : run();
}

export async function pauseUploadSession(deps: UploadRuntimeDependencies, uploadId: string, ownerId: string, isAdmin = false) {
  return changeUploadPauseState(deps, uploadId, ownerId, isAdmin, "PAUSED");
}

export async function resumeUploadSession(deps: UploadRuntimeDependencies, uploadId: string, ownerId: string, isAdmin = false) {
  return changeUploadPauseState(deps, uploadId, ownerId, isAdmin, "OPEN");
}

async function completeClusterUpload(deps: UploadRuntimeDependencies, sessionId: string, expectedChecksum?: string | null) {
  return withLocalMutationLock(deps.dataLayout, sessionId, async () => {
    const fresh = await deps.prisma.uploadSession.findUnique({ where: { id: sessionId } });
    if (fresh?.status === "COMPLETED" && fresh.checksumSha256) {
      if (expectedChecksum && fresh.checksumSha256 !== expectedChecksum.toLowerCase()) throw Object.assign(new Error("Completed upload checksum disagrees with the requested checksum."), { statusCode: 409, code: "UPLOAD_CHECKSUM_MISMATCH" });
      return { ok: true, uploadId: fresh.id, fileName: fresh.fileName, checksumSha256: fresh.checksumSha256, sizeBytes: Number(fresh.totalBytes), transferMode: "cluster" };
    }
    if (!fresh || fresh.mode !== "cluster" || fresh.status !== "OPEN") throw Object.assign(new Error("Upload cannot be completed from its current state."), { statusCode: 409, code: "UPLOAD_STATE_INVALID" });
    const totalBytes = Number(fresh.totalBytes || 0);
    if (Number(fresh.receivedBytes || 0) !== totalBytes) throw Object.assign(new Error("Upload is incomplete."), { statusCode: 409, code: "UPLOAD_INCOMPLETE" });
    const partial = localPartialPath(deps.dataLayout, sessionId);
    const completed = localCompletePath(deps.dataLayout, sessionId, fresh.fileName);
    await verifyLocalUploadFile(deps.dataLayout, sessionId, partial);
    const info = await stat(partial).catch(() => null);
    if (!info?.isFile() || info.size !== totalBytes) throw Object.assign(new Error("Upload staging size does not match the declared transfer size."), { statusCode: 409, code: "UPLOAD_STATE_INVALID" });
    const checksumSha256 = await hashReadable(createReadStream(partial));
    if (expectedChecksum && checksumSha256 !== expectedChecksum.toLowerCase()) throw Object.assign(new Error("Upload checksum mismatch."), { statusCode: 422, code: "UPLOAD_CHECKSUM_MISMATCH" });
    await rename(partial, completed);
    try {
      const committed = await deps.prisma.uploadSession.updateMany({
        where: { id: sessionId, mode: "cluster", status: "OPEN", receivedBytes: BigInt(totalBytes) },
        data: { status: "COMPLETED", checksumSha256, completedAt: new Date() },
      });
      if (committed.count !== 1) throw Object.assign(new Error("Upload revision changed during finalization."), { statusCode: 409, code: "UPLOAD_STATE_INVALID" });
    } catch (error) {
      try { await rename(completed, partial); }
      catch { throw Object.assign(new Error("Upload commit failed and staged file needs recovery. No completion was recorded."), { statusCode: 503, code: "UPLOAD_RECONCILIATION_REQUIRED", cause: error }); }
      throw error;
    }
    return { ok: true, uploadId: sessionId, fileName: fresh.fileName, checksumSha256, sizeBytes: totalBytes, transferMode: "cluster" };
  });
}

export async function completeUploadSession(deps: UploadRuntimeDependencies, session: any, expectedChecksum?: string | null) {
  if (session.mode === "cluster") return completeClusterUpload(deps, session.id, expectedChecksum);
  const fresh = await deps.prisma.uploadSession.findUnique({ where: { id: session.id } });
  if (fresh?.status === "COMPLETED" && fresh.checksumSha256) {
    if (expectedChecksum && fresh.checksumSha256 !== expectedChecksum.toLowerCase()) throw Object.assign(new Error("Completed upload checksum disagrees with requested checksum."), { statusCode: 409, code: "UPLOAD_CHECKSUM_MISMATCH" });
    return { ok: true, uploadId: fresh.id, fileName: fresh.fileName, checksumSha256: fresh.checksumSha256, sizeBytes: Number(fresh.totalBytes), transferMode: fresh.mode };
  }
  if (!fresh || fresh.mode !== "direct" || fresh.status !== "OPEN") throw uploadStateConflict("Direct upload is not open. Finalizing or recovery sessions require review.");

  // The status transition is the distributed operation claim. No provider
  // operation may run before it succeeds. Other nodes cannot acknowledge,
  // pause, abort or prune a session while the remote outcome is uncertain.
  await claimUploadState(deps, fresh, "FINALIZING", { multipartUploadId: fresh.multipartUploadId });
  const claimed = await deps.prisma.uploadSession.findUnique({ where: { id: fresh.id }, include: { parts: { orderBy: { partNumber: "asc" } } } });
  const totalBytes = Number(fresh.totalBytes);
  const totalParts = Math.max(1, Math.ceil(totalBytes / Math.max(1, Number(fresh.partSize || 1))));
  const completed = (claimed?.parts || []).filter((part: any) => part.completedAt && part.etag);
  const parts: StorageMultipartPart[] = completed.map((part: any) => ({ partNumber: Number(part.partNumber), etag: String(part.etag), sizeBytes: Number(part.sizeBytes) }));
  const valid = claimed?.status === "FINALIZING" && claimed?.multipartUploadId === fresh.multipartUploadId
    && parts.length === totalParts && parts.every((part, index) => part.partNumber === index + 1 && part.sizeBytes === expectedPartSize(fresh, index + 1))
    && parts.reduce((sum, part) => sum + part.sizeBytes, 0) === totalBytes;
  if (!valid) {
    // No provider operation started. The original client may resume parts.
    await deps.prisma.uploadSession.updateMany({ where: { id: fresh.id, status: "FINALIZING" }, data: { status: "OPEN" } });
    throw Object.assign(new Error("Multipart upload has missing or invalid acknowledged parts."), { statusCode: 409, code: "UPLOAD_PART_INVALID" });
  }
  const storage = sessionLocator(fresh);
  if (!storage || !fresh.multipartUploadId) {
    await deps.prisma.uploadSession.updateMany({ where: { id: fresh.id, status: "FINALIZING" }, data: { status: "OPEN" } });
    throw Object.assign(new Error("Direct upload storage state is incomplete."), { statusCode: 503, code: "UPLOAD_STORAGE_UNAVAILABLE" });
  }
  // From this point onward any provider exception (including an unknown
  // response to CompleteMultipartUpload) leaves FINALIZING for administrator
  // reconciliation; blindly retrying could destroy or duplicate remote work.
  const completedObject = await deps.storageRuntime.completeMultipartUpload(storage, fresh.multipartUploadId, parts);
  if (completedObject.size !== totalBytes) {
    await deferDirectUpload(deps, fresh, "size-mismatch");
    await deps.prisma.uploadSession.updateMany({ where: { id: fresh.id, status: "FINALIZING" }, data: { status: "REVIEW_REQUIRED" } });
    throw Object.assign(new Error("Completed object size is wrong. Remote bytes have been retained for review."), { statusCode: 422, code: "UPLOAD_SIZE_MISMATCH" });
  }
  const checksumSha256 = await hashReadable(await deps.storageRuntime.openRead(storage));
  if (expectedChecksum && checksumSha256 !== expectedChecksum.toLowerCase()) {
    await deferDirectUpload(deps, fresh, "checksum-mismatch");
    await deps.prisma.uploadSession.updateMany({ where: { id: fresh.id, status: "FINALIZING" }, data: { status: "REVIEW_REQUIRED" } });
    throw Object.assign(new Error("Upload checksum mismatch. Remote bytes retained for governed review."), { statusCode: 422, code: "UPLOAD_CHECKSUM_MISMATCH" });
  }
  const updated = await deps.prisma.uploadSession.updateMany({
    where: { id: fresh.id, mode: "direct", status: "FINALIZING", multipartUploadId: fresh.multipartUploadId },
    data: { status: "COMPLETED", checksumSha256, completedAt: new Date(), receivedBytes: BigInt(totalBytes) },
  });
  if (updated.count !== 1) throw uploadStateConflict("Completed provider object needs reconciliation before it can be published.");
  void recordEfficiencyMetric(deps.prisma, "direct_upload_api_bypass", totalBytes, 1).catch(() => undefined);
  return { ok: true, uploadId: fresh.id, fileName: fresh.fileName, checksumSha256, sizeBytes: totalBytes, transferMode: "direct" };
}

export async function resolveCompletedUpload(deps: UploadRuntimeDependencies, uploadId: string, ownerId: string, isAdmin = false): Promise<CompletedUpload | null> {
  const session = await deps.prisma.uploadSession.findUnique({ where: { id: uploadId } });
  if (!session || session.status !== "COMPLETED" || !session.checksumSha256) return null;
  if (session.ownerId !== ownerId && !isAdmin) return null;
  if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) return null;

  const metadata = sessionMetadata(session);
  if (session.mode === "direct") {
    const storage = sessionLocator(session);
    if (!storage) return null;
    const info = await deps.storageRuntime.stat(storage).catch(() => null);
    if (!info || info.size !== metadata.totalBytes) return null;
    return { metadata, filePath: null, storage, resourceStat: { size: info.size, modifiedAt: info.modifiedAt } };
  }

  const filePath = localCompletePath(deps.dataLayout, session.id, session.fileName);
  try { await verifyLocalUploadFile(deps.dataLayout, session.id, filePath); }
  catch { return null; }
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile() || info.size !== metadata.totalBytes) return null;
  return { metadata, filePath, storage: null, resourceStat: { size: info.size, modifiedAt: info.mtime } };
}

export async function readCompletedUploadPrefix(deps: UploadRuntimeDependencies, upload: CompletedUpload, maximum = 64 * 1024) {
  // Only retain the requested prefix, regardless of how much a provider emits
  // per chunk. Empty resources must not open a meaningless byte-range stream.
  const declaredBytes = Number(upload.metadata.totalBytes);
  const requestedBytes = Number(maximum);
  const length = Number.isFinite(declaredBytes) && declaredBytes >= 0 && Number.isFinite(requestedBytes) && requestedBytes > 0
    ? Math.min(Math.floor(declaredBytes), Math.floor(requestedBytes))
    : 0;
  if (length === 0) return Buffer.alloc(0);
  if (upload.filePath) {
    const handle = await open(upload.filePath, "r");
    try {
      const prefix = Buffer.alloc(length);
      const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
      return prefix.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }
  if (!upload.storage) return Buffer.alloc(0);
  const prefix = Buffer.alloc(length);
  let received = 0;
  const stream = await deps.storageRuntime.openRead(upload.storage, { start: 0, end: length - 1 });
  // Breaking an async iterator destroys a Node readable. That matters when a
  // storage adapter ignores its requested range and keeps sending data.
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    const bytes = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const copied = bytes.copy(prefix, received, 0, length - received);
    received += copied;
    if (received >= length) break;
  }
  return prefix.subarray(0, received);
}

export async function copyCompletedUploadToFile(deps: UploadRuntimeDependencies, upload: CompletedUpload, destination: string) {
  // Library import and storage materialization must verify content, not just
  // length. A failed transfer never leaves a partial destination behind.
  await mkdir(path.dirname(destination), { recursive: true });
  const hash = createHash("sha256");
  const verifier = new Transform({ transform(chunk, _encoding, callback) {
    hash.update(chunk);
    callback(null, chunk);
  } });
  let destinationHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    if (upload.filePath) await verifyLocalUploadFile(deps.dataLayout, upload.metadata.id, upload.filePath);
    destinationHandle = await open(destination, "wx", 0o640);
    const source = upload.filePath
      ? createReadStream(upload.filePath)
      : upload.storage ? await deps.storageRuntime.openRead(upload.storage) : null;
    if (!source) throw Object.assign(new Error("Completed upload has no readable storage source."), { statusCode: 503, code: "UPLOAD_STORAGE_UNAVAILABLE" });
    await pipeline(source as any, verifier, createWriteStream(destination, { fd: destinationHandle.fd, autoClose: false }));
    await destinationHandle.sync();
    const info = await destinationHandle.stat();
    if (!info.isFile() || info.size !== upload.metadata.totalBytes || hash.digest("hex") !== upload.metadata.checksumSha256) {
      throw Object.assign(new Error("Stored upload bytes failed digest or size verification."), { statusCode: 422, code: "UPLOAD_COPY_INVALID" });
    }
    return destination;
  } catch (error) {
    if (destinationHandle) {
      await destinationHandle.close().catch(() => undefined);
      destinationHandle = null;
      await rm(destination, { force: true }).catch(() => undefined);
    }
    throw error;
  } finally { await destinationHandle?.close().catch(() => undefined); }
}

/** Disposition is one-way and DB-owned. Staging removal follows successful
 * deletion, never the other way around. Ambiguous provider aborts remain
 * ABORTING/CLEANING for governed reconciliation rather than blind retries.
 */
async function disposeClaimedUpload(deps: UploadRuntimeDependencies, session: any, reason: "consumed" | "aborted" | "expired") {
  const storage = sessionLocator(session);
  if (session.mode === "direct" && storage && session.multipartUploadId
    && ["INITIALIZING", "OPEN", "PAUSED"].includes(session.status)) {
    await deps.storageRuntime.abortMultipartUpload(storage, session.multipartUploadId);
  }
  if (session.mode === "direct") await deferDirectUpload(deps, session, reason);
  const deleted = await deps.prisma.uploadSession.deleteMany({
    where: { id: session.id, status: reason === "aborted" ? "ABORTING" : "CLEANING" },
  });
  if (deleted.count !== 1) throw uploadStateConflict("Upload disposition was changed before it could be committed.");
  if (session.mode !== "direct") {
    // Any failure leaves unowned bytes for a governed orphan sweep rather than
    // destroying a still-live session. Never follow user-controlled links.
    await rm(localSessionDirectory(deps.dataLayout, session.id), { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function consumeCompletedUpload(deps: UploadRuntimeDependencies, uploadId: string) {
  const session = await deps.prisma.uploadSession.findUnique({ where: { id: uploadId } });
  if (!session) return;
  if (session.status !== "COMPLETED") throw uploadStateConflict("Only completed uploads can be consumed.");
  const consume = async () => {
    const fresh = await deps.prisma.uploadSession.findUnique({ where: { id: uploadId } });
    if (!fresh || fresh.status !== "COMPLETED") throw uploadStateConflict("Upload changed before consumption.");
    await claimUploadState(deps, fresh, "CLEANING");
    await disposeClaimedUpload(deps, fresh, "consumed");
  };
  return session.mode === "cluster" ? withLocalMutationLock(deps.dataLayout, uploadId, consume) : consume();
}

export async function abortUploadSession(deps: UploadRuntimeDependencies, uploadId: string, ownerId: string, isAdmin = false) {
  const session = await deps.prisma.uploadSession.findUnique({ where: { id: uploadId } });
  if (!session || (session.ownerId !== ownerId && !isAdmin)) return false;
  const abort = async () => {
    const fresh = await deps.prisma.uploadSession.findUnique({ where: { id: uploadId } });
    if (!fresh || (fresh.ownerId !== ownerId && !isAdmin)) return false;
    if (!["INITIALIZING", "OPEN", "PAUSED", "COMPLETED", "ABORTED"].includes(fresh.status)) {
      throw uploadStateConflict("Upload is finalizing, disposing, or under recovery review; it cannot be cancelled automatically.");
    }
    if (fresh.status === "COMPLETED" && (await protectedLibraryTransferUploads(deps, [fresh])).has(fresh.id)) {
      throw Object.assign(new Error("A Library finalization job still owns this upload. Cancel the job before disposing of its source."), { statusCode: 409, code: "UPLOAD_TRANSFER_HELD" });
    }
    await claimUploadState(deps, fresh, "ABORTING");
    await disposeClaimedUpload(deps, fresh, "aborted");
    return true;
  };
  return session.mode === "cluster" ? withLocalMutationLock(deps.dataLayout, uploadId, abort) : abort();
}

/**
 * Completed Library transfers can be suspended for days while Library is
 * disabled. The ordinary seven-day upload TTL must not destroy their staged
 * bytes while the durable finalize job still owns them.
 *
 * This uses the queue's indexed dedupeKey, not its untrusted JSON payload.
 * Completed/failed/cancelled jobs release the retention hold automatically.
 * Database lookup failures abort pruning rather than silently deleting
 * potentially referenced bytes. This does not replace concurrent producer/
 * cleanup fencing, which requires a live PostgreSQL integration test.
 */
async function protectedLibraryTransferUploads(deps: UploadRuntimeDependencies, sessions: Array<{ id: string; status: string }>): Promise<Set<string>> {
  const completed = sessions.filter((session) => session.status === "COMPLETED");
  if (!completed.length) return new Set();
  const rows = await deps.prisma.backgroundJob.findMany({
    where: {
      type: "library.transfer.finalize",
      status: { in: ["QUEUED", "RUNNING"] },
      dedupeKey: { in: completed.map((session) => `library-transfer:${session.id}`) },
    },
    select: { dedupeKey: true },
  });
  const activeKeys = new Set(rows.map((row: { dedupeKey: string | null }) => row.dedupeKey));
  return new Set(completed.filter((session) => activeKeys.has(`library-transfer:${session.id}`)).map((session) => session.id));
}

export async function pruneExpiredUploads(deps: UploadRuntimeDependencies, maximum = 100) {
  const limit = Math.max(1, Math.min(500, maximum));
  const scanLimit = Math.min(500, Math.max(limit, 100));
  const expiresBefore = new Date();
  let removed = 0;
  let protectedByJob = 0;
  let cursor: { id: string; expiresAt: Date } | null = null;
  // Scan past held transfers so a long-disabled Library cannot starve normal
  // cleanup indefinitely. Bound work during upload-session creation.
  let scanned = 0;
  const maximumScanned = Math.min(2_500, scanLimit * 5);
  while (removed < limit && scanned < maximumScanned) {
    const batch: Array<{ id: string; expiresAt: Date; status: string; mode: string; multipartUploadId?: string | null }> = await deps.prisma.uploadSession.findMany({
      where: {
        expiresAt: { lt: expiresBefore },
        ...(cursor ? { OR: [
          { expiresAt: { gt: cursor.expiresAt } },
          { expiresAt: cursor.expiresAt, id: { gt: cursor.id } },
        ] } : {}),
      },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: Math.min(scanLimit, maximumScanned - scanned),
    });
    if (!batch.length) break;
    scanned += batch.length;
    cursor = { id: batch[batch.length - 1]!.id, expiresAt: batch[batch.length - 1]!.expiresAt };
    const held = await protectedLibraryTransferUploads(deps, batch);
    for (const session of batch) {
      if (held.has(session.id)) { protectedByJob++; continue; }
      if (removed >= limit) break;
      // Unknown provider completion/abort and previously failed disposition
      // must be recovered by an operator, not reaped on an expiry timestamp.
      if (["FINALIZING", "ABORTING", "CLEANING", "REVIEW_REQUIRED"].includes(session.status)) continue;
      const dispose = async () => {
        const fresh = await deps.prisma.uploadSession.findUnique({ where: { id: session.id } });
        if (!fresh || fresh.status !== session.status || new Date(fresh.expiresAt).getTime() >= Date.now()) return false;
        await claimUploadState(deps, fresh, "CLEANING", { expiresAt: { lt: expiresBefore } });
        await disposeClaimedUpload(deps, fresh, "expired");
        return true;
      };
      if (session.mode === "cluster") {
        try { if (await withLocalMutationLock(deps.dataLayout, session.id, dispose)) removed++; }
        catch (error: any) { if (error?.code === "UPLOAD_BUSY" || error?.code === "UPLOAD_LOCK_RECOVERY_REQUIRED" || error?.code === "UPLOAD_STATE_INVALID") continue; throw error; }
      } else {
        try { if (await dispose()) removed++; }
        catch (error: any) { if (error?.code === "UPLOAD_STATE_INVALID") continue; throw error; }
      }
    }
    if (batch.length < scanLimit) break;
  }
  return { removed, protectedByJob, scanned };
}

/** Read-only operator evidence. This projection deliberately excludes storage
 * keys, multipart IDs, provider URLs, ETags and filesystem paths. It does not
 * authorize provider mutation, forced lock takeover, or state resetting.
 */
export async function uploadRecoveryQueue(deps: UploadRuntimeDependencies, options: { limit?: number; cursor?: string } = {}) {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit || 25)));
  const recoveryWhere = { status: { in: [...RECOVERY_SESSION_STATUSES] } };
  if (options.cursor) {
    const prior = await deps.prisma.uploadSession.findFirst({ where: { id: options.cursor, ...recoveryWhere }, select: { id: true } });
    if (!prior) throw Object.assign(new Error("Upload recovery cursor was not found."), { statusCode: 400, code: "UPLOAD_RECOVERY_CURSOR_INVALID" });
  }
  const [rows, total] = await Promise.all([
    deps.prisma.uploadSession.findMany({ where: recoveryWhere, orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}), take: limit + 1,
      select: { id: true, ownerId: true, workspaceId: true, fileName: true, mode: true, status: true,
        createdAt: true, updatedAt: true, expiresAt: true, totalBytes: true, receivedBytes: true,
        storageProvider: true, storageTier: true, storageKey: true, multipartUploadId: true, checksumSha256: true },
    }),
    deps.prisma.uploadSession.count({ where: recoveryWhere }),
  ]);
  const page = rows.slice(0, limit);
  return {
    ok: true, total, readOnly: true,
    reconciliationPolicy: "verify-provider-outcome-and-job-ownership-before-disposition",
    sessions: page.map((session: any) => ({
      id: session.id, ownerId: session.ownerId, workspaceId: session.workspaceId,
      fileName: session.fileName, mode: session.mode, state: session.status,
      createdAt: session.createdAt, updatedAt: session.updatedAt, expiresAt: session.expiresAt,
      totalBytes: Number(session.totalBytes || 0), receivedBytes: Number(session.receivedBytes || 0),
      provider: session.mode === "direct" ? session.storageProvider : null,
      hasStorageLocator: Boolean(session.storageProvider && session.storageTier && session.storageKey),
      hasMultipartIdentity: Boolean(session.multipartUploadId),
      hasChecksum: Boolean(session.checksumSha256),
      dispositionAuthorized: false,
    })),
    nextCursor: rows.length > limit ? page[page.length - 1]?.id : null,
  };
}

/** An operator-triggered HEAD + multipart listing. This does NOT acquire a
 * generation fence, permit disposal, or resolve the ambiguous upload status.
 * No raw provider keys, multipart IDs, ETags, error bodies or credentials are
 * ever copied to the response. Fail closed if the DB changes during inspection.
 */
export async function inspectUploadRecovery(deps: UploadRuntimeDependencies, uploadId: string) {
  const select = { id: true, ownerId: true, workspaceId: true, fileName: true, mode: true, status: true,
    updatedAt: true, totalBytes: true, receivedBytes: true, checksumSha256: true,
    storageProvider: true, storageTier: true, storageKey: true, multipartUploadId: true };
  const session = await deps.prisma.uploadSession.findUnique({ where: { id: uploadId }, select });
  if (!session || !RECOVERY_SESSION_STATUSES.includes(session.status as any)) {
    throw Object.assign(new Error("Upload recovery session was not found."), { statusCode: 404, code: "UPLOAD_RECOVERY_NOT_FOUND" });
  }
  const evidence: any = {
    ok: true, uploadId, state: session.status, inspectedAt: null as string | null,
    readOnly: true, dispositionAuthorized: false, recoveryAuthorized: false,
    limitations: "Inspection is not a provider generation lease, checksum verification, backup inventory, or disposal approval.",
    object: { state: "not_inspected" }, multipart: { state: "not_inspected" },
    jobs: { state: "unknown", active: 0, finished: 0 },
    unchangedDuringInspection: false,
    assessment: { state: "requires_review", reasons: [] as string[], automaticallyActionable: false },
  };
  // Only inspect an exact Cluster-issued direct-upload locator. Never perform
  // arbitrary provider queries using a DB row with malformed storage identity.
  const locator = sessionLocator(session);
  const expectedKeyPrefix = `uploads/${session.workspaceId || "unscoped"}/${session.id}/`;
  let verifiedRemoteProvider = false;
  if (locator) {
    try {
      const provider = deps.storageRuntime.provider(locator);
      verifiedRemoteProvider = Boolean(provider.capabilities.objectStorage && provider.capabilities.multipartUploads);
    } catch { /* unavailable provider identity must not trigger remote reads */ }
  }
  const validPointer = session.mode === "direct" && Boolean(locator) && verifiedRemoteProvider
    && locator!.tier === "temporary"
    && /^(?:[a-zA-Z0-9_-]{1,128})$/.test(session.workspaceId || "unscoped")
    && /^[a-zA-Z0-9_-]{1,64}$/.test(locator!.provider)
    && typeof session.storageKey === "string"
    && session.storageKey.startsWith(expectedKeyPrefix)
    && session.storageKey.length > expectedKeyPrefix.length
    && !/[\\\u0000-\u001f]/.test(session.storageKey.slice(expectedKeyPrefix.length))
    && !session.storageKey.slice(expectedKeyPrefix.length).includes("/")
    && session.storageKey.slice(expectedKeyPrefix.length) !== "."
    && session.storageKey.slice(expectedKeyPrefix.length) !== "..";
  if (session.mode === "direct" && !validPointer) {
    evidence.object.state = "unsafe_locator";
    evidence.multipart.state = "unsafe_locator";
  } else if (session.mode !== "direct") {
    evidence.object.state = "local_staging_not_inspected";
    evidence.multipart.state = "not_applicable";
  } else if (locator) {
    try {
      const stat = await deps.storageRuntime.stat(locator);
      const size = Number(stat.size);
      evidence.object = Number.isSafeInteger(size) && size >= 0
        ? { state: "present", bytes: size, matchesExpectedSize: size === Number(session.totalBytes),
          checksumMetadata: stat.checksumSha256 ? "present_unverified" : "absent",
          providerVersionIdentity: stat.providerVersionId ? "observed_unfenced" : "unavailable",
          providerGenerationFenceEstablished: false,
          matchesRecordedChecksumMetadata: stat.checksumSha256 && session.checksumSha256
            ? stat.checksumSha256.toLowerCase() === String(session.checksumSha256).toLowerCase() : null }
        : { state: "invalid_provider_metadata" };
    } catch (error: any) {
      evidence.object.state = error?.storageHttpStatus === 404 || error?.code === "ENOENT" ? "not_found" : "unavailable";
    }
    if (session.multipartUploadId) {
      try {
        const inspect = await deps.storageRuntime.inspectMultipartUpload(locator, String(session.multipartUploadId));
        evidence.multipart = inspect
          ? { state: inspect.state, observedParts: inspect.observedParts, observedBytes: inspect.observedBytes,
            truncated: inspect.truncated }
          : { state: "unsupported" };
      } catch { evidence.multipart.state = "unavailable"; }
    } else evidence.multipart.state = "identity_missing";
  }
  try {
    const jobs = await deps.prisma.backgroundJob.findMany({
      where: { type: "library.transfer.finalize", dedupeKey: `library-transfer:${session.id}` },
      select: { status: true, leaseExpiresAt: true }, take: 20,
    });
    evidence.jobs = { state: jobs.length >= 20 ? "incomplete" : "checked",
      active: jobs.filter((job: any) => ["QUEUED", "RUNNING"].includes(job.status)).length,
      finished: jobs.filter((job: any) => !["QUEUED", "RUNNING"].includes(job.status)).length,
      leaseExpiredCount: jobs.filter((job: any) => job.status === "RUNNING" && job.leaseExpiresAt && new Date(job.leaseExpiresAt).getTime() < Date.now()).length };
  } catch { evidence.jobs.state = "unavailable"; }
  // Compare every locator, expected size and checksum field that influenced
  // the remote observation, not only status/time/key. A repointed provider,
  // new upload owner or changed size invalidates the entire inspection.
  const after = await deps.prisma.uploadSession.findUnique({ where: { id: uploadId }, select });
  evidence.unchangedDuringInspection = Boolean(after &&
    ["id", "ownerId", "workspaceId", "fileName", "mode", "status", "storageProvider", "storageTier", "storageKey", "multipartUploadId", "checksumSha256"].every(
      (key) => after[key] === session[key]) &&
    ["totalBytes", "receivedBytes"].every((key) => String(after[key]) === String(session[key])) &&
    new Date(after.updatedAt).getTime() === new Date(session.updatedAt).getTime());
  if (!evidence.unchangedDuringInspection) evidence.warning = "Upload session changed during inspection. Evidence is stale.";
  const reasons: string[] = [];
  if (!evidence.unchangedDuringInspection) reasons.push("session_changed");
  if (evidence.object.state === "unsafe_locator") reasons.push("unsafe_provider_identity");
  if (evidence.object.matchesExpectedSize === false) reasons.push("remote_size_mismatch");
  if (evidence.object.matchesRecordedChecksumMetadata === false) reasons.push("checksum_metadata_mismatch");
  if (["unavailable", "invalid_provider_metadata"].includes(evidence.object.state)) reasons.push("object_evidence_unavailable");
  if (["unavailable", "unsupported"].includes(evidence.multipart.state)) reasons.push("multipart_evidence_unavailable");
  if (evidence.jobs.state !== "checked") reasons.push("job_evidence_incomplete");
  if (evidence.jobs.active > 0) reasons.push("active_transfer_job");
  if (evidence.object.state === "not_found" || evidence.multipart.state === "not_found")
    reasons.push("provider_absence_is_not_finalization_proof");
  if (evidence.object.state === "present") reasons.push("remote_presence_not_checksum_or_generation_proof");
  if (!reasons.length) reasons.push("independent_provider_reconciliation_required");
  evidence.assessment = { state: !evidence.unchangedDuringInspection ? "stale"
    : reasons.some((reason) => ["unsafe_provider_identity", "remote_size_mismatch", "checksum_metadata_mismatch"].includes(reason)) ? "conflicting"
    : "requires_review", reasons, automaticallyActionable: false };
  evidence.inspectedAt = new Date().toISOString();
  return evidence;
}

export async function uploadPressureSnapshot(deps: UploadRuntimeDependencies) {
  const activeWhere = uploadCapacityWhere();
  const [sessions, reserved, workspaces, recoveryRequired] = await Promise.all([
    deps.prisma.uploadSession.count({ where: activeWhere }),
    deps.prisma.uploadSession.aggregate({ where: activeWhere, _sum: { totalBytes: true, receivedBytes: true } }),
    deps.prisma.uploadSession.groupBy({
      by: ["workspaceId"],
      where: activeWhere,
      _count: { _all: true },
      _sum: { totalBytes: true, receivedBytes: true },
    }).catch(() => []),
    deps.prisma.uploadSession.count({ where: { status: { in: [...RECOVERY_SESSION_STATUSES] } } }),
  ]);
  const workspaceRows = Array.isArray(workspaces) ? workspaces : [];
  const topology = uploadStagingTopology(deps);
  const direct = topology.directMultipart;
  return {
    staging: topology,
    sessions: Number(sessions || 0),
    recoveryRequiredSessions: Number(recoveryRequired || 0),
    activeWorkspaces: workspaceRows.length,
    reservedBytes: Number(reserved?._sum?.totalBytes || 0),
    receivedBytes: Number(reserved?._sum?.receivedBytes || 0),
    outstandingBytes: Math.max(0, Number(reserved?._sum?.totalBytes || 0) - Number(reserved?._sum?.receivedBytes || 0)),
    largestWorkspaceSessions: workspaceRows.reduce((maximum: number, row: any) => Math.max(maximum, Number(row?._count?._all || 0)), 0),
    largestWorkspaceReservedBytes: workspaceRows.reduce((maximum: number, row: any) => Math.max(maximum, Number(row?._sum?.totalBytes || 0)), 0),
    freeBytes: direct ? null : await localFreeBytes(deps.dataLayout),
    limits: {
      workspaceSessions: workspaceSessionLimit(),
      workspaceReservedBytes: workspaceReservedByteLimit(),
      globalReservedBytes: globalReservedByteLimit(),
      workspaceBytesPerMinute: workspaceByteRateLimit(),
      freeSpaceReserveBytes: MIN_FREE_SPACE_RESERVE_BYTES,
    },
  };
}

export function serializeUploadSession(session: any) {
  const totalBytes = Number(session.totalBytes || 0);
  const partSize = Number(session.partSize || 0);
  return {
    ok: true,
    upload: sessionMetadata(session),
    transferMode: session.mode === "direct" ? "direct" : "cluster",
    chunkSize: session.mode === "direct" ? partSize : DEFAULT_UPLOAD_CHUNK_BYTES,
    totalParts: session.mode === "direct" ? Math.max(1, Math.ceil(totalBytes / Math.max(1, partSize))) : null,
    completedParts: Array.isArray(session.parts)
      ? session.parts.filter((part: any) => part.completedAt && part.etag).map((part: any) => ({
          partNumber: Number(part.partNumber),
          sizeBytes: Number(part.sizeBytes),
          etag: String(part.etag),
        }))
      : [],
  };
}

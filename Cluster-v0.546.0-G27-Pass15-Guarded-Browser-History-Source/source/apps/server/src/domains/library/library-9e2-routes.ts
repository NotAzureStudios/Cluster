import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ClusterOperationRuntime } from "../../core/operation-runtime.js";
import type { CollaborationRuntime } from "../../core/collaboration-runtime.js";
import type { ClusterDataLayout } from "../../core/data-layout.js";
import { untrustedFileResponseHeaders } from "../../core/uploads.js";
import { sendStoredResource } from "../media/resource-delivery.js";
import { copyrightDisabledResponse, isCopyrightResourceDisabled } from "../../core/copyright-workflow.js";
import { libraryDerivativeClientState, libraryDerivativeIsDeliverable } from "./library-derivative-version.js";
import { validateManagedDerivativePath } from "./library-derivative-file-safety.js";
import { libraryMimeGroup, libraryPreviewKind, parseLibraryMetadata } from "../../core/library.js";
import { uploadPressureSnapshot, uploadRecoveryQueue, inspectUploadRecovery, type UploadRuntimeDependencies } from "../uploads/upload-session-runtime.js";
import type { LibraryAccessService, LibraryAccessLevel } from "./library-access-service.js";
import { requestDeviceProof } from "../sessions/device-proof.js";
import { libraryCollectionOffset, libraryCollectionPage, LibraryCollectionPageError } from "./library-collection-pagination.js";
import { collectLibraryMatchingSelection, LibraryMatchingSelectionError } from "./library-matching-selection.js";
import { libraryCollectionCan, libraryCollectionRole, type LibraryCollectionPermission, type LibraryCollectionRole } from "./library-collection-access.js";
import {
  LIBRARY_REVIEW_STATES,
  LIBRARY_TRANSFER_CONFLICT_POLICIES,
  libraryLockConflict,
  libraryLockIsActive,
  librarySmartCollectionOrderBy,
  librarySmartCollectionWhere,
  librarySmartCollectionDescendantFolders,
} from "./library-platform-9e2.js";

const idSchema = z.string().trim().min(1).max(240);
const collectionKindSchema = z.enum(["manual", "smart"]);
const reviewStateSchema = z.enum(LIBRARY_REVIEW_STATES);

function parseJson(value: unknown, fallback: any = {}) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "")); } catch { return fallback; }
}

function isInside(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
}

function parseStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string" || !value) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}

function serializeCollectionLibraryItem(item: any) {
  const metadata = parseLibraryMetadata(item.metadata);
  const previewKind = libraryPreviewKind(item);
  return {
    id: item.id, projectId: item.projectId, ownerId: item.ownerId, reviewerId: item.reviewerId, parentId: item.parentId,
    title: item.title, body: item.body, type: item.type, status: item.status, priority: item.priority, tags: parseStringArray(item.tags),
    externalUrl: item.externalUrl, pinned: Boolean(item.pinned), reviewState: item.reviewState || "draft", reviewDueAt: item.reviewDueAt, approvedAt: item.approvedAt,
    visibility: item.visibility, classification: item.classification, lifecycleState: item.lifecycleState,
    legalHold: Boolean(item.legalHold), retentionUntil: item.retentionUntil || null, integrityState: item.integrityState || (item.checksumSha256 ? "verified" : "unverified"),
    fileName: item.fileName, originalName: item.originalName, mimeType: item.mimeType, mimeGroup: libraryMimeGroup(item.mimeType, item.extension),
    sizeBytes: item.sizeBytes, checksumSha256: item.checksumSha256, extension: item.extension, source: item.source, revision: item.revision, fileModifiedAt: item.fileModifiedAt, manualOrder: item.manualOrder,
    previewKind, previewText: item.previewText, hasFile: Boolean(item.fileName), fileUrl: item.fileName ? `/api/library/${item.id}/file` : null,
    downloadUrl: item.fileName ? `/api/library/${item.id}/file?download=1` : null, snippet: String(item.body || item.previewText || "").trim().slice(0, 280),
    metadata, folderColor: item.type === "folder" && typeof metadata.folderColor === "string" ? metadata.folderColor : null, folderIcon: item.type === "folder" && typeof metadata.folderIcon === "string" ? metadata.folderIcon : null,
    project: item.project ? { id: item.project.id, name: item.project.name } : null, createdAt: item.createdAt, updatedAt: item.updatedAt,
  };
}

function serializeDerivative(row: any, item: any) {
  const version = libraryDerivativeClientState(item, row);
  return {
    currentVersion: version.currentVersion,
    available: version.available,
    availabilityReason: version.availabilityReason,
    id: row.id,
    itemId: row.itemId,
    kind: row.kind,
    variantKey: row.variantKey,
    sourceChecksumSha256: row.sourceChecksumSha256,
    contentChecksumSha256: row.contentChecksumSha256,
    status: version.status,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    metadata: parseJson(row.metadata, {}),
    generatedByJobId: row.generatedByJobId,
    builtAt: row.builtAt,
    invalidatedAt: row.invalidatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    fileUrl: version.available ? `/api/library/${row.itemId}/derivatives/${row.id}/file` : null,
  };
}

function serializeLock(lock: any, proof?: ReturnType<typeof requestDeviceProof>) {
  if (!lock) return null;
  const deviceBound = Boolean(lock.ownerDeviceId && lock.ownerDeviceProofFingerprint);
  const ownedByCurrentDevice = Boolean(deviceBound && proof?.verified && proof.deviceId === lock.ownerDeviceId && proof.keyFingerprint === lock.ownerDeviceProofFingerprint);
  return {
    id: lock.id,
    itemId: lock.itemId,
    ownerId: lock.ownerId,
    state: lock.state,
    active: libraryLockIsActive(lock),
    sourceKind: lock.sourceKind,
    sourceRef: lock.sourceRef,
    acquiredAt: lock.acquiredAt,
    expiresAt: lock.expiresAt,
    releasedAt: lock.releasedAt,
    releasedById: lock.releasedById,
    forceReleased: Boolean(lock.forceReleased),
    reason: lock.reason,
    revision: lock.revision,
    deviceBound,
    ownedByCurrentDevice,
  };
}

export type Library9E2RouteDependencies = {
  app: FastifyInstance;
  prisma: any;
  operationRuntime: ClusterOperationRuntime;
  collaborationRuntime: CollaborationRuntime;
  libraryAccess: LibraryAccessService;
  dataLayout: ClusterDataLayout;
  storageRuntime: UploadRuntimeDependencies["storageRuntime"];
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  decorateUserForClient: (user: any) => Promise<any>;
  hasToolPermission: (user: any, role: string | null | undefined, tool: string, minimum?: string) => boolean;
  logActivity: (input: any) => Promise<unknown>;
};

export function registerLibrary9E2Routes(deps: Library9E2RouteDependencies) {
  const { app, prisma, operationRuntime, collaborationRuntime, libraryAccess, dataLayout, storageRuntime, getCurrentUser, decorateUserForClient, hasToolPermission, logActivity } = deps;
  const uploadRuntime: UploadRuntimeDependencies = { prisma, storageRuntime, dataLayout };

  async function requireUser(request: FastifyRequest, reply: FastifyReply) {
    const user = await getCurrentUser(request);
    if (!user) { reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Authentication required." }); return null; }
    return user;
  }

  function requireVerifiedLockDevice(request: FastifyRequest, reply: FastifyReply) {
    const proof = requestDeviceProof(request);
    if (!proof?.verified || !proof.deviceId || !proof.keyFingerprint) {
      reply.code(403).send({ ok: false, code: "DEVICE_PROOF_REQUIRED", error: "A verified installation device is required to own or refresh a Library edit lock." });
      return null;
    }
    return proof;
  }

  function lockOwnedByProof(lock: any, proof: NonNullable<ReturnType<typeof requestDeviceProof>>) {
    if (!lock?.ownerDeviceId || !lock?.ownerDeviceProofFingerprint) return false;
    return String(lock.ownerDeviceId) === String(proof.deviceId) && String(lock.ownerDeviceProofFingerprint) === String(proof.keyFingerprint);
  }

  async function requireLibraryTool(request: FastifyRequest, reply: FastifyReply, minimum: "view" | "edit") {
    const user = await requireUser(request, reply);
    if (!user) return null;
    const decorated = await decorateUserForClient(user);
    if (!decorated?.isAdmin && !hasToolPermission(user, decorated?.workspaceRole, "library", minimum)) {
      reply.code(403).send({ ok: false, code: "LIBRARY_ACCESS_DENIED", error: `Library ${minimum} access required.` });
      return null;
    }
    return { user, decorated };
  }

  async function requireItem(request: FastifyRequest, reply: FastifyReply, itemId: string, minimum: LibraryAccessLevel = "view") {
    const user = await requireUser(request, reply);
    if (!user) return null;
    const item = await prisma.libraryItem.findUnique({ where: { id: itemId }, include: { project: { include: { memberships: { where: { status: "active" } } } }, assetLock: true } });
    if (!item || item.lifecycleState === "destroyed") { reply.code(404).send({ ok: false, code: "LIBRARY_ITEM_NOT_FOUND", error: "Library item not found." }); return null; }
    const recordsAttachment = await prisma.personnelRecordAttachment?.findFirst?.({ where: { libraryItemId: itemId }, select: { id: true } }).catch(() => null);
    if (recordsAttachment) {
      reply.code(403).send({ ok: false, code: "PERSONNEL_RECORD_POLICY_REQUIRED", error: "Official Personnel Record attachments must be opened from Personnel Records." });
      return null;
    }
    if (!(await libraryAccess.canAccessItem(request, item, minimum))) {
      reply.code(403).send({ ok: false, code: "LIBRARY_ACCESS_DENIED", error: `Library ${minimum} access required.` });
      return null;
    }
    return { user, item };
  }

  async function ownOperation(request: FastifyRequest, reply: FastifyReply, operationId: string) {
    const user = await requireUser(request, reply);
    if (!user) return null;
    const operation = await operationRuntime.get(operationId);
    if (!operation || !String(operation.type || "").startsWith("library.")) {
      reply.code(404).send({ ok: false, code: "LIBRARY_OPERATION_NOT_FOUND", error: "Library operation not found." });
      return null;
    }
    const decorated = await decorateUserForClient(user);
    if (!decorated?.isAdmin && operation.createdById !== user.id) {
      reply.code(403).send({ ok: false, code: "LIBRARY_OPERATION_ACCESS_DENIED", error: "This Library operation belongs to another user." });
      return null;
    }
    return { user, decorated, operation };
  }

  app.get("/api/library/transfers/pressure", async (request, reply) => {
    if (!(await requireLibraryTool(request, reply, "view"))) return;
    reply.header("Cache-Control", "no-store");
    return { ok: true, pressure: await uploadPressureSnapshot(uploadRuntime) };
  });

  // An administrator can inspect unresolved provider work, but cannot force
  // its deletion or reuse a session via this endpoint. No storage secrets
  // escape into the browser, logs, or this diagnostic response.
  app.get("/api/library/transfers/recovery", async (request, reply) => {
    const auth = await requireLibraryTool(request, reply, "view");
    if (!auth) return;
    if (!auth.decorated?.isAdmin) return reply.code(403).send({ ok: false, code: "ADMIN_REQUIRED", error: "Administrator access is required for upload recovery evidence." });
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().uuid().optional() }).parse(request.query || {});
    try {
      reply.header("Cache-Control", "private, no-store");
      return await uploadRecoveryQueue(uploadRuntime, query);
    } catch (error: any) {
      if (error?.code === "UPLOAD_RECOVERY_CURSOR_INVALID") return reply.code(400).send({ ok: false, code: error.code, error: error.message });
      throw error;
    }
  });

  // Explicit, per-session provider observation only. No background inspection,
  // reconciliation, state transition, retry, deletion or force-unlock route.
  app.get("/api/library/transfers/recovery/:uploadId/inspect", async (request, reply) => {
    const auth = await requireLibraryTool(request, reply, "view");
    if (!auth) return;
    if (!auth.decorated?.isAdmin) return reply.code(403).send({ ok: false, code: "ADMIN_REQUIRED", error: "Administrator access is required for upload provider inspection." });
    const params = z.object({ uploadId: z.string().uuid() }).parse(request.params);
    reply.header("Cache-Control", "private, no-store");
    try { return await inspectUploadRecovery(uploadRuntime, params.uploadId); }
    catch (error: any) {
      if (error?.code === "UPLOAD_RECOVERY_NOT_FOUND") return reply.code(404).send({ ok: false, code: error.code, error: error.message });
      throw error;
    }
  });

  app.post("/api/library/transfers/finalize", async (request, reply) => {
    const auth = await requireLibraryTool(request, reply, "edit");
    if (!auth) return;
    const body = z.object({
      uploadId: z.string().uuid(),
      workspaceId: idSchema.nullable().optional(),
      parentId: idSchema.nullable().optional(),
      projectId: idSchema.nullable().optional(),
      ownerId: idSchema.nullable().optional(),
      originalName: z.string().trim().min(1).max(500),
      relativePath: z.string().trim().max(4000).nullable().optional(),
      mimeType: z.string().trim().min(1).max(200).default("application/octet-stream"),
      expectedChecksumSha256: z.string().regex(/^[a-f0-9]{64}$/i).nullable().optional(),
      conflictPolicy: z.enum(LIBRARY_TRANSFER_CONFLICT_POLICIES).default("rename"),
      classification: z.enum(["public", "internal", "confidential", "restricted"]).default("internal"),
      tags: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
    }).parse(request.body || {});
    if (body.parentId) {
      const parent = await prisma.libraryItem.findUnique({ where: { id: body.parentId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      if (!parent || parent.type !== "folder") return reply.code(404).send({ ok: false, code: "LIBRARY_FOLDER_NOT_FOUND", error: "Destination Library folder not found." });
      if (!(await libraryAccess.canAccessItem(request, parent, "contribute"))) return reply.code(403).send({ ok: false, code: "LIBRARY_ACCESS_DENIED", error: "Library contribute access is required for the destination folder." });
      if (body.projectId && parent.projectId !== body.projectId) return reply.code(409).send({ ok: false, code: "LIBRARY_SCOPE_MISMATCH", error: "Destination folder and requested project scope do not match." });
    }
    const operation = await operationRuntime.enqueue({
      type: "library.transfer.finalize",
      queue: "library-transfer",
      workspaceId: body.workspaceId || null,
      createdById: auth.user.id,
      dedupeKey: `library-transfer:${body.uploadId}`,
      maxAttempts: 4,
      priority: 30,
      costUnits: 2,
      payload: { ...body, actorId: auth.user.id },
      authorization: { actorUserId: auth.user.id, action: "contribute", resource: { kind: "tool", tool: "library" }, minimum: "edit", tool: "library" },
    });
    reply.code(202);
    return { ok: true, operation, receipt: { transferAccepted: true, transferComplete: false, derivativesComplete: false, operationId: operation.id } };
  });

  app.get("/api/library/transfers/:operationId", async (request, reply) => {
    const { operationId } = z.object({ operationId: idSchema }).parse(request.params);
    const owned = await ownOperation(request, reply, operationId);
    if (!owned) return;
    reply.header("Cache-Control", "no-store");
    return { ok: true, operation: owned.operation };
  });

  app.post("/api/library/transfers/:operationId/cancel", async (request, reply) => {
    const { operationId } = z.object({ operationId: idSchema }).parse(request.params);
    if (!(await ownOperation(request, reply, operationId))) return;
    const operation = await operationRuntime.cancel(operationId);
    if (!operation) return reply.code(409).send({ ok: false, code: "LIBRARY_OPERATION_CANCEL_NOT_ALLOWED", error: "This operation can no longer be cancelled." });
    return { ok: true, operation };
  });

  app.post("/api/library/transfers/:operationId/retry", async (request, reply) => {
    const { operationId } = z.object({ operationId: idSchema }).parse(request.params);
    if (!(await ownOperation(request, reply, operationId))) return;
    const operation = await operationRuntime.retry(operationId);
    if (!operation) return reply.code(409).send({ ok: false, code: "LIBRARY_OPERATION_RETRY_NOT_ALLOWED", error: "This operation is not in a retryable state." });
    return { ok: true, operation };
  });

  app.get("/api/library/:itemId/derivatives", async (request, reply) => {
    const { itemId } = z.object({ itemId: idSchema }).parse(request.params);
    const access = await requireItem(request, reply, itemId, "view");
    if (!access) return;
    if (await isCopyrightResourceDisabled(prisma, "library", itemId)) return copyrightDisabledResponse(reply);
    const derivatives = await prisma.libraryDerivative.findMany({ where: { itemId }, orderBy: [{ invalidatedAt: "asc" }, { kind: "asc" }, { updatedAt: "desc" }] });
    reply.header("Cache-Control", "private, no-store");
    return { ok: true, sourceChecksumSha256: access.item.checksumSha256 || null, derivatives: derivatives.map((row: any) => serializeDerivative(row, access.item)) };
  });

  app.post("/api/library/:itemId/derivatives/rebuild", async (request, reply) => {
    const { itemId } = z.object({ itemId: idSchema }).parse(request.params);
    const access = await requireItem(request, reply, itemId, "edit");
    if (!access) return;
    if (access.item.type !== "file" || !access.item.checksumSha256) return reply.code(409).send({ ok: false, code: "LIBRARY_DERIVATIVE_SOURCE_INVALID", error: "Only verified Library files can build derivatives." });
    await prisma.libraryDerivative.updateMany({ where: { itemId, invalidatedAt: null }, data: { status: "stale", invalidatedAt: new Date() } });
    const operation = await operationRuntime.enqueue({
      type: "library.derivative.build",
      queue: "library-derivative",
      createdById: access.user.id,
      dedupeKey: `library-derivatives:${itemId}:${access.item.checksumSha256}`,
      maxAttempts: 4,
      priority: 10,
      costUnits: 3,
      payload: { itemId, actorId: access.user.id, sourceChecksumSha256: access.item.checksumSha256 },
      authorization: { actorUserId: access.user.id, action: "contribute", resource: { kind: "target", targetKind: "library", targetId: itemId, projectId: access.item.projectId || null }, minimum: "edit", tool: "library" },
    });
    reply.code(202);
    return { ok: true, operation };
  });

  app.get("/api/library/:itemId/derivatives/:derivativeId/file", async (request, reply) => {
    const { itemId, derivativeId } = z.object({ itemId: idSchema, derivativeId: idSchema }).parse(request.params);
    const access = await requireItem(request, reply, itemId, "view");
    if (!access) return;
    if (await isCopyrightResourceDisabled(prisma, "library", itemId)) return copyrightDisabledResponse(reply);
    const derivative = await prisma.libraryDerivative.findFirst({ where: { id: derivativeId, itemId, status: "ready", invalidatedAt: null } });
    if (!derivative?.storagePath) return reply.code(404).send({ ok: false, code: "LIBRARY_DERIVATIVE_NOT_FOUND", error: "Derivative file not found." });
    if (!libraryDerivativeIsDeliverable(access.item, derivative)) return reply.code(409).send({ ok: false, code: "LIBRARY_DERIVATIVE_SOURCE_CHANGED", error: "This preview belongs to a different Library file version. Rebuild previews for the current version." });
    const fullPath = path.resolve(derivative.storagePath);
    const derivativeRoot = path.resolve(dataLayout.runtimeRoot, "library-derivatives");
    if (!isInside(derivativeRoot, fullPath)) return reply.code(409).send({ ok: false, code: "LIBRARY_DERIVATIVE_PATH_INVALID", error: "Derivative storage path is outside the managed cache." });
    if (!(await validateManagedDerivativePath(derivativeRoot, fullPath))) return reply.code(409).send({ ok: false, code: "LIBRARY_DERIVATIVE_PATH_INVALID", error: "Derivative storage path is not a regular managed file." });
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat?.isFile()) return reply.code(404).send({ ok: false, code: "LIBRARY_DERIVATIVE_FILE_MISSING", error: "Derivative bytes are not available." });
    const kind = String(derivative.kind || "preview").replace(/[^a-z0-9_-]+/gi, "-");
    return sendStoredResource(request, reply, {
      filePath: fullPath,
      mimeType: derivative.mimeType || "application/octet-stream",
      originalName: `${access.item.title || "Library item"}-${kind}`,
      requestedInline: true,
      checksumSha256: derivative.contentChecksumSha256 || null,
      // The URL is stable while permissions and copyright holds are not.
      cacheControl: "private, no-store",
    });
  });

  async function requireCollectionAccess(request: FastifyRequest, reply: FastifyReply, collectionId: string, minimum: LibraryCollectionPermission = "view") {
    const auth = await requireLibraryTool(request, reply, "view");
    if (!auth) return null;
    const collection = await prisma.libraryCollection.findUnique({ where: { id: collectionId }, include: { grants: { where: { userId: auth.user.id }, select: { userId: true, role: true } } } });
    if (!collection || collection.archived) {
      reply.code(404).send({ ok: false, code: "LIBRARY_COLLECTION_NOT_FOUND", error: "Library collection not found." });
      return null;
    }
    const role = libraryCollectionRole(collection, auth.user.id, Boolean(auth.decorated?.isAdmin));
    if (!libraryCollectionCan(role, minimum)) {
      reply.code(403).send({ ok: false, code: "LIBRARY_COLLECTION_ACCESS_DENIED", error: "This collection is not available at the requested access level." });
      return null;
    }
    return { ...auth, collection, role: role as Exclude<LibraryCollectionRole, null> };
  }

  // Personnel Record attachments are governed by the Records domain, not
  // ordinary Library ACLs. Never expose their metadata or URLs via collections.
  async function filterCollectionItems(request: FastifyRequest, rows: any[]) {
    if (!rows.length) return [];
    const attached = await prisma.personnelRecordAttachment.findMany({
      where: { libraryItemId: { in: rows.map((row) => row.id) } }, select: { libraryItemId: true },
    });
    const protectedIds = new Set(attached.map((entry: any) => entry.libraryItemId));
    return libraryAccess.filterItems(request, rows.filter((item) => !protectedIds.has(item.id)), "view");
  }

  // Recursive collections only target folders the caller can view. Resolve the
  // current hierarchy at read time so a moved subfolder follows its parent.
  async function authorizedCollectionScope(request: FastifyRequest, reply: FastifyReply, compiled: ReturnType<typeof librarySmartCollectionWhere>, db: any = prisma) {
    const scope = compiled.query.folderScope;
    if (!scope) return null;
    const anchor = await db.libraryItem.findUnique({ where: { id: scope.folderId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
    if (!anchor || anchor.type !== "folder" || anchor.lifecycleState === "destroyed" || ["trashed", "archived"].includes(anchor.status)) {
      reply.code(404).send({ ok: false, code: "LIBRARY_COLLECTION_FOLDER_NOT_FOUND", error: "Smart Collection folder is unavailable." });
      return false;
    }
    if (!(await libraryAccess.canAccessItem(request, anchor, "view"))) {
      reply.code(403).send({ ok: false, code: "LIBRARY_COLLECTION_FOLDER_DENIED", error: "The folder scope is not accessible." });
      return false;
    }
    try {
      const ids = await librarySmartCollectionDescendantFolders(anchor.id, (parents, take) => db.libraryItem.findMany({
        where: { type: "folder", parentId: { in: parents }, status: { notIn: ["trashed", "archived"] }, lifecycleState: { not: "destroyed" } },
        select: { id: true }, take,
      }));
      return { parentId: { in: ids } };
    } catch {
      reply.code(409).send({ ok: false, code: "LIBRARY_COLLECTION_FOLDER_SCOPE_LIMIT", error: "Folder hierarchy is too large or deeply nested for this Smart Collection." });
      return false;
    }
  }

  function serializeCollection(collection: any, role: Exclude<LibraryCollectionRole, null> = "owner") {
    return {
      id: collection.id,
      ownerId: collection.ownerId,
      projectId: collection.projectId,
      name: collection.name,
      description: collection.description,
      kind: collection.kind,
      query: parseJson(collection.queryJson, {}),
      archived: Boolean(collection.archived),
      revision: collection.revision,
      // Membership counts can include inaccessible files; keep them private to the owner.
      itemCount: role === "owner" ? collection._count?.memberships ?? undefined : undefined,
      accessRole: role,
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
    };
  }

  app.get("/api/library/collections", async (request, reply) => {
    const auth = await requireLibraryTool(request, reply, "view");
    if (!auth) return;
    const rows = await prisma.libraryCollection.findMany({
      where: { archived: false, OR: [{ ownerId: auth.user.id }, { grants: { some: { userId: auth.user.id } } }] },
      include: { grants: { where: { userId: auth.user.id }, select: { userId: true, role: true } }, _count: { select: { memberships: true } } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 500,
    });
    return { ok: true, collections: rows.map((collection: any) => serializeCollection(collection, libraryCollectionRole(collection, auth.user.id, Boolean(auth.decorated?.isAdmin)) || "viewer")) };
  });

  app.post("/api/library/collections", async (request, reply) => {
    const auth = await requireLibraryTool(request, reply, "view");
    if (!auth) return;
    const body = z.object({ name: z.string().trim().min(1).max(160), description: z.string().trim().max(1000).nullable().optional(), kind: collectionKindSchema.default("manual"), projectId: idSchema.nullable().optional(), query: z.unknown().optional() }).parse(request.body || {});
    const normalized = body.kind === "smart" ? librarySmartCollectionWhere(body.query || {}) : null;
    if (normalized?.query.folderScope && (await authorizedCollectionScope(request, reply, normalized)) === false) return;
    const row = await prisma.libraryCollection.create({ data: { ownerId: auth.user.id, projectId: body.projectId || null, name: body.name, description: body.description || null, kind: body.kind, queryJson: JSON.stringify(normalized?.query || {}) }, include: { _count: { select: { memberships: true } } } });
    return { ok: true, collection: serializeCollection(row) };
  });

  app.patch("/api/library/collections/:collectionId", async (request, reply) => {
    const { collectionId } = z.object({ collectionId: idSchema }).parse(request.params);
    const access = await requireCollectionAccess(request, reply, collectionId, "manage");
    if (!access) return;
    const body = z.object({ name: z.string().trim().min(1).max(160).optional(), description: z.string().trim().max(1000).nullable().optional(), query: z.unknown().optional(), expectedRevision: z.number().int().positive() }).parse(request.body || {});
    if (body.expectedRevision !== access.collection.revision) return reply.code(409).send({ ok: false, code: "REVISION_CONFLICT", error: "Collection changed on another client.", current: serializeCollection(access.collection, access.role) });
    if (access.collection.kind !== "smart" && body.query !== undefined) return reply.code(409).send({ ok: false, code: "LIBRARY_COLLECTION_QUERY_INVALID", error: "Manual collections do not use a smart query." });
    const updatedQuery = body.query !== undefined ? librarySmartCollectionWhere(body.query) : null;
    if (updatedQuery?.query.folderScope && (await authorizedCollectionScope(request, reply, updatedQuery)) === false) return;
    const queryJson = updatedQuery ? JSON.stringify(updatedQuery.query) : undefined;
    const changed = await prisma.libraryCollection.updateMany({ where: { id: collectionId, archived: false, revision: body.expectedRevision }, data: { ...(body.name !== undefined ? { name: body.name } : {}), ...(body.description !== undefined ? { description: body.description } : {}), ...(queryJson !== undefined ? { queryJson } : {}), revision: { increment: 1 } } });
    if (changed.count !== 1) return reply.code(409).send({ ok: false, code: "REVISION_CONFLICT", error: "Collection changed during the update. Refresh and retry." });
    const row = await prisma.libraryCollection.findUnique({ where: { id: collectionId }, include: { _count: { select: { memberships: true } } } });
    return { ok: true, collection: serializeCollection(row, access.role) };
  });

  app.delete("/api/library/collections/:collectionId", async (request, reply) => {
    const { collectionId } = z.object({ collectionId: idSchema }).parse(request.params);
    const access = await requireCollectionAccess(request, reply, collectionId, "manage");
    if (!access) return;
    const body = z.object({ expectedRevision: z.number().int().positive() }).parse(request.body || {});
    if (body.expectedRevision !== access.collection.revision) return reply.code(409).send({ ok: false, code: "REVISION_CONFLICT", error: "Collection changed. Refresh before removing it." });
    const changed = await prisma.libraryCollection.updateMany({ where: { id: collectionId, archived: false, revision: body.expectedRevision }, data: { archived: true, revision: { increment: 1 } } });
    if (changed.count !== 1) return reply.code(409).send({ ok: false, code: "REVISION_CONFLICT", error: "Collection changed during removal. Refresh and retry." });
    return { ok: true };
  });

  // Grant changes are revision-guarded and atomic with the collection revision.
  // A grant only opens the collection; each listed item still passes Library ACLs.
  app.get("/api/library/collections/:collectionId/shares", async (request, reply) => {
    const { collectionId } = z.object({ collectionId: idSchema }).parse(request.params);
    const access = await requireCollectionAccess(request, reply, collectionId, "manage");
    if (!access) return;
    const grants = await prisma.libraryCollectionGrant.findMany({
      where: { collectionId }, include: { user: { select: { id: true, displayName: true, username: true, archived: true } } },
      orderBy: [{ createdAt: "asc" }, { userId: "asc" }], take: 500,
    });
    return { ok: true, revision: access.collection.revision, grants: grants.map((entry: any) => ({ userId: entry.userId, role: entry.role, user: entry.user })) };
  });

  app.put("/api/library/collections/:collectionId/shares/:userId", async (request, reply) => {
    const { collectionId, userId } = z.object({ collectionId: idSchema, userId: idSchema }).parse(request.params);
    const access = await requireCollectionAccess(request, reply, collectionId, "manage");
    if (!access) return;
    const body = z.object({ role: z.enum(["viewer", "editor"]), expectedRevision: z.number().int().positive() }).parse(request.body || {});
    if (userId === access.collection.ownerId) return reply.code(409).send({ ok: false, code: "LIBRARY_COLLECTION_OWNER_GRANT", error: "Collection owner access cannot be changed by sharing." });
    const recipient = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, archived: true, accountState: true, accessExpiresAt: true } });
    if (!recipient || recipient.archived || recipient.accountState !== "ACTIVE" || (recipient.accessExpiresAt && recipient.accessExpiresAt <= new Date())) {
      return reply.code(409).send({ ok: false, code: "LIBRARY_COLLECTION_RECIPIENT_UNAVAILABLE", error: "Choose an active studio member for collection access." });
    }
    try {
      const updated = await prisma.$transaction(async (tx: any) => {
        const changed = await tx.libraryCollection.updateMany({ where: { id: collectionId, archived: false, revision: body.expectedRevision }, data: { revision: { increment: 1 } } });
        if (changed.count !== 1) return null;
        await tx.libraryCollectionGrant.upsert({ where: { collectionId_userId: { collectionId, userId } }, create: { collectionId, userId, role: body.role, grantedById: access.user.id }, update: { role: body.role, grantedById: access.user.id } });
        await tx.activityEvent.create({ data: { userId: access.user.id, type: "access", entityType: "library_collection", entityId: collectionId, title: "Library collection access granted", message: `Collection ${collectionId}: ${body.role} access granted to ${userId}`, metadata: JSON.stringify({ collectionId, recipientId: userId, role: body.role, action: "grant" }) } });
        return tx.libraryCollection.findUnique({ where: { id: collectionId } });
      }, { isolationLevel: "Serializable" });
      if (!updated) return reply.code(409).send({ ok: false, code: "LIBRARY_COLLECTION_REVISION_CONFLICT", error: "Collection sharing changed. Refresh before retrying." });
      return { ok: true, collection: serializeCollection(updated, access.role) };
    } catch (error) {
      if ((error as any)?.code === "P2034") return reply.code(409).send({ ok: false, code: "LIBRARY_COLLECTION_REVISION_CONFLICT", error: "Concurrent sharing update. Refresh before retrying." });
      throw error;
    }
  });

  app.delete("/api/library/collections/:collectionId/shares/:userId", async (request, reply) => {
    const { collectionId, userId } = z.object({ collectionId: idSchema, userId: idSchema }).parse(request.params);
    const access = await requireCollectionAccess(request, reply, collectionId, "manage");
    if (!access) return;
    const body = z.object({ expectedRevision: z.number().int().positive() }).parse(request.body || {});
    try {
      const updated = await prisma.$transaction(async (tx: any) => {
        const changed = await tx.libraryCollection.updateMany({ where: { id: collectionId, archived: false, revision: body.expectedRevision }, data: { revision: { increment: 1 } } });
        if (changed.count !== 1) return null;
        const removed = await tx.libraryCollectionGrant.deleteMany({ where: { collectionId, userId } });
        if (removed.count) await tx.activityEvent.create({ data: { userId: access.user.id, type: "access", entityType: "library_collection", entityId: collectionId, title: "Library collection access revoked", message: `Collection ${collectionId}: access revoked for ${userId}`, metadata: JSON.stringify({ collectionId, recipientId: userId, action: "revoke" }) } });
        return tx.libraryCollection.findUnique({ where: { id: collectionId } });
      }, { isolationLevel: "Serializable" });
      if (!updated) return reply.code(409).send({ ok: false, code: "LIBRARY_COLLECTION_REVISION_CONFLICT", error: "Collection sharing changed. Refresh before retrying." });
      return { ok: true, collection: serializeCollection(updated, access.role) };
    } catch (error) {
      if ((error as any)?.code === "P2034") return reply.code(409).send({ ok: false, code: "LIBRARY_COLLECTION_REVISION_CONFLICT", error: "Concurrent sharing update. Refresh before retrying." });
      throw error;
    }
  });

  app.get("/api/library/collections/:collectionId/items", async (request, reply) => {
    const { collectionId } = z.object({ collectionId: idSchema }).parse(request.params);
    const access = await requireCollectionAccess(request, reply, collectionId);
    if (!access) return;
    const params = z.object({ limit: z.coerce.number().int().min(1).max(250).default(100), cursor: z.string().max(32).optional() }).parse(request.query || {});
    let offset: number;
    try { offset = libraryCollectionOffset(params.cursor, access.collection.revision); }
    catch (error) {
      if (error instanceof LibraryCollectionPageError) return reply.code(error.code === "LIBRARY_COLLECTION_CURSOR_STALE" ? 409 : 400).send({ ok: false, code: error.code, error: error.message });
      throw error;
    }
    const limit = params.limit;
    let rows: any[] = [];
    let query: any = null;
    let hasMore = false;
    if (access.collection.kind === "smart") {
      const compiled = librarySmartCollectionWhere(parseJson(access.collection.queryJson, {}));
      query = compiled.query;
      const folderWhere = await authorizedCollectionScope(request, reply, compiled);
      if (folderWhere === false) return;
      const where = { AND: [compiled.where, ...(access.collection.projectId ? [{ projectId: access.collection.projectId }] : []), ...(folderWhere ? [folderWhere] : [])] };
      const sorts = librarySmartCollectionOrderBy(query);
      const orderBy = sorts.some((sort) => Object.prototype.hasOwnProperty.call(sort, "id")) ? sorts : [...sorts, { id: "asc" }];
      const results = await prisma.libraryItem.findMany({ where, include: { project: { include: { memberships: { where: { status: "active" } } } } }, orderBy, skip: offset, take: limit + 1 });
      const page = libraryCollectionPage(results, offset, limit, access.collection.revision);
      hasMore = page.pagination.hasMore;
      rows = [...page.entries];
    } else {
      const results = await prisma.libraryCollectionMembership.findMany({ where: { collectionId }, include: { item: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } }, orderBy: [{ addedAt: "desc" }, { itemId: "asc" }], skip: offset, take: limit + 1 });
      const page = libraryCollectionPage(results, offset, limit, access.collection.revision);
      hasMore = page.pagination.hasMore;
      rows = page.entries.map((entry: any) => entry.item).filter(Boolean);
    }
    const visible = await filterCollectionItems(request, rows);
    return { ok: true, collection: serializeCollection(access.collection, access.role), query, items: visible.map(serializeCollectionLibraryItem), pagination: { cursor: hasMore ? `v${access.collection.revision}:o${offset + limit}` : null, hasMore, limit, loaded: visible.length } };
  });

  // Unlike the paginated collection browser, this is a complete, bounded
  // server-owned selection. Collection access and the collection revision are
  // re-evaluated within the same read snapshot as its members. A grant never
  // grants Library item access, and Records attachments are excluded here too.
  app.post("/api/library/collections/:collectionId/select-matching", async (request, reply) => {
    const { collectionId } = z.object({ collectionId: idSchema }).parse(request.params);
    const body = z.object({ expectedCollectionRevision: z.number().int().positive() }).parse(request.body || {});
    const auth = await requireCollectionAccess(request, reply, collectionId, "view");
    if (!auth) return;
    const context = await libraryAccess.accessContext(request);
    try {
      const result = await prisma.$transaction(async (tx: any) => {
        const collection = await tx.libraryCollection.findUnique({
          where: { id: collectionId },
          include: { grants: { where: { userId: auth.user.id }, select: { userId: true, role: true } } },
        });
        if (!collection || collection.archived || !libraryCollectionCan(libraryCollectionRole(collection, auth.user.id, Boolean(auth.decorated?.isAdmin)), "view")) {
          return { error: { status: 403, code: "LIBRARY_COLLECTION_ACCESS_DENIED", message: "Collection access changed. Refresh before selecting." } };
        }
        if (collection.revision !== body.expectedCollectionRevision) {
          return { error: { status: 409, code: "LIBRARY_COLLECTION_REVISION_CONFLICT", message: "Collection changed. Refresh before selecting." } };
        }
        let where: any = null;
        let orderBy: any = null;
        if (collection.kind === "smart") {
          const compiled = librarySmartCollectionWhere(parseJson(collection.queryJson, {}));
          const folderWhere = await authorizedCollectionScope(request, reply, compiled, tx);
          if (folderWhere === false) return { handled: true };
          where = { AND: [compiled.where, ...(collection.projectId ? [{ projectId: collection.projectId }] : []), ...(folderWhere ? [folderWhere] : [])] };
          const sorts = librarySmartCollectionOrderBy(compiled.query);
          orderBy = sorts.some((sort) => Object.prototype.hasOwnProperty.call(sort, "id")) ? sorts : [...sorts, { id: "asc" }];
        }
        const selected = await collectLibraryMatchingSelection({
          fetchPage: async (skip, take) => {
            if (collection.kind === "smart") return tx.libraryItem.findMany({
              where, include: { project: { include: { memberships: { where: { status: "active" } } } } },
              orderBy, skip, take,
            });
            const members = await tx.libraryCollectionMembership.findMany({
              where: { collectionId },
              include: { item: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } },
              orderBy: [{ addedAt: "desc" }, { itemId: "asc" }], skip, take,
            });
            // Referential integrity should make these non-null. If it doesn't,
            // reject the snapshot instead of claiming a complete selection.
            if (members.some((member: any) => !member.item)) throw new LibraryMatchingSelectionError("LIBRARY_MATCHING_SCAN_LIMIT");
            return members.map((member: any) => member.item);
          },
          filterVisible: async (rows) => {
            if (!rows.length) return [];
            const records = await tx.personnelRecordAttachment.findMany({
              where: { libraryItemId: { in: rows.map((item: any) => item.id) } },
              select: { libraryItemId: true },
            });
            const protectedIds = new Set(records.map((entry: any) => entry.libraryItemId));
            return rows.filter((item: any) => !protectedIds.has(item.id) &&
              item.lifecycleState !== "destroyed" && libraryAccess.visibleFor(context, item, "view"));
          },
        });
        return { selected, revision: collection.revision };
      }, { isolationLevel: "RepeatableRead", timeout: 15_000 });
      if ("handled" in result) return;
      if ("error" in result) return reply.code(result.error.status).send({ ok: false, code: result.error.code, error: result.error.message });
      return {
        ok: true, collectionId, collectionRevision: result.revision,
        selectedCount: result.selected.length, items: result.selected.map(serializeCollectionLibraryItem),
      };
    } catch (error) {
      if (error instanceof LibraryMatchingSelectionError) return reply.code(409).send({
        ok: false, code: error.code,
        error: error.code === "LIBRARY_MATCHING_TOO_LARGE"
          ? "This collection has more than 200 accessible items. Refine its saved query or work in smaller batches. Nothing was selected."
          : error.message,
      });
      if (["P2028", "P2034"].includes(String((error as any)?.code || ""))) return reply.code(409).send({
        ok: false, code: "LIBRARY_SELECTION_SNAPSHOT_RETRY", error: "The collection snapshot could not finish safely. Refresh and retry; no items were selected.",
      });
      throw error;
    }
  });

  app.post("/api/library/collections/:collectionId/items", async (request, reply) => {
    const { collectionId } = z.object({ collectionId: idSchema }).parse(request.params);
    const access = await requireCollectionAccess(request, reply, collectionId, "edit");
    if (!access) return;
    if (access.collection.kind !== "manual") return reply.code(409).send({ ok: false, code: "LIBRARY_COLLECTION_MANAGED", error: "Smart collection membership is derived from its query." });
    const body = z.object({
      itemIds: z.array(idSchema).min(1).max(200).refine((ids) => new Set(ids).size === ids.length, "Select distinct Library items."),
      expectedRevisions: z.record(z.number().int().positive()),
      expectedCollectionRevision: z.number().int().positive(),
    }).parse(request.body || {});
    if (access.collection.revision !== body.expectedCollectionRevision) return reply.code(409).send({ ok: false, code: "LIBRARY_COLLECTION_REVISION_CONFLICT", error: "Collection changed on another client. Refresh and retry." });
    const rows = await prisma.libraryItem.findMany({ where: { id: { in: body.itemIds }, lifecycleState: { not: "destroyed" } }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
    const visible = await filterCollectionItems(request, rows);
    if (visible.length !== body.itemIds.length) return reply.code(403).send({ ok: false, code: "LIBRARY_COLLECTION_ITEM_DENIED", error: "One or more selected items cannot be added to this collection." });
    if (visible.some((item: any) => body.expectedRevisions[item.id] !== item.revision)) return reply.code(409).send({ ok: false, code: "LIBRARY_COLLECTION_ITEM_CONFLICT", error: "A selected Library item changed. Refresh and retry." });
    try {
      const result = await prisma.$transaction(async (tx: any) => {
        const current = await tx.libraryItem.findMany({ where: { id: { in: body.itemIds }, lifecycleState: { not: "destroyed" } }, select: { id: true, revision: true } });
        if (current.length !== body.itemIds.length || current.some((item: any) => body.expectedRevisions[item.id] !== item.revision)) throw new Error("LIBRARY_COLLECTION_ITEM_CONFLICT");
        const changed = await tx.libraryCollection.updateMany({ where: { id: collectionId, ownerId: access.collection.ownerId, archived: false, revision: body.expectedCollectionRevision }, data: { revision: { increment: 1 } } });
        if (changed.count !== 1) throw new Error("LIBRARY_COLLECTION_REVISION_CONFLICT");
        const inserted = await tx.libraryCollectionMembership.createMany({ data: body.itemIds.map((itemId) => ({ collectionId, itemId, addedById: access.user.id })), skipDuplicates: true });
        const updated = await tx.libraryCollection.findUnique({ where: { id: collectionId }, include: { _count: { select: { memberships: true } } } });
        return { added: inserted.count, collection: serializeCollection(updated, access.role) };
      }, { isolationLevel: "Serializable" });
      return { ok: true, ...result };
    } catch (error) {
      const conflict = (error as Error)?.message;
      if (["LIBRARY_COLLECTION_ITEM_CONFLICT", "LIBRARY_COLLECTION_REVISION_CONFLICT"].includes(conflict) || (error as any)?.code === "P2034") return reply.code(409).send({ ok: false, code: "LIBRARY_COLLECTION_REVISION_CONFLICT", error: "The collection or selected items changed during this operation. Nothing was added. Refresh and retry." });
      throw error;
    }
  });

  app.delete("/api/library/collections/:collectionId/items", async (request, reply) => {
    const { collectionId } = z.object({ collectionId: idSchema }).parse(request.params);
    const access = await requireCollectionAccess(request, reply, collectionId, "edit");
    if (!access) return;
    if (access.collection.kind !== "manual") return reply.code(409).send({ ok: false, code: "LIBRARY_COLLECTION_MANAGED", error: "Smart collection membership is derived from its query." });
    const body = z.object({ itemIds: z.array(idSchema).min(1).max(200).refine((ids) => new Set(ids).size === ids.length, "Select distinct Library items."), expectedCollectionRevision: z.number().int().positive() }).parse(request.body || {});
    if (access.collection.revision !== body.expectedCollectionRevision) return reply.code(409).send({ ok: false, code: "LIBRARY_COLLECTION_REVISION_CONFLICT", error: "Collection changed on another client. Refresh and retry." });
    try {
      const result = await prisma.$transaction(async (tx: any) => {
        const changed = await tx.libraryCollection.updateMany({ where: { id: collectionId, ownerId: access.collection.ownerId, archived: false, revision: body.expectedCollectionRevision }, data: { revision: { increment: 1 } } });
        if (changed.count !== 1) throw new Error("LIBRARY_COLLECTION_REVISION_CONFLICT");
        const removed = await tx.libraryCollectionMembership.deleteMany({ where: { collectionId, itemId: { in: body.itemIds } } });
        const current = await tx.libraryCollection.findUnique({ where: { id: collectionId }, include: { _count: { select: { memberships: true } } } });
        return { removed: removed.count, collection: serializeCollection(current, access.role) };
      }, { isolationLevel: "Serializable" });
      return { ok: true, ...result };
    } catch (error) {
      if ((error as Error)?.message === "LIBRARY_COLLECTION_REVISION_CONFLICT" || (error as any)?.code === "P2034") return reply.code(409).send({ ok: false, code: "LIBRARY_COLLECTION_REVISION_CONFLICT", error: "Collection membership changed during this operation. Refresh and retry." });
      throw error;
    }
  });

  app.delete("/api/library/collections/:collectionId/items/:itemId", async (request, reply) => {
    const { collectionId, itemId } = z.object({ collectionId: idSchema, itemId: idSchema }).parse(request.params);
    const access = await requireCollectionAccess(request, reply, collectionId, "edit");
    if (!access) return;
    if (access.collection.kind !== "manual") return reply.code(409).send({ ok: false, code: "LIBRARY_COLLECTION_MANAGED", error: "Smart collection membership is derived from its query." });
    const body = z.object({ expectedCollectionRevision: z.number().int().positive() }).parse(request.body || {});
    const result = await prisma.$transaction(async (tx: any) => {
      const changed = await tx.libraryCollection.updateMany({ where: { id: collectionId, ownerId: access.collection.ownerId, archived: false, revision: body.expectedCollectionRevision }, data: { revision: { increment: 1 } } });
      if (changed.count !== 1) return null;
      const removed = await tx.libraryCollectionMembership.deleteMany({ where: { collectionId, itemId } });
      return removed.count;
    }, { isolationLevel: "Serializable" }).catch((error: any) => {
      if (error?.code === "P2034") return null;
      throw error;
    });
    if (result === null) return reply.code(409).send({ ok: false, code: "LIBRARY_COLLECTION_REVISION_CONFLICT", error: "Collection changed. Refresh before removing an item." });
    return { ok: true, removed: result };
  });

  app.get("/api/library/:itemId/review", async (request, reply) => {
    const { itemId } = z.object({ itemId: idSchema }).parse(request.params);
    const access = await requireItem(request, reply, itemId, "view");
    if (!access) return;
    const [watch, watchers, lock, openAnnotations] = await Promise.all([
      prisma.libraryWatch.findUnique({ where: { userId_itemId: { userId: access.user.id, itemId } } }),
      prisma.libraryWatch.count({ where: { itemId } }),
      prisma.libraryAssetLock.findUnique({ where: { itemId } }),
      prisma.entityComment.count({ where: { entityType: "library", entityId: itemId, resolved: false } }),
    ]);
    return { ok: true, review: { state: access.item.reviewState || "draft", reviewerId: access.item.reviewerId, reviewDueAt: access.item.reviewDueAt, approvedAt: access.item.approvedAt, watched: Boolean(watch), watcherCount: watchers, openAnnotations, lock: serializeLock(lock, requestDeviceProof(request)) } };
  });

  app.patch("/api/library/:itemId/review", async (request, reply) => {
    const { itemId } = z.object({ itemId: idSchema }).parse(request.params);
    const access = await requireItem(request, reply, itemId, "edit");
    if (!access) return;
    const body = z.object({ state: reviewStateSchema.optional(), reviewerId: idSchema.nullable().optional(), reviewDueAt: z.coerce.date().nullable().optional(), note: z.string().trim().max(1000).nullable().optional(), expectedRevision: z.number().int().positive().optional() }).parse(request.body || {});
    if (body.expectedRevision !== undefined && body.expectedRevision !== access.item.revision) return reply.code(409).send({ ok: false, code: "REVISION_CONFLICT", error: "Library review changed on another client." });
    const nextState = body.state || access.item.reviewState || "draft";
    const now = new Date();
    const updated = await prisma.libraryItem.update({ where: { id: itemId }, data: {
      ...(body.state ? { reviewState: nextState, approvedAt: body.state === "approved" ? now : body.state !== access.item.reviewState ? null : access.item.approvedAt } : {}),
      ...(body.reviewerId !== undefined ? { reviewerId: body.reviewerId } : {}),
      ...(body.reviewDueAt !== undefined ? { reviewDueAt: body.reviewDueAt } : {}),
      ...(body.note !== undefined ? { lifecycleNotes: body.note } : {}),
      lastEditorId: access.user.id,
      revision: { increment: 1 },
    } });
    const watchers = await prisma.libraryWatch.findMany({ where: { itemId }, select: { userId: true } });
    const notifyIds = [...new Set([...watchers.map((entry: any) => entry.userId), updated.reviewerId].filter(Boolean).filter((id) => id !== access.user.id))];
    collaborationRuntime.recordAction({ id: `library-review:${itemId}:${Date.now()}`, userId: access.user.id, userName: access.user.displayName || access.user.username || "User", tool: "library", resourceId: itemId, projectId: updated.projectId || null, entity: { entityType: "library", entityId: itemId, label: updated.title }, action: "review-updated", detail: `${access.item.reviewState || "draft"} → ${nextState}`, createdAt: Date.now() });
    collaborationRuntime.scheduleBroadcast("library", itemId, true);
    await logActivity({ userId: access.user.id, projectId: updated.projectId, type: "review", entityType: "library", entityId: itemId, title: "Library review updated", message: `${updated.title}: ${nextState}`, metadata: { reviewState: nextState, previousReviewState: access.item.reviewState || "draft", reviewerId: updated.reviewerId || null, userIds: notifyIds, notifyInbox: notifyIds.length > 0 } });
    return { ok: true, item: updated };
  });

  app.post("/api/library/:itemId/watch", async (request, reply) => {
    const { itemId } = z.object({ itemId: idSchema }).parse(request.params);
    const access = await requireItem(request, reply, itemId, "view");
    if (!access) return;
    const watch = await prisma.libraryWatch.upsert({ where: { userId_itemId: { userId: access.user.id, itemId } }, update: {}, create: { userId: access.user.id, itemId } });
    return { ok: true, watch };
  });

  app.delete("/api/library/:itemId/watch", async (request, reply) => {
    const { itemId } = z.object({ itemId: idSchema }).parse(request.params);
    const access = await requireItem(request, reply, itemId, "view");
    if (!access) return;
    await prisma.libraryWatch.deleteMany({ where: { userId: access.user.id, itemId } });
    return { ok: true };
  });

  app.get("/api/library/:itemId/lock", async (request, reply) => {
    const { itemId } = z.object({ itemId: idSchema }).parse(request.params);
    if (!(await requireItem(request, reply, itemId, "view"))) return;
    const lock = await prisma.libraryAssetLock.findUnique({ where: { itemId } });
    return { ok: true, lock: serializeLock(lock, requestDeviceProof(request)), expired: Boolean(lock && !libraryLockIsActive(lock)) };
  });

  app.post("/api/library/:itemId/lock", async (request, reply) => {
    const { itemId } = z.object({ itemId: idSchema }).parse(request.params);
    const access = await requireItem(request, reply, itemId, "edit");
    if (!access) return;
    const proof = requireVerifiedLockDevice(request, reply);
    if (!proof) return;
    const body = z.object({ ttlSeconds: z.number().int().min(60).max(86400).default(1800), sourceKind: z.enum(["cluster", "desktop", "git-lfs", "external"]).default("cluster"), sourceRef: z.string().trim().max(500).nullable().optional(), reason: z.string().trim().max(500).nullable().optional() }).parse(request.body || {});
    const current = await prisma.libraryAssetLock.findUnique({ where: { itemId } });
    const conflict = libraryLockConflict(current, access.user.id);
    if (conflict) return reply.code(409).send({ ok: false, ...conflict, error: "This Library asset is locked by another user." });
    if (current && libraryLockIsActive(current) && current.ownerId === access.user.id && current.ownerDeviceId && !lockOwnedByProof(current, proof)) {
      return reply.code(409).send({ ok: false, code: "LIBRARY_LOCK_DEVICE_CONFLICT", error: "This Library asset is already locked by your account on another verified device.", lock: serializeLock(current, proof) });
    }
    const expiresAt = new Date(Date.now() + body.ttlSeconds * 1000);
    const lock = await prisma.libraryAssetLock.upsert({ where: { itemId }, update: { ownerId: access.user.id, ownerDeviceId: proof.deviceId, ownerDeviceProofFingerprint: proof.keyFingerprint, state: "active", sourceKind: body.sourceKind, sourceRef: body.sourceRef || null, acquiredAt: current && libraryLockIsActive(current) ? current.acquiredAt : new Date(), expiresAt, releasedAt: null, releasedById: null, forceReleased: false, reason: body.reason || null, revision: { increment: 1 } }, create: { itemId, ownerId: access.user.id, ownerDeviceId: proof.deviceId, ownerDeviceProofFingerprint: proof.keyFingerprint, state: "active", sourceKind: body.sourceKind, sourceRef: body.sourceRef || null, expiresAt, reason: body.reason || null } });
    collaborationRuntime.scheduleBroadcast("library", itemId, true);
    return { ok: true, lock: serializeLock(lock, proof) };
  });

  app.post("/api/library/:itemId/lock/heartbeat", async (request, reply) => {
    const { itemId } = z.object({ itemId: idSchema }).parse(request.params);
    const access = await requireItem(request, reply, itemId, "edit");
    if (!access) return;
    const proof = requireVerifiedLockDevice(request, reply);
    if (!proof) return;
    const body = z.object({ ttlSeconds: z.number().int().min(60).max(86400).default(1800), expectedRevision: z.number().int().positive().optional() }).parse(request.body || {});
    const current = await prisma.libraryAssetLock.findUnique({ where: { itemId } });
    if (!current || current.ownerId !== access.user.id || !libraryLockIsActive(current)) return reply.code(409).send({ ok: false, code: "LIBRARY_LOCK_NOT_OWNED", error: "No active Library lock owned by this user." });
    if (current.ownerDeviceId && !lockOwnedByProof(current, proof)) return reply.code(409).send({ ok: false, code: "LIBRARY_LOCK_DEVICE_CONFLICT", error: "This edit lock belongs to another verified device.", lock: serializeLock(current, proof) });
    if (body.expectedRevision !== undefined && body.expectedRevision !== current.revision) return reply.code(409).send({ ok: false, code: "REVISION_CONFLICT", error: "Library lock changed on another client.", current: serializeLock(current, proof) });
    const lock = await prisma.libraryAssetLock.update({ where: { itemId }, data: { ownerDeviceId: proof.deviceId, ownerDeviceProofFingerprint: proof.keyFingerprint, expiresAt: new Date(Date.now() + body.ttlSeconds * 1000), revision: { increment: 1 } } });
    return { ok: true, lock: serializeLock(lock, proof) };
  });

  app.delete("/api/library/:itemId/lock", async (request, reply) => {
    const { itemId } = z.object({ itemId: idSchema }).parse(request.params);
    const access = await requireItem(request, reply, itemId, "view");
    if (!access) return;
    const body = z.object({ force: z.boolean().default(false), reason: z.string().trim().max(500).nullable().optional() }).parse(request.body || {});
    const current = await prisma.libraryAssetLock.findUnique({ where: { itemId } });
    if (!current || !libraryLockIsActive(current)) return { ok: true, lock: serializeLock(current, requestDeviceProof(request)) };
    const manage = body.force && await libraryAccess.canAccessItem(request, access.item, "manage");
    let forceReleased = current.ownerId !== access.user.id;
    if (current.ownerId === access.user.id && current.ownerDeviceId) {
      const proof = requestDeviceProof(request);
      if (!proof?.verified || !lockOwnedByProof(current, proof)) {
        if (!manage) return reply.code(409).send({ ok: false, code: "LIBRARY_LOCK_DEVICE_CONFLICT", error: "This edit lock belongs to another verified device. A Library manager can force-release it.", lock: serializeLock(current, proof) });
        forceReleased = true;
      }
    } else if (current.ownerId !== access.user.id && !manage) {
      return reply.code(409).send({ ok: false, code: "LIBRARY_LOCK_CONFLICT", error: "Only the lock owner or a Library manager can release this lock.", lock: serializeLock(current, requestDeviceProof(request)) });
    }
    const lock = await prisma.libraryAssetLock.update({ where: { itemId }, data: { state: "released", releasedAt: new Date(), releasedById: access.user.id, forceReleased, reason: body.reason || current.reason || null, revision: { increment: 1 } } });
    collaborationRuntime.scheduleBroadcast("library", itemId, true);
    await logActivity({ userId: access.user.id, projectId: access.item.projectId, type: "updated", entityType: "library", entityId: itemId, title: forceReleased ? "Library lock force-released" : "Library lock released", message: access.item.title, metadata: { lockId: lock.id, previousOwnerId: current.ownerId, sourceKind: current.sourceKind, sourceRef: current.sourceRef, force: forceReleased } });
    return { ok: true, lock: serializeLock(lock, requestDeviceProof(request)) };
  });
}

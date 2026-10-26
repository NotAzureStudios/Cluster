import { resolveLibraryEffectiveRetention } from "./library-effective-retention.js";
import { isLibraryRetentionActive, libraryMetadataMutationDenial } from "./library-retention-relocation.js";
import { createHash } from "node:crypto";
import type { BackgroundJobQueue } from "../jobs/job-queue-service.js";
import { serializeBackgroundJob } from "../jobs/job-queue-service.js";
import { libraryBulkMetadataRequestSchema, libraryBulkSelectionDigest } from "./library-bulk-job-contract.js";
import { hierarchyMoveSchema, hierarchyMoveSubmitSchema, inspectLibraryHierarchyMove, LIBRARY_HIERARCHY_IMPACT_LIMIT } from "./library-hierarchy-move.js";
import { hierarchyLifecycleSchema, hierarchyLifecycleSubmitSchema, inspectLibraryHierarchyLifecycle } from "./library-hierarchy-lifecycle.js";
import { filterLibraryBackgroundCandidates } from "./library-bulk-lifecycle.js";
import { resolveLibraryBulkCollectionSelection, LibraryBulkCollectionError } from "./library-bulk-collection-selection.js";
import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  buildLibraryFolderPath,
  libraryDisplayTitle,
  libraryFacetCounts,
  libraryFileExtension,
  libraryMimeGroup,
  libraryPreviewKind,
  librarySort,
  makeLibraryPreviewText,
  normalizeLibraryMetadata,
  parseLibraryMetadata,
  wouldCreateLibraryCycle
} from "../../core/library.js";
import { decodeDataUrl, detectedMimeType, normalizeMimeType, safeFileName, untrustedFileResponseHeaders, uploadContentDisposition } from "../../core/uploads.js";
import { copyrightDisabledResponse, isCopyrightResourceDisabled } from "../../core/copyright-workflow.js";
import { createBlendPreview, ModelPreviewBusyError } from "../../core/blender-preview.js";
import { validateManagedDerivativePath } from "./library-derivative-file-safety.js";
import { ManagedPreviewIOError, openManagedPreviewStream, saveManagedModelThumbnail } from "./library-managed-preview-io.js";
import { LibraryModelPreviewError, modelPreviewAuthorizationSnapshot, modelPreviewFingerprint, resolveAuthorizedModelCompanions } from "./library-model-preview-security.js";
import { libraryFolderRelativePath, type ClusterDataLayout } from "../../core/data-layout.js";
import { computeSyncScopeDigest, decodeSyncCursor, encodeSyncCursor } from "../../core/sync-security.js";
import { BoundedCache } from "../../core/bounded-cache.js";
import { createHttpError } from "../../core/http-errors.js";
import { sendPrivateRevalidated } from "../../core/http-cache.js";
import { consumeCompletedUpload, copyCompletedUploadToFile, resolveCompletedUpload } from "../uploads/upload-session-runtime.js";
import { sendStoredResource } from "../media/resource-delivery.js";
import { libraryItemViewableResource } from "../media/viewable-resource.js";
import { registerPacketRoutes } from "./packet-routes.js";
import type { LibraryAccessService } from "./library-access-service.js";
import { libraryLockIsActive } from "./library-platform-9e2.js";
import { libraryMimeFilter } from "./library-media-filters.js";
import { cancelLibraryDisposition, decideLibraryDisposition, inspectLibraryDisposition, LibraryDispositionError, requestLibraryDisposition, reviewLibraryDisposition } from "./library-disposition.js";
import { inspectLibraryStorageOwnership } from "./library-disposition-ownership.js";
import { inspectLibraryQuarantineSimulation, recordLibraryQuarantineSimulation, withdrawLibraryQuarantineSimulation } from "./library-quarantine-simulation.js";
import { collectLibraryStorageReferences } from "./library-orphan-jobs.js";
import { reviewLibraryOrphanCandidate } from "./library-orphan-review.js";
import { inspectLibraryBulkScope, LibraryBulkScopeLimitError } from "./library-bulk-scope.js";
import { revalidateLibraryBulkTreeWrite, LibraryBulkGuardError } from "./library-bulk-transaction-guard.js";
import { collectLibraryMatchingSelection, LibraryMatchingSelectionError } from "./library-matching-selection.js";
import { applyLibraryBulkTagChange } from "./library-bulk-tags.js";
import { planLibraryBulkRename, LibraryBulkRenameError } from "./library-bulk-rename.js";
import { inspectLibraryBulkGovernance, libraryBulkGovernanceSchema, commitLibraryGovernanceStrengthening } from "./library-bulk-governance.js";
import { inspectLibraryHierarchyGovernance, libraryHierarchyGovernanceSchema } from "./library-hierarchy-governance.js";
import { createLibraryItemSerializer, parseJsonArray, parseModelBundle, parseYouTubeLink } from "./library-item-serialization.js";
import { registerMountedLibraryRoutes } from "./mounted-library-routes.js";
import { scheduleCommittedLibraryStorageRepair } from "./library-storage-scheduling.js";
import {
  createLibraryVersionSnapshot,
  libraryRetentionDecision,
  normalizeLibraryClassification,
  normalizeLibraryLifecycleState
} from "./library-governance.js";

const metadataValueSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const metadataSchema = z.record(metadataValueSchema).optional().default({});
const lifecycleStatusSchema = z.enum(["draft", "active", "in-review", "approved", "needs-update", "deprecated", "archived", "trashed"]);
const libraryClassificationSchema = z.enum(["public", "internal", "confidential", "restricted"]);
const libraryLifecycleSchema = z.enum(["active", "in-review", "approved", "deprecated", "trashed"]);
const libraryCreateTypeSchema = z.enum(["folder", "link", "youtube-video", "youtube-playlist"]);

function pathInsideRoot(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

export type LibraryRouteDependencies = {
  app: FastifyInstance;
  prisma: any;
  uploadRoot: string;
  dataLayout: ClusterDataLayout;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  decorateUserForClient: (user: any) => Promise<any>;
  hasTargetAccess: (user: any, role: string | null | undefined, targetKind: string, targetId: string, project: any | null | undefined, rules: any[], minimum?: string) => boolean;
  hasToolPermission: (user: any, role: string | null | undefined, tool: string, minimum?: string) => boolean;
  serializeUserLite: (user: any) => any;
  storeCompletedUpload: (
    ownerId: string,
    isAdmin: boolean,
    uploadId: string,
    projectId: string,
    kind: "review_asset" | "file",
    originalName: string,
    clientMime?: string,
    destinationFolder?: string,
    reviewMedium?: any,
  ) => Promise<{
    uploadId: string;
    storedName: string;
    fullPath: string | null;
    storage?: { provider: string; tier: string; key: string } | null;
    actualSize: number;
    detectedMime: string;
    declaredMime?: string;
    checksumSha256: string;
  }>;
  consumeUploadSession: (uploadId: string) => Promise<void>;
  sha256File: (filePath: string) => Promise<string>;
  safeUrl: (value: string | null | undefined, label: string, allowedProtocols?: string[]) => string;
  unique: (values: string[]) => string[];
  logActivity: (input: any) => Promise<any>;
  readSettings: () => Promise<Record<string, any>>;
  syncCursorSecret: string;
  coordination?: { publish: (topic: string, payload: unknown) => Promise<boolean>; subscribe: (topic: string, listener: (payload: unknown) => void | Promise<void>) => () => void };
  ownedSubscriptions: { registerOwnedSubscription: (name: string, owner: string, subscribe: () => () => void, hooks?: { onSuspend?: () => void; onResume?: () => void }) => () => void };
  storageRuntime: any;
  libraryAccess: LibraryAccessService;
  jobQueue: BackgroundJobQueue;
  notificationService?: { publishRecord: (record: any) => void };
};

export function registerLibraryRoutes({
  app,
  prisma,
  uploadRoot,
  dataLayout,
  getCurrentUser,
  decorateUserForClient,
  hasTargetAccess,
  hasToolPermission,
  serializeUserLite,
  storeCompletedUpload,
  consumeUploadSession,
  sha256File,
  safeUrl,
  unique,
  logActivity,
  readSettings,
  syncCursorSecret,
  coordination,
  ownedSubscriptions,
  storageRuntime,
  libraryAccess,
  jobQueue,
  notificationService
}: LibraryRouteDependencies) {
  const itemInclude = {
    project: { include: { memberships: { where: { status: "active" } } } },
    owner: true,
    reviewer: true,
    parent: { select: { id: true, title: true, parentId: true } },
    folderPermissions: { select: { userId: true, access: true } },
    _count: { select: { children: true, versions: true, backlinks: true, favorites: true } }
  };

  function isManagedLibraryFolder(item: any) {
    return Boolean(item?.type === "folder" && ["packets-root", "project-folder"].includes(String(item.source || "")));
  }

  function rejectManagedFolderChange(reply: FastifyReply) {
    return reply.code(409).send({ ok: false, code: "MANAGED_LIBRARY_FOLDER", error: "Packets and project Library folders are managed by Cluster and cannot be moved or archived." });
  }

  async function rejectMountedWriteWhenLocked(reply: FastifyReply, itemId: string) {
    const lock = await prisma.libraryAssetLock.findUnique({ where: { itemId } });
    if (!libraryLockIsActive(lock)) return false;
    reply.code(409).send({
      ok: false,
      code: "LIBRARY_LOCK_CONFLICT",
      error: "Release the active Library edit lock before changing this item through a mounted Library.",
      lock: {
        id: lock.id,
        itemId: lock.itemId,
        ownerId: lock.ownerId,
        sourceKind: lock.sourceKind || null,
        acquiredAt: lock.acquiredAt || null,
        expiresAt: lock.expiresAt || null,
      },
    });
    return true;
  }

  const serializeLibraryItem = createLibraryItemSerializer(serializeUserLite);
  const libraryContextSelect = {
    id: true, projectId: true, ownerId: true, reviewerId: true, parentId: true, creatorId: true, uploaderId: true, lastEditorId: true, generatedForUserId: true,
    title: true, type: true, status: true, priority: true, tags: true, externalUrl: true, pinned: true, versionLabel: true, reviewDueAt: true, approvedAt: true,
    visibility: true, classification: true, lifecycleState: true, retentionPolicyKey: true, retentionUntil: true, legalHold: true, deletedAt: true, deletedById: true,
    integrityState: true, integrityCheckedAt: true, originKind: true, originRef: true, generatedByKind: true, generatedById: true, lifecycleNotes: true,
    fileName: true, originalName: true, mimeType: true, sizeBytes: true, checksumSha256: true, extension: true, previewText: true, metadata: true, source: true,
    fileModifiedAt: true, manualOrder: true, createdAt: true, updatedAt: true, revision: true,
    project: { select: {
      id: true, name: true, description: true, source: true,
      memberships: { where: { status: "active" }, select: { userId: true, roleKey: true, roleLabel: true, accessLevel: true, isLead: true, status: true, startsAt: true, endsAt: true } },
    } },
    _count: { select: { children: true, versions: true, backlinks: true, favorites: true } },
  };

  function serializeLibraryTreeItem(item: any) {
    const metadata = item.type === "folder" ? parseLibraryMetadata(item.metadata) : {};
    return {
      id: item.id, projectId: item.projectId || null, parentId: item.parentId || null, ownerId: item.ownerId || null,
      title: item.title, type: item.type, status: item.status, priority: item.priority, tags: [], externalUrl: item.externalUrl || null, pinned: Boolean(item.pinned),
      visibility: item.visibility, classification: item.classification, lifecycleState: item.lifecycleState,
      fileName: item.fileName || null, originalName: item.originalName || null, mimeType: item.mimeType || null, mimeGroup: libraryMimeGroup(item.mimeType, item.extension), sizeBytes: item.sizeBytes || 0,
      extension: item.extension || null, source: item.source || null, revision: item.revision || 0, manualOrder: item.manualOrder ?? null, previewKind: libraryPreviewKind(item), hasFile: Boolean(item.fileName),
      fileUrl: item.fileName ? `/api/library/${item.id}/file` : null, snippet: String(item.previewText || "").trim().slice(0, 280),
      childCount: Number(item._count?.children || 0), versionCount: Number(item._count?.versions || 0), backlinkCount: Number(item._count?.backlinks || 0), favoriteCount: Number(item._count?.favorites || 0), permissionCount: 0,
      folderColor: item.type === "folder" && typeof metadata.folderColor === "string" ? metadata.folderColor : null,
      folderIcon: item.type === "folder" && typeof metadata.folderIcon === "string" ? metadata.folderIcon : null,
      project: item.project ? { id: item.project.id, name: item.project.name, description: item.project.description } : null,
      owner: null, reviewer: null, parent: null, createdAt: item.createdAt, updatedAt: item.updatedAt,
    };
  }

  async function requireLibraryTool(request: FastifyRequest, reply: FastifyReply, minimum: "view" | "edit" = "view") {
    const user = await getCurrentUser(request);
    if (!user) {
      reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Authentication required." });
      return null;
    }
    const decorated = await decorateUserForClient(user);
    if (!decorated?.isAdmin && !hasToolPermission(user, decorated?.workspaceRole, "library", minimum)) {
      reply.code(403).send({ ok: false, code: "ACCESS_DENIED", error: `Library ${minimum} access required.` });
      return null;
    }
    return { user, decorated };
  }

  const { accessContext, contextForUser, folderPermissionFor, explainAccess, visibleFor, folderAccessRank } = libraryAccess;

  async function resolveStoredLibraryFile(item: any) {
    if (!item?.fileName) return null;
    const currentPath = path.resolve(dataLayout.libraryFilesRoot, item.fileName);
    // A stored Library pointer cannot follow a symlink/junction outside the
    // managed root, even when it originated from otherwise authorized metadata.
    const verified = await validateManagedDerivativePath(dataLayout.libraryFilesRoot, currentPath);
    if (!verified) return null;
    try {
      const stat = await fs.lstat(verified);
      if (stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1) return { fullPath: verified, stat };
    } catch {}
    return null;
  }

  async function findAccessibleItem(request: FastifyRequest, reply: FastifyReply, itemId: string, minimum: "view" | "contribute" | "edit" | "manage" = "view") {
    const item = await prisma.libraryItem.findUnique({ where: { id: itemId }, include: itemInclude });
    if (!item) {
      reply.code(404).send({ ok: false, error: "Library item not found." });
      return null;
    }
    const recordsAttachment = await prisma.personnelRecordAttachment?.findFirst?.({ where: { libraryItemId: itemId }, select: { id: true } }).catch(() => null);
    if (recordsAttachment) {
      reply.code(403).send({ ok: false, code: "PERSONNEL_RECORD_POLICY_REQUIRED", error: "This Library object is governed by Personnel Records policy. Open it from Records." });
      return null;
    }
    const context = await accessContext(request);
    if (!visibleFor(context, item, minimum)) {
      reply.code(403).send({ ok: false, error: `Library ${minimum} access required.` });
      return null;
    }
    return { item, context };
  }


  function applyMimeWhere(where: any, group?: string) {
    const clause = libraryMimeFilter(group);
    if (!clause) return;
    if ("OR" in clause) where.AND = [...(where.AND || []), clause];
    else if ("extension" in clause) where.extension = clause.extension;
    else where.mimeType = clause;
  }

  async function assertValidParent(itemId: string | null, parentId?: string | null) {
    if (!parentId) return;
    const parent = await prisma.libraryItem.findUnique({ where: { id: parentId }, select: { id: true, type: true, status: true } });
    if (!parent || parent.type !== "folder" || parent.status === "archived") throw new Error("Destination folder is unavailable.");
    if (!itemId) return;
    const tree = await prisma.libraryItem.findMany({ select: { id: true, parentId: true } });
    if (wouldCreateLibraryCycle(tree, itemId, parentId)) throw new Error("A folder cannot be moved into itself or one of its descendants.");
  }

  type LibraryContextSnapshot = { folders: any[]; treeFiles: any[]; facets: ReturnType<typeof libraryFacetCounts>; recent: any[]; pinned: any[]; favoriteIds: string[]; storageBytes: number };
  const LIBRARY_CONTEXT_TTL_MS = 15_000;
  const LIBRARY_CONTEXT_CACHE_MAX = 100;
  const libraryContextCache = new BoundedCache<string, LibraryContextSnapshot>({
    maxEntries: LIBRARY_CONTEXT_CACHE_MAX,
    maxWeight: Math.max(8 * 1024 * 1024, Number(process.env.CLUSTER_LIBRARY_CONTEXT_CACHE_BYTES || 32 * 1024 * 1024)),
    weightOf: (value) => {
      try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return 4096; }
    },
  });
  const libraryTreeFilesCache = new BoundedCache<string, any[]>({
    maxEntries: LIBRARY_CONTEXT_CACHE_MAX,
    maxWeight: Math.max(8 * 1024 * 1024, Number(process.env.CLUSTER_LIBRARY_TREE_CACHE_BYTES || 24 * 1024 * 1024)),
    weightOf: (value) => {
      try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return 4096; }
    },
  });

  function clearLibraryContextCache(broadcast = true) {
    libraryContextCache.clear();
    libraryTreeFilesCache.clear();
    if (broadcast) void coordination?.publish("library.context.invalidate", { at: Date.now() });
  }
  if (coordination) {
    ownedSubscriptions.registerOwnedSubscription(
      "library-context-invalidation", "library",
      () => coordination.subscribe("library.context.invalidate", () => clearLibraryContextCache(false)),
      // A disabled tool misses invalidations. Never expose pre-disable cache
      // snapshots when re-enabled, even if no cross-node event was received.
      { onSuspend: () => clearLibraryContextCache(false), onResume: () => clearLibraryContextCache(false) },
    );
  }

  function libraryContextCacheKey(context: Awaited<ReturnType<typeof accessContext>>) {
    return `${context.user?.id || "anonymous"}:${context.decorated?.workspaceRole || "none"}:${context.decorated?.isAdmin ? "admin" : "member"}`;
  }

  async function loadLibraryContext(context: Awaited<ReturnType<typeof accessContext>>, includeTreeFiles = false) {
    const key = libraryContextCacheKey(context);
    const base = await libraryContextCache.getOrLoad(key, { ttlMs: LIBRARY_CONTEXT_TTL_MS }, async () => {
      const [folderCandidates, summaryCandidates, favoriteRows] = await Promise.all([
      prisma.libraryItem.findMany({
        where: { type: "folder", status: { notIn: ["archived", "trashed"] } },
        select: libraryContextSelect,
        orderBy: [{ title: "asc" }, { id: "asc" }],
        take: 3000
      }),
      prisma.libraryItem.findMany({
        where: { status: { notIn: ["archived", "trashed"] } },
        select: libraryContextSelect,
        orderBy: { updatedAt: "desc" },
        take: 5000
      }),
      context.user ? prisma.libraryFavorite.findMany({ where: { userId: context.user.id }, select: { itemId: true }, take: 5000 }) : Promise.resolve([])
    ]);
    const folders = folderCandidates.filter((item: any) => visibleFor(context, item));
    const visibleSummary = summaryCandidates.filter((item: any) => visibleFor(context, item));
      const value: LibraryContextSnapshot = {
      folders: folders.map((item: any) => serializeLibraryTreeItem(item)),
      treeFiles: [],
      facets: libraryFacetCounts(visibleSummary),
      recent: visibleSummary.slice(0, 12).map((item: any) => serializeLibraryItem(item)),
      pinned: visibleSummary.filter((item: any) => item.pinned).slice(0, 24).map((item: any) => serializeLibraryTreeItem(item)),
      favoriteIds: favoriteRows.map((entry: any) => String(entry.itemId)),
      storageBytes: visibleSummary.reduce((sum: number, item: any) => sum + Number(item.sizeBytes || 0), 0)
    };
      return value;
    });
    if (!includeTreeFiles) return base;
    const treeFiles = await libraryTreeFilesCache.getOrLoad(key, { ttlMs: LIBRARY_CONTEXT_TTL_MS }, async () => {
      const candidates = await prisma.libraryItem.findMany({
        where: { status: { notIn: ["archived", "trashed"] }, type: { not: "folder" } },
        select: libraryContextSelect,
        orderBy: { updatedAt: "desc" },
        take: 5000,
      });
      return candidates.filter((item: any) => visibleFor(context, item)).slice(0, 4000).map((item: any) => serializeLibraryTreeItem(item));
    });
    return { ...base, treeFiles };
  }

  app.get("/api/library/delta", async (request, reply) => {
    const query = z.object({
      since: z.string().optional().default(""),
      limit: z.coerce.number().int().min(1).max(1000).optional().default(500),
    }).parse(request.query || {});
    const upperBound = new Date();
    const context = await accessContext(request);
    if (!context.user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const projectAccessState = await prisma.project.findMany({
      select: { id: true, source: true, memberships: { where: { status: "active" }, select: { userId: true, roleKey: true, roleLabel: true, isLead: true, accessLevel: true } } },
      orderBy: { id: "asc" },
    });
    const scopeDigest = computeSyncScopeDigest({
      role: context.decorated?.workspaceRole || null,
      admin: Boolean(context.decorated?.isAdmin),
      accessExpiresAt: context.user.accessExpiresAt || null,
      libraryVisible: hasToolPermission(context.user, context.decorated?.workspaceRole, "library", "view"),
      projectPermissions: context.user.projectPermissions || null,
      projects: projectAccessState,
      rules: context.rules.map((rule: any) => ({ id: rule.id, targetKind: rule.targetKind, targetId: rule.targetId, projectId: rule.projectId, subjectKind: rule.subjectKind, subjectId: rule.subjectId, subjectName: rule.subjectName, effect: rule.effect, level: rule.level, expiresAt: rule.expiresAt?.toISOString?.() || rule.expiresAt || null, updatedAt: rule.updatedAt?.toISOString?.() || rule.updatedAt || null })),
      folderPermissions: context.folderPermissions.map((entry: any) => ({ folderId: String(entry.folderId), access: String(entry.access) })).sort((a: any, b: any) => a.folderId.localeCompare(b.folderId)),
      folderParents: [...context.folderParents.entries()].sort(([a], [b]) => a.localeCompare(b)),
    });
    const decoded = decodeSyncCursor<{ at: string; id: string }>(query.since, "library", context.user.id, scopeDigest, syncCursorSecret);
    const cursor = decoded.payload && typeof decoded.payload === "object" ? decoded.payload : { at: new Date(0).toISOString(), id: "" };
    const cutoff = new Date(cursor.at);
    const safeCutoff = Number.isFinite(cutoff.getTime()) ? cutoff : new Date(0);
    const scanLimit = Math.min(4000, Math.max(query.limit, query.limit * 4));
    const candidates = await prisma.libraryItem.findMany({
      where: {
        OR: [
          { updatedAt: { gt: safeCutoff, lte: upperBound } },
          { AND: [{ updatedAt: safeCutoff }, { id: { gt: String(cursor.id || "") } }] },
        ],
      },
      include: itemInclude,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: scanLimit,
    });
    const visibleCandidates = candidates.filter((item: any) => visibleFor(context, item));
    const visible = visibleCandidates.slice(0, query.limit);
    const visibleOverflow = visibleCandidates.length > query.limit;
    const advanceThrough = visibleOverflow ? visible.at(-1) : candidates.at(-1);
    const nextPosition = advanceThrough
      ? { at: new Date(advanceThrough.updatedAt).toISOString(), id: advanceThrough.id }
      : { at: upperBound.toISOString(), id: "" };
    return {
      ok: true,
      cursor: encodeSyncCursor("library", context.user.id, scopeDigest, nextPosition, syncCursorSecret),
      scopeDigest,
      resetRequired: decoded.resetRequired,
      resetReason: decoded.resetReason,
      serverTime: upperBound.toISOString(),
      hasMore: visibleOverflow || candidates.length === scanLimit,
      changes: visible.map((item: any) => ({
        entityType: "library",
        entityId: item.id,
        projectId: item.projectId,
        revision: item.revision,
        updatedAt: item.updatedAt,
        data: serializeLibraryItem(item, true),
        invalidate: ["/api/library"],
      })),
    };
  });

  const libraryWorkspaceQuerySchema = z.object({
      q: z.string().max(300).optional().default(""),
      parentId: z.string().optional(),
      scope: z.enum(["folder", "descendants", "project", "all"]).optional().default("folder"),
      section: z.enum(["folder", "recent", "favorites", "shared", "created", "generated", "trash"]).optional().default("folder"),
      projectId: z.string().optional().default(""),
      ownerId: z.string().optional().default(""),
      type: z.string().optional().default("all"),
      status: z.string().optional().default("active"),
      mimeGroup: z.string().optional().default("all"),
      visibility: z.string().optional().default("all"),
      modified: z.enum(["any", "day", "week", "month", "year"]).optional().default("any"),
      tag: z.string().optional().default(""),
      pinned: z.enum(["all", "yes", "no"]).optional().default("all"),
      sort: z.string().optional().default("updated-desc"),
      cursor: z.string().optional(),
      includeContext: z.enum(["1", "0"]).optional().default("1"),
      includeTreeFiles: z.enum(["1", "0"]).optional().default("0"),
      limit: z.coerce.number().int().min(20).max(200).optional().default(80)
  });


  async function libraryWorkspaceWhere(query: z.infer<typeof libraryWorkspaceQuerySchema>, context: Awaited<ReturnType<typeof accessContext>>, db: any = prisma) {
    const where: any = {};
    if (query.section === "favorites" && context.user) {
      const favoriteIds = (await db.libraryFavorite.findMany({ where: { userId: context.user.id }, select: { itemId: true }, take: 5000 })).map((entry: any) => entry.itemId);
      where.id = { in: favoriteIds.length ? favoriteIds : ["__no_library_favorites__"] };
    }
    if (query.section === "created" && context.user) where.creatorId = context.user.id;
    if (query.section === "shared" && context.user) where.ownerId = { not: context.user.id };
    if (query.section === "generated") where.OR = [{ generatedByKind: { not: null } }, { source: { in: ["data-export", "data-import", "data-import-source", "data-import-report", "analytics", "qa-report", "build-report", "generated"] } }];
    if (query.projectId) where.projectId = query.projectId;
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.type !== "all") where.type = query.type;
    if (query.section === "trash") where.status = "trashed";
    else if (query.status === "active") where.status = { notIn: ["archived", "trashed"] };
    else if (query.status !== "all") where.status = query.status;
    if (query.visibility !== "all") where.visibility = query.visibility;
    if (query.modified !== "any") {
      const durationMs = query.modified === "day" ? 24 * 60 * 60 * 1000 : query.modified === "week" ? 7 * 24 * 60 * 60 * 1000 : query.modified === "month" ? 30 * 24 * 60 * 60 * 1000 : 365 * 24 * 60 * 60 * 1000;
      where.updatedAt = { gte: new Date(Date.now() - durationMs) };
    }
    if (query.tag) where.tags = { contains: query.tag };
    if (query.pinned !== "all") where.pinned = query.pinned === "yes";
    if (query.section === "folder" && query.scope === "folder") where.parentId = !query.parentId || query.parentId === "root" ? null : query.parentId;
    if (query.section === "folder" && query.scope === "descendants") {
      const anchorId = !query.parentId || query.parentId === "root" ? null : query.parentId;
      if (anchorId) {
        const folderRows = await db.libraryItem.findMany({ where: { type: "folder", status: { notIn: ["archived", "trashed"] } }, select: { id: true, parentId: true } });
        const descendants = new Set<string>([anchorId]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const folder of folderRows) if (folder.parentId && descendants.has(folder.parentId) && !descendants.has(folder.id)) { descendants.add(folder.id); changed = true; }
        }
        where.parentId = { in: [...descendants] };
      }
    }
    if (query.section === "folder" && query.scope === "project" && !query.projectId) {
      const anchorId = !query.parentId || query.parentId === "root" ? null : query.parentId;
      if (anchorId) {
        const anchor = await db.libraryItem.findUnique({ where: { id: anchorId }, select: { projectId: true } });
        if (anchor?.projectId) where.projectId = anchor.projectId;
      }
    }
    applyMimeWhere(where, query.mimeGroup);
    if (query.q.trim()) {
      const search = query.q.trim();
      where.AND = [
        ...(where.AND || []),
        { OR: [
          { title: { contains: search } },
          { body: { contains: search } },
          { tags: { contains: search } },
          { externalUrl: { contains: search } },
          { originalName: { contains: search } },
          { metadata: { contains: search } }
        ] }
      ];
    }

    return where;
  }

  // The selection is an explicit, bounded snapshot of the *current* search, not
  // a browser guess based on loaded pages. Its revisions feed the existing CAS
  // bulk mutation pipeline; no long-lived permission-bearing token is issued.
  // A preview and a queue request independently resolve one authoritative snapshot.
  // No client-supplied IDs are trusted, and a changed digest refuses to enqueue.
  async function resolveBackgroundBulk(request: FastifyRequest, body: ReturnType<typeof libraryBulkMetadataRequestSchema.parse>) {
    const requestingUser = await getCurrentUser(request);
    if (!requestingUser) throw createHttpError("AUTH_REQUIRED", "Authentication required.", 401);
    return prisma.$transaction(async (tx: any) => {
      const actor = await tx.user.findUnique({ where: { id: requestingUser.id } });
      if (!actor || actor.archived || actor.accountState !== "ACTIVE" || (actor.accessExpiresAt && new Date(actor.accessExpiresAt) <= new Date())) throw createHttpError("LIBRARY_ACCESS_DENIED", "The initiating account is not active.", 403);
      const context = await libraryAccess.contextForUser(actor, tx);
      if (body.collectionId) return resolveLibraryBulkCollectionSelection({
        tx, context, actorId: actor.id, collectionId: body.collectionId,
        expectedRevision: body.expectedCollectionRevision!, action: body.action,
        canContribute: (ctx, row) => visibleFor(ctx, row, "contribute"),
      });
      const query = libraryWorkspaceQuerySchema.omit({ cursor: true, includeContext: true, includeTreeFiles: true, limit: true }).parse(body.query);
      const where = await libraryWorkspaceWhere({ ...query, limit: 80, includeContext: "0", includeTreeFiles: "0" }, context, tx);
      const targets = await collectLibraryMatchingSelection({
        maximumSelected: 1000,
        fetchPage: (skip, take) => tx.libraryItem.findMany({ where, include: itemInclude, orderBy: [{ id: "asc" }], skip, take }),
        filterVisible: async (rows) => {
          const protectedRefs = rows.length ? await tx.personnelRecordAttachment.findMany({ where: { libraryItemId: { in: rows.map((row: any) => row.id) } }, select: { libraryItemId: true } }) : [];
          const protectedIds = new Set(protectedRefs.map((row: any) => row.libraryItemId));
          // Actions on trashed/destroyed records and Records-owned attachments are not part of this workflow.
          const permitted = rows.filter((row: any) => !protectedIds.has(row.id) && visibleFor(context, row, "contribute"));
          return filterLibraryBackgroundCandidates(permitted, body.action, async (ids) => {
            const parents = await tx.libraryItem.findMany({ where: { parentId: { in: ids } }, select: { parentId: true }, distinct: ["parentId"] });
            return parents.map((entry: any) => entry.parentId).filter(Boolean);
          });
        },
      });
      return { targets: targets.map((row: any) => ({ id: row.id, revision: row.revision })), digest: libraryBulkSelectionDigest(targets) };
    }, { isolationLevel: "RepeatableRead", timeout: 30000 });
  }

  function backgroundBulkError(reply: FastifyReply, error: unknown) {
    if (error instanceof LibraryBulkCollectionError) return reply.code(error.status).send({ ok: false, code: error.code, error: error.message });
    if (error instanceof LibraryMatchingSelectionError) return reply.code(409).send({ ok: false, code: error.code, error: error.message });
    if (["P2028", "P2034"].includes(String((error as any)?.code || ""))) return reply.code(409).send({ ok: false, code: "LIBRARY_BULK_SNAPSHOT_RETRY", error: "The selection changed while preparing the job. Retry preview; no work was queued." });
    throw error;
  }

  app.post("/api/library/bulk/jobs/preview", async (request, reply) => {
    if (!(await requireLibraryTool(request, reply, "edit"))) return;
    const body = libraryBulkMetadataRequestSchema.parse(request.body || {});
    try {
      const selection = await resolveBackgroundBulk(request, body);
      reply.header("Cache-Control", "no-store");
      return { ok: true, count: selection.targets.length, digest: selection.digest, action: body.action, limit: 1000, requiresConfirmation: true };
    } catch (error) { return backgroundBulkError(reply, error); }
  });

  app.post("/api/library/bulk/jobs", async (request, reply) => {
    const authorized = await requireLibraryTool(request, reply, "edit");
    if (!authorized) return;
    const body = z.intersection(libraryBulkMetadataRequestSchema, z.object({ digest: z.string().regex(/^[a-f0-9]{64}$/), requestKey: z.string().uuid() })).parse(request.body || {});
    const operationIdentity = createHash("sha256").update(JSON.stringify({ actorId: authorized.user.id, requestKey: body.requestKey, digest: body.digest, action: body.action, tag: body.tag, pinned: body.pinned,
      collectionId: body.collectionId, collectionRevision: body.expectedCollectionRevision })).digest("hex");
    const dedupeKey = `library-bulk:${operationIdentity}`;
    // Check for a previously accepted identical intent BEFORE resnapshotting.
    // Its first execution may have already changed the item revisions, so a
    // subsequent preview could no longer reproduce the original digest.
    const priorJob = await prisma.backgroundJob.findFirst({
      where: { type: "library.bulk.metadata", createdById: authorized.user.id, dedupeKey },
      orderBy: { createdAt: "desc" }, select: { id: true, status: true, payload: true },
    });
    if (priorJob) {
      let selectedCount = 0;
      try { selectedCount = JSON.parse(priorJob.payload || "{}").targets?.length || 0; } catch { /* corrupt evidence does not authorize a second execution */ }
      reply.header("Cache-Control", "no-store");
      return reply.code(202).send({ ok: true, jobId: priorJob.id, status: priorJob.status, selectedCount, replayed: true });
    }
    let selection: Awaited<ReturnType<typeof resolveBackgroundBulk>>;
    try { selection = await resolveBackgroundBulk(request, body); }
    catch (error) { return backgroundBulkError(reply, error); }
    if (selection.digest !== body.digest) return reply.code(409).send({ ok: false, code: "LIBRARY_BULK_PREVIEW_STALE", error: "The matching records or revisions changed since preview. Review the selection again; nothing was queued." });
    if (!selection.targets.length) return reply.code(409).send({ ok: false, code: "LIBRARY_BULK_EMPTY", error: "There are no editable matches to process." });
    const payload = { actorId: authorized.user.id, action: body.action, tag: body.tag, pinned: body.pinned,
      ...(selection.collection ? { collection: selection.collection } : {}), targets: selection.targets };
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 110_000) return reply.code(409).send({ ok: false, code: "LIBRARY_BULK_PAYLOAD_LIMIT", error: "Selected Library identifiers are too large for one queued operation. Narrow the scope and retry." });
    let accepted: { id: string; status: string };
    try {
      const job = await jobQueue.enqueue({
        type: "library.bulk.metadata", queue: "default", costUnits: 2, maxAttempts: 5,
        dedupeKey, createdById: authorized.user.id,
        payload,
        authorization: { actorUserId: authorized.user.id, action: "contribute", resource: { kind: "tool", tool: "library" }, minimum: "edit", tool: "library" },
      });
      accepted = { id: job.id, status: job.status };
    } catch (enqueueError) {
      // A concurrent request can race with the terminal transition or receive
      // an uncertain commit result. The intent's durable unique index ensures
      // there is at most one record; resolve it instead of creating a second job.
      const existing = await prisma.backgroundJob.findFirst({
        where: { type: "library.bulk.metadata", createdById: authorized.user.id, dedupeKey },
        select: { id: true, status: true },
      });
      if (!existing) throw enqueueError;
      accepted = existing;
    }
    reply.header("Cache-Control", "no-store");
    return reply.code(202).send({ ok: true, jobId: accepted.id, status: accepted.status, selectedCount: selection.targets.length });
  });

  // A hierarchy move is a different workflow from metadata-only bulk jobs:
  // its preview covers nested ACLs, topology and active locks. The durable
  // job commits one whole root subtree at a time, and never mutates blobs.
  async function hierarchyMoveSelection(actorId: string, body: z.infer<typeof hierarchyMoveSchema>) {
    return prisma.$transaction((tx: any) => inspectLibraryHierarchyMove({
      tx, actorId, roots: body.roots, parentId: body.parentId, access: libraryAccess,
    }), { isolationLevel: "RepeatableRead", timeout: 30_000 });
  }
  function hierarchyMoveError(reply: FastifyReply, error: unknown) {
    if (error instanceof LibraryBulkGuardError) return reply.code(error.status).send({ ok: false, code: error.code, error: error.message });
    if (["P2028", "P2034"].includes(String((error as any)?.code || "")))
      return reply.code(409).send({ ok: false, code: "LIBRARY_HIERARCHY_SNAPSHOT_RETRY", error: "The hierarchy changed while reading its preview. Retry." });
    throw error;
  }

  app.post("/api/library/bulk/hierarchy/move/preview", async (request, reply) => {
    const actor = await requireLibraryTool(request, reply, "edit");
    if (!actor) return;
    const body = hierarchyMoveSchema.parse(request.body || {});
    try {
      const selection = await hierarchyMoveSelection(actor.user.id, body);
      reply.header("Cache-Control", "no-store");
      return { ok: true, action: "move", roots: selection.targets.length,
        affected: selection.affected, maximumAffected: LIBRARY_HIERARCHY_IMPACT_LIMIT,
        digest: selection.digest, destinationId: body.parentId, requiresConfirmation: true };
    } catch (error) { return hierarchyMoveError(reply, error); }
  });

  app.post("/api/library/bulk/hierarchy/move", async (request, reply) => {
    const actor = await requireLibraryTool(request, reply, "edit");
    if (!actor) return;
    const body = hierarchyMoveSubmitSchema.parse(request.body || {});
    const dedupeKey = `library-hierarchy:${createHash("sha256").update(JSON.stringify({
      actorId: actor.user.id, requestKey: body.requestKey, destinationId: body.parentId,
      roots: body.roots, digest: body.digest,
    })).digest("hex")}`;
    // A retry must return an already accepted job without resnapshotting data
    // that its own earlier committed root may have changed.
    const prior = await prisma.backgroundJob.findFirst({
      where: { type: "library.hierarchy.move", createdById: actor.user.id, dedupeKey },
      select: { id: true, status: true }, orderBy: { createdAt: "desc" },
    });
    if (prior) {
      reply.header("Cache-Control", "no-store");
      return reply.code(202).send({ ok: true, jobId: prior.id, status: prior.status, replayed: true });
    }
    let selection: Awaited<ReturnType<typeof hierarchyMoveSelection>>;
    try { selection = await hierarchyMoveSelection(actor.user.id, body); }
    catch (error) { return hierarchyMoveError(reply, error); }
    if (selection.digest !== body.digest)
      return reply.code(409).send({ ok: false, code: "LIBRARY_HIERARCHY_PREVIEW_STALE", error: "The destination, resource scope, or revisions changed. Preview again." });
    const payload = { actorId: actor.user.id, parentId: body.parentId,
      destinationFingerprint: selection.destinationFingerprint, targets: selection.targets };
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 100_000)
      return reply.code(409).send({ ok: false, code: "LIBRARY_HIERARCHY_PAYLOAD_LIMIT", error: "Hierarchy selection is too large to queue." });
    let job: { id: string; status: string };
    try {
      job = await jobQueue.enqueue({
        type: "library.hierarchy.move", queue: "default", costUnits: 2, maxAttempts: 5,
        createdById: actor.user.id, dedupeKey, payload,
        authorization: { actorUserId: actor.user.id, action: "contribute",
          resource: { kind: "tool", tool: "library" }, minimum: "edit", tool: "library" },
      });
    } catch (enqueueError) {
      const accepted = await prisma.backgroundJob.findFirst({
        where: { type: "library.hierarchy.move", createdById: actor.user.id, dedupeKey },
        select: { id: true, status: true }, orderBy: { createdAt: "desc" },
      });
      if (!accepted) throw enqueueError;
      job = accepted;
    }
    reply.header("Cache-Control", "no-store");
    return reply.code(202).send({ ok: true, jobId: job.id, status: job.status,
      roots: selection.targets.length, affected: selection.affected });
  });

  async function ownHierarchyMove(request: FastifyRequest, reply: FastifyReply, jobId: string) {
    const user = await getCurrentUser(request);
    if (!user) { reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Authentication required." }); return null; }
    const detail = await jobQueue.get(jobId);
    if (!detail || detail.job.type !== "library.hierarchy.move" || detail.job.createdById !== user.id) {
      reply.code(404).send({ ok: false, code: "LIBRARY_HIERARCHY_JOB_NOT_FOUND", error: "Hierarchy operation not found." }); return null;
    }
    return detail;
  }
  app.get("/api/library/bulk/hierarchy/move/:jobId", async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string().min(1).max(200) }).parse(request.params);
    const detail = await ownHierarchyMove(request, reply, jobId);
    if (!detail) return;
    const checkpoint = await prisma.libraryBulkCheckpoint.findUnique({ where: { jobId } });
    reply.header("Cache-Control", "no-store");
    return { ok: true, job: serializeBackgroundJob(detail.job), checkpoint: checkpoint ? {
      nextIndex: checkpoint.nextIndex, moved: checkpoint.changed, skipped: checkpoint.skipped,
    } : null };
  });
  app.post("/api/library/bulk/hierarchy/move/:jobId/cancel", async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string().min(1).max(200) }).parse(request.params);
    const detail = await ownHierarchyMove(request, reply, jobId);
    if (!detail) return;
    const cancelled = await jobQueue.cancel(jobId);
    reply.header("Cache-Control", "no-store");
    return { ok: true, status: cancelled?.status || detail.job.status, cancellationRequested: Boolean(cancelled) };
  });

  // Durable provenance-backed lifecycle for folders. Never use the legacy
  // root-only archive/trash/restore mutations to change a folder tree.
  async function hierarchyLifecycleSelection(actorId: string, body: z.infer<typeof hierarchyLifecycleSchema>) {
    return prisma.$transaction((tx: any) => inspectLibraryHierarchyLifecycle({
      tx, actorId, action: body.action, roots: body.roots, access: libraryAccess,
    }), { isolationLevel: "RepeatableRead", timeout: 30_000 });
  }
  app.post("/api/library/bulk/hierarchy/lifecycle/preview", async (request, reply) => {
    const actor = await requireLibraryTool(request, reply, "edit");
    if (!actor) return;
    const body = hierarchyLifecycleSchema.parse(request.body || {});
    try {
      const snapshot = await hierarchyLifecycleSelection(actor.user.id, body);
      reply.header("Cache-Control", "no-store");
      return { ok: true, action: body.action, roots: snapshot.targets.length,
        affected: snapshot.affected, preserved: snapshot.preserved, digest: snapshot.digest,
        requiresConfirmation: true };
    } catch (error) { return hierarchyMoveError(reply, error); }
  });
  app.post("/api/library/bulk/hierarchy/lifecycle", async (request, reply) => {
    const actor = await requireLibraryTool(request, reply, "edit");
    if (!actor) return;
    const body = hierarchyLifecycleSubmitSchema.parse(request.body || {});
    const dedupeKey = `library-lifecycle:${createHash("sha256").update(JSON.stringify({ actorId: actor.user.id,
      requestKey: body.requestKey, action: body.action, roots: body.roots, digest: body.digest })).digest("hex")}`;
    const prior = await prisma.backgroundJob.findFirst({ where: {
      type: "library.hierarchy.lifecycle", createdById: actor.user.id, dedupeKey,
    }, select: { id: true, status: true }, orderBy: { createdAt: "desc" } });
    if (prior) {
      reply.header("Cache-Control", "no-store");
      return reply.code(202).send({ ok: true, jobId: prior.id, status: prior.status, replayed: true });
    }
    let snapshot: Awaited<ReturnType<typeof hierarchyLifecycleSelection>>;
    try { snapshot = await hierarchyLifecycleSelection(actor.user.id, body); }
    catch (error) { return hierarchyMoveError(reply, error); }
    if (snapshot.digest !== body.digest) return reply.code(409).send({ ok: false,
      code: "LIBRARY_HIERARCHY_PREVIEW_STALE", error: "Hierarchy lifecycle preview changed. Review it again." });
    const payload = { actorId: actor.user.id, action: body.action, targets: snapshot.targets };
    let job: { id: string; status: string };
    try {
      job = await jobQueue.enqueue({ type: "library.hierarchy.lifecycle", queue: "default", costUnits: 2,
        maxAttempts: 5, createdById: actor.user.id, dedupeKey, payload,
        authorization: { actorUserId: actor.user.id, action: "contribute",
          resource: { kind: "tool", tool: "library" }, minimum: "edit", tool: "library" },
      });
    } catch (error) {
      const accepted = await prisma.backgroundJob.findFirst({ where: { type: "library.hierarchy.lifecycle",
        createdById: actor.user.id, dedupeKey }, select: { id: true, status: true }, orderBy: { createdAt: "desc" } });
      if (!accepted) throw error;
      job = accepted;
    }
    reply.header("Cache-Control", "no-store");
    return reply.code(202).send({ ok: true, jobId: job.id, status: job.status,
      action: body.action, roots: snapshot.targets.length, affected: snapshot.affected });
  });
  async function ownHierarchyLifecycle(request: FastifyRequest, reply: FastifyReply, jobId: string) {
    const user = await getCurrentUser(request);
    if (!user) { reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." }); return null; }
    const detail = await jobQueue.get(jobId);
    if (!detail || detail.job.type !== "library.hierarchy.lifecycle" || detail.job.createdById !== user.id) {
      reply.code(404).send({ ok: false, code: "LIBRARY_HIERARCHY_JOB_NOT_FOUND", error: "Hierarchy lifecycle operation not found." }); return null;
    }
    return detail;
  }
  app.get("/api/library/bulk/hierarchy/lifecycle/:jobId", async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string().min(1).max(200) }).parse(request.params);
    const detail = await ownHierarchyLifecycle(request, reply, jobId);
    if (!detail) return;
    const checkpoint = await prisma.libraryBulkCheckpoint.findUnique({ where: { jobId } });
    reply.header("Cache-Control", "no-store");
    return { ok: true, job: serializeBackgroundJob(detail.job), checkpoint: checkpoint ? {
      nextIndex: checkpoint.nextIndex, changed: checkpoint.changed, preserved: checkpoint.skipped,
    } : null };
  });
  app.post("/api/library/bulk/hierarchy/lifecycle/:jobId/cancel", async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string().min(1).max(200) }).parse(request.params);
    const detail = await ownHierarchyLifecycle(request, reply, jobId);
    if (!detail) return;
    const cancelled = await jobQueue.cancel(jobId);
    reply.header("Cache-Control", "no-store");
    return { ok: true, status: cancelled?.status || detail.job.status, cancellationRequested: Boolean(cancelled) };
  });

  async function ownBackgroundBulk(request: FastifyRequest, reply: FastifyReply, jobId: string) {
    const user = await getCurrentUser(request);
    if (!user) { reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." }); return null; }
    const detail = await jobQueue.get(jobId);
    if (!detail || detail.job.type !== "library.bulk.metadata" || detail.job.createdById !== user.id) {
      reply.code(404).send({ ok: false, code: "LIBRARY_BULK_JOB_NOT_FOUND", error: "Bulk operation not found." }); return null;
    }
    return detail;
  }

  app.get("/api/library/bulk/jobs/:jobId", async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string().min(1).max(200) }).parse(request.params);
    const detail = await ownBackgroundBulk(request, reply, jobId);
    if (!detail) return;
    const checkpoint = await prisma.libraryBulkCheckpoint.findUnique({ where: { jobId } });
    reply.header("Cache-Control", "no-store");
    return { ok: true, job: serializeBackgroundJob(detail.job), checkpoint: checkpoint ? { nextIndex: checkpoint.nextIndex, changed: checkpoint.changed, conflicted: checkpoint.conflicted, denied: checkpoint.denied, blocked: checkpoint.blocked, skipped: checkpoint.skipped } : null };
  });

  app.post("/api/library/bulk/jobs/:jobId/cancel", async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string().min(1).max(200) }).parse(request.params);
    const detail = await ownBackgroundBulk(request, reply, jobId);
    if (!detail) return;
    const result = await jobQueue.cancel(jobId);
    reply.header("Cache-Control", "no-store");
    return { ok: true, status: result?.status || detail.job.status, cancellationRequested: Boolean(result) };
  });

  app.post("/api/library/bulk/select-matching", async (request, reply) => {
    const auth = await requireLibraryTool(request, reply, "view");
    if (!auth) return;
    const query = libraryWorkspaceQuerySchema.omit({ cursor: true, includeContext: true, includeTreeFiles: true, limit: true })
      .parse(request.body || {});
    const context = await accessContext(request);
    try {
      // One repeatable-read snapshot prevents page offsets from shifting if
      // another user inserts, moves, or archives a record while we scan.
      const result = await prisma.$transaction(async (tx: any) => {
        const where = await libraryWorkspaceWhere({ ...query, limit: 80, includeContext: "0", includeTreeFiles: "0" }, context, tx);
        return collectLibraryMatchingSelection({
          fetchPage: (skip, take) => tx.libraryItem.findMany({
            where, include: itemInclude, orderBy: librarySort(query.sort) as any, skip, take,
          }),
          filterVisible: async (rows) => {
            if (!rows.length) return [];
            const protectedRows = await tx.personnelRecordAttachment.findMany({
              where: { libraryItemId: { in: rows.map((item: any) => item.id) } },
              select: { libraryItemId: true },
            });
            const protectedIds = new Set(protectedRows.map((row: any) => row.libraryItemId));
            return rows.filter((item: any) => !protectedIds.has(item.id) && visibleFor(context, item));
          },
        });
      }, { isolationLevel: "RepeatableRead", timeout: 15_000 });
      return { ok: true, selectedCount: result.length, items: result.map((item: any) => serializeLibraryItem(item)) };
    } catch (error) {
      if (error instanceof LibraryMatchingSelectionError) return reply.code(409).send({
        ok: false, code: error.code, error: error.message,
      });
      if (["P2028", "P2034"].includes(String((error as any)?.code || ""))) return reply.code(409).send({
        ok: false, code: "LIBRARY_SELECTION_SNAPSHOT_RETRY", error: "The selection snapshot could not finish safely. Narrow the filters or retry; nothing was selected.",
      });
      throw error;
    }
  });

  app.get("/api/library/workspace", async (request, reply) => {
    const query = libraryWorkspaceQuerySchema.parse(request.query || {});

    const context = await accessContext(request);
    if (context.user && (await readSettings()).packetsEnabled !== false) await ensurePacketsRoot();
    const where = await libraryWorkspaceWhere(query, context);
    const take = Math.min(800, query.limit * 4 + 1);
    const candidates = await prisma.libraryItem.findMany({
      where,
      include: itemInclude,
      orderBy: librarySort(query.sort) as any,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take
    });
    const accessibleCandidates = candidates.filter((item: any) => visibleFor(context, item));
    const page = accessibleCandidates.slice(0, query.limit);
    const hasMore = accessibleCandidates.length > query.limit || candidates.length === take;

    const libraryContext = query.includeContext === "1" ? await loadLibraryContext(context, query.includeTreeFiles === "1") : null;

    const payload = {
      items: page.map((item: any) => serializeLibraryItem(item)),
      folders: libraryContext?.folders,
      treeFiles: query.includeTreeFiles === "1" ? libraryContext?.treeFiles : undefined,
      pinnedItems: libraryContext?.pinned,
      favoriteIds: libraryContext?.favoriteIds,
      path: libraryContext ? buildLibraryFolderPath(libraryContext.folders, query.parentId === "root" ? null : query.parentId) : undefined,
      facets: libraryContext?.facets,
      storageBytes: libraryContext?.storageBytes ?? 0,
      storage: context.decorated?.isAdmin ? { root: dataLayout.libraryRoot } : undefined,
      pagination: {
        cursor: page.length ? page[page.length - 1].id : null,
        hasMore,
        limit: query.limit,
        loaded: page.length
      }
    };
    return sendPrivateRevalidated(request, reply, payload);
  });

  registerMountedLibraryRoutes({
    app, prisma, requireLibraryTool, readSettings, accessContext, visibleFor, itemInclude, findAccessibleItem,
    rejectMountedWriteWhenLocked, assertValidParent, isManagedLibraryFolder, rejectManagedFolderChange, dataLayout,
    logActivity, clearLibraryContextCache, serializeLibraryItem, storageRuntime, sha256File, jobQueue,
  });

  app.get("/api/library/summary", async (request, reply) => {
    const context = await accessContext(request);
    const libraryContext = await loadLibraryContext(context);
    return sendPrivateRevalidated(request, reply, {
      ...libraryContext.facets,
      recent: libraryContext.recent,
      storageBytes: libraryContext.storageBytes
    });
  });
  async function ensurePacketsRoot() {
    const settings = await readSettings();
    const rootName = String(settings.packetsRootName || "Packets").trim().slice(0, 100) || "Packets";
    let root = await prisma.libraryItem.findFirst({
      where: { type: "folder", source: "packets-root", status: { notIn: ["archived", "trashed"] } },
      include: itemInclude
    });
    if (!root) {
      root = await prisma.libraryItem.create({
        data: {
          title: rootName,
          body: "",
          type: "folder",
          status: "active",
          priority: "medium",
          tags: JSON.stringify(["packets"]),
          visibility: "internal",
          metadata: JSON.stringify({ packetRoot: true, folderColor: "#7aa8ff", folderIcon: "note" }),
          source: "packets-root"
        },
        include: itemInclude
      });
      clearLibraryContextCache();
    } else if (root.title !== rootName) {
      root = await prisma.libraryItem.update({ where: { id: root.id }, data: { title: rootName }, include: itemInclude });
      clearLibraryContextCache();
    }
    return root;
  }

  registerPacketRoutes({
    app,
    prisma,
    libraryFilesRoot: dataLayout.libraryFilesRoot,
    readSettings,
    accessContext,
    hasToolPermission,
    visibleFor,
    ensurePacketsRoot,
    serializeLibraryItem,
    itemInclude,
    clearLibraryContextCache,
    logActivity,
    notificationService,
  });

  app.get("/api/library/navigation", async (request, reply) => {
    const context = await accessContext(request);
    if (!context.user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const [recentCandidates, favoriteRows, generatedCandidates, trashCandidates, createdCandidates, sharedCandidates, projectShortcutCandidates] = await Promise.all([
      prisma.libraryItem.findMany({ where: { status: { notIn: ["archived", "trashed"] } }, include: itemInclude, orderBy: { updatedAt: "desc" }, take: 80 }),
      prisma.libraryFavorite.findMany({ where: { userId: context.user.id }, include: { item: { include: itemInclude } }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.libraryItem.findMany({ where: { status: { notIn: ["archived", "trashed"] }, OR: [{ generatedByKind: { not: null } }, { source: { in: ["data-export", "data-import", "analytics", "qa-report", "build-report", "generated"] } }] }, include: itemInclude, orderBy: { updatedAt: "desc" }, take: 80 }),
      prisma.libraryItem.findMany({ where: { OR: [{ status: "trashed" }, { lifecycleState: "trashed" }] }, include: itemInclude, orderBy: { deletedAt: "desc" }, take: 100 }),
      prisma.libraryItem.findMany({ where: { creatorId: context.user.id, status: { notIn: ["archived", "trashed"] } }, include: itemInclude, orderBy: { createdAt: "desc" }, take: 80 }),
      prisma.libraryItem.findMany({ where: { ownerId: { not: context.user.id }, status: { notIn: ["archived", "trashed"] } }, include: itemInclude, orderBy: { updatedAt: "desc" }, take: 120 }),
      prisma.libraryItem.findMany({ where: { type: "folder", source: "project-folder", status: { notIn: ["archived", "trashed"] } }, include: itemInclude, orderBy: { title: "asc" }, take: 500 }),
    ]);
    const visible = (items: any[]) => items.filter((item: any) => visibleFor(context, item)).map((item: any) => serializeLibraryItem(item));
    const favorites = favoriteRows.map((row: any) => row.item).filter((item: any) => item && visibleFor(context, item)).map((item: any) => serializeLibraryItem(item));
    return {
      ok: true,
      sections: {
        recent: visible(recentCandidates).slice(0, 24),
        favorites: favorites.slice(0, 50),
        sharedWithMe: visible(sharedCandidates).slice(0, 50),
        createdByMe: visible(createdCandidates).slice(0, 50),
        generated: visible(generatedCandidates).slice(0, 50),
        trash: visible(trashCandidates).slice(0, 100),
        projectShortcuts: visible(projectShortcutCandidates),
      },
      favoriteIds: favorites.map((item: any) => item.id),
    };
  });

  app.get("/api/library/:itemId", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const result = await findAccessibleItem(request, reply, params.itemId);
    if (!result) return;
    const folders = await prisma.libraryItem.findMany({ where: { type: "folder", status: { notIn: ["archived", "trashed"] } }, select: { id: true, parentId: true, title: true } });
    return { ...serializeLibraryItem(result.item, true), path: buildLibraryFolderPath(folders, result.item.parentId) };
  });

  app.get("/api/library/:itemId/file", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const query = z.object({ download: z.coerce.boolean().optional().default(false) }).parse(request.query || {});
    const result = await findAccessibleItem(request, reply, params.itemId);
    if (!result) return;
    const item = result.item;
    if (await isCopyrightResourceDisabled(prisma, "library", item.id)) return copyrightDisabledResponse(reply);
    if (!item.fileName) return reply.code(404).send({ ok: false, error: "This library item has no stored file." });
    const resolved = await resolveStoredLibraryFile(item);
    if (!resolved) return reply.code(404).send({ ok: false, error: "Stored file is missing. Run Cluster repair to rebuild the Library index." });
    return sendStoredResource(request, reply, {
      filePath: resolved.fullPath,
      mimeType: item.mimeType || "application/octet-stream",
      originalName: item.originalName || item.title,
      requestedInline: !query.download,
      checksumSha256: item.checksumSha256 || null,
      cacheControl: "private, max-age=0, must-revalidate",
    });
  });

  app.get("/api/library/:itemId/viewable-resource", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const result = await findAccessibleItem(request, reply, params.itemId);
    if (!result) return;
    if (await isCopyrightResourceDisabled(prisma, "library", result.item.id)) return copyrightDisabledResponse(reply);
    const derivatives = await prisma.libraryDerivative.findMany({
      where: { itemId: result.item.id, status: "ready", invalidatedAt: null, ...(result.item.checksumSha256 ? { sourceChecksumSha256: result.item.checksumSha256 } : {}) },
      orderBy: { updatedAt: "desc" },
      take: 32,
    });
    const resource = libraryItemViewableResource(result.item, derivatives);
    if (!resource) return reply.code(415).send({ ok: false, code: "RESOURCE_NOT_VIEWABLE", error: "This Library item does not have a registered viewer format." });
    return { resource };
  });


  const modelThumbnailRoot = path.join(dataLayout.runtimeRoot, "library-model-thumbnails");

  async function findModelThumbnail(itemId: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(itemId)) return null;
    for (const extension of ["webp", "png", "jpg"] as const) {
      const candidate = path.join(modelThumbnailRoot, `${itemId}.${extension}`);
      const opened = await openManagedPreviewStream(modelThumbnailRoot, candidate, 4 * 1024 * 1024, extension).catch(() => null);
      if (opened) return { ...opened, extension };
    }
    return null;
  }

  app.get("/api/library/:itemId/model-thumbnail", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const result = await findAccessibleItem(request, reply, params.itemId);
    if (!result) return;
    if (await isCopyrightResourceDisabled(prisma, "library", params.itemId)) return copyrightDisabledResponse(reply);
    if (libraryPreviewKind(result.item) !== "model") return reply.code(404).send({ ok: false, error: "No model thumbnail is available." });
    const settings = await readSettings();
    if (settings.libraryAllowModelPreviews === false) return reply.code(403).send({ ok: false, error: "3D model previews are disabled." });
    if (String(result.item.extension || "").toLowerCase() === "blend" && settings.libraryAllowBlendPreviews === false) return reply.code(403).send({ ok: false, error: ".blend previews are disabled." });
    const thumbnail = await findModelThumbnail(params.itemId);
    if (!thumbnail) return reply.code(404).send({ ok: false, error: "Model thumbnail has not been generated." });
    const mime = thumbnail.extension === "png" ? "image/png" : thumbnail.extension === "jpg" ? "image/jpeg" : "image/webp";
    reply.header("Content-Type", mime);
    reply.header("Content-Length", String(thumbnail.size));
    reply.header("Cache-Control", "private, no-cache");
    reply.header("X-Content-Type-Options", "nosniff");
    return reply.send(thumbnail.stream);
  });

  app.put("/api/library/:itemId/model-thumbnail", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    // A viewer may read a preview, but must not replace the shared thumbnail.
    const result = await findAccessibleItem(request, reply, params.itemId, "contribute");
    if (!result) return;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(params.itemId)) return reply.code(400).send({ ok: false, code: "INVALID_LIBRARY_ID", error: "Invalid Library item identity." });
    if (await isCopyrightResourceDisabled(prisma, "library", params.itemId)) return copyrightDisabledResponse(reply);
    if (libraryPreviewKind(result.item) !== "model") return reply.code(400).send({ ok: false, error: "Thumbnails can only be stored for 3D models." });
    const settings = await readSettings();
    if (settings.libraryAllowModelPreviews === false) return reply.code(403).send({ ok: false, error: "3D model previews are disabled." });
    if (String(result.item.extension || "").toLowerCase() === "blend" && settings.libraryAllowBlendPreviews === false) return reply.code(403).send({ ok: false, error: ".blend previews are disabled." });
    const body = z.object({ dataUrl: z.string().min(100).max(6_000_000) }).parse(request.body || {});
    let decoded: ReturnType<typeof decodeDataUrl>;
    try { decoded = decodeDataUrl(body.dataUrl, 4 * 1024 * 1024); }
    catch { return reply.code(400).send({ code: "UPLOAD_INVALID_PAYLOAD", message: "Thumbnail must be a valid base64 WebP, PNG, or JPEG data URL." }); }
    const bytes = decoded.buffer;
    if (bytes.length < 64) return reply.code(400).send({ code: "UPLOAD_INVALID_PAYLOAD", message: "Thumbnail must be at least 64 bytes." });
    const detected = detectedMimeType(bytes);
    const declared = normalizeMimeType(decoded.declaredMime);
    const allowed = new Set(["image/webp", "image/png", "image/jpeg"]);
    if (!allowed.has(detected) || detected !== declared) return reply.code(415).send({ code: "UPLOAD_TYPE_NOT_ALLOWED", message: "Thumbnail bytes must match the declared WebP, PNG, or JPEG type." });
    const extension = detected === "image/jpeg" ? "jpg" : detected === "image/png" ? "png" : "webp";
    try {
      await saveManagedModelThumbnail(modelThumbnailRoot, params.itemId, extension, bytes);
    } catch (error) {
      if (error instanceof ManagedPreviewIOError) {
        if (error.code === "THUMBNAIL_BUSY") reply.header("Retry-After", "5");
        return reply.code(409).send({ ok: false, code: error.code, error: error.message });
      }
      throw error;
    }
    return { ok: true, modelThumbnailUrl: `/api/library/${params.itemId}/model-thumbnail` };
  });


  app.get("/api/library/:itemId/model-preview", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const result = await findAccessibleItem(request, reply, params.itemId);
    if (!result) return;
    const item = result.item;
    const settings = await readSettings();
    if (settings.libraryAllowModelPreviews === false) return reply.code(403).send({ ok: false, error: "3D model previews are disabled." });
    if (settings.libraryAllowBlendPreviews === false) return reply.code(403).send({ ok: false, error: ".blend previews are disabled." });
    if (String(item.extension || "").toLowerCase() !== "blend") return reply.code(400).send({ ok: false, error: "Converted model previews are only used for .blend files." });
    const resolved = await resolveStoredLibraryFile(item);
    if (!resolved) return reply.code(404).send({ ok: false, error: "Stored Blender file is missing." });

    const metadata = parseLibraryMetadata(item.metadata);
    const bundle = parseModelBundle(metadata.modelBundle);
    const companionIds = [...new Set(bundle.map((entry) => entry.id))];
    // The model's ACL does not authorize its embedded texture/dependency list.
    // Load the same policy projections used by normal Library access checks.
    const companionItems = companionIds.length ? await prisma.libraryItem.findMany({
      where: { id: { in: companionIds } }, include: itemInclude,
    }) : [];
    const recordsAttachments = companionIds.length ? await prisma.personnelRecordAttachment.findMany({
      where: { libraryItemId: { in: companionIds } }, select: { libraryItemId: true }, take: 129,
    }) : [];
    const recordsIds = new Set(recordsAttachments.map((row: any) => row.libraryItemId));
    let permittedCompanions: ReturnType<typeof resolveAuthorizedModelCompanions>;
    try {
      permittedCompanions = resolveAuthorizedModelCompanions(bundle, companionItems,
        (companion) => visibleFor(result.context, companion, "view"),
        (id) => recordsIds.has(id));
    } catch (error) {
      if (error instanceof LibraryModelPreviewError) return reply.code(403).send({ ok: false, code: error.code, error: error.message });
      throw error;
    }
    // Check active copyright restrictions once for the source + all embedded
    // companions. One bounded query, not 128 sequential provider/DB calls.
    const copyrightRestrictions = await prisma.copyrightResourceRestriction.findMany({
      where: { resourceType: "library", resourceId: { in: [item.id, ...companionIds] }, state: "disabled" },
      select: { resourceId: true }, take: 129,
    });
    const copyrightDisabledIds = new Set(copyrightRestrictions.map((row: any) => row.resourceId));
    if (copyrightDisabledIds.has(item.id)) return copyrightDisabledResponse(reply);
    if (permittedCompanions.some(({ record }) => copyrightDisabledIds.has(record.id))) {
      return reply.code(403).send({ ok: false, code: "MODEL_PREVIEW_DEPENDENCY_DENIED", error: "A model dependency is not available for preview." });
    }
    const authorizationSnapshot = modelPreviewAuthorizationSnapshot(item, permittedCompanions);
    const inputFileEvidence = new Map<string, Awaited<ReturnType<typeof fs.lstat>>>();
    inputFileEvidence.set(item.id, resolved.stat);
    const companions: Array<{ sourcePath: string; relativeName: string }> = [];
    const companionEvidence: Array<{ id: string; revision: number; checksumSha256: string | null; updatedAt: any; fileName: string; size: number; modifiedMs: number; name: string }> = [];
    for (const { reference, record } of permittedCompanions) {
      const companionFile = await resolveStoredLibraryFile(record);
      if (!companionFile) return reply.code(409).send({ ok: false, code: "MODEL_PREVIEW_DEPENDENCY_UNAVAILABLE", error: "A model dependency file is unavailable. Recheck the Library source." });
      companions.push({ sourcePath: companionFile.fullPath, relativeName: reference.name });
      inputFileEvidence.set(record.id, companionFile.stat);
      companionEvidence.push({ id: record.id, revision: Number(record.revision || 0),
        checksumSha256: record.checksumSha256 || null, updatedAt: record.updatedAt || null,
        fileName: record.fileName || "", size: companionFile.stat.size, modifiedMs: companionFile.stat.mtimeMs,
        name: reference.name });
    }

    try {
      const sourceRelativeName = typeof metadata.browserRelativePath === "string" && metadata.browserRelativePath.trim() ? metadata.browserRelativePath : item.originalName || path.basename(item.fileName);
      const maxSourceBytes = Math.max(8, Math.min(4096, Number(settings.libraryModelPreviewMaxMb || 512))) * 1024 * 1024;
      const cacheKey = modelPreviewFingerprint({ id: item.id, revision: Number(item.revision || 0),
        checksumSha256: item.checksumSha256 || null, updatedAt: item.updatedAt || null,
        fileName: item.fileName, size: resolved.stat.size, modifiedMs: resolved.stat.mtimeMs },
        companionEvidence, sourceRelativeName, maxSourceBytes);
      const previewPath = await createBlendPreview({
        sourcePath: resolved.fullPath,
        sourceRelativeName,
        companions,
        cacheRoot: path.join(dataLayout.runtimeRoot, "model-previews"),
        cacheKey,
        maxSourceBytes
      });
      const managedPreviewRoot = path.join(dataLayout.runtimeRoot, "model-previews");
      if (!await validateManagedDerivativePath(managedPreviewRoot, previewPath)) {
        return reply.code(409).send({ ok: false, code: "MODEL_PREVIEW_CACHE_UNSAFE", error: "Model preview cache needs administrator repair." });
      }
      // Conversion may wait behind unrelated jobs. The original request's
      // cached ACL snapshot is not proof of access at delivery time.
      const freshUser = await getCurrentUser(request);
      const freshContext = await contextForUser(freshUser, prisma, { strict: true });
      const freshItems = await prisma.libraryItem.findMany({
        where: { id: { in: [item.id, ...companionIds] } }, include: itemInclude,
      });
      const freshSource = freshItems.find((entry: any) => entry.id === item.id);
      const denied = () => reply.code(403).send({ ok: false, code: "MODEL_PREVIEW_ACCESS_CHANGED", error: "Model preview is no longer available for this request." });
      if (!freshSource || !visibleFor(freshContext, freshSource, "view")) return denied();
      const freshRecords = await prisma.personnelRecordAttachment.findMany({
        where: { libraryItemId: { in: [item.id, ...companionIds] } }, select: { libraryItemId: true }, take: 129,
      });
      const freshRecordsIds = new Set(freshRecords.map((entry: any) => entry.libraryItemId));
      if (freshRecordsIds.has(item.id)) return denied();
      let freshCompanions: ReturnType<typeof resolveAuthorizedModelCompanions>;
      try {
        freshCompanions = resolveAuthorizedModelCompanions(bundle, freshItems,
          (entry) => visibleFor(freshContext, entry, "view"),
          (id) => freshRecordsIds.has(id));
      } catch (error) {
        if (error instanceof LibraryModelPreviewError) return denied();
        throw error;
      }
      const freshRestrictions = await prisma.copyrightResourceRestriction.findMany({
        where: { resourceType: "library", resourceId: { in: [item.id, ...companionIds] }, state: "disabled" },
        select: { resourceId: true }, take: 129,
      });
      if (freshRestrictions.length) return denied();
      const freshSettings = await readSettings();
      if (freshSettings.libraryAllowModelPreviews === false || freshSettings.libraryAllowBlendPreviews === false) return denied();
      if (modelPreviewAuthorizationSnapshot(freshSource, freshCompanions) !== authorizationSnapshot) {
        return reply.code(409).send({ ok: false, code: "MODEL_PREVIEW_INPUT_CHANGED", error: "Model inputs changed during conversion. Reload the preview." });
      }
      // Metadata revisions alone do not detect external in-place file writes.
      for (const currentItem of [freshSource, ...freshCompanions.map(({ record }) => record)]) {
        const current = await resolveStoredLibraryFile(currentItem);
        const previous = inputFileEvidence.get(currentItem.id);
        if (!current || !previous || current.stat.dev !== previous.dev || current.stat.ino !== previous.ino ||
            current.stat.size !== previous.size || current.stat.mtimeMs !== previous.mtimeMs ||
            current.stat.ctimeMs !== previous.ctimeMs) {
          return reply.code(409).send({ ok: false, code: "MODEL_PREVIEW_INPUT_CHANGED", error: "Model inputs changed during conversion. Reload the preview." });
        }
      }
      // Only open the completed GLB after the fresh ACL and input-evidence
      // recheck. The stream is tied to its verified descriptor, never reopened.
      const openedPreview = await openManagedPreviewStream(managedPreviewRoot, previewPath, Number.MAX_SAFE_INTEGER, "glb");
      if (!openedPreview) return reply.code(409).send({ ok: false, code: "MODEL_PREVIEW_CACHE_UNSAFE", error: "Model preview cache needs administrator repair." });
      reply.header("Content-Type", "model/gltf-binary");
      reply.header("Content-Length", String(openedPreview.size));
      reply.header("Content-Disposition", `inline; filename="${safeFileName(`${libraryDisplayTitle(item.originalName || item.title)}.glb`)}"`);
      reply.header("Cache-Control", "private, no-cache");
      reply.header("ETag", `"blend-${cacheKey}"`);
      return reply.send(openedPreview.stream);
    } catch (error) {
      if (error instanceof ModelPreviewBusyError) {
        reply.header("Retry-After", "5");
        return reply.code(503).send({ ok: false, code: "MODEL_PREVIEW_BUSY", error: "Model preview conversion capacity is busy. Retry shortly." });
      }
      request.log.warn({ error, itemId: item.id }, "Built-in model preview conversion failed");
      return reply.code(503).send({ ok: false, error: "Built-in model preview conversion is unavailable. Review the Library source and conversion service." });
    }
  });

  app.post("/api/library/upload", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) throw new Error("Login required.");
    const body = z.object({
      parentId: z.string().optional().nullable(),
      projectId: z.string().optional().nullable(),
      ownerId: z.string().optional().nullable(),
      title: z.string().max(240).optional(),
      description: z.string().max(100_000).optional().nullable(),
      originalName: z.string().min(1).max(500),
      mimeType: z.string().min(1).max(200).default("application/octet-stream"),
      lastModified: z.string().optional().nullable(),
      tags: z.array(z.string().max(80)).max(80).optional().default([]),
      visibility: z.string().max(40).optional().default("internal"),
      classification: z.string().max(40).optional().default("internal"),
      metadata: metadataSchema,
      uploadId: z.string().uuid()
    }).parse(request.body);
    await assertValidParent(null, body.parentId);
    if (body.parentId) {
      const destination = await findAccessibleItem(request, reply, body.parentId, "contribute");
      if (!destination) return;
    }

    const relativeDirectory = await libraryFolderRelativePath(prisma, body.parentId);
    const destinationFolder = path.join(dataLayout.libraryFilesRoot, relativeDirectory);
    const stored = await storeCompletedUpload(user.id, Boolean(user.isAdmin), body.uploadId, "library", "file", body.originalName, body.mimeType, destinationFolder);
    if (!stored.fullPath) throw createHttpError("STORAGE_UNAVAILABLE", "Library upload staging did not return a local destination path.", 503);
    const settings = await readSettings();
    const maxUploadBytes = Math.max(1, Math.min(4096, Number(settings.libraryMaxUploadMb || settings.uploadLimitMb || 512))) * 1024 * 1024;
    if (stored.actualSize > maxUploadBytes) {
      await fs.rm(stored.fullPath, { force: true }).catch(() => undefined);
      return reply.code(413).send({ ok: false, error: `Library uploads are limited to ${Math.round(maxUploadBytes / 1024 / 1024)} MB.` });
    }
    const relativeFileName = path.relative(dataLayout.libraryFilesRoot, stored.fullPath);
    const extension = libraryFileExtension(body.originalName);
    const [checksumSha256, buffer] = await Promise.all([
      sha256File(stored.fullPath),
      stored.actualSize <= 256 * 1024 ? fs.readFile(stored.fullPath) : Promise.resolve(null)
    ]);
    const previewText = buffer ? makeLibraryPreviewText(buffer, stored.detectedMime, 256 * 1024, extension) : null;
    const item = await prisma.libraryItem.create({
      data: {
        parentId: body.parentId || null,
        projectId: body.projectId || null,
        ownerId: body.ownerId || user.id,
        creatorId: user.id,
        uploaderId: user.id,
        lastEditorId: user.id,
        title: body.title?.trim() || libraryDisplayTitle(body.originalName),
        body: body.description || null,
        type: "file",
        status: "active",
        priority: "medium",
        tags: JSON.stringify(unique(body.tags)),
        visibility: body.visibility || "internal",
        classification: normalizeLibraryClassification(body.classification || "internal"),
        lifecycleState: "active",
        fileName: relativeFileName,
        originalName: body.originalName,
        mimeType: stored.detectedMime,
        sizeBytes: stored.actualSize,
        checksumSha256,
        integrityState: "verified",
        integrityCheckedAt: new Date(),
        extension,
        previewText,
        metadata: JSON.stringify(normalizeLibraryMetadata(body.metadata)),
        source: "upload",
        originKind: "upload",
        originRef: body.uploadId,
        fileModifiedAt: body.lastModified ? new Date(body.lastModified) : null,
        changelog: JSON.stringify([{ at: new Date().toISOString(), by: user.id, from: null, to: "active", note: "File uploaded to Library." }])
      },
      include: itemInclude
    });
    await consumeUploadSession(body.uploadId).catch(() => undefined);
    // This file is already committed. Activity is a secondary projection:
    // its failure cannot turn a successful upload into a retryable error.
    clearLibraryContextCache();
    try {
      await logActivity({ userId: user.id, projectId: item.projectId, type: "uploaded", entityType: "library", entityId: item.id, title: "Library file uploaded", message: item.title, metadata: { mimeType: item.mimeType, sizeBytes: item.sizeBytes } });
    } catch (error) {
      request.log.warn({ error, itemId: item.id }, "Library upload committed, but Activity projection failed");
    }
    return serializeLibraryItem(item, true);
  });

  app.post("/api/library", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) throw new Error("Login required.");
    const body = itemWriteSchema().parse(request.body);
    const title = String(body.title || "").trim();
    if (!title) throw new Error("Library item title is required.");
    await assertValidParent(null, body.parentId);
    if (body.parentId) {
      const destination = await findAccessibleItem(request, reply, body.parentId, "contribute");
      if (!destination) return;
    }
    const requestedType = libraryCreateTypeSchema.parse(body.type || "link");
    const settings = await readSettings();
    if (requestedType === "link" && settings.libraryAllowExternalLinks === false) return reply.code(403).send({ ok: false, error: "External Library links are disabled." });
    if (["youtube-video", "youtube-playlist"].includes(requestedType) && settings.libraryAllowYoutube === false) return reply.code(403).send({ ok: false, error: "YouTube Library entries are disabled." });
    const externalUrl = body.externalUrl ? safeUrl(body.externalUrl, "External URL") : null;
    if (["link", "youtube-video", "youtube-playlist"].includes(requestedType) && !externalUrl) throw new Error("A link URL is required.");
    const youtube = parseYouTubeLink(externalUrl);
    if (requestedType === "youtube-video" && !youtube.videoId) throw new Error("Use a valid YouTube video URL.");
    if (requestedType === "youtube-playlist" && !youtube.playlistId) throw new Error("Use a valid YouTube playlist URL.");
    const createMetadata = normalizeLibraryMetadata({
      ...body.metadata,
      ...(youtube.videoId ? { youtubeId: youtube.videoId } : {}),
      ...(youtube.playlistId ? { youtubePlaylistId: youtube.playlistId } : {})
    });
    const item = await prisma.libraryItem.create({
      data: {
        parentId: body.parentId || null,
        projectId: body.projectId || null,
        ownerId: body.ownerId || user.id,
        creatorId: user.id,
        lastEditorId: user.id,
        title,
        body: body.body || null,
        type: requestedType,
        status: body.status || "active",
        priority: body.priority || "medium",
        tags: JSON.stringify(unique(body.tags || [])),
        externalUrl,
        pinned: body.pinned || false,
        reviewerId: body.reviewerId || null,
        versionLabel: body.versionLabel || null,
        reviewDueAt: body.reviewDueAt ? new Date(body.reviewDueAt) : null,
        approvedAt: body.approvedAt ? new Date(body.approvedAt) : (body.status === "approved" ? new Date() : null),
        visibility: body.visibility || "internal",
        classification: normalizeLibraryClassification(body.classification || "internal"),
        lifecycleState: normalizeLibraryLifecycleState(body.lifecycleState || "active"),
        retentionPolicyKey: body.retentionPolicyKey || null,
        retentionUntil: body.retentionUntil ? new Date(body.retentionUntil) : null,
        legalHold: Boolean(body.legalHold),
        lifecycleNotes: body.lifecycleNotes || null,
        metadata: JSON.stringify(createMetadata),
        source: body.source || (requestedType.startsWith("youtube-") ? "youtube" : requestedType === "link" ? "link" : "manual"),
        originKind: body.originKind || (requestedType.startsWith("youtube-") ? "youtube" : requestedType === "link" ? "link" : "manual"),
        originRef: body.originRef || null,
        generatedForUserId: body.generatedForUserId || null,
        generatedByKind: body.generatedByKind || null,
        generatedById: body.generatedById || null,
        changelog: JSON.stringify(body.changelogNote ? [{ at: new Date().toISOString(), by: user.id, from: null, to: body.status || "active", note: body.changelogNote }] : [])
      },
      include: itemInclude
    });
    if (item.type === "folder") {
      const relativeDirectory = await libraryFolderRelativePath(prisma, item.id);
      await fs.mkdir(path.join(dataLayout.libraryFilesRoot, relativeDirectory), { recursive: true });
    }
    await logActivity({ userId: user.id, projectId: item.projectId, type: "created", entityType: "library", entityId: item.id, title: "Library item created", message: item.title, metadata: { type: item.type, status: item.status } });
    clearLibraryContextCache();
    return serializeLibraryItem(item, true);
  });

  app.get("/api/library/:itemId/permissions", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const accessible = await findAccessibleItem(request, reply, params.itemId, "view");
    if (!accessible) return;
    if (accessible.item.type !== "folder") return reply.code(400).send({ ok: false, error: "Folder permissions are only available for folders." });
    const canManage = Boolean(accessible.context.decorated?.isAdmin || accessible.item.ownerId === accessible.context.user?.id || folderAccessRank[String(folderPermissionFor(accessible.context, accessible.item)?.access || "none")] >= folderAccessRank.manage);
    if (!canManage) return reply.code(403).send({ ok: false, error: "Folder management access required." });
    const [users, permissions] = await Promise.all([
      prisma.user.findMany({ where: { archived: false }, orderBy: [{ displayName: "asc" }, { username: "asc" }] }),
      (prisma as any).folderPermission.findMany({ where: { folderId: params.itemId }, orderBy: { userId: "asc" } }),
    ]);
    return { ok: true, folderId: params.itemId, users: users.map(serializeUserLite), permissions };
  });

  app.put("/api/library/:itemId/permissions", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const body = z.object({ entries: z.array(z.object({ userId: z.string(), access: z.enum(["none", "view", "contribute", "edit", "manage"]) })).max(500) }).parse(request.body);
    const accessible = await findAccessibleItem(request, reply, params.itemId, "view");
    if (!accessible) return;
    if (accessible.item.type !== "folder") return reply.code(400).send({ ok: false, error: "Folder permissions are only available for folders." });
    const canManage = Boolean(accessible.context.decorated?.isAdmin || accessible.item.ownerId === accessible.context.user?.id || folderAccessRank[String(folderPermissionFor(accessible.context, accessible.item)?.access || "none")] >= folderAccessRank.manage);
    if (!canManage) return reply.code(403).send({ ok: false, error: "Folder management access required." });
    const activeUserIds = new Set((await prisma.user.findMany({ where: { id: { in: body.entries.map((entry) => entry.userId) }, archived: false }, select: { id: true } })).map((user: any) => user.id));
    const valid = body.entries.filter((entry) => activeUserIds.has(entry.userId));
    await (prisma as any).$transaction([
      (prisma as any).folderPermission.deleteMany({ where: { folderId: params.itemId } }),
      ...valid.map((entry) => (prisma as any).folderPermission.create({ data: { folderId: params.itemId, userId: entry.userId, access: entry.access } })),
    ]);
    clearLibraryContextCache();
    await logActivity({ userId: accessible.context.user.id, projectId: accessible.item.projectId, type: "permissions_updated", entityType: "library", entityId: params.itemId, title: "Folder permissions updated", message: accessible.item.title });
    return { ok: true, updated: valid.length };
  });

  app.get("/api/library/:itemId/access-explanation", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const accessible = await findAccessibleItem(request, reply, params.itemId, "view");
    if (!accessible) return;
    const own = explainAccess(accessible.context, accessible.item, "view");
    const canManage = explainAccess(accessible.context, accessible.item, "manage").allowed;
    if (!canManage) return { ok: true, itemId: params.itemId, currentUser: own, roster: null };
    const users = await prisma.user.findMany({ where: { archived: false }, orderBy: [{ displayName: "asc" }, { username: "asc" }], take: 1000 });
    const roster = [];
    for (const candidate of users) {
      const candidateContext = await contextForUser(candidate);
      const explanation = explainAccess(candidateContext, accessible.item, "view");
      if (!explanation.allowed) continue;
      roster.push({ user: serializeUserLite(candidate), explanation });
    }
    return { ok: true, itemId: params.itemId, currentUser: own, roster };
  });

  app.get("/api/library/:itemId/versions", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const accessible = await findAccessibleItem(request, reply, params.itemId, "view");
    if (!accessible) return;
    const versions = await prisma.libraryVersion.findMany({ where: { itemId: params.itemId }, orderBy: [{ versionNumber: "desc" }, { createdAt: "desc" }], take: 250 });
    return {
      ok: true,
      itemId: params.itemId,
      current: serializeLibraryItem(accessible.item, true),
      versions: versions.map((version: any) => ({ ...version, downloadUrl: version.fileName ? `/api/library/${params.itemId}/versions/${version.id}/file?download=1` : null })),
    };
  });

  app.get("/api/library/:itemId/versions/:versionId/file", async (request, reply) => {
    const params = z.object({ itemId: z.string(), versionId: z.string() }).parse(request.params);
    const accessible = await findAccessibleItem(request, reply, params.itemId, "view");
    if (!accessible) return;
    const version = await prisma.libraryVersion.findFirst({ where: { id: params.versionId, itemId: params.itemId } });
    if (!version?.fileName) return reply.code(404).send({ ok: false, code: "LIBRARY_VERSION_FILE_MISSING", error: "This version does not contain a stored file." });
    const fullPath = path.resolve(dataLayout.libraryFilesRoot, version.fileName);
    if (!pathInsideRoot(dataLayout.libraryFilesRoot, fullPath)) return reply.code(409).send({ ok: false, code: "LIBRARY_VERSION_PATH_INVALID", error: "Stored version path is invalid." });
    return sendStoredResource(request, reply, {
      filePath: fullPath,
      mimeType: version.mimeType || "application/octet-stream",
      originalName: version.originalName || accessible.item.originalName || accessible.item.title,
      requestedInline: String((request.query as any)?.download || "") !== "1",
      checksumSha256: version.checksumSha256,
    });
  });

  app.post("/api/library/:itemId/versions/:versionId/restore", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const params = z.object({ itemId: z.string(), versionId: z.string() }).parse(request.params);
    const body = z.object({ expectedRevision: z.number().int().positive() }).parse(request.body || {});
    const accessible = await findAccessibleItem(request, reply, params.itemId, "edit");
    if (!accessible) return;
    const target = await prisma.libraryVersion.findFirst({ where: { id: params.versionId, itemId: params.itemId } });
    if (!target?.fileName) return reply.code(404).send({ ok: false, code: "LIBRARY_VERSION_FILE_MISSING", error: "This version does not contain a stored file." });
    const targetPath = path.resolve(dataLayout.libraryFilesRoot, target.fileName);
    if (!pathInsideRoot(dataLayout.libraryFilesRoot, targetPath)) return reply.code(409).send({ ok: false, code: "LIBRARY_VERSION_PATH_INVALID", error: "Stored version path is invalid." });
    await fs.access(targetPath).catch(() => { throw createHttpError("LIBRARY_VERSION_FILE_MISSING", "The stored bytes for this version are unavailable.", 404); });
    let result: { updated: any; nextNumber: number };
    try {
      result = await prisma.$transaction(async (tx: any) => {
      const current = await tx.libraryItem.findUnique({ where: { id: params.itemId } });
      if (!current || current.revision !== body.expectedRevision || current.revision !== accessible.item.revision)
        throw createHttpError("REVISION_CONFLICT", "The Library item changed since you reviewed it. Reload before restoring a version.", 409);
      const snapshot = await createLibraryVersionSnapshot(tx, current, { actorId: user.id, note: `Current version before restoring v${target.versionNumber}` });
      const nextNumber = Number(snapshot.versionNumber) + 1;
      const restoreData = {
          fileName: target.fileName,
          originalName: target.originalName || current.originalName,
          mimeType: target.mimeType || current.mimeType,
          sizeBytes: target.sizeBytes,
          checksumSha256: target.checksumSha256,
          extension: target.extension || current.extension,
          versionLabel: `v${nextNumber}`,
          fileModifiedAt: new Date(),
          lastEditorId: user.id,
          integrityState: target.checksumSha256 ? "verified" : "unverified",
          integrityCheckedAt: target.checksumSha256 ? new Date() : null,
          originKind: "version-restore",
          originRef: target.id,
          revision: { increment: 1 },
      };
      const wrote = await tx.libraryItem.updateMany({ where: { id: params.itemId, revision: current.revision }, data: restoreData });
      if (wrote.count !== 1) throw createHttpError("REVISION_CONFLICT", "Another change won the race to restore this version.", 409);
      const updated = await tx.libraryItem.findUniqueOrThrow({ where: { id: params.itemId }, include: itemInclude });
      return { updated, nextNumber };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if ((error as any)?.code === "P2034") return reply.code(409).send({ ok: false, code: "REVISION_CONFLICT", error: "A concurrent change prevented the restore. Refresh and try again." });
      throw error;
    }
    // The restore transaction already committed. Flush cache regardless of
    // whether the independent Activity projection can be written.
    clearLibraryContextCache();
    try {
      await logActivity({ userId: user.id, projectId: result.updated.projectId, type: "version_restored", entityType: "library", entityId: result.updated.id, title: "Library version restored", message: `${result.updated.title} · restored v${target.versionNumber} as v${result.nextNumber}`, metadata: { restoredVersionId: target.id, restoredVersionNumber: target.versionNumber, checksumSha256: target.checksumSha256 } });
    } catch (error) {
      request.log.warn({ error, itemId: result.updated.id, versionNumber: result.nextNumber }, "Library version restore committed, but Activity projection failed");
    }
    return { ok: true, restoredVersionNumber: target.versionNumber, versionNumber: result.nextNumber, item: serializeLibraryItem(result.updated, true) };
  });

  app.post("/api/library/:itemId/versions", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const body = z.object({
      uploadId: z.string().uuid(),
      originalName: z.string().min(1).max(500),
      mimeType: z.string().min(1).max(200).default("application/octet-stream"),
      note: z.string().max(2000).optional().nullable(),
      lastModified: z.string().optional().nullable(),
    }).parse(request.body);
    const accessible = await findAccessibleItem(request, reply, params.itemId, "edit");
    if (!accessible) return;
    if (accessible.item.type !== "file") return reply.code(400).send({ ok: false, code: "LIBRARY_VERSION_FILE_ONLY", error: "File versions can only be uploaded for Library files." });
    const relativeDirectory = await libraryFolderRelativePath(prisma, accessible.item.parentId);
    const destinationFolder = path.join(dataLayout.libraryFilesRoot, relativeDirectory);
    const stored = await storeCompletedUpload(user.id, Boolean(user.isAdmin), body.uploadId, "library", "file", body.originalName, body.mimeType, destinationFolder);
    if (!stored.fullPath) throw createHttpError("STORAGE_UNAVAILABLE", "Library version staging did not return a local destination path.", 503);
    const relativeFileName = path.relative(dataLayout.libraryFilesRoot, stored.fullPath);
    const extension = libraryFileExtension(body.originalName);
    const [checksumSha256, buffer] = await Promise.all([
      sha256File(stored.fullPath),
      stored.actualSize <= 256 * 1024 ? fs.readFile(stored.fullPath) : Promise.resolve(null),
    ]);
    const previewText = buffer ? makeLibraryPreviewText(buffer, stored.detectedMime, 256 * 1024, extension) : null;
    // Storage staging is private until the transaction publishes the version.
    // A failure AFTER commit must never erase bytes already referenced by the
    // Library item and its version history.
    let result: { updated: any; nextNumber: number };
    try {
      result = await prisma.$transaction(async (tx: any) => {
        const current = await tx.libraryItem.findUnique({ where: { id: params.itemId } });
        if (!current || current.revision !== accessible.item.revision) throw createHttpError("REVISION_CONFLICT", "The Library item changed before the new version could be committed.", 409);
        const snapshot = await createLibraryVersionSnapshot(tx, current, { actorId: user.id, note: body.note || "Previous current version" });
        const nextNumber = Number(snapshot.versionNumber) + 1;
        const updated = await tx.libraryItem.update({
          where: { id: params.itemId },
          data: {
            fileName: relativeFileName,
            originalName: body.originalName,
            mimeType: stored.detectedMime,
            sizeBytes: stored.actualSize,
            checksumSha256,
            extension,
            previewText,
            versionLabel: `v${nextNumber}`,
            fileModifiedAt: body.lastModified ? new Date(body.lastModified) : new Date(),
            uploaderId: user.id,
            lastEditorId: user.id,
            integrityState: "verified",
            integrityCheckedAt: new Date(),
            originKind: "upload-version",
            originRef: body.uploadId,
            revision: { increment: 1 },
          },
          include: itemInclude,
        });
        return { snapshot, updated, nextNumber };
      });
    } catch (error) {
      // The database did not publish this candidate file. It is still a
      // request-private staging copy, so removing it cannot orphan a version.
      await fs.rm(stored.fullPath, { force: true }).catch(() => undefined);
      throw error;
    }
    await consumeUploadSession(body.uploadId).catch(() => undefined);
    // Activity is a secondary projection. A logging outage after the version
    // transaction must not turn a committed upload into a failed response or
    // trigger deletion of the committed file.
    try {
      await logActivity({ userId: user.id, projectId: result.updated.projectId, type: "version_uploaded", entityType: "library", entityId: result.updated.id, title: "Library version uploaded", message: `${result.updated.title} · v${result.nextNumber}`, metadata: { checksumSha256, sizeBytes: stored.actualSize } });
    } catch (error) {
      request.log.warn({ error, itemId: result.updated.id, versionNumber: result.nextNumber }, "Library version committed, but Activity projection failed");
    }
    clearLibraryContextCache();
    return { ok: true, versionNumber: result.nextNumber, item: serializeLibraryItem(result.updated, true) };
  });

  app.put("/api/library/:itemId/favorite", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const body = z.object({ favorite: z.boolean() }).parse(request.body);
    const accessible = await findAccessibleItem(request, reply, params.itemId, "view");
    if (!accessible?.context.user) return;
    if (body.favorite) {
      await prisma.libraryFavorite.upsert({
        where: { userId_itemId: { userId: accessible.context.user.id, itemId: params.itemId } },
        create: { userId: accessible.context.user.id, itemId: params.itemId },
        update: {},
      });
    } else {
      await prisma.libraryFavorite.deleteMany({ where: { userId: accessible.context.user.id, itemId: params.itemId } });
    }
    clearLibraryContextCache();
    return { ok: true, itemId: params.itemId, favorite: body.favorite };
  });

  app.get("/api/library/:itemId/backlinks", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const accessible = await findAccessibleItem(request, reply, params.itemId, "view");
    if (!accessible) return;
    const backlinks = await prisma.libraryBacklink.findMany({ where: { itemId: params.itemId }, orderBy: [{ sourceResourceKind: "asc" }, { updatedAt: "desc" }], take: 1000 });
    return { ok: true, itemId: params.itemId, backlinks: backlinks.map((entry: any) => ({ ...entry, metadata: parseLibraryMetadata(entry.metadata) })) };
  });

  app.post("/api/library/:itemId/restore", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const item = await prisma.libraryItem.findUnique({ where: { id: params.itemId }, include: itemInclude });
    if (!item) return reply.code(404).send({ ok: false, error: "Library item not found." });
    const context = await accessContext(request);
    if (!visibleFor(context, item, "contribute")) return reply.code(403).send({ ok: false, error: "Library contribute access required." });
    if (item.type === "folder") return reply.code(409).send({ ok: false, code: "LIBRARY_HIERARCHY_LIFECYCLE_REQUIRED",
      error: "Restore folder trees through the durable hierarchy lifecycle workflow." });
    const activeHierarchyMark = await prisma.libraryHierarchyLifecycleEntry.findFirst({ where: { itemId: item.id, restoredAt: null }, select: { jobId: true } });
    if (activeHierarchyMark) return reply.code(409).send({ ok: false, code: "LIBRARY_HIERARCHY_RESTORE_PROVENANCE_REQUIRED",
      error: "This item is part of an active hierarchy operation. Restore its originating folder instead." });
    if (String(item.status) !== "trashed" && String(item.lifecycleState) !== "trashed") return reply.code(409).send({ ok: false, code: "LIBRARY_NOT_TRASHED", error: "This object is not in Trash." });
    let restored: any;
    try {
      restored = await prisma.$transaction(async (tx: any) => {
        const current = await tx.libraryItem.findUnique({ where: { id: params.itemId } });
        if (!current || current.revision !== item.revision || (current.status !== "trashed" && current.lifecycleState !== "trashed"))
          throw new LibraryDispositionError("LIBRARY_REVISION_CONFLICT", "The item changed. Refresh before restoring.");
        const mark = await tx.libraryHierarchyLifecycleEntry.findFirst({ where: { itemId: item.id, restoredAt: null }, select: { jobId: true } });
        if (mark) throw new LibraryDispositionError("LIBRARY_HIERARCHY_RESTORE_PROVENANCE_REQUIRED", "Restore the originating hierarchy first.");
        await cancelLibraryDisposition(tx, { itemId: item.id, actorId: user.id, reason: "Library item restored by an authorized contributor." });
        return tx.libraryItem.update({ where: { id: item.id }, data: {
          status: "active", lifecycleState: "active", deletedAt: null, deletedById: null,
          lastEditorId: user.id, revision: { increment: 1 },
        }, include: itemInclude });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if ((error as any)?.code === "P2034") return reply.code(409).send({ ok: false, code: "LIBRARY_REVISION_CONFLICT", error: "Restore conflicted with another update." });
      if (error instanceof LibraryDispositionError) return reply.code(409).send({ ok: false, code: error.code, error: error.message });
      throw error;
    }
    await logActivity({ userId: user.id, projectId: restored.projectId, type: "restored", entityType: "library", entityId: restored.id, title: "Library item restored", message: restored.title });
    clearLibraryContextCache();
    return serializeLibraryItem(restored, true);
  });

  app.get("/api/library/:itemId/destruction-preview", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const accessible = await findAccessibleItem(request, reply, params.itemId, "manage");
    if (!accessible) return;
    const [childRows, backlinkRows, versionRows, children, backlinks, versions] = await Promise.all([
      prisma.libraryItem.findMany({ where: { parentId: params.itemId }, select: { id: true, title: true, type: true, status: true }, orderBy: [{ type: "asc" }, { title: "asc" }], take: 250 }),
      prisma.libraryBacklink.findMany({ where: { itemId: params.itemId }, orderBy: [{ sourceResourceKind: "asc" }, { updatedAt: "desc" }], take: 250 }),
      prisma.libraryVersion.findMany({ where: { itemId: params.itemId }, select: { id: true, versionNumber: true, title: true, originalName: true, createdAt: true, checksumSha256: true }, orderBy: [{ versionNumber: "desc" }, { createdAt: "desc" }], take: 250 }),
      prisma.libraryItem.count({ where: { parentId: params.itemId } }),
      prisma.libraryBacklink.count({ where: { itemId: params.itemId } }),
      prisma.libraryVersion.count({ where: { itemId: params.itemId } }),
    ]);
    const effective = await resolveLibraryEffectiveRetention(prisma, accessible.item);
    const retention = libraryRetentionDecision({ ...accessible.item,
      legalHold: effective.legalHold, retentionUntil: effective.retentionUntil });
    return {
      ok: true,
      itemId: params.itemId,
      retention,
      effectiveRetention: { legalHold: effective.legalHold, retentionUntil: effective.retentionUntil,
        governingIds: effective.governingIds, lineage: effective.lineage },
      dependencies: { children, backlinks, versions, truncated: { children: children > childRows.length, backlinks: backlinks > backlinkRows.length, versions: versions > versionRows.length } },
      revision: accessible.item.revision,
      evidence: {
        children: childRows,
        backlinks: backlinkRows.map((entry: any) => ({ ...entry, metadata: parseLibraryMetadata(entry.metadata) })),
        versions: versionRows,
      },
      canDestroy: retention.eligible && children === 0,
    };
  });

  app.put("/api/library/:itemId/retention", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const body = z.object({ retentionPolicyKey: z.string().max(120).optional().nullable(),
      retentionUntil: z.string().optional().nullable(), legalHold: z.boolean().optional(),
      expectedRevision: z.number().int().positive(), reason: z.string().trim().max(1000).optional(),
    }).parse(request.body);
    const accessible = await findAccessibleItem(request, reply, params.itemId, "manage");
    if (!accessible) return;
    const requestedDate = body.retentionUntil === undefined ? undefined : body.retentionUntil ? new Date(body.retentionUntil) : null;
    if (requestedDate && !Number.isFinite(requestedDate.getTime())) return reply.code(400).send({ ok: false, code: "RETENTION_DATE_INVALID", error: "Invalid retention deadline." });
    const existing = accessible.item;
    if (existing.revision !== body.expectedRevision) return reply.code(409).send({ ok: false, code: "LIBRARY_REVISION_CONFLICT", error: "Retention settings changed. Reload before saving." });
    const reducesRetention = body.retentionUntil !== undefined && Boolean(existing.retentionUntil) &&
      (!requestedDate || requestedDate.getTime() < new Date(existing.retentionUntil).getTime());
    const removesHold = existing.legalHold && body.legalHold === false;
    if (reducesRetention || removesHold) {
      if (!accessible.context.decorated?.isAdmin) return reply.code(403).send({ ok: false, code: "RETENTION_OVERRIDE_ADMIN_REQUIRED", error: "Only an administrator can shorten retention or lift a hold." });
      if (!body.reason || body.reason.length < 12) return reply.code(400).send({ ok: false, code: "RETENTION_OVERRIDE_REASON_REQUIRED", error: "Explain the retention override in at least 12 characters." });
    }
    let updated: any;
    try {
      updated = await prisma.$transaction(async (tx: any) => {
        const result = await tx.libraryItem.updateMany({ where: { id: params.itemId, revision: body.expectedRevision }, data: {
          ...(body.retentionPolicyKey !== undefined ? { retentionPolicyKey: body.retentionPolicyKey || null } : {}),
          ...(requestedDate !== undefined ? { retentionUntil: requestedDate } : {}),
          ...(body.legalHold !== undefined ? { legalHold: body.legalHold } : {}),
          lastEditorId: user.id, revision: { increment: 1 },
        } });
        if (result.count !== 1) throw new LibraryDispositionError("LIBRARY_REVISION_CONFLICT", "Retention policy was changed concurrently.");
        const current = await tx.libraryItem.findUnique({ where: { id: params.itemId }, include: itemInclude });
        await tx.activityEvent.create({ data: { userId: user.id, projectId: current.projectId,
          type: "retention_updated", entityType: "library", entityId: params.itemId,
          title: "Library retention updated", message: current.title,
          metadata: JSON.stringify({ previous: { retentionPolicyKey: existing.retentionPolicyKey,
            retentionUntil: existing.retentionUntil, legalHold: existing.legalHold },
            next: { retentionPolicyKey: current.retentionPolicyKey, retentionUntil: current.retentionUntil,
              legalHold: current.legalHold }, reason: body.reason || null }),
        } });
        return current;
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if ((error as any)?.code === "P2034") return reply.code(409).send({ ok: false, code: "LIBRARY_REVISION_CONFLICT", error: "Retention update conflicted; reload and retry." });
      if (error instanceof LibraryDispositionError) return reply.code(409).send({ ok: false, code: error.code, error: error.message });
      throw error;
    }
    clearLibraryContextCache();
    return serializeLibraryItem(updated, true);
  });

  // Disposition is staged and reversible. The old immediate cascading delete
  // endpoint is intentionally retired: it destroyed revision/provenance records
  // without reliably reclaiming referenced bytes.
  app.get("/api/library/:itemId/disposition", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const accessible = await findAccessibleItem(request, reply, params.itemId, "manage");
    if (!accessible) return;
    reply.header("Cache-Control", "private, no-store");
    const inspected = await inspectLibraryDisposition(prisma, params.itemId);
    const review = await reviewLibraryDisposition(prisma, params.itemId);
    const history = await prisma.libraryDispositionRequest.findMany({ where: { itemId: params.itemId },
      select: { id: true, reason: true, status: true, requestedAt: true, reviewAfter: true, cancelledAt: true, requestedById: true, originalRevision: true },
      orderBy: { requestedAt: "desc" }, take: 25 });
    const viewerId = accessible.context.user?.id;
    return { ok: true, itemId: params.itemId, canInspectStorageOwnership: Boolean(accessible.context.decorated?.isAdmin),
      canReviewDisposition: Boolean(accessible.context.decorated?.isAdmin && viewerId !== review?.request?.requestedById),
      canApproveDisposition: Boolean(accessible.context.decorated?.isAdmin && viewerId !== review?.request?.requestedById &&
        review?.readyForHumanReview && !review?.approverIds?.includes(viewerId)),
      canWithdrawMyDispositionApproval: Boolean(accessible.context.decorated?.isAdmin && review?.approverIds?.includes(viewerId)),
      evidence: inspected.evidence, fingerprint: inspected.fingerprint,
      blockers: inspected.blockers, reviewAfter: inspected.reviewAfter, activeRequest: review?.request || null,
      reviewBlockers: review?.blockers || [], readyForHumanReview: review?.readyForHumanReview || false,
      approvalValidNow: review?.approvalValidNow || false, approvalCount: review?.approvalCount || 0,
      requiredApprovers: review?.requiredApprovers || 2, decisionRevision: review?.request?.decisionRevision || 0,
      approverIds: review?.approverIds || [], decisions: review?.decisions || [],
      history, events: history.length ? await prisma.libraryDispositionEvidence.findMany({
        where: { requestId: { in: history.map((entry: any) => entry.id) } },
        select: { id: true, requestId: true, actorId: true, eventType: true, occurredAt: true, detailsJson: true },
        orderBy: { occurredAt: "desc" }, take: 100,
      }) : [], physicalDisposalAllowed: false };
  });

  // R64: explicit operator inspection. Ownership evidence is intentionally not
  // merged into a disposition permit or cached; no filesystem mutation occurs.
  app.get("/api/library/:itemId/disposition/ownership", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const accessible = await findAccessibleItem(request, reply, params.itemId, "manage");
    if (!accessible?.context.user) return;
    if (!accessible.context.decorated?.isAdmin) return reply.code(403).send({ ok: false, code: "ADMIN_REQUIRED", error: "Storage ownership inventory requires an administrator." });
    reply.header("Cache-Control", "private, no-store");
    try {
      const ownership = await inspectLibraryStorageOwnership({ prisma, itemId: params.itemId, libraryRoot: dataLayout.libraryFilesRoot });
      return { ok: true, ownership };
    } catch (error) {
      if (/LIBRARY_OWNERSHIP_(?:INVENTORY|CANDIDATE|MATCH)_LIMIT|LIBRARY_OWNERSHIP_(?:CURSOR_STALLED|DEADLINE)|LIBRARY_RELATED_(?:DIGEST|MATCH|RELEASE)_LIMIT/.test(String((error as Error).message)))
        return reply.code(409).send({ ok: false, code: "OWNERSHIP_INCOMPLETE", error: "Storage ownership inspection could not scan all required records; no report or disposal authority was produced." });
      throw error;
    }
  });

  // R67 simulation-only interface. Each operation rechecks administrator and
  // Library-management authority; plans are NOT executable job payloads.
  app.get("/api/library/:itemId/disposition/quarantine-simulation", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const accessible = await findAccessibleItem(request, reply, params.itemId, "manage");
    if (!accessible?.context.user) return;
    if (!accessible.context.decorated?.isAdmin) return reply.code(403).send({ ok: false, code: "ADMIN_REQUIRED" });
    reply.header("Cache-Control", "private, no-store");
    try {
      const simulation = await inspectLibraryQuarantineSimulation({ prisma, itemId: params.itemId, libraryRoot: dataLayout.libraryFilesRoot });
      return { ok: true, simulation };
    } catch (error) {
      if (/LIBRARY_OWNERSHIP_|LIBRARY_RELATED_/.test(String((error as Error).message)))
        return reply.code(409).send({ ok: false, code: "QUARANTINE_INSPECTION_INCOMPLETE", error: "No complete quarantine simulation was produced." });
      throw error;
    }
  });

  app.post("/api/library/:itemId/disposition/quarantine-simulations", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const body = z.object({ planKey: z.string().uuid(), reason: z.string().trim().min(12).max(1000),
      expectedDecisionRevision: z.number().int().nonnegative() }).parse(request.body);
    const accessible = await findAccessibleItem(request, reply, params.itemId, "manage");
    if (!accessible?.context.user) return;
    if (!accessible.context.decorated?.isAdmin) return reply.code(403).send({ ok: false, code: "ADMIN_REQUIRED" });
    reply.header("Cache-Control", "private, no-store");
    try {
      const simulation = await inspectLibraryQuarantineSimulation({ prisma, itemId: params.itemId, libraryRoot: dataLayout.libraryFilesRoot });
      const recorded = await prisma.$transaction((tx: any) => recordLibraryQuarantineSimulation(tx, {
        itemId: params.itemId, actorId: accessible.context.user.id, ...body, simulation,
      }), { isolationLevel: "Serializable" });
      return { ok: true, id: recorded.plan.id, replay: recorded.replay,
        mode: "SIMULATION_ONLY", quarantineAllowed: false, physicalDisposalAllowed: false,
        snapshotSha256: recorded.plan.snapshotSha256, blockers: simulation.blockers };
    } catch (error) {
      if ((error as any)?.code === "P2034" || (error as any)?.code === "P2002")
        return reply.code(409).send({ ok: false, code: "QUARANTINE_SIMULATION_CONFLICT", error: "Simulation changed concurrently. Refresh and retry." });
      if (error instanceof LibraryDispositionError) return reply.code(409).send({ ok: false, code: error.code, error: error.message });
      if (/LIBRARY_OWNERSHIP_|LIBRARY_RELATED_/.test(String((error as Error).message)))
        return reply.code(409).send({ ok: false, code: "QUARANTINE_INSPECTION_INCOMPLETE" });
      throw error;
    }
  });

  app.get("/api/library/:itemId/disposition/quarantine-simulations", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const accessible = await findAccessibleItem(request, reply, params.itemId, "manage");
    if (!accessible?.context.user) return;
    if (!accessible.context.decorated?.isAdmin) return reply.code(403).send({ ok: false, code: "ADMIN_REQUIRED" });
    reply.header("Cache-Control", "private, no-store");
    const plans = await prisma.libraryQuarantinePlan.findMany({ where: { itemId: params.itemId },
      select: { id: true, requestId: true, actorId: true, reason: true, planVersion: true,
        snapshotSha256: true, recordedAt: true, expiresAt: true,
        journal: { select: { id: true, actorId: true, eventType: true, occurredAt: true }, orderBy: { occurredAt: "asc" } } },
      orderBy: { recordedAt: "desc" }, take: 25 });
    return { ok: true, mode: "SIMULATION_ONLY", plans, quarantineAllowed: false, physicalDisposalAllowed: false };
  });

  app.post("/api/library/:itemId/disposition/quarantine-simulations/:planId/withdraw", async (request, reply) => {
    const params = z.object({ itemId: z.string(), planId: z.string() }).parse(request.params);
    const body = z.object({ reason: z.string().trim().min(12).max(1000) }).parse(request.body);
    const accessible = await findAccessibleItem(request, reply, params.itemId, "manage");
    if (!accessible?.context.user) return;
    if (!accessible.context.decorated?.isAdmin) return reply.code(403).send({ ok: false, code: "ADMIN_REQUIRED" });
    try {
      const result = await prisma.$transaction((tx: any) => withdrawLibraryQuarantineSimulation(tx, {
        itemId: params.itemId, planId: params.planId, actorId: accessible.context.user.id, reason: body.reason,
      }), { isolationLevel: "Serializable" });
      return { ok: true, ...result, quarantineAllowed: false, physicalDisposalAllowed: false };
    } catch (error) {
      if ((error as any)?.code === "P2002" || (error as any)?.code === "P2034")
        return reply.code(409).send({ ok: false, code: "QUARANTINE_WITHDRAW_CONFLICT" });
      if (error instanceof LibraryDispositionError) return reply.code(409).send({ ok: false, code: error.code, error: error.message });
      throw error;
    }
  });

  app.post("/api/library/:itemId/disposition", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const body = z.object({ confirmTitle: z.string().max(240), expectedRevision: z.number().int().positive(),
      requestKey: z.string().uuid(), reason: z.string().trim().min(12).max(1000) }).parse(request.body);
    const accessible = await findAccessibleItem(request, reply, params.itemId, "manage");
    if (!accessible?.context.user) return;
    if (await rejectMountedWriteWhenLocked(reply, params.itemId)) return;
    const hierarchyMark = await prisma.libraryHierarchyLifecycleEntry.findFirst({ where: { itemId: params.itemId, restoredAt: null }, select: { jobId: true } });
    if (hierarchyMark) return reply.code(409).send({ ok: false, code: "LIBRARY_HIERARCHY_DISPOSITION_BLOCKED", error: "Restore the originating hierarchy before requesting disposition." });
    try {
      const submitted = await prisma.$transaction((tx: any) => requestLibraryDisposition(tx, {
        itemId: params.itemId, actorId: accessible.context.user.id, ...body,
      }), { isolationLevel: "Serializable" });
      return { ok: true, requestId: submitted.request.id, reviewAfter: submitted.request.reviewAfter,
        replay: submitted.replay, storageDisposition: "preserved_no_unlink" };
    } catch (error) {
      if ((error as any)?.code === "P2034" || (error as any)?.code === "P2002") return reply.code(409).send({ ok: false, code: "DISPOSITION_CONFLICT", error: "Disposition changed concurrently. Refresh and retry." });
      if (error instanceof LibraryDispositionError) return reply.code(error.code === "LIBRARY_NOT_FOUND" ? 404 : 409).send({ ok: false, code: error.code, error: error.message });
      throw error;
    }
  });

  // Independent human review is a governance decision, not file disposal.
  // Two different administrators other than the requester must approve an
  // unchanged evidence snapshot after the restore window. No unlink endpoint.
  app.post("/api/library/:itemId/disposition/decision", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const body = z.object({ action: z.enum(["APPROVE", "REJECT", "REVOKE"]),
      reason: z.string().trim().min(12).max(1000), expectedDecisionRevision: z.number().int().nonnegative() }).parse(request.body);
    const accessible = await findAccessibleItem(request, reply, params.itemId, "manage");
    if (!accessible?.context.user) return;
    if (!accessible.context.decorated?.isAdmin) return reply.code(403).send({ ok: false, code: "ADMIN_REQUIRED", error: "Independent disposition review requires an administrator." });
    if (await rejectMountedWriteWhenLocked(reply, params.itemId)) return;
    reply.header("Cache-Control", "private, no-store");
    try {
      const decided = await prisma.$transaction((tx: any) => decideLibraryDisposition(tx, {
        itemId: params.itemId, actorId: accessible.context.user.id, ...body,
      }), { isolationLevel: "Serializable" });
      clearLibraryContextCache();
      return { ok: true, ...decided, storageDisposition: "preserved_no_unlink" };
    } catch (error) {
      if ((error as any)?.code === "P2034" || (error as any)?.code === "P2002") return reply.code(409).send({ ok: false, code: "DISPOSITION_CONFLICT", error: "A review was changed concurrently; refresh its decisions." });
      if (error instanceof LibraryDispositionError) return reply.code(error.code === "LIBRARY_NOT_FOUND" ? 404 : 409).send({ ok: false, code: error.code, error: error.message });
      throw error;
    }
  });

  app.post("/api/library/:itemId/disposition/cancel", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const body = z.object({ reason: z.string().trim().min(5).max(1000) }).parse(request.body);
    const accessible = await findAccessibleItem(request, reply, params.itemId, "manage");
    if (!accessible?.context.user) return;
    try {
      const outcome = await prisma.$transaction((tx: any) => cancelLibraryDisposition(tx, {
        itemId: params.itemId, actorId: accessible.context.user.id, reason: body.reason,
      }), { isolationLevel: "Serializable" });
      if (!outcome.cancelled) return reply.code(409).send({ ok: false, code: "DISPOSITION_NOT_PENDING", error: "No pending disposition to cancel." });
      return { ok: true, cancelled: true, requestId: outcome.request.id };
    } catch (error) {
      if ((error as any)?.code === "P2034") return reply.code(409).send({ ok: false, code: "DISPOSITION_CONFLICT", error: "Disposition changed concurrently." });
      if (error instanceof LibraryDispositionError) return reply.code(409).send({ ok: false, code: error.code, error: error.message });
      throw error;
    }
  });

  app.patch("/api/library/:itemId", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) throw new Error("Login required.");
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const accessible = await findAccessibleItem(request, reply, params.itemId, "contribute");
    if (!accessible) return;
    const body = itemWriteSchema(true).extend({ expectedRevision: z.number().int().positive().optional() }).parse(request.body);
    const existing = accessible.item;
    const metadataPolicyDenial = libraryMetadataMutationDenial(existing, body);
    if (metadataPolicyDenial) return reply.code(409).send({ ok: false, ...metadataPolicyDenial, error: metadataPolicyDenial.message });
    if (body.expectedRevision !== undefined && body.expectedRevision !== existing.revision) {
      return reply.code(409).send({ ok: false, code: "revision_conflict", error: "The Library item changed on the server.", current: serializeLibraryItem(existing, true) });
    }
    if (isManagedLibraryFolder(existing) && (body.status === "archived" || (body.parentId !== undefined && (body.parentId || null) !== (existing.parentId || null)))) return rejectManagedFolderChange(reply);
    if (existing.type === "folder" && ((body.status !== undefined && (["archived", "trashed"].includes(body.status) || (["archived", "trashed"].includes(existing.status) && body.status !== existing.status))) ||
      (body.lifecycleState !== undefined && body.lifecycleState !== existing.lifecycleState && (body.lifecycleState === "trashed" || existing.lifecycleState === "trashed")) ||
      (body.type !== undefined && body.type !== "folder")))
      return reply.code(409).send({ ok: false, code: "LIBRARY_HIERARCHY_LIFECYCLE_REQUIRED",
        error: "Folder lifecycle changes require the durable hierarchy lifecycle operation." });
    if ((body.status !== undefined && body.status !== existing.status) ||
      (body.lifecycleState !== undefined && body.lifecycleState !== existing.lifecycleState) ||
      (body.parentId !== undefined && (body.parentId || null) !== (existing.parentId || null)) ||
      (body.type !== undefined && body.type !== existing.type)) {
      const activeHierarchyMark = await prisma.libraryHierarchyLifecycleEntry.findFirst({ where: { itemId: existing.id, restoredAt: null }, select: { jobId: true } });
      if (activeHierarchyMark) return reply.code(409).send({ ok: false, code: "LIBRARY_HIERARCHY_OPERATION_ACTIVE",
        error: "Restore the originating hierarchy before moving or changing this item's lifecycle." });
    }
    if (body.parentId !== undefined) {
      await assertValidParent(existing.id, body.parentId);
      if (body.parentId) {
        const destination = await findAccessibleItem(request, reply, body.parentId, "contribute");
        if (!destination) return;
      }
    }
    const previousChangelog = parseJsonArray(existing.changelog);
    const nextStatus = body.status ?? existing.status;
    const nextChangelog = body.changelogNote
      ? [{ at: new Date().toISOString(), by: user.id, from: existing.status, to: nextStatus, note: body.changelogNote }, ...previousChangelog].slice(0, 80)
      : previousChangelog;
    const data: any = { lastEditorId: user.id };
    for (const field of ["projectId", "ownerId", "reviewerId", "parentId", "generatedForUserId"] as const) if (body[field] !== undefined) data[field] = body[field] || null;
    for (const field of ["title", "body", "type", "status", "priority", "versionLabel", "visibility", "lifecycleNotes", "source", "retentionPolicyKey", "originKind", "originRef", "generatedByKind", "generatedById"] as const) if (body[field] !== undefined) data[field] = body[field] || null;
    if (body.classification !== undefined) data.classification = normalizeLibraryClassification(body.classification);
    if (body.lifecycleState !== undefined) data.lifecycleState = normalizeLibraryLifecycleState(body.lifecycleState);
    if (body.retentionUntil !== undefined) data.retentionUntil = body.retentionUntil ? new Date(body.retentionUntil) : null;
    if (body.legalHold !== undefined) data.legalHold = body.legalHold;
    if (body.tags !== undefined) data.tags = JSON.stringify(unique(body.tags));
    if (body.externalUrl !== undefined) data.externalUrl = body.externalUrl ? safeUrl(body.externalUrl, "External URL") : null;
    if (body.pinned !== undefined) data.pinned = body.pinned;
    if (body.reviewDueAt !== undefined) data.reviewDueAt = body.reviewDueAt ? new Date(body.reviewDueAt) : null;
    if (body.approvedAt !== undefined || body.status !== undefined) data.approvedAt = body.approvedAt ? new Date(body.approvedAt) : (nextStatus === "approved" ? (existing.approvedAt || new Date()) : null);
    if (body.metadata !== undefined) data.metadata = JSON.stringify(normalizeLibraryMetadata(body.metadata));
    data.changelog = JSON.stringify(nextChangelog);
    data.revision = { increment: 1 };

    const updated = await prisma.libraryItem.updateMany({ where: { id: params.itemId, revision: existing.revision }, data });
    if (!updated.count) {
      const current = await prisma.libraryItem.findUnique({ where: { id: params.itemId }, include: itemInclude });
      return reply.code(409).send({ ok: false, code: "REVISION_CONFLICT", error: "The Library item changed on the server.", current: current ? serializeLibraryItem(current, true) : null });
    }
    let item = await prisma.libraryItem.findUniqueOrThrow({ where: { id: params.itemId }, include: itemInclude });
    // A folder title change or parent move can affect any number of stored
    // descendants. Never run a full disk reconciliation inside the HTTP edit.
    // The DB edit is committed even if enqueue fails.
    const storageChange = (body.parentId !== undefined && (body.parentId || null) !== (existing.parentId || null))
      || (existing.type === "folder" && body.title !== undefined && body.title !== existing.title);
    const repair = storageChange
      ? await scheduleCommittedLibraryStorageRepair(jobQueue, user.id, body.parentId !== undefined ? "item-move" : "folder-rename")
      : null;
    await logActivity({ userId: user.id, projectId: item.projectId, type: "updated", entityType: "library", entityId: item.id, title: "Library item updated", message: item.title, metadata: { type: item.type, status: item.status, ...(repair ? { reconciliationQueued: repair.reconciliationQueued, reconciliationJobId: repair.reconciliationJobId } : {}) } });
    clearLibraryContextCache();
    if (repair) {
      reply.code(202);
      return { ...serializeLibraryItem(item, true), ...repair };
    }
    return serializeLibraryItem(item, true);
  });

  app.put("/api/library/:itemId", async (request, reply) => {
    return reply.code(405).send({ ok: false, error: "Use PATCH for Library metadata updates." });
  });

  app.post("/api/library/:itemId/reorder", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const body = z.object({ targetId: z.string(), position: z.enum(["before", "after"]).optional().default("before") }).parse(request.body || {});
    if (params.itemId === body.targetId) return reply.code(400).send({ ok: false, code: "LIBRARY_REORDER_SELF", error: "An item cannot be ordered relative to itself." });
    const sourceAccess = await findAccessibleItem(request, reply, params.itemId, "edit");
    if (!sourceAccess) return;
    const targetAccess = await findAccessibleItem(request, reply, body.targetId, "edit");
    if (!targetAccess) return;
    const source = sourceAccess.item;
    const target = targetAccess.item;
    if ((source.parentId || null) !== (target.parentId || null)) return reply.code(409).send({ ok: false, code: "LIBRARY_REORDER_PARENT_MISMATCH", error: "Custom ordering only applies within the same folder." });
    const siblings = await prisma.libraryItem.findMany({
      where: { parentId: source.parentId || null, status: { notIn: ["trashed"] } },
      select: { id: true, manualOrder: true, title: true },
      orderBy: librarySort("custom") as any,
      take: 10_000,
    });
    const ordered = siblings.filter((entry: any) => entry.id !== source.id);
    const targetIndex = ordered.findIndex((entry: any) => entry.id === target.id);
    if (targetIndex < 0) return reply.code(409).send({ ok: false, code: "LIBRARY_REORDER_TARGET_MISSING", error: "The target item is no longer in this folder." });
    ordered.splice(targetIndex + (body.position === "after" ? 1 : 0), 0, { id: source.id, manualOrder: source.manualOrder, title: source.title });
    await prisma.$transaction(ordered.map((entry: any, index: number) => prisma.libraryItem.update({ where: { id: entry.id }, data: { manualOrder: (index + 1) * 1024, revision: { increment: 1 } } })));
    clearLibraryContextCache();
    await logActivity({ userId: sourceAccess.context.user?.id, projectId: source.projectId || null, type: "library.reordered", entityType: "library", entityId: source.id, message: `Reordered Library item ${source.title}` });
    return { ok: true, orderedIds: ordered.map((entry: any) => entry.id) };
  });

  const libraryBulkSchema = z.object({
    ids: z.array(z.string().min(1)).min(1).max(200).refine((ids) => new Set(ids).size === ids.length, "Select distinct Library items."),
    expectedRevisions: z.record(z.number().int().positive()),
    action: z.enum(["move", "archive", "trash", "restore", "tag", "untag", "status", "pin", "rename"]),
    rename: z.object({ mode: z.enum(["replace", "prefix", "suffix", "number"]), text: z.string().max(160).optional(), replacement: z.string().max(160).optional(), start: z.number().int().min(0).max(999999).optional(), padding: z.number().int().min(1).max(8).optional() }).optional(),
    confirmedTitles: z.record(z.string()).optional(),
    parentId: z.string().optional().nullable(),
    tag: z.string().max(80).optional(),
    // Archive/Trash have dedicated lifecycle actions with extra safeguards.
    status: z.enum(["draft", "active", "in-review", "approved", "needs-update", "deprecated"]).optional(),
    pinned: z.boolean().optional(),
  }).superRefine((value, ctx) => {
    if (value.action === "status" && !value.status) ctx.addIssue({ code: "custom", path: ["status"], message: "Select a status." });
    if (["tag", "untag"].includes(value.action) && !value.tag?.trim()) ctx.addIssue({ code: "custom", path: ["tag"], message: "Enter a tag." });
    if (value.action === "rename" && !value.rename) ctx.addIssue({ code: "custom", path: ["rename"], message: "Provide a rename rule." });
    if (value.action === "pin" && value.pinned === undefined) ctx.addIssue({ code: "custom", path: ["pinned"], message: "Choose whether to pin or unpin." });
  });
  async function prepareLibraryBulk(request: FastifyRequest, reply: FastifyReply, body: z.infer<typeof libraryBulkSchema>) {
    const context = await accessContext(request);
    if (!context.user) { reply.code(401).send({ ok: false, error: "Authentication required." }); return null; }
    const items = await prisma.libraryItem.findMany({ where: { id: { in: body.ids } }, include: itemInclude });
    // The Records domain controls attached personnel records, even when the
    // caller has an otherwise valid Library folder grant or guesses item IDs.
    const protectedReferences = await prisma.personnelRecordAttachment.findMany({
      where: { libraryItemId: { in: body.ids } }, select: { libraryItemId: true }, take: 1,
    });
    if (protectedReferences.length) {
      reply.code(403).send({ ok: false, code: "PERSONNEL_RECORD_POLICY_REQUIRED", error: "Personnel Records cannot be changed by Library bulk actions." }); return null;
    }
    if (items.length !== body.ids.length || items.some((item: any) => !visibleFor(context, item, "contribute"))) {
      reply.code(403).send({ ok: false, error: "One or more Library items cannot be changed." }); return null;
    }
    if (items.some((item: any) => body.expectedRevisions[item.id] !== item.revision)) {
      reply.code(409).send({ ok: false, code: "LIBRARY_BULK_REVISION_CONFLICT", error: "The selected Library items changed. Refresh and review them before retrying." }); return null;
    }
    // Bulk rename edits display names, never persisted blob filenames or paths.
    // Folder renames need the standalone path-reconciliation flow.
    if (body.action === "rename" && items.some((item: any) => item.type === "folder" || item.status === "trashed" || Boolean(item.deletedAt))) {
      reply.code(409).send({ ok: false, code: "LIBRARY_BULK_RENAME_SCOPE", error: "Only active, non-folder items may be bulk renamed." }); return null;
    }
    // A status-only bulk edit must not revive trashed objects while leaving
    // their lifecycle/deletion evidence marked as trashed. Archive is similarly
    // invalid until an item is restored through the dedicated transition.
    if (["status", "archive"].includes(body.action) && items.some((item: any) => item.status === "trashed" || item.lifecycleState === "trashed" || Boolean(item.deletedAt))) {
      reply.code(409).send({ ok: false, code: "LIBRARY_BULK_LIFECYCLE_CONFLICT", error: "Restore trashed Library items before changing their status or archiving them." }); return null;
    }
    if (["move", "archive", "trash"].includes(body.action) && items.some((item: any) => isManagedLibraryFolder(item))) {
      rejectManagedFolderChange(reply); return null;
    }
    if (body.action === "move") {
      if (body.parentId) {
        const destination = await prisma.libraryItem.findUnique({ where: { id: body.parentId }, include: itemInclude });
        if (!destination || destination.type !== "folder" || ["archived", "trashed"].includes(destination.status) || !visibleFor(context, destination, "contribute")) {
          reply.code(403).send({ ok: false, code: "LIBRARY_BULK_DESTINATION_DENIED", error: "The destination folder cannot accept these items." }); return null;
        }
      }
      // Compute the hierarchy once, rather than performing a full-table scan for each selected item.
      if (body.parentId) {
        const hierarchy = await prisma.libraryItem.findMany({ select: { id: true, parentId: true } });
        if (items.some((item: any) => wouldCreateLibraryCycle(hierarchy, item.id, body.parentId!))) {
          reply.code(409).send({ ok: false, code: "LIBRARY_BULK_CYCLE", error: "A folder cannot be moved into itself or one of its descendants." }); return null;
        }
      }
    }
    let descendantCount = 0;
    let descendantIds: string[] = [];
    if (["move", "archive", "trash", "restore"].includes(body.action) && items.some((item: any) => item.type === "folder")) {
      try {
        const scope = await inspectLibraryBulkScope(items, (parentIds, limit) => prisma.libraryItem.findMany({
          where: { parentId: { in: parentIds } }, include: itemInclude, take: limit,
        }), (item) => visibleFor(context, item, "contribute"), (item) => isManagedLibraryFolder(item));
        if (scope.hasRestrictedDescendants || scope.hasProtectedDescendants) {
          reply.code(403).send({ ok: false, code: "LIBRARY_BULK_NESTED_ACCESS", error: "The selected folders contain protected or inaccessible items. Change them individually with appropriate access." }); return null;
        }
        descendantCount = scope.descendants.length;
        descendantIds = scope.descendants.map((item) => item.id);
      } catch (error) {
        if (error instanceof LibraryBulkScopeLimitError) {
          reply.code(409).send({ ok: false, code: "LIBRARY_BULK_SCOPE_LIMIT", error: error.message }); return null;
        }
        throw error;
      }
    }
    // Changing a parent location can indirectly relocate records or locked assets.
    // Inspect the entire bounded impacted scope, not merely the selected roots.
    const impactedIds = [...body.ids, ...descendantIds];
    const attachments = await prisma.personnelRecordAttachment?.findFirst?.({
      where: { libraryItemId: { in: impactedIds } }, select: { id: true },
    });
    if (attachments) { reply.code(403).send({ ok: false, code: "PERSONNEL_RECORD_POLICY_REQUIRED", error: "Personnel Records attachments must be managed from Records." }); return null; }
    const locks = await prisma.libraryAssetLock.findMany({ where: { itemId: { in: impactedIds } } });
    if (locks.some((lock: any) => libraryLockIsActive(lock))) {
      reply.code(409).send({ ok: false, code: "LIBRARY_BULK_LOCK_CONFLICT", error: "At least one selected item or nested file has an active edit lock. Release the lock and retry." }); return null;
    }
    return { context, items, descendantCount };
  }

  async function prepareBulkRenames(reply: FastifyReply, body: z.infer<typeof libraryBulkSchema>, items: any[]) {
    if (body.action !== "rename") return null;
    let renames: ReturnType<typeof planLibraryBulkRename>;
    try { renames = planLibraryBulkRename(items, body.rename!); }
    catch (error) {
      if (error instanceof LibraryBulkRenameError) { reply.code(409).send({ ok: false, code: error.code, error: error.message }); return null; }
      throw error;
    }
    const parentIds = [...new Set(renames.map((entry) => entry.parentId))];
    // Bound the collision query so preview and execution cannot accidentally
    // scan a giant Library; refuse instead of giving a misleading preview.
    const siblings = await prisma.libraryItem.findMany({
      where: { OR: parentIds.map((parentId) => ({ parentId })), status: { not: "trashed" } },
      select: { id: true, parentId: true, title: true }, take: 10001,
    });
    if (siblings.length > 10000) {
      reply.code(409).send({ ok: false, code: "LIBRARY_BULK_RENAME_SCOPE_LIMIT", error: "Too many nearby Library items to verify naming collisions safely." }); return null;
    }
    const selected = new Set(body.ids);
    const existing = new Set(siblings.filter((entry: any) => !selected.has(entry.id))
      .map((entry: any) => `${entry.parentId ?? "ROOT"}\0${entry.title.toLocaleLowerCase("en-US")}`));
    if (renames.some((entry) => existing.has(`${entry.parentId ?? "ROOT"}\0${entry.to.toLocaleLowerCase("en-US")}`))) {
      reply.code(409).send({ ok: false, code: "LIBRARY_BULK_RENAME_COLLISION", error: "A generated title conflicts with an existing item in its folder." }); return null;
    }
    return renames;
  }

  app.post("/api/library/storage/reconciliation", async (request, reply) => {
    const authenticated = await requireLibraryTool(request, reply, "edit");
    if (!authenticated) return;
    if (!authenticated.decorated?.isAdmin) return reply.code(403).send({ ok: false, code: "ADMIN_REQUIRED", error: "Only Studio administrators may request storage reconciliation." });
    const repair = await scheduleCommittedLibraryStorageRepair(jobQueue, authenticated.user.id, "admin-repair");
    reply.header("Cache-Control", "no-store");
    if (!repair.reconciliationQueued) return reply.code(503).send({ ok: false, code: "LIBRARY_RECONCILIATION_QUEUE_UNAVAILABLE", error: "Unable to queue Library storage repair. Retry from Operations." });
    return reply.code(202).send({ ok: true, jobId: repair.reconciliationJobId, status: repair.reconciliationJobStatus });
  });

  app.get("/api/library/storage/reconciliation/:jobId", async (request, reply) => {
    const authenticated = await requireLibraryTool(request, reply, "view");
    if (!authenticated) return;
    const { jobId } = z.object({ jobId: z.string().min(1).max(200) }).parse(request.params);
    const detail = await jobQueue.get(jobId);
    if (!detail || detail.job.type !== "library.storage.reconcile" ||
        (!authenticated.decorated?.isAdmin && detail.job.createdById !== authenticated.user.id)) {
      return reply.code(404).send({ ok: false, code: "JOB_NOT_FOUND", error: "Storage repair job not found." });
    }
    reply.header("Cache-Control", "no-store");
    return { ok: true, job: serializeBackgroundJob(detail.job, { includeResult: true }) };
  });

  // Storage audit is evidence collection only. It cannot delete, quarantine,
  // or declare paths destruction-eligible. Results remain administrator-only.
  app.post("/api/library/storage/orphans/audit", async (request, reply) => {
    const authenticated = await requireLibraryTool(request, reply, "edit");
    if (!authenticated) return;
    if (!authenticated.decorated?.isAdmin) return reply.code(403).send({ ok: false, code: "ADMIN_REQUIRED", error: "Only Studio administrators may audit Library storage." });
    try {
      const job = await jobQueue.enqueue({
        type: "library.storage.orphan-audit", queue: "default", costUnits: 2,
        maxAttempts: 2, createdById: authenticated.user.id, payload: { scope: "library" },
      });
      reply.header("Cache-Control", "no-store");
      return reply.code(202).send({ ok: true, jobId: job.id, status: job.status, readOnly: true });
    } catch {
      return reply.code(503).send({ ok: false, code: "LIBRARY_AUDIT_QUEUE_UNAVAILABLE", error: "Unable to queue a read-only Library storage audit." });
    }
  });

  app.get("/api/library/storage/orphans/audit/:jobId", async (request, reply) => {
    const authenticated = await requireLibraryTool(request, reply, "view");
    if (!authenticated) return;
    if (!authenticated.decorated?.isAdmin) return reply.code(403).send({ ok: false, code: "ADMIN_REQUIRED", error: "Only Studio administrators may inspect Library storage audits." });
    const { jobId } = z.object({ jobId: z.string().min(1).max(200) }).parse(request.params);
    const detail = await jobQueue.get(jobId);
    if (!detail || detail.job.type !== "library.storage.orphan-audit") return reply.code(404).send({ ok: false, code: "JOB_NOT_FOUND", error: "Library storage audit not found." });
    reply.header("Cache-Control", "no-store");
    return { ok: true, job: serializeBackgroundJob(detail.job, { includeResult: true }) };
  });

  // R41: An operator can re-review an audit sample, but no review response
  // constitutes deletion or quarantine authorization. Candidate identity is
  // taken from the completed server job, not from a user-supplied pathname.
  app.post("/api/library/storage/orphans/audit/:jobId/review", async (request, reply) => {
    const authenticated = await requireLibraryTool(request, reply, "edit");
    if (!authenticated) return;
    if (!authenticated.decorated?.isAdmin) return reply.code(403).send({ ok: false, code: "ADMIN_REQUIRED", error: "Only administrators may review storage candidates." });
    const { jobId } = z.object({ jobId: z.string().min(1).max(200) }).parse(request.params);
    const { relativePath } = z.object({ relativePath: z.string().min(1).max(2048) }).parse(request.body || {});
    const detail = await jobQueue.get(jobId);
    const job = detail?.job;
    if (!job || job.type !== "library.storage.orphan-audit" || job.status !== "SUCCEEDED")
      return reply.code(404).send({ ok: false, code: "AUDIT_NOT_FOUND", error: "A completed storage audit is required." });
    const audit = serializeBackgroundJob(job, { includeResult: true }).result as any;
    const sample = Array.isArray(audit?.sample) ? audit.sample.find((entry: any) => entry?.relativePath === relativePath) : null;
    if (!sample || typeof sample.sizeBytes !== "number" || typeof sample.modifiedAt !== "string")
      return reply.code(404).send({ ok: false, code: "CANDIDATE_NOT_IN_AUDIT", error: "This path was not in the completed audit sample. Run a new audit." });
    const activeLibraryJobs = await prisma.backgroundJob.count({ where: {
      status: { in: ["QUEUED", "RUNNING"] }, type: { startsWith: "library." },
    } });
    // A bounded all-owner rescan is deliberate: a direct `fileName = path`
    // lookup can miss absolute/normalized aliases or historical revisions.
    const { references } = await collectLibraryStorageReferences(prisma, dataLayout.libraryRoot, async () => {});
    const review = await reviewLibraryOrphanCandidate({ root: dataLayout.libraryRoot, sample, references, activeLibraryJobs });
    reply.header("Cache-Control", "private, no-store");
    return { ok: true, auditJobId: jobId, review };
  });

  // G26 WS9: preview-first, additive-only governance for flat Library items.
  // No bulk lifting of holds, shortening retention, folder-tree propagation or deletion.
  async function inspectGovernanceRequest(request: FastifyRequest, command: ReturnType<typeof libraryBulkGovernanceSchema.parse>, db: any, actorId: string) {
    const actor = await db.user.findUnique({ where: { id: actorId } });
    if (!actor || actor.archived || actor.accountState !== "ACTIVE" ||
      (actor.accessExpiresAt && new Date(actor.accessExpiresAt) <= new Date()))
      throw createHttpError("LIBRARY_GOVERNANCE_ACCESS", "An active account is required for Library governance.", 403);
    const context = await libraryAccess.contextForUser(actor, db);
    if (!context.decorated?.isAdmin)
      throw createHttpError("LIBRARY_GOVERNANCE_ADMIN", "Studio administrator authority is required.", 403);
    const inspection = await inspectLibraryBulkGovernance({
      tx: db, command, itemInclude, canManage: (item) => visibleFor(context, item, "manage"),
    });
    if (inspection.items.some((item) => command.expectedRevisions[item.id] !== item.revision))
      throw createHttpError("LIBRARY_GOVERNANCE_REVISION", "The Library selection changed. Refresh and preview again.", 409);
    return inspection;
  }

  app.post("/api/library/bulk/governance/preview", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const caller = await requireLibraryTool(request, reply, "edit");
    if (!caller) return;
    if (!caller.decorated?.isAdmin) return reply.code(403).send({ ok: false, code: "LIBRARY_GOVERNANCE_ADMIN", error: "Administrator authority required." });
    const command = libraryBulkGovernanceSchema.parse(request.body || {});
    try { return await inspectGovernanceRequest(request, command, prisma, caller.user.id); }
    catch (error) { const failure = error as any;
      if (failure?.statusCode === 403 || failure?.statusCode === 409) return reply.code(failure.statusCode).send({ ok: false, code: failure.code, error: failure.message });
      throw error;
    }
  });

  app.post("/api/library/bulk/governance/apply", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const caller = await requireLibraryTool(request, reply, "edit");
    if (!caller) return;
    if (!caller.decorated?.isAdmin) return reply.code(403).send({ ok: false, code: "LIBRARY_GOVERNANCE_ADMIN", error: "Administrator authority required." });
    const command = libraryBulkGovernanceSchema.parse(request.body || {});
    if (!command.digest) return reply.code(400).send({ ok: false, code: "GOVERNANCE_PREVIEW_REQUIRED", error: "Review a fresh server preview before applying governance." });
    if (!command.reason || command.reason.length < 12) return reply.code(400).send({ ok: false, code: "GOVERNANCE_REASON_REQUIRED", error: "Provide an audit reason of at least 12 characters." });
    try {
      const result = await prisma.$transaction(async (tx: any) => {
        const preview = await inspectGovernanceRequest(request, command, tx, caller.user.id);
        if (preview.digest !== command.digest)
          throw createHttpError("GOVERNANCE_PREVIEW_STALE", "The Library governance or reference evidence changed. Review the selection again.", 409);
        if (preview.blockedCount)
          throw createHttpError("GOVERNANCE_BLOCKED", "One or more Library items require individual governance review. Nothing was changed.", 409);
        // Aggregate preview is informational; authorization, legal holds,
        // CAS and evidence are all evaluated inside this transaction.
        await commitLibraryGovernanceStrengthening(tx, preview, caller.user.id);
        if (preview.changeCount) await tx.activityEvent.create({ data: {
          userId: caller.user.id, type: "library.bulk.governance", entityType: "library", entityId: null,
          title: "Library bulk governance strengthened", message: `${preview.changeCount} Library retention or hold policies strengthened`,
          metadata: JSON.stringify({ action: command.action, affectedIds: preview.items.filter((i) => i.outcome === "change").map((i) => i.id),
            selectionDigest: command.digest, newRetentionUntil: preview.retentionUntil, reason: command.reason,
            referenceCounts: preview.references }),
        } });
        return { ok: true, changedCount: preview.changeCount, unchangedCount: preview.unchangedCount,
          selectedCount: preview.selectedCount, action: command.action };
      }, { isolationLevel: "Serializable", timeout: 20_000 });
      if (result.changedCount) clearLibraryContextCache();
      return result;
    } catch (error) { const failure = error as any;
      if (failure?.code === "P2034") return reply.code(409).send({ ok: false, code: "GOVERNANCE_CONCURRENT_WRITE", error: "Concurrent Library activity prevented a safe commit. Preview again." });
      if (failure?.statusCode === 403 || failure?.statusCode === 409) return reply.code(failure.statusCode).send({ ok: false, code: failure.code, error: failure.message });
      throw error;
    }
  });

  // G26 Batch C: bounded subtree-wide strengthening, separately reviewed from
  // flat Library governance. This does not authorize hold lifting or deletion.
  async function inspectHierarchyGovernanceRequest(actorId: string, command: ReturnType<typeof libraryHierarchyGovernanceSchema.parse>, tx: any) {
    return inspectLibraryHierarchyGovernance({ tx, actorId, command, itemInclude, access: libraryAccess });
  }
  function hierarchyGovernanceError(reply: FastifyReply, error: unknown) {
    const failure = error as any;
    if (["P2034", "P2028"].includes(String(failure?.code || "")))
      return reply.code(409).send({ ok: false, code: "GOVERNANCE_CONCURRENT_WRITE", error: "Concurrent Library changes require a fresh preview." });
    if (failure instanceof LibraryBulkGuardError || failure?.statusCode === 403 || failure?.statusCode === 409)
      return reply.code(failure.status || failure.statusCode).send({ ok: false, code: failure.code, error: failure.message });
    throw error;
  }
  app.post("/api/library/bulk/governance/hierarchy/preview", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const caller = await requireLibraryTool(request, reply, "edit");
    if (!caller) return;
    if (!caller.decorated?.isAdmin) return reply.code(403).send({ ok: false, code: "LIBRARY_GOVERNANCE_ADMIN", error: "Administrator authority required." });
    const command = libraryHierarchyGovernanceSchema.parse(request.body || {});
    try {
      return await prisma.$transaction((tx: any) => inspectHierarchyGovernanceRequest(caller.user.id, command, tx),
        { isolationLevel: "RepeatableRead", timeout: 30_000 });
    } catch (error) { return hierarchyGovernanceError(reply, error); }
  });
  app.post("/api/library/bulk/governance/hierarchy/apply", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const caller = await requireLibraryTool(request, reply, "edit");
    if (!caller) return;
    if (!caller.decorated?.isAdmin) return reply.code(403).send({ ok: false, code: "LIBRARY_GOVERNANCE_ADMIN", error: "Administrator authority required." });
    const command = libraryHierarchyGovernanceSchema.parse(request.body || {});
    if (!command.digest) return reply.code(400).send({ ok: false, code: "GOVERNANCE_PREVIEW_REQUIRED", error: "Review a current subtree impact first." });
    if (!command.reason || command.reason.length < 12) return reply.code(400).send({ ok: false, code: "GOVERNANCE_REASON_REQUIRED", error: "Provide an audit reason of at least 12 characters." });
    try {
      const result = await prisma.$transaction(async (tx: any) => {
        const preview = await inspectHierarchyGovernanceRequest(caller.user.id, command, tx);
        if (preview.digest !== command.digest)
          throw createHttpError("GOVERNANCE_PREVIEW_STALE", "Folder contents, permissions, or reference evidence changed. Preview again.", 409);
        if (preview.blockedCount)
          throw createHttpError("GOVERNANCE_BLOCKED", "A protected descendant needs separate review. No items were updated.", 409);
        await commitLibraryGovernanceStrengthening(tx, preview, caller.user.id);
        if (preview.changeCount) await tx.activityEvent.create({ data: {
          userId: caller.user.id, type: "library.hierarchy.governance", entityType: "library", entityId: null,
          title: "Library hierarchy retention strengthened",
          message: `${preview.changeCount} Library items protected in ${preview.rootCount} folder hierarchies`,
          metadata: JSON.stringify({ rootIds: command.roots.map((root) => root.id),
            changedItemIds: preview.items.filter((item) => item.outcome === "change").map((item) => item.id),
            action: command.action, newRetentionUntil: preview.retentionUntil,
            selectionDigest: preview.digest, knownReferences: preview.references, reason: command.reason }),
        } });
        return { ok: true, scope: "hierarchy", rootCount: preview.rootCount,
          selectedCount: preview.selectedCount, changedCount: preview.changeCount,
          unchangedCount: preview.unchangedCount, action: command.action };
      }, { isolationLevel: "Serializable", timeout: 60_000 });
      if (result.changedCount) clearLibraryContextCache();
      return result;
    } catch (error) { return hierarchyGovernanceError(reply, error); }
  });

  app.post("/api/library/bulk/preview", async (request, reply) => {
    const body = libraryBulkSchema.parse(request.body || {});
    const prepared = await prepareLibraryBulk(request, reply, body);
    if (!prepared) return;
    const renames = body.action === "rename" ? await prepareBulkRenames(reply, body, prepared.items) : null;
    if (body.action === "rename" && !renames) return;
    return {
      ok: true,
      ...(renames ? { renames, changedCount: renames.filter((entry) => entry.from !== entry.to).length } : {}),
      selectedCount: body.ids.length,
      descendantCount: prepared.descendantCount,
      totalAffectedByLocation: body.ids.length + prepared.descendantCount,
      action: body.action,
      // This is an informational snapshot. The mutation re-evaluates access, revisions and scope.
      requiresRevalidation: true,
    };
  });

  app.post("/api/library/bulk", async (request, reply) => {
    const body = libraryBulkSchema.parse(request.body || {});
    const prepared = await prepareLibraryBulk(request, reply, body);
    if (!prepared) return;
    const { context, items } = prepared;
    if (["archive", "trash", "restore"].includes(body.action) && items.some((item: any) => item.type === "folder"))
      return reply.code(409).send({ ok: false, code: "LIBRARY_HIERARCHY_LIFECYCLE_REQUIRED",
        error: "Folder archive, trash and restore require the durable hierarchy lifecycle preview and job." });
    const renames = body.action === "rename" ? await prepareBulkRenames(reply, body, items) : null;
    if (body.action === "rename" && !renames) return;
    // Only apply the exact names that were previewed and confirmed by the user.
    if (renames && (!body.confirmedTitles || renames.some((entry) => body.confirmedTitles?.[entry.id] !== entry.to)))
      return reply.code(409).send({ ok: false, code: "LIBRARY_BULK_RENAME_PREVIEW_STALE", error: "The rename preview no longer matches. Preview the changes again." });
    const renameById = new Map((renames || []).map((entry) => [entry.id, entry]));
    class BulkRevisionConflict extends Error {}
    class BulkRenameCollision extends Error {}
    try {
      await prisma.$transaction(async (tx: any) => {
        // Preview validation cannot authorize a later tree mutation: another
        // user may have added protected children, revoked access, moved the
        // destination or locked a nested item between preview and commit.
        if (["move", "archive", "trash", "restore"].includes(body.action)) {
          const checked = await revalidateLibraryBulkTreeWrite({
            tx, actorId: context.user.id, ids: body.ids, expectedRevisions: body.expectedRevisions,
            action: body.action as "move" | "archive" | "trash" | "restore",
            parentId: body.parentId, itemInclude, access: libraryAccess,
            isManagedFolder: isManagedLibraryFolder,
          });
          if (["archive", "trash", "restore"].includes(body.action) && checked.selected.some((item: any) => item.type === "folder"))
            throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_LIFECYCLE_REQUIRED", "Use the durable hierarchy lifecycle workflow for folders.");
          if (["archive", "trash", "restore", "move"].includes(body.action)) {
            const activeMark = await tx.libraryHierarchyLifecycleEntry.findFirst({ where: {
              itemId: { in: body.ids }, restoredAt: null,
            }, select: { itemId: true } });
            if (activeMark) throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_OPERATION_ACTIVE", "Restore the originating hierarchy before changing a marked item.");
          }
        }
        if (renames) {
          // Recheck sibling names INSIDE the Serializable write transaction.
          // A preview query outside the transaction is not a collision guard.
          const parentIds = [...new Set(renames.map((entry) => entry.parentId))];
          const currentSiblings = await tx.libraryItem.findMany({
            where: { OR: parentIds.map((parentId) => ({ parentId })), status: { not: "trashed" } },
            select: { id: true, parentId: true, title: true }, take: 10001,
          });
          if (currentSiblings.length > 10000) throw new BulkRenameCollision();
          const selectedIds = new Set(body.ids);
          const occupied = new Set(currentSiblings.filter((entry: any) => !selectedIds.has(entry.id))
            .map((entry: any) => `${entry.parentId ?? "ROOT"}\0${entry.title.toLocaleLowerCase("en-US")}`));
          if (renames.some((entry) => occupied.has(`${entry.parentId ?? "ROOT"}\0${entry.to.toLocaleLowerCase("en-US")}`)))
            throw new BulkRenameCollision();
        }
        for (const item of items) {
          const data: any = {};
          if (body.action === "rename") data.title = renameById.get(item.id)!.to;
          if (body.action === "move") data.parentId = body.parentId || null;
          if (body.action === "archive") data.status = "archived";
          if (body.action === "trash") { data.status = "trashed"; data.lifecycleState = "trashed"; data.deletedAt = new Date(); data.deletedById = context.user.id; }
          if (body.action === "restore") { data.status = "active"; data.lifecycleState = "active"; data.deletedAt = null; data.deletedById = null; }
          if (body.action === "status") {
            data.status = body.status!;
            data.approvedAt = body.status === "approved" ? (item.approvedAt || new Date()) : null;
          }
          if (body.action === "pin") data.pinned = body.pinned ?? true;
          if (body.action === "tag" || body.action === "untag") data.tags = JSON.stringify(applyLibraryBulkTagChange(parseJsonArray(item.tags), String(body.tag || ""), body.action));
          data.lastEditorId = context.user.id;
          data.revision = { increment: 1 };
          const updated = await tx.libraryItem.updateMany({ where: { id: item.id, revision: body.expectedRevisions[item.id] }, data });
          if (updated.count !== 1) throw new BulkRevisionConflict();
        }
        // The same commit that changes a hierarchy records who changed it and
        // which IDs were requested. An activity failure rolls back the writes.
        if (["move", "archive", "trash", "restore"].includes(body.action)) {
          await tx.activityEvent.create({ data: {
            userId: context.user.id, type: "library.bulk.hierarchy.commit",
            entityType: "library", entityId: null,
            title: "Library hierarchy bulk operation",
            message: `${body.action}: ${body.ids.length} selected roots`,
            metadata: JSON.stringify({ action: body.action, libraryItemIds: body.ids, destinationId: body.action === "move" ? body.parentId || null : undefined }),
          } });
        }
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error instanceof LibraryBulkGuardError) return reply.code(error.status).send({ ok: false, code: error.code, error: error.message });
      if (error instanceof BulkRenameCollision) return reply.code(409).send({ ok: false, code: "LIBRARY_BULK_RENAME_COLLISION", error: "A name conflict appeared while renaming. Refresh and preview again." });
      if (error instanceof BulkRevisionConflict || (error as any)?.code === "P2034") return reply.code(409).send({ ok: false, code: "LIBRARY_BULK_REVISION_CONFLICT", error: "A Library item changed during this operation. No selected items were updated. Refresh and retry." });
      throw error;
    }
    // The hierarchy mutation has committed. Physical relocation must not hold
    // the request open or be confused with a DB rollback. The durable system
    // job retries safe, collision-free repairs after process interruption.
    clearLibraryContextCache();
    if (body.action === "move") {
      const repair = await scheduleCommittedLibraryStorageRepair(jobQueue, context.user.id, "bulk-move");
      return reply.code(202).send({ ok: true, ...repair, updated: body.ids.length,
        code: repair.reconciliationQueued ? "LIBRARY_BULK_MOVE_RECONCILIATION_QUEUED" : "LIBRARY_BULK_MOVE_RECONCILE_REQUIRED" });
    }
    if (!["move", "archive", "trash", "restore"].includes(body.action)) {
      await logActivity({ userId: context.user.id, type: "updated", entityType: "library", entityId: null, title: "Library bulk action", message: `${body.action}: ${body.ids.length} item(s)`, metadata: { action: body.action, count: body.ids.length, libraryItemIds: body.ids } });
    }
    return { ok: true, updated: body.ids.length };
  });

  app.delete("/api/library/:itemId", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) throw new Error("Login required.");
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const body = z.object({ expectedRevision: z.number().int().positive().optional() }).parse(request.body || {});
    const accessible = await findAccessibleItem(request, reply, params.itemId, "contribute");
    if (!accessible) return;
    if (await rejectMountedWriteWhenLocked(reply, accessible.item.id)) return;
    if (isManagedLibraryFolder(accessible.item)) return rejectManagedFolderChange(reply);
    if (body.expectedRevision !== undefined && body.expectedRevision !== accessible.item.revision) {
      return reply.code(409).send({ ok: false, code: "revision_conflict", error: "The Library item changed on the server.", current: serializeLibraryItem(accessible.item, true) });
    }
    if (accessible.item.type === "folder") return reply.code(409).send({ ok: false, code: "LIBRARY_HIERARCHY_LIFECYCLE_REQUIRED",
      error: "Move folder trees to Trash through the durable hierarchy lifecycle workflow." });
    const hierarchyRecord = await prisma.libraryHierarchyLifecycleEntry.findFirst({ where: { itemId: params.itemId, restoredAt: null }, select: { jobId: true } });
    if (hierarchyRecord) return reply.code(409).send({ ok: false, code: "LIBRARY_HIERARCHY_OPERATION_ACTIVE",
      error: "Restore the originating hierarchy before changing this item's lifecycle." });
    let item: any;
    try {
      item = await prisma.$transaction(async (tx: any) => {
        const current = await tx.libraryItem.findUnique({ where: { id: params.itemId }, include: itemInclude });
        if (!current || current.revision !== accessible.item.revision) throw new LibraryBulkGuardError("REVISION_CONFLICT", "The Library item changed on the server.");
        if (current.type === "folder" || current.deletedAt || current.status === "trashed" ||
          ["trashed", "destroyed"].includes(String(current.lifecycleState))) throw new LibraryBulkGuardError("LIBRARY_LIFECYCLE_CONFLICT", "Use the canonical lifecycle workflow.");
        const retention = await resolveLibraryEffectiveRetention(tx, current);
        if (isLibraryRetentionActive(retention)) throw new LibraryBulkGuardError("LIBRARY_INHERITED_RETENTION_ACTIVE", "A Library hold or inherited retention deadline prevents Trash.", 403);
        const [attachments, locks, children, mark] = await Promise.all([
          tx.personnelRecordAttachment.findFirst({ where: { libraryItemId: current.id }, select: { libraryItemId: true } }),
          tx.libraryAssetLock.findMany({ where: { itemId: current.id } }),
          tx.libraryItem.findFirst({ where: { parentId: current.id }, select: { id: true } }),
          tx.libraryHierarchyLifecycleEntry.findFirst({ where: { itemId: current.id, restoredAt: null }, select: { jobId: true } }),
        ]);
        if (attachments || children || mark || locks.some((lock: any) => libraryLockIsActive(lock))) throw new LibraryBulkGuardError("LIBRARY_TRASH_PROTECTED", "Active references, locks or hierarchy state prevent Trash.", 403);
        const archived = await tx.libraryItem.updateMany({ where: { id: params.itemId, revision: current.revision },
          data: { status: "trashed", lifecycleState: "trashed", deletedAt: new Date(), deletedById: user.id, lastEditorId: user.id, revision: { increment: 1 } } });
        if (archived.count !== 1) throw new LibraryBulkGuardError("REVISION_CONFLICT", "The item changed during Trash.");
        return tx.libraryItem.findUniqueOrThrow({ where: { id: params.itemId }, include: itemInclude });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error instanceof LibraryBulkGuardError) return reply.code(error.status).send({ ok: false, code: error.code, error: error.message });
      if ((error as any)?.code === "P2034") return reply.code(409).send({ ok: false, code: "REVISION_CONFLICT", error: "Concurrent Trash conflict. Refresh and retry." });
      throw error;
    }
    await logActivity({ userId: user.id, projectId: item.projectId, type: "archived", entityType: "library", entityId: item.id, title: "Library item moved to Trash", message: item.title });
    clearLibraryContextCache();
    return serializeLibraryItem(item, true);
  });

  function itemWriteSchema(partial = false) {
    const schema = z.object({
      parentId: z.string().optional().nullable(),
      projectId: z.string().optional().nullable(),
      ownerId: z.string().optional().nullable(),
      reviewerId: z.string().optional().nullable(),
      title: z.string().min(1).max(240),
      body: z.string().max(200_000).optional().nullable(),
      type: z.string().max(50).optional().default("link"),
      status: lifecycleStatusSchema.optional().default("active"),
      priority: z.string().max(30).optional().default("medium"),
      tags: z.array(z.string().max(80)).max(80).optional().default([]),
      externalUrl: z.string().max(4000).optional().nullable(),
      pinned: z.boolean().optional().default(false),
      versionLabel: z.string().max(80).optional().nullable(),
      reviewDueAt: z.string().optional().nullable(),
      approvedAt: z.string().optional().nullable(),
      visibility: z.string().max(40).optional().default("internal"),
      classification: libraryClassificationSchema.optional().default("internal"),
      lifecycleState: libraryLifecycleSchema.optional().default("active"),
      retentionPolicyKey: z.string().max(120).optional().nullable(),
      retentionUntil: z.string().optional().nullable(),
      legalHold: z.boolean().optional().default(false),
      lifecycleNotes: z.string().max(20_000).optional().nullable(),
      changelogNote: z.string().max(2000).optional().nullable(),
      metadata: metadataSchema,
      source: z.string().max(50).optional(),
      originKind: z.string().max(80).optional(),
      originRef: z.string().max(500).optional().nullable(),
      generatedForUserId: z.string().optional().nullable(),
      generatedByKind: z.string().max(80).optional().nullable(),
      generatedById: z.string().max(240).optional().nullable()
    });
    return partial ? schema.partial() : schema;
  }
}

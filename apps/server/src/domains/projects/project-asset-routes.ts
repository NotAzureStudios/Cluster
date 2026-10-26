import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { buildCursorPage, cursorWhere, decodeCursor } from "../../core/cursor-pagination.js";
import { managedProjectStorageKey } from "../../core/storage/storage-runtime.js";
import type { ServerRouteRegistrationDeps } from "../../app/server-composition-types.js";
import { acquireTransactionAdvisoryLock } from "../../core/postgres-advisory-lock.js";

const ASSET_ROLES = ["source", "derived", "proxy", "export", "reference", "deliverable"] as const;
const ASSET_STATUSES = ["active", "review", "approved", "superseded", "archived"] as const;
const LINEAGE_RELATIONSHIPS = ["derived_from", "proxy_of", "export_of", "supersedes", "duplicate_of"] as const;
const LINEAGE_FIELDS = ["derivedFromId", "proxyOfId", "exportOfId", "supersededById"] as const;
const MAX_INTEGRITY_ROWS = 10_000;

function parseArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 40);
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 40) : [];
  } catch { return []; }
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

export function serializeProjectAsset(file: any, lockOwner?: any) {
  const { ingestSessionId: _ingestSessionId, managedBlobId: _managedBlobId, managedBlob: _managedBlob, ...safeFile } = file || {};
  const lockExpiresAt = file.lockExpiresAt ? new Date(file.lockExpiresAt) : null;
  const lockActive = Boolean(file.lockedById && lockExpiresAt && lockExpiresAt.getTime() > Date.now());
  const metadata = parseObject(file.metadata);
  const { _storage: _internalStorage, ...publicMetadata } = metadata as Record<string, unknown>;
  return {
    ...safeFile,
    sizeBytes: Number(file.sizeBytes || 0),
    tags: parseArray(file.tags),
    metadata: publicMetadata,
    versionGroupId: file.versionGroupId || file.id,
    lock: lockActive ? {
      ownerId: file.lockedById,
      ownerName: lockOwner?.displayName || lockOwner?.username || null,
      expiresAt: lockExpiresAt?.toISOString() || null,
    } : null,
  };
}

async function projectAndAccess(deps: ServerRouteRegistrationDeps, request: FastifyRequest, reply: FastifyReply, projectId: string, permission: "view" | "contribute" | "manage") {
  const project = await deps.prisma.project.findUnique({ where: { id: projectId } });
  if (!project) { reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found." }); return null; }
  if (!(await deps.authorization.requireProjectResource(request, reply, project, "library", permission))) return null;
  return project;
}

async function fileAndAccess(deps: ServerRouteRegistrationDeps, request: FastifyRequest, reply: FastifyReply, fileId: string, permission: "view" | "contribute" | "manage") {
  const file = await deps.prisma.projectFile.findUnique({ where: { id: fileId }, include: { managedBlob: true } });
  if (!file) { reply.code(404).send({ code: "PROJECT_FILE_NOT_FOUND", message: "Project asset not found." }); return null; }
  const project = await projectAndAccess(deps, request, reply, file.projectId, permission);
  if (!project) return null;
  if (!(await deps.authorization.requireTarget(request, reply, "file", file.id, project, permission))) return null;
  return { file, project };
}

function activeForeignLock(file: any, user: any) {
  if (!file.lockedById || !file.lockExpiresAt) return false;
  if (new Date(file.lockExpiresAt).getTime() <= Date.now()) return false;
  return file.lockedById !== user?.id && !user?.isAdmin;
}

async function advisoryLock(tx: any, key: string) {
  await acquireTransactionAdvisoryLock(tx, key);
}

async function validateLineageTargets(tx: any, projectId: string, fileId: string, targetIds: string[]) {
  const uniqueTargets = [...new Set(targetIds.filter(Boolean))];
  if (!uniqueTargets.length) return;
  if (uniqueTargets.includes(fileId)) throw Object.assign(new Error("An asset cannot reference itself."), { code: "ASSET_LINEAGE_INVALID", statusCode: 400 });
  const targets = await tx.projectFile.findMany({ where: { projectId, id: { in: uniqueTargets } }, select: { id: true } });
  if (targets.length !== uniqueTargets.length) throw Object.assign(new Error("Lineage targets must belong to the same project."), { code: "ASSET_LINEAGE_INVALID", statusCode: 400 });

  const seen = new Set<string>();
  const queue = [...uniqueTargets];
  let inspected = 0;
  while (queue.length) {
    const id = queue.shift()!;
    if (id === fileId) throw Object.assign(new Error("This lineage change would create a cycle."), { code: "ASSET_LINEAGE_CYCLE", statusCode: 409 });
    if (seen.has(id)) continue;
    seen.add(id);
    inspected += 1;
    if (inspected > 512) throw Object.assign(new Error("Asset lineage is too deep to update safely."), { code: "ASSET_LINEAGE_TOO_DEEP", statusCode: 409 });
    const row = await tx.projectFile.findFirst({ where: { id, projectId }, select: { derivedFromId: true, proxyOfId: true, exportOfId: true, supersededById: true } });
    if (!row) continue;
    for (const next of LINEAGE_FIELDS.map((field) => row[field]).filter(Boolean)) if (!seen.has(String(next))) queue.push(String(next));
  }
}

async function syncLineageRelationships(db: any, file: any, actorId?: string | null) {
  await db.projectRelationship.deleteMany({
    where: {
      projectId: file.projectId,
      relationship: { in: [...LINEAGE_RELATIONSHIPS] },
      OR: [
        { sourceType: "file", sourceId: file.id },
        { relationship: "supersedes", targetType: "file", targetId: file.id },
      ],
    },
  });
  const candidates: Array<{ id?: string | null; relationship: typeof LINEAGE_RELATIONSHIPS[number] }> = [
    { id: file.derivedFromId, relationship: "derived_from" },
    { id: file.proxyOfId, relationship: "proxy_of" },
    { id: file.exportOfId, relationship: "export_of" },
    { id: file.duplicateOfId, relationship: "duplicate_of" },
  ];
  for (const item of candidates) {
    if (!item.id || item.id === file.id) continue;
    await db.projectRelationship.create({
      data: { projectId: file.projectId, sourceType: "file", sourceId: file.id, targetType: "file", targetId: item.id, relationship: item.relationship, description: `Project asset ${item.relationship.replace(/_/g, " ")}.`, createdById: actorId || null },
    });
  }
  if (file.supersededById && file.supersededById !== file.id) {
    await db.projectRelationship.create({
      data: { projectId: file.projectId, sourceType: "file", sourceId: file.supersededById, targetType: "file", targetId: file.id, relationship: "supersedes", description: "Newer project asset supersedes this asset.", createdById: actorId || null },
    });
  }
}



async function sha256StoredObject(storage: any, locator: any) {
  const hash = createHash("sha256");
  const stream = await storage.openRead(locator);
  for await (const chunk of stream as any) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

// A provider outage, access denial, S3 404, or an invalid locator does not
// prove that managed bytes were deleted. Only local ENOENT is affirmative
// absence evidence; remote providers need an independently verified protocol.
function isConfirmedLocalMissing(error: unknown, locator: { provider?: string } | null) {
  return locator?.provider === "local" && (error as { code?: string })?.code === "ENOENT";
}

async function scanAssetIntegrity(deps: ServerRouteRegistrationDeps, request: FastifyRequest, project: any) {
  const projectId = project.id;
  const records = await deps.prisma.projectFile.findMany({
    where: { projectId },
    select: { id: true, title: true, fileName: true, originalName: true, metadata: true, sizeBytes: true, archived: true, lockedById: true, lockExpiresAt: true, derivedFromId: true, proxyOfId: true, exportOfId: true, supersededById: true, managedBlob: { select: { storageProvider: true, storageTier: true, storageKey: true } } },
    orderBy: { updatedAt: "desc" },
    take: MAX_INTEGRITY_ROWS + 1,
  });
  const truncated = records.length > MAX_INTEGRITY_ROWS;
  const scannedRecords = truncated ? records.slice(0, MAX_INTEGRITY_ROWS) : records;
  const files = await deps.authorization.filterTargetsForRequest(request, scannedRecords, "file", project, "manage");
  // Hidden records still count as known storage/lineage occupants so a restricted
  // file cannot be exposed indirectly as an "orphan" or "dangling" object.
  const knownIds = new Set(scannedRecords.map((file: any) => file.id));
  const referencedIds = new Set(files.flatMap((file: any) => LINEAGE_FIELDS.map((field) => file[field]).filter(Boolean)).map(String));
  const danglingIds = truncated ? [] : [...referencedIds].filter((id) => !knownIds.has(id));
  const checks = await mapConcurrent(files, 20, async (file: any) => {
    const locator = deps.projectFileStorageLocator(file);
    if (!locator) return { kind: "unavailable" as const, file };
    try {
      const info = await deps.storageRuntime.stat(locator);
      const expected = Number(file.sizeBytes || 0);
      return expected === info.size ? null : { kind: "size" as const, file, actualBytes: info.size, expectedBytes: expected };
    } catch (error) {
      if (isConfirmedLocalMissing(error, locator)) return { kind: "missing" as const, file };
      return { kind: "unavailable" as const, file };
    }
  });
  const missing = checks.filter((item): item is Extract<NonNullable<typeof checks[number]>, { kind: "missing" }> => item?.kind === "missing").map(({ file }) => ({ id: file.id, title: file.title, originalName: file.originalName }));
  const unavailable = checks.filter((item): item is Extract<NonNullable<typeof checks[number]>, { kind: "unavailable" }> => item?.kind === "unavailable").map(({ file }) => ({ id: file.id, title: file.title }));
  const sizeMismatch = checks.filter((item): item is Extract<NonNullable<typeof checks[number]>, { kind: "size" }> => item?.kind === "size").map(({ file, expectedBytes, actualBytes }) => ({ id: file.id, title: file.title, expectedBytes, actualBytes }));
  let orphanNames: string[] = [];
  let inventoryFailed = false;
  if (!truncated) {
    const dbKeys = new Set(scannedRecords.map((file: any) => deps.projectFileStorageLocator(file)?.key).filter(Boolean).map(String));
    const prefix = deps.storageRuntime.place(
      { purpose: "source", activeProject: true },
      managedProjectStorageKey(project.workspaceId, projectId, "assets"),
    );
    try {
      const storedKeys = await deps.storageRuntime.list(prefix);
      orphanNames = storedKeys.filter((key: string) => !dbKeys.has(key));
    } catch { inventoryFailed = true; }
  }
  const complete = !truncated && !inventoryFailed && unavailable.length === 0;
  const now = Date.now();
  const staleLocks = files.filter((file: any) => file.lockedById && file.lockExpiresAt && new Date(file.lockExpiresAt).getTime() <= now).map((file: any) => file.id);
  const activeBytes = files.filter((file: any) => !file.archived).reduce((sum: number, file: any) => sum + Number(file.sizeBytes || 0), 0);
  const archivedBytes = files.filter((file: any) => file.archived).reduce((sum: number, file: any) => sum + Number(file.sizeBytes || 0), 0);
  return {
    ok: complete && missing.length === 0 && sizeMismatch.length === 0 && danglingIds.length === 0, complete, inventoryFailed, unavailable, checkedAt: new Date().toISOString(), scanned: files.length, truncated, activeBytes, archivedBytes,
    missing, sizeMismatch, danglingLineageIds: danglingIds.slice(0, 200), staleLockIds: staleLocks.slice(0, 500),
    orphanCount: orphanNames.length, orphanSamples: orphanNames.slice(0, 20).map((name) => name.replace(/^[0-9a-f-]{20,}-/i, "")), orphanScanSkipped: truncated || inventoryFailed,
  };
}

export function registerProjectAssetRoutes(deps: ServerRouteRegistrationDeps) {
  const { app, prisma, getCurrentUser, logActivity } = deps;

  app.get("/api/projects/:projectId/assets", async (request: FastifyRequest, reply: FastifyReply) => {
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const query = z.object({
      q: z.string().trim().max(160).optional(),
      collection: z.string().trim().max(80).optional(),
      role: z.enum(ASSET_ROLES).optional(),
      status: z.enum(ASSET_STATUSES).optional(),
      duplicatesOnly: z.preprocess((value) => value === true || value === "true" || value === "1", z.boolean()).optional().default(false),
      includeArchived: z.preprocess((value) => value === true || value === "true" || value === "1", z.boolean()).optional().default(false),
      limit: z.coerce.number().int().min(20).max(250).optional().default(100),
      cursor: z.string().max(500).optional(),
    }).parse(request.query || {});
    const project = await projectAndAccess(deps, request, reply, params.projectId, "view");
    if (!project) return;
    const q = query.q?.toLowerCase() || "";
    const cursor = decodeCursor(query.cursor);
    const baseWhere = {
      projectId: params.projectId, ...(query.includeArchived ? {} : { archived: false }), ...(query.collection ? { category: query.collection } : {}), ...(query.role ? { assetRole: query.role } : {}), ...(query.status ? { status: query.status } : {}), ...(query.duplicatesOnly ? { duplicateOfId: { not: null } } : {}),
      ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }, { originalName: { contains: q, mode: "insensitive" } }, { category: { contains: q, mode: "insensitive" } }, { assetRole: { contains: q, mode: "insensitive" } }, { status: { contains: q, mode: "insensitive" } }, { tags: { contains: q, mode: "insensitive" } }] } : {}),
    } as any;
    const visibleRows: any[] = [];
    const batchLimit = Math.min(750, Math.max(100, query.limit * 3));
    let scanCursor = cursor;
    for (let scan = 0; scan < 100 && visibleRows.length <= query.limit; scan += 1) {
      const cursorFilter = cursorWhere(scanCursor, "updatedAt", "desc");
      const where = cursorFilter ? { AND: [baseWhere, cursorFilter] } : baseWhere;
      const rows = await prisma.projectFile.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: batchLimit });
      if (!rows.length) break;
      visibleRows.push(...await deps.authorization.filterTargetsForRequest(request, rows, "file", project, "view"));
      if (rows.length < batchLimit) break;
      const last = rows.at(-1);
      scanCursor = last ? { at: new Date(last.updatedAt), id: String(last.id) } : scanCursor;
    }
    const page = buildCursorPage(visibleRows, query.limit, "updatedAt");

    // Aggregate cards must not reveal restricted assets through counts, bytes,
    // versions, locks, or collection names. Filter the compact summary rows by
    // the same file ACL used for the list itself before computing statistics.
    const summaryCandidates = await prisma.projectFile.findMany({
      where: { projectId: params.projectId },
      select: { id: true, archived: true, sizeBytes: true, duplicateOfId: true, lockedById: true, lockExpiresAt: true, category: true, versionGroupId: true },
    });
    const visibleSummary = await deps.authorization.filterTargetsForRequest(request, summaryCandidates, "file", project, "view");
    const activeSummary = visibleSummary.filter((file: any) => !file.archived);
    const now = Date.now();
    const total = activeSummary.length;
    const totalBytes = activeSummary.reduce((sum: number, file: any) => sum + Number(file.sizeBytes || 0), 0);
    const duplicateCount = activeSummary.filter((file: any) => Boolean(file.duplicateOfId)).length;
    const lockedCount = activeSummary.filter((file: any) => file.lockedById && file.lockExpiresAt && new Date(file.lockExpiresAt).getTime() > now).length;
    const archivedCount = visibleSummary.length - activeSummary.length;
    const versionCount = new Set(activeSummary.map((file: any) => String(file.versionGroupId || file.id))).size;
    const collectionCounts = new Map<string, number>();
    for (const file of activeSummary) {
      const category = String(file.category || "shared");
      collectionCounts.set(category, (collectionCounts.get(category) || 0) + 1);
    }
    const lockOwnerIds = [...new Set(page.items.map((file: any) => file.lockedById).filter(Boolean))];
    const lockOwners = lockOwnerIds.length ? await prisma.user.findMany({ where: { id: { in: lockOwnerIds } }, select: { id: true, username: true, displayName: true } }) : [];
    const ownerById = new Map(lockOwners.map((owner: any) => [owner.id, owner]));
    return {
      items: page.items.map((file: any) => serializeProjectAsset(file, ownerById.get(file.lockedById))),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      summary: {
        total,
        bytes: totalBytes,
        duplicates: duplicateCount,
        locked: lockedCount,
        versions: versionCount,
        archived: archivedCount,
      },
      collections: [...collectionCounts.entries()].sort(([left], [right]) => left.localeCompare(right)).slice(0, 200).map(([category, count]) => ({ id: category, label: category.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()), count })),
    };
  });

  app.get("/api/project-files/:fileId", async (request: FastifyRequest, reply: FastifyReply) => {
    const params = z.object({ fileId: z.string().min(1) }).parse(request.params);
    const resolved = await fileAndAccess(deps, request, reply, params.fileId, "view");
    if (!resolved) return;
    const owner = resolved.file.lockedById ? await prisma.user.findUnique({ where: { id: resolved.file.lockedById }, select: { id: true, username: true, displayName: true } }) : null;
    return serializeProjectAsset(resolved.file, owner);
  });

  app.patch("/api/project-files/:fileId", async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Authentication required." });
    const params = z.object({ fileId: z.string().min(1) }).parse(request.params);
    const resolved = await fileAndAccess(deps, request, reply, params.fileId, "contribute");
    if (!resolved) return;
    const body = z.object({
      title: z.string().trim().min(1).max(240).optional(),
      description: z.string().trim().max(4000).nullable().optional(),
      category: z.string().trim().min(1).max(80).optional(),
      assetRole: z.enum(ASSET_ROLES).optional(),
      status: z.enum(ASSET_STATUSES).optional(),
      tags: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
      metadata: z.record(z.unknown()).optional(),
      versionLabel: z.string().trim().max(80).nullable().optional(),
      derivedFromId: z.string().nullable().optional(),
      proxyOfId: z.string().nullable().optional(),
      exportOfId: z.string().nullable().optional(),
      supersededById: z.string().nullable().optional(),
      archived: z.boolean().optional(),
      expectedRevision: z.number().int().positive(),
    }).parse(request.body || {});
    try {
      const updated = await prisma.$transaction(async (tx: any) => {
        await advisoryLock(tx, `cluster-asset-lineage:${resolved.file.projectId}`);
        const current = await tx.projectFile.findUnique({ where: { id: resolved.file.id } });
        if (!current) throw Object.assign(new Error("Project asset not found."), { code: "PROJECT_FILE_NOT_FOUND", statusCode: 404 });
        if (current.revision !== body.expectedRevision) throw Object.assign(new Error("This asset changed since you opened it."), { code: "REVISION_CONFLICT", statusCode: 409, currentRevision: current.revision });
        if (activeForeignLock(current, user)) throw Object.assign(new Error("This asset is locked by another user."), { code: "ASSET_LOCKED", statusCode: 423 });
        const targetIds = [body.derivedFromId, body.proxyOfId, body.exportOfId, body.supersededById].filter((value): value is string => Boolean(value));
        await validateLineageTargets(tx, current.projectId, current.id, targetIds);
        const data: Record<string, unknown> = { revision: { increment: 1 } };
        for (const key of ["title", "description", "category", "assetRole", "status", "versionLabel", "derivedFromId", "proxyOfId", "exportOfId", "supersededById", "archived"] as const) if (body[key] !== undefined) data[key] = body[key];
        if (body.tags !== undefined) data.tags = JSON.stringify([...new Set(body.tags.map((item) => item.trim()).filter(Boolean))]);
        if (body.metadata !== undefined) data.metadata = JSON.stringify(body.metadata || {});
        if (body.archived === true) data.status = "archived";
        if (body.archived === false && current.status === "archived" && body.status === undefined) data.status = "active";
        const lockWhere = user.isAdmin ? {} : { OR: [{ lockedById: null }, { lockedById: user.id }, { lockExpiresAt: { lte: new Date() } }] };
        const changed = await tx.projectFile.updateMany({ where: { id: current.id, revision: body.expectedRevision, ...lockWhere }, data });
        if (!changed.count) throw Object.assign(new Error("This asset changed or was locked before the update could be committed."), { code: "REVISION_CONFLICT", statusCode: 409 });
        const next = await tx.projectFile.findUniqueOrThrow({ where: { id: current.id } });
        await syncLineageRelationships(tx, next, user.id);
        return next;
      });
      await logActivity({ userId: user.id, projectId: updated.projectId, type: "updated", entityType: "file", entityId: updated.id, title: body.archived ? "Asset archived" : "Asset metadata updated", message: updated.title, metadata: { assetRole: updated.assetRole, category: updated.category, versionGroupId: updated.versionGroupId || updated.id } });
      return serializeProjectAsset(updated, user.id === updated.lockedById ? user : null);
    } catch (error: any) {
      if (error?.statusCode) return reply.code(error.statusCode).send({ code: error.code || "ASSET_UPDATE_FAILED", message: error.message, currentRevision: error.currentRevision });
      throw error;
    }
  });

  app.post("/api/project-files/:fileId/lock", async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Authentication required." });
    const params = z.object({ fileId: z.string().min(1) }).parse(request.params);
    const body = z.object({ action: z.enum(["acquire", "release", "refresh"]), ttlMinutes: z.number().int().min(5).max(120).optional().default(30), force: z.boolean().optional().default(false) }).parse(request.body || {});
    const resolved = await fileAndAccess(deps, request, reply, params.fileId, "contribute");
    if (!resolved) return;
    const release = body.action === "release";
    const now = new Date();
    const canForce = Boolean(body.force && user.isAdmin);
    const where = canForce
      ? { id: resolved.file.id }
      : release || body.action === "refresh"
        ? { id: resolved.file.id, lockedById: user.id }
        : { id: resolved.file.id, OR: [{ lockedById: null }, { lockedById: user.id }, { lockExpiresAt: { lte: now } }] };
    const changed = await prisma.projectFile.updateMany({
      where,
      data: release
        ? { lockedById: null, lockExpiresAt: null, revision: { increment: 1 } }
        : { lockedById: user.id, lockExpiresAt: new Date(Date.now() + body.ttlMinutes * 60_000), revision: { increment: 1 } },
    });
    if (!changed.count) {
      const current = await prisma.projectFile.findUnique({ where: { id: resolved.file.id }, select: { lockedById: true, lockExpiresAt: true } });
      return reply.code(423).send({ code: "ASSET_LOCKED", message: release || body.action === "refresh" ? "Only the lock owner or an administrator can change this lock." : "This asset is already locked by another user.", lockedById: current?.lockedById || null, lockExpiresAt: current?.lockExpiresAt || null });
    }
    const updated = await prisma.projectFile.findUniqueOrThrow({ where: { id: resolved.file.id } });
    await logActivity({ userId: user.id, projectId: updated.projectId, type: "updated", entityType: "file", entityId: updated.id, title: release ? "Asset unlocked" : "Asset locked", message: updated.title, metadata: { lockAction: body.action, expiresAt: updated.lockExpiresAt?.toISOString?.() || null } });
    return serializeProjectAsset(updated, release ? null : user);
  });

  app.get("/api/project-files/:fileId/lineage", async (request: FastifyRequest, reply: FastifyReply) => {
    const params = z.object({ fileId: z.string().min(1) }).parse(request.params);
    const resolved = await fileAndAccess(deps, request, reply, params.fileId, "view");
    if (!resolved) return;
    const groupId = resolved.file.versionGroupId || resolved.file.id;
    const [versions, relationships] = await Promise.all([
      prisma.projectFile.findMany({ where: { projectId: resolved.file.projectId, OR: [{ id: groupId }, { versionGroupId: groupId }] }, orderBy: [{ versionNumber: "asc" }, { createdAt: "asc" }], take: 250 }),
      prisma.projectRelationship.findMany({ where: { projectId: resolved.file.projectId, OR: [{ sourceType: "file", sourceId: resolved.file.id }, { targetType: "file", targetId: resolved.file.id }], relationship: { in: [...LINEAGE_RELATIONSHIPS] } }, orderBy: { createdAt: "asc" }, take: 300 }),
    ]);
    const relatedIds = [...new Set(relationships.flatMap((row: any) => [row.sourceType === "file" ? row.sourceId : null, row.targetType === "file" ? row.targetId : null]).filter((id: any) => id && id !== resolved.file.id))];
    const related = relatedIds.length ? await prisma.projectFile.findMany({ where: { projectId: resolved.file.projectId, id: { in: relatedIds } }, take: 300 }) : [];
    const [visibleVersions, visibleRelated] = await Promise.all([
      deps.authorization.filterTargetsForRequest(request, versions, "file", resolved.project, "view"),
      deps.authorization.filterTargetsForRequest(request, related, "file", resolved.project, "view"),
    ]);
    const visibleIds = new Set([resolved.file.id, ...visibleVersions.map((file: any) => file.id), ...visibleRelated.map((file: any) => file.id)]);
    return {
      asset: serializeProjectAsset(resolved.file),
      versions: visibleVersions.map((file: any) => serializeProjectAsset(file)),
      relationships: relationships.filter((row: any) => (!row.sourceId || visibleIds.has(row.sourceId)) && (!row.targetId || visibleIds.has(row.targetId))),
      related: visibleRelated.map((file: any) => serializeProjectAsset(file)),
    };
  });

  app.post("/api/project-files/:fileId/verify", async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Authentication required." });
    const params = z.object({ fileId: z.string().min(1) }).parse(request.params);
    const body = z.object({ repairMissingChecksum: z.boolean().optional().default(false), expectedRevision: z.number().int().positive().optional() }).parse(request.body || {});
    const resolved = await fileAndAccess(deps, request, reply, params.fileId, body.repairMissingChecksum ? "manage" : "view");
    if (!resolved) return;
    const locator = deps.projectFileStorageLocator(resolved.file);
    if (!locator) return reply.code(503).send({ code: "ASSET_VERIFICATION_UNAVAILABLE", message: "The asset storage location cannot be verified." });
    let info: Awaited<ReturnType<typeof deps.storageRuntime.stat>>;
    let actualChecksum: string;
    try {
      info = await deps.storageRuntime.stat(locator);
      actualChecksum = await sha256StoredObject(deps.storageRuntime, locator);
    } catch (error) {
      if (!isConfirmedLocalMissing(error, locator)) {
        return reply.code(503).send({ code: "ASSET_VERIFICATION_UNAVAILABLE", message: "Storage could not be verified. The file has not been confirmed missing." });
      }
      return { ok: false, exists: false, sizeMatches: false, checksumMatches: false, expectedBytes: Number(resolved.file.sizeBytes || 0), actualBytes: null, checksumSha256: null, repaired: false };
    }
    const sizeMatches = info.size === Number(resolved.file.sizeBytes || 0);
    const checksumMatches = !resolved.file.checksumSha256 || actualChecksum === resolved.file.checksumSha256;
    let repaired = false;
    if (body.repairMissingChecksum && !resolved.file.checksumSha256) {
      if (!body.expectedRevision) return reply.code(400).send({ code: "EXPECTED_REVISION_REQUIRED", message: "Expected revision is required to repair asset metadata." });
      const changed = await prisma.projectFile.updateMany({ where: { id: resolved.file.id, revision: body.expectedRevision, checksumSha256: null }, data: { checksumSha256: actualChecksum, sizeBytes: BigInt(info.size), revision: { increment: 1 } } });
      if (!changed.count) return reply.code(409).send({ code: "REVISION_CONFLICT", message: "This asset changed before integrity metadata could be repaired." });
      repaired = true;
      // A successful metadata commit must not be reported as a failed repair
      // solely because the downstream Activity projection is unavailable.
      try {
        await logActivity({ userId: user.id, projectId: resolved.file.projectId, type: "updated", entityType: "file", entityId: resolved.file.id, title: "Asset integrity metadata repaired", message: resolved.file.title });
      } catch {
        request.log?.warn?.("Asset integrity metadata committed but Activity projection could not be recorded.");
      }
    }
    return { ok: sizeMatches && checksumMatches, exists: true, sizeMatches, checksumMatches, expectedBytes: Number(resolved.file.sizeBytes || 0), actualBytes: info.size, checksumSha256: actualChecksum, repaired };
  });

  app.get("/api/projects/:projectId/assets/integrity", async (request: FastifyRequest, reply: FastifyReply) => {
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const project = await projectAndAccess(deps, request, reply, params.projectId, "manage");
    if (!project) return;
    return scanAssetIntegrity(deps, request, project);
  });

  app.post("/api/projects/:projectId/assets/integrity/repair", async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Authentication required." });
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const body = z.object({ action: z.enum(["release-stale-locks", "archive-missing-records"]) }).parse(request.body || {});
    const project = await projectAndAccess(deps, request, reply, params.projectId, "manage");
    if (!project) return;
    const scan = await scanAssetIntegrity(deps, request, project);
    if (!scan.complete) return reply.code(409).send({ code: "INTEGRITY_SCAN_INCOMPLETE", message: "The storage audit was incomplete. No repair can run until all storage records are verified." });
    let changed = 0;
    if (body.action === "release-stale-locks" && scan.staleLockIds.length) {
      const result = await prisma.projectFile.updateMany({ where: { projectId: params.projectId, id: { in: scan.staleLockIds }, lockExpiresAt: { lte: new Date() } }, data: { lockedById: null, lockExpiresAt: null, revision: { increment: 1 } } });
      changed = result.count;
    }
    if (body.action === "archive-missing-records" && scan.missing.length) {
      const result = await prisma.projectFile.updateMany({ where: { projectId: params.projectId, id: { in: scan.missing.map((item) => item.id) } }, data: { archived: true, status: "archived", revision: { increment: 1 } } });
      changed = result.count;
    }
    await logActivity({ userId: user.id, projectId: params.projectId, type: "updated", entityType: "project", entityId: params.projectId, title: "Asset integrity repair", message: `${body.action}: ${changed} record${changed === 1 ? "" : "s"} changed.`, metadata: { action: body.action, changed } });
    return { ok: true, action: body.action, changed, before: scan, after: await scanAssetIntegrity(deps, request, project) };
  });
}

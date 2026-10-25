import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { syncAcknowledgementSchema, syncConflictQuerySchema, syncConflictResolutionSchema, syncDeviceRegistrationSchema } from "@cluster/shared";
import { createSyncControlRepository } from "./sync-control-repository.js";
import { classifySyncConflict, createSyncControlService } from "./sync-control-service.js";
import { canonicalSyncMutationPath, computeSyncScopeDigest, containsSensitiveSyncValue, decodeSyncCursor, encodeSyncCursor, sanitizeSyncHeaders } from "../../core/sync-security.js";

const batchMutationSchema = z.object({
  id: z.string().min(1).max(160),
  idempotencyKey: z.string().min(8).max(200),
  method: z.enum(["POST", "PATCH", "PUT", "DELETE"]),
  path: z.string().min(1).max(2_000),
  headers: z.record(z.string()).optional().default({}),
  body: z.unknown().optional(),
  schemaVersion: z.coerce.number().int().min(1).max(10).optional().default(1),
  dependsOn: z.array(z.string().min(1).max(160)).max(25).optional().default([]),
  baseRevision: z.coerce.number().int().min(1).optional(),
});

const batchSchema = z.object({
  deviceId: z.string().uuid(),
  clientVersion: z.string().trim().max(40).optional(),
  mutationSchemaVersion: z.coerce.number().int().min(1).max(10).optional().default(1),
  mutations: z.array(batchMutationSchema).min(1).max(25),
});

const deltaQuerySchema = z.object({
  since: z.string().optional().default(""),
  limit: z.coerce.number().int().min(1).max(1_000).optional().default(500),
  domains: z.string().optional().default("projects,timeline,collaboration"),
  deviceId: z.string().uuid().optional(),
});

const SAFE_BATCH_PREFIXES = [
  "/api/projects/",
  "/api/boards/",
  "/api/lists/",
  "/api/cards/",
  "/api/whiteboards/",
  "/api/timeline/items",
  "/api/library/",
  "/api/calendar/events",
  "/api/me/preferences",
  "/api/client-state/",
  "/api/me/presence",
];

const STREAMS = ["project", "board", "list", "card", "whiteboard", "timeline", "tombstone"] as const;
type StreamName = (typeof STREAMS)[number];
type CursorPosition = { at: string; id: string };
type DeltaCursor = { version: 1; positions: Record<StreamName, CursorPosition> };

type InternalChange = Record<string, unknown> & {
  _stream: StreamName;
  _cursorAt: string;
  _cursorId: string;
};

type SyncInjectResponse = {
  statusCode: number;
  payload: string;
  headers: Record<string, string | string[] | undefined>;
};

const EPOCH_POSITION: CursorPosition = { at: "1970-01-01T00:00:00.000Z", id: "" };


function safeBatchPath(value: string) {
  const canonical = canonicalSyncMutationPath(value);
  if (!canonical || canonical.startsWith("/api/sync/") || canonical.startsWith("/api/auth/")) return null;
  return SAFE_BATCH_PREFIXES.some((prefix) => canonical === prefix || canonical.startsWith(prefix)) ? canonical : null;
}

function parsePayload(payload: string) {
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

function validDate(value: unknown, fallback = new Date(0)) {
  const parsed = new Date(String(value || ""));
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

function emptyCursor(date = new Date(0)): DeltaCursor {
  const at = date.toISOString();
  return {
    version: 1,
    positions: Object.fromEntries(STREAMS.map((stream) => [stream, { at, id: "" }])) as Record<StreamName, CursorPosition>,
  };
}

function normalizeCursorPayload(value: any): DeltaCursor {
  const cursor = emptyCursor();
  for (const stream of STREAMS) {
    const candidate = value?.positions?.[stream];
    const at = validDate(candidate?.at);
    cursor.positions[stream] = { at: at.toISOString(), id: String(candidate?.id || "") };
  }
  return cursor;
}

function afterPositionWhere(field: "updatedAt" | "deletedAt", position: CursorPosition, upperBound: Date) {
  const at = validDate(position.at);
  return {
    OR: [
      { [field]: { gt: at, lte: upperBound } },
      { AND: [{ [field]: at }, { id: { gt: position.id } }] },
    ],
  };
}

function positionOf(record: any, field: "updatedAt" | "deletedAt"): CursorPosition {
  return { at: validDate(record[field]).toISOString(), id: String(record.id) };
}

function advancePosition(cursor: DeltaCursor, stream: StreamName, records: any[], field: "updatedAt" | "deletedAt") {
  const last = records.at(-1);
  if (last) cursor.positions[stream] = positionOf(last, field);
}

function authorizedStreamPage<T>(records: T[], limit: number, visible: (record: T) => boolean) {
  const selected: T[] = [];
  let advanceThrough: T | null = null;
  let overflow = false;
  for (const record of records) {
    if (visible(record)) {
      if (selected.length >= limit) {
        overflow = true;
        break;
      }
      selected.push(record);
    }
    advanceThrough = record;
  }
  return { selected, advanceThrough, overflow };
}

function internalChange(stream: StreamName, record: any, field: "updatedAt" | "deletedAt", change: Record<string, unknown>): InternalChange {
  const position = positionOf(record, field);
  return { ...change, _stream: stream, _cursorAt: position.at, _cursorId: position.id };
}

function changeTime(change: InternalChange) {
  return validDate(change._cursorAt).getTime();
}

function stripInternal(change: InternalChange) {
  const { _stream, _cursorAt, _cursorId, ...publicChange } = change;
  return publicChange;
}

export type SyncRouteDependencies = {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  getWorkspaceRole: (userId: string) => Promise<string | null | undefined>;
  hasTargetAccess: (user: any, role: string | null | undefined, targetKind: string, targetId: string, project: any | null | undefined, rules: any[], minimum?: string) => boolean;
  hasProjectResourceAccess: (user: any, role: string | null | undefined, project: any, rules: any[], minimum?: string) => boolean;
  hasToolPermission: (user: any, role: string | null | undefined, tool: string, minimum?: string) => boolean;
  syncCursorSecret: string;
};

export function registerSyncRoutes({
  app,
  prisma,
  getCurrentUser,
  getWorkspaceRole,
  hasTargetAccess,
  hasProjectResourceAccess,
  hasToolPermission,
  syncCursorSecret,
}: SyncRouteDependencies) {
  const syncControl = createSyncControlService(createSyncControlRepository(prisma));

  app.post("/api/sync/devices/register", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const body = syncDeviceRegistrationSchema.parse(request.body || {});
    const device = await syncControl.registerDevice({ ...body, id: body.deviceId, userId: user.id });
    if (device.ownershipConflict) return reply.code(409).send({ ok: false, code: "SYNC_DEVICE_OWNERSHIP_CONFLICT", error: "This sync device identifier belongs to another account. Generate a new device identity." });
    return { ok: true, device, mutationSchemaVersion: syncControl.mutationSchemaVersion };
  });

  app.post("/api/sync/ack", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const body = syncAcknowledgementSchema.parse(request.body || {});
    const acknowledgement = await syncControl.acknowledge({ ...body, userId: user.id });
    if (!acknowledgement.accepted) return reply.code(404).send({ ok: false, code: "SYNC_DEVICE_NOT_FOUND", error: "Sync device is not registered for this account." });
    return { ok: true, acknowledgement };
  });

  app.get("/api/sync/status", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const query = z.object({ deviceId: z.string().uuid().optional() }).parse(request.query || {});
    return {
      ok: true,
      mutationSchemaVersion: syncControl.mutationSchemaVersion,
      tombstoneRetentionDays: 90,
      ...(await syncControl.status({ userId: user.id, deviceId: query.deviceId })),
    };
  });

  app.get("/api/sync/conflicts", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const query = syncConflictQuerySchema.parse(request.query || {});
    return syncControl.listConflicts({ ...query, userId: user.id });
  });

  app.post("/api/sync/conflicts/:conflictId/resolve", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const params = z.object({ conflictId: z.string().uuid() }).parse(request.params);
    const body = syncConflictResolutionSchema.parse(request.body || {});
    const resolved = await syncControl.resolveConflict({ id: params.conflictId, userId: user.id, action: body.action });
    if (!resolved) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Sync conflict not found." });
    if (!resolved.allowed) return reply.code(409).send({ ok: false, code: "CONFLICT_RESOLUTION_NOT_ALLOWED", error: "That action is not available for this conflict.", allowedActions: resolved.conflict.allowedActions });
    return { ok: true, conflict: resolved.conflict };
  });

  app.post("/api/sync/batch", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const body = batchSchema.parse(request.body);
    const deviceId = body.deviceId;
    const mutationIds = new Set<string>();
    for (const mutation of body.mutations) {
      if (mutationIds.has(mutation.id)) return reply.code(400).send({ ok: false, code: "SYNC_DUPLICATE_MUTATION_ID", error: "A sync batch cannot contain duplicate mutation IDs." });
      for (const dependency of mutation.dependsOn) if (!mutationIds.has(dependency)) return reply.code(400).send({ ok: false, code: "SYNC_DEPENDENCY_ORDER_INVALID", error: "Sync dependencies must refer to an earlier mutation in the same batch." });
      mutationIds.add(mutation.id);
    }
    const device = await syncControl.registerDevice({
      id: deviceId,
      userId: user.id,
      clientVersion: body.clientVersion || null,
      mutationSchemaVersion: body.mutationSchemaVersion,
    });
    if (device.ownershipConflict) return reply.code(409).send({ ok: false, code: "SYNC_DEVICE_OWNERSHIP_CONFLICT", error: "This sync device identifier belongs to another account. Generate a new device identity." });
    const cookie = String(request.headers.cookie || "");
    const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
    const results: Array<Record<string, unknown>> = [];
    const resultById = new Map<string, Record<string, unknown>>();

    for (const mutation of body.mutations) {
      const canonicalPath = safeBatchPath(mutation.path);
      if (!canonicalPath) {
        const result = { id: mutation.id, ok: false, status: 400, payload: { ok: false, code: "SYNC_PATH_NOT_ALLOWED", error: "This action cannot be replayed through offline synchronization." } };
        results.push(result); resultById.set(mutation.id, result);
        await syncControl.recordReceipt({ userId: user.id, deviceId, mutationId: mutation.id, idempotencyKey: mutation.idempotencyKey, statusCode: 400, payload: result.payload });
        continue;
      }
      if (containsSensitiveSyncValue(mutation.body)) {
        const result = { id: mutation.id, ok: false, status: 400, payload: { ok: false, code: "SYNC_SENSITIVE_PAYLOAD_BLOCKED", error: "Sensitive credential material cannot be persisted or replayed through offline synchronization." } };
        results.push(result); resultById.set(mutation.id, result);
        await syncControl.recordReceipt({ userId: user.id, deviceId, mutationId: mutation.id, idempotencyKey: mutation.idempotencyKey, statusCode: 400, payload: result.payload });
        continue;
      }
      const safeMutation = { ...mutation, path: canonicalPath, headers: sanitizeSyncHeaders(mutation.headers) };
      const priorReceipt = await syncControl.receipt(user.id, deviceId, mutation.idempotencyKey);
      if (priorReceipt && priorReceipt.statusCode >= 200 && priorReceipt.statusCode < 300) {
        const result = {
          id: mutation.id, ok: true, status: priorReceipt.statusCode, requestId: priorReceipt.requestId, payload: priorReceipt.payload, replayed: true,
        };
        results.push(result); resultById.set(mutation.id, result);
        continue;
      }
      if (priorReceipt) {
        const activeConflict = await syncControl.activeConflict(user.id, deviceId, mutation.idempotencyKey);
        if (activeConflict) {
          const result = {
            id: mutation.id, ok: false, status: priorReceipt.statusCode, requestId: priorReceipt.requestId, payload: priorReceipt.payload,
            conflictId: activeConflict.id, conflict: { classification: activeConflict.classification, allowedActions: activeConflict.allowedActions, entityType: activeConflict.entityType, entityId: activeConflict.entityId }, replayed: true,
          };
          results.push(result); resultById.set(mutation.id, result);
          continue;
        }
      }
      const failedDependency = mutation.dependsOn.find((id) => resultById.get(id)?.ok !== true);
      if (failedDependency) {
        const payload = { ok: false, code: "SYNC_DEPENDENCY_FAILED", error: `Dependency ${failedDependency} did not complete successfully.` };
        const conflict = classifySyncConflict(409, payload, canonicalPath);
        const created = await syncControl.createConflict({
          userId: user.id, deviceId: deviceId, mutationId: mutation.id, idempotencyKey: mutation.idempotencyKey,
          ...conflict, classification: "DEPENDENCY_FAILED", allowedActions: ["discard"], localPayload: safeMutation, serverPayload: payload, status: "QUARANTINED",
        });
        const result = { id: mutation.id, ok: false, status: 409, payload, conflictId: created.id, quarantined: true };
        results.push(result); resultById.set(mutation.id, result);
        continue;
      }

      if (mutation.schemaVersion !== syncControl.mutationSchemaVersion) {
        const payload = { ok: false, code: "SYNC_SCHEMA_UNSUPPORTED", error: `Mutation schema ${mutation.schemaVersion} is not supported by this server.` };
        const conflict = classifySyncConflict(409, payload, canonicalPath);
        const created = await syncControl.createConflict({
          userId: user.id, deviceId: deviceId, mutationId: mutation.id, idempotencyKey: mutation.idempotencyKey,
          ...conflict, classification: "UNSUPPORTED_SCHEMA", allowedActions: ["discard"], localPayload: safeMutation, serverPayload: payload, status: "QUARANTINED",
        });
        const result = { id: mutation.id, ok: false, status: 409, payload, conflictId: created.id, quarantined: true };
        results.push(result); resultById.set(mutation.id, result);
        continue;
      }

      const headers: Record<string, string> = {
        cookie, "content-type": "application/json",
        "x-cluster-idempotency-key": mutation.idempotencyKey,
        "x-cluster-sync-batch": "1",
        "x-cluster-device-id": deviceId,
        "x-cluster-mutation-schema-version": String(mutation.schemaVersion),
      };
      if (mutation.baseRevision) headers["x-cluster-base-revision"] = String(mutation.baseRevision);
      if (origin) headers.origin = origin;
      Object.assign(headers, sanitizeSyncHeaders(mutation.headers));

      let response = (await app.inject({
        method: mutation.method,
        url: canonicalPath,
        headers,
        ...(mutation.body === undefined ? {} : { payload: mutation.body as any }),
      })) as unknown as SyncInjectResponse;
      let payload = parsePayload(response.payload);
      let autoRebased = false;
      // User-scoped client state is private preference/UI state. A stale expectedRevision has a
      // deterministic resolution: fetch the latest revision and retry this local value once.
      // Studio-scoped state is deliberately excluded because it may contain another person's work.
      if (mutation.method === "PUT" && canonicalPath.startsWith("/api/client-state/user/") && response.statusCode === 409 && String((payload as any)?.code || "") === "REVISION_CONFLICT" && mutation.body && typeof mutation.body === "object" && Object.prototype.hasOwnProperty.call(mutation.body, "payload")) {
        const current = (await app.inject({ method: "GET", url: canonicalPath, headers: { cookie, ...(origin ? { origin } : {}) } })) as unknown as SyncInjectResponse;
        const currentPayload = parsePayload(current.payload) as any;
        if (current.statusCode >= 200 && current.statusCode < 300) {
          const expectedRevision = Number(currentPayload?.record?.revision || 0);
          const retryBody = { ...(mutation.body as Record<string, unknown>), expectedRevision };
          response = (await app.inject({ method: mutation.method, url: canonicalPath, headers, payload: retryBody as any })) as unknown as SyncInjectResponse;
          payload = parsePayload(response.payload);
          autoRebased = response.statusCode >= 200 && response.statusCode < 300;
        }
      }
      const requestIdHeader = response.headers["x-request-id"];
      const requestId = Array.isArray(requestIdHeader) ? requestIdHeader[0] || null : requestIdHeader || null;
      // Replaying DELETE is intentionally idempotent. If another client already removed the
      // entity, the desired state is already true and there is nothing useful for a human to resolve.
      const alreadyDeleted = mutation.method === "DELETE" && response.statusCode === 404;
      const effectiveStatus = alreadyDeleted ? 204 : response.statusCode;
      const effectivePayload = alreadyDeleted ? { ok: true, alreadyDeleted: true } : payload;
      const result: Record<string, unknown> = {
        id: mutation.id, ok: effectiveStatus >= 200 && effectiveStatus < 300, status: effectiveStatus, requestId, payload: effectivePayload, ...(autoRebased ? { rebased: true } : {}),
      };
      if (!alreadyDeleted && [404, 409, 412].includes(response.statusCode)) {
        const conflict = classifySyncConflict(response.statusCode, payload, canonicalPath);
        const created = await syncControl.createConflict({
          userId: user.id, deviceId: deviceId, mutationId: mutation.id, idempotencyKey: mutation.idempotencyKey,
          ...conflict, localPayload: safeMutation, serverPayload: payload,
        });
        result.conflictId = created.id;
        result.conflict = { classification: conflict.classification, allowedActions: conflict.allowedActions, entityType: conflict.entityType, entityId: conflict.entityId };
      }
      await syncControl.recordReceipt({ userId: user.id, deviceId: deviceId, mutationId: mutation.id, idempotencyKey: mutation.idempotencyKey, statusCode: effectiveStatus, payload: effectivePayload, requestId: requestId ? String(requestId) : null });
      results.push(result); resultById.set(mutation.id, result);
      if (response.statusCode === 401 || response.statusCode === 403) break;
    }

    return reply.send({ ok: true, serverTime: new Date().toISOString(), deviceId: deviceId, mutationSchemaVersion: syncControl.mutationSchemaVersion, results });
  });


  app.get("/api/sync/delta", async (request, reply) => {
    const query = deltaQuerySchema.parse(request.query || {});
    const upperBound = new Date();
    const domains = new Set(query.domains.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const role = await getWorkspaceRole(user.id);
    if (query.deviceId) {
      const device = await syncControl.registerDevice({ id: query.deviceId, userId: user.id });
      if (device.ownershipConflict) return reply.code(409).send({ ok: false, code: "SYNC_DEVICE_OWNERSHIP_CONFLICT", error: "This sync device identifier belongs to another account. Generate a new device identity." });
    }
    const [allProjects, activeRules] = await Promise.all([
      prisma.project.findMany({
        select: {
          id: true, workspaceId: true, name: true, description: true, objective: true, clientName: true,
          startDate: true, targetDate: true, priority: true, tags: true, color: true, healthNote: true,
          projectType: true, productionProfile: true, blueprintKey: true, workspacePresetKey: true, status: true, source: true, archived: true,
          libraryFolderId: true, revision: true, updatedAt: true,
          memberships: { where: { status: "active" }, select: { userId: true, roleKey: true, roleLabel: true, allocationPercent: true, accessLevel: true, isLead: true, status: true, startsAt: true, endsAt: true } },
        },
      }),
      prisma.accessRule.findMany({
        where: { status: "active" },
        select: { id: true, targetKind: true, targetId: true, projectId: true, subjectKind: true, subjectId: true, subjectName: true, effect: true, level: true, expiresAt: true, updatedAt: true },
      }).catch(() => []),
    ]);
    const visibleProjects = allProjects.filter((project: any) => hasTargetAccess(user, role, "project", project.id, project, activeRules, "view"));
    const resourceProjects = allProjects.filter((project: any) => hasProjectResourceAccess(user, role, project, activeRules, "view"));
    const visibleProjectIds = visibleProjects.map((project: any) => project.id);
    const resourceProjectIds = resourceProjects.map((project: any) => project.id);
    const resourceProjectSet = new Set(resourceProjectIds);
    const projectById = new Map(allProjects.map((project: any) => [String(project.id), project]));
    const toolVisibility = Object.fromEntries(["projects", "boards", "tickets", "whiteboards", "timeline"].map((tool) => [tool, hasToolPermission(user, role, tool, "view")]));
    const scopeDigest = computeSyncScopeDigest({
      role: role || null,
      accessExpiresAt: user.accessExpiresAt || null,
      toolVisibility,
      visibleProjectIds: [...visibleProjectIds].sort(),
      resourceProjectIds: [...resourceProjectIds].sort(),
      rules: activeRules.map((rule: any) => ({ ...rule, expiresAt: rule.expiresAt?.toISOString?.() || rule.expiresAt || null, updatedAt: rule.updatedAt?.toISOString?.() || rule.updatedAt || null })),
    });
    const decoded = decodeSyncCursor<DeltaCursor>(query.since, "core", user.id, scopeDigest, syncCursorSecret);
    const cursor = decoded.payload ? normalizeCursorPayload(decoded.payload) : emptyCursor();
    const nextCursor: DeltaCursor = JSON.parse(JSON.stringify(cursor));
    const resetRequired = decoded.resetRequired;
    const resetReason = decoded.resetReason;

    const activeStreams = [
      ...(domains.has("projects") ? ["project" as const] : []),
      ...(domains.has("collaboration") ? ["board" as const, "list" as const, "card" as const, "whiteboard" as const] : []),
      ...(domains.has("timeline") ? ["timeline" as const] : []),
      "tombstone" as const,
    ];
    const streamLimit = Math.max(10, Math.ceil(query.limit / Math.max(1, activeStreams.length)));
    const scanLimit = Math.min(4_000, streamLimit * 4);
    const changes: InternalChange[] = [];
    let hasMore = false;

    if (domains.has("projects") && toolVisibility.projects) {
      const position = cursor.positions.project;
      const raw = visibleProjects
        .filter((project: any) => {
          const updatedAt = validDate(project.updatedAt);
          const cursorAt = validDate(position.at);
          return updatedAt <= upperBound && (updatedAt > cursorAt || (updatedAt.getTime() === cursorAt.getTime() && project.id > position.id));
        })
        .sort((left: any, right: any) => validDate(left.updatedAt).getTime() - validDate(right.updatedAt).getTime() || String(left.id).localeCompare(String(right.id)))
        .slice(0, streamLimit);
      hasMore ||= raw.length === streamLimit;
      advancePosition(nextCursor, "project", raw, "updatedAt");
      for (const project of raw) changes.push(internalChange("project", project, "updatedAt", {
        entityType: "project", entityId: project.id, projectId: project.id, revision: project.revision, updatedAt: project.updatedAt,
        data: project, invalidate: ["/api/projects", "/api/dashboard", "/api/operations"],
      }));
    }

    if (domains.has("collaboration") && resourceProjectIds.length && (toolVisibility.boards || toolVisibility.whiteboards)) {
      const [boards, lists, cards, whiteboards] = await Promise.all([
        toolVisibility.boards ? prisma.board.findMany({ where: { projectId: { in: resourceProjectIds }, ...afterPositionWhere("updatedAt", cursor.positions.board, upperBound) }, select: { id: true, projectId: true, name: true, archived: true, revision: true, updatedAt: true }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: scanLimit }) : [],
        toolVisibility.boards ? prisma.boardList.findMany({ where: { board: { projectId: { in: resourceProjectIds } }, ...afterPositionWhere("updatedAt", cursor.positions.list, upperBound) }, select: { id: true, boardId: true, title: true, position: true, revision: true, updatedAt: true, board: { select: { id: true, projectId: true } } }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: scanLimit }) : [],
        toolVisibility.boards ? prisma.card.findMany({ where: { list: { board: { projectId: { in: resourceProjectIds } } }, ...afterPositionWhere("updatedAt", cursor.positions.card, upperBound) }, select: { id: true, listId: true, title: true, workItemKind: true, labels: true, position: true, archived: true, revision: true, updatedAt: true, list: { select: { boardId: true, board: { select: { id: true, projectId: true } } } } }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: scanLimit }) : [],
        toolVisibility.whiteboards ? prisma.whiteboard.findMany({ where: { projectId: { in: resourceProjectIds }, ...afterPositionWhere("updatedAt", cursor.positions.whiteboard, upperBound) }, select: { id: true, projectId: true, name: true, revision: true, updatedAt: true }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: scanLimit }) : [],
      ]);

      const boardPage = authorizedStreamPage(boards, streamLimit, (board: any) => {
        const project = projectById.get(String(board.projectId));
        return Boolean(project && hasTargetAccess(user, role, "board", board.id, project, activeRules, "view"));
      });
      const listPage = authorizedStreamPage(lists, streamLimit, (list: any) => {
        const project = projectById.get(String(list.board.projectId));
        return Boolean(project && hasTargetAccess(user, role, "board", list.board.id, project, activeRules, "view"));
      });
      const cardPage = authorizedStreamPage(cards, streamLimit, (card: any) => {
        const project = projectById.get(String(card.list.board.projectId));
        if (!project || !hasTargetAccess(user, role, "board", card.list.board.id, project, activeRules, "view")) return false;
        if (!hasTargetAccess(user, role, "card", card.id, project, activeRules, "view")) return false;
        return card.workItemKind !== "ticket" || hasToolPermission(user, role, "tickets", "view");
      });
      const whiteboardPage = authorizedStreamPage(whiteboards, streamLimit, (whiteboard: any) => {
        const project = projectById.get(String(whiteboard.projectId));
        return Boolean(project && hasTargetAccess(user, role, "whiteboard", whiteboard.id, project, activeRules, "view"));
      });

      for (const [stream, records, page] of [["board", boards, boardPage], ["list", lists, listPage], ["card", cards, cardPage], ["whiteboard", whiteboards, whiteboardPage]] as const) {
        hasMore ||= page.overflow || records.length === scanLimit;
        if (page.advanceThrough) advancePosition(nextCursor, stream, [page.advanceThrough], "updatedAt");
      }
      for (const board of boardPage.selected) changes.push(internalChange("board", board, "updatedAt", { entityType: "board", entityId: board.id, projectId: board.projectId, revision: board.revision, updatedAt: board.updatedAt, data: board, invalidate: ["/api/projects", `/api/boards/${board.id}`] }));
      for (const list of listPage.selected) changes.push(internalChange("list", list, "updatedAt", { entityType: "list", entityId: list.id, projectId: list.board.projectId, boardId: list.boardId, revision: list.revision, updatedAt: list.updatedAt, data: list, invalidate: ["/api/projects", `/api/boards/${list.boardId}`] }));
      for (const card of cardPage.selected) changes.push(internalChange("card", card, "updatedAt", { entityType: "card", entityId: card.id, projectId: card.list.board.projectId, boardId: card.list.boardId, revision: card.revision, updatedAt: card.updatedAt, data: card, invalidate: ["/api/projects", `/api/boards/${card.list.boardId}`] }));
      for (const whiteboard of whiteboardPage.selected) changes.push(internalChange("whiteboard", whiteboard, "updatedAt", { entityType: "whiteboard", entityId: whiteboard.id, projectId: whiteboard.projectId, revision: whiteboard.revision, updatedAt: whiteboard.updatedAt, data: whiteboard, invalidate: ["/api/projects", `/api/whiteboards/${whiteboard.id}`] }));
    }

    if (domains.has("timeline") && toolVisibility.timeline) {
      const timelineCandidates = await prisma.timelineItem.findMany({
        where: { AND: [afterPositionWhere("updatedAt", cursor.positions.timeline, upperBound), { OR: [{ projectId: null }, ...(resourceProjectIds.length ? [{ projectId: { in: resourceProjectIds } }] : [])] }] },
        include: { project: { include: { memberships: { where: { status: "active" } } } }, user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: scanLimit,
      });
      const timelinePage = authorizedStreamPage(timelineCandidates, streamLimit, (item: any) => {
        if (item.project) return hasTargetAccess(user, role, "timeline", item.id, item.project, activeRules, "view");
        return item.userId === user.id
          ? hasToolPermission(user, role, "timeline", "view")
          : hasToolPermission(user, role, "timeline", "manage");
      });
      hasMore ||= timelinePage.overflow || timelineCandidates.length === scanLimit;
      if (timelinePage.advanceThrough) advancePosition(nextCursor, "timeline", [timelinePage.advanceThrough], "updatedAt");
      for (const item of timelinePage.selected) changes.push(internalChange("timeline", item, "updatedAt", { entityType: "timeline_item", entityId: item.id, projectId: item.projectId, revision: item.revision, updatedAt: item.updatedAt, data: item, invalidate: ["/api/timeline", "/api/calendar"] }));
    }

    const rawTombstones = await prisma.syncTombstone.findMany({ where: afterPositionWhere("deletedAt", cursor.positions.tombstone, upperBound), orderBy: [{ deletedAt: "asc" }, { id: "asc" }], take: scanLimit });
    const tombstoneVisible = (tombstone: any) => {
      const audience = (() => { try { const parsed = JSON.parse(tombstone.visibleToUserIds || "[]"); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } })();
      const project = tombstone.projectId ? projectById.get(String(tombstone.projectId)) : null;
      if (["owner", "admin"].includes(String(role || ""))) return true;
      if (audience.length && !audience.includes(user.id)) return false;
      if (tombstone.entityType === "project") return audience.includes(user.id);
      if (tombstone.entityType === "timeline_item" && !tombstone.projectId) {
        return audience.includes(user.id) && hasToolPermission(user, role, "timeline", "view");
      }
      if (!project || !resourceProjectSet.has(String(tombstone.projectId))) return false;
      if (tombstone.entityType === "board") return hasTargetAccess(user, role, "board", tombstone.entityId, project, activeRules, "view");
      if (tombstone.entityType === "list") return Boolean(tombstone.parentEntityId && hasTargetAccess(user, role, "board", tombstone.parentEntityId, project, activeRules, "view"));
      if (tombstone.entityType === "card") {
        if (!tombstone.parentEntityId || !hasTargetAccess(user, role, "board", tombstone.parentEntityId, project, activeRules, "view")) return false;
        return hasTargetAccess(user, role, "card", tombstone.entityId, project, activeRules, "view");
      }
      if (tombstone.entityType === "whiteboard") return hasTargetAccess(user, role, "whiteboard", tombstone.entityId, project, activeRules, "view");
      if (tombstone.entityType === "timeline_item") return hasTargetAccess(user, role, "timeline", tombstone.entityId, project, activeRules, "view");
      return false;
    };
    const tombstonePage = authorizedStreamPage(rawTombstones, streamLimit, tombstoneVisible);
    hasMore ||= tombstonePage.overflow || rawTombstones.length === scanLimit;
    if (tombstonePage.advanceThrough) advancePosition(nextCursor, "tombstone", [tombstonePage.advanceThrough], "deletedAt");
    for (const tombstone of tombstonePage.selected as any[]) {
      const invalidate = tombstone.entityType === "timeline_item" ? ["/api/timeline", "/api/calendar"]
        : tombstone.entityType === "whiteboard" ? ["/api/projects", `/api/whiteboards/${tombstone.entityId}`]
          : tombstone.entityType === "board" ? ["/api/projects", `/api/boards/${tombstone.entityId}`]
            : tombstone.entityType === "list" || tombstone.entityType === "card" ? ["/api/projects", ...(tombstone.parentEntityId ? [`/api/boards/${tombstone.parentEntityId}`] : [])]
              : ["/api/projects", "/api/dashboard", "/api/operations"];
      changes.push(internalChange("tombstone", tombstone, "deletedAt", { entityType: tombstone.entityType, entityId: tombstone.entityId, projectId: tombstone.projectId, boardId: tombstone.parentEntityId, deletedAt: tombstone.deletedAt, deleted: true, invalidate }));
    }

    changes.sort((left, right) => changeTime(left) - changeTime(right) || STREAMS.indexOf(left._stream) - STREAMS.indexOf(right._stream) || left._cursorId.localeCompare(right._cursorId));
    const encodedCursor = encodeSyncCursor("core", user.id, scopeDigest, nextCursor, syncCursorSecret);
    if (query.deviceId) {
      const acknowledgement = await syncControl.acknowledge({ deviceId: query.deviceId, userId: user.id, cursor: encodedCursor });
      if (!acknowledgement.accepted) return reply.code(409).send({ ok: false, code: "SYNC_DEVICE_NOT_FOUND", error: "Sync device is not registered for this account." });
    }
    return {
      ok: true, cursor: encodedCursor, scopeDigest, resetRequired, resetReason,
      serverTime: upperBound.toISOString(), hasMore, tombstoneRetentionDays: 90,
      mutationSchemaVersion: syncControl.mutationSchemaVersion, changes: changes.map(stripInternal),
    };
  });
}

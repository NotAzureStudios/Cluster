import { z } from "zod";
import { randomUUID } from "node:crypto";
import { captureWhiteboardHistory, ensureWhiteboardHistoryNoCollision, restoreWhiteboardHistoryElements } from "./whiteboard-saved-history.js";
import type { ServerRouteRegistrationDeps } from "../../app/server-composition-types.js";

const operationKindSchema = z.enum([
  "element.create",
  "element.move",
  "element.resize",
  "element.patch",
  "element.delete",
  "group.set",
  "batch.transform",
  "settings.patch",
  "snapshot.restore",
]);

const operationSchema = z.object({
  id: z.string().trim().min(8).max(200),
  kind: operationKindSchema,
  payload: z.record(z.any()).default({}),
});

const batchSchema = z.object({
  clientId: z.string().trim().min(1).max(120).optional().nullable(),
  baseSequence: z.coerce.number().int().min(0),
  operations: z.array(operationSchema).min(1).max(2000),
});

function parseArray(value: unknown) {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function parseRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, any> : {}; } catch { return {}; }
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))];
}

function targetIds(operation: z.infer<typeof operationSchema>) {
  const payload = operation.payload || {};
  if ((operation as any).kind === "history.restore") return uniqueStrings(Array.isArray(payload.elements) ? payload.elements.map((entry: any) => entry?.id) : []);
  if (operation.kind === "settings.patch") return ["$settings"];
  if (operation.kind === "snapshot.restore") return ["$document"];
  if (operation.kind === "element.create") return payload.element?.id ? [String(payload.element.id)] : [];
  if (["element.move", "element.resize", "element.patch", "element.delete"].includes(operation.kind)) return payload.id ? [String(payload.id)] : [];
  if (operation.kind === "group.set" || operation.kind === "batch.transform") return uniqueStrings(Array.isArray(payload.ids) ? payload.ids : []);
  return [];
}

function operationConflictTargets(operations: Array<z.infer<typeof operationSchema>>) {
  return new Set(operations.flatMap(targetIds));
}

class WhiteboardOperationError extends Error {
  constructor(public code: string, message: string, public status = 400, public metadata?: any) { super(message); }
}

function elementIndex(elements: any[], id: string) {
  return elements.findIndex((element) => String(element?.id || "") === id);
}

function ensureMutable(elements: any[], ids: string[], canManage: boolean) {
  if (canManage) return;
  const locked = ids.find((id) => {
    const index = elementIndex(elements, id);
    return index >= 0 && Boolean(elements[index]?.locked);
  });
  if (locked) throw new WhiteboardOperationError("WHITEBOARD_ELEMENT_LOCKED", "A locked Whiteboard object requires manage access before it can be changed.", 403, { elementId: locked });
}

function applyOperation(state: any, operation: z.infer<typeof operationSchema>, canManage: boolean) {
  const payload = operation.payload || {};
  const elements = state.elements as any[];
  if ((operation as any).kind === "history.restore") {
    try { restoreWhiteboardHistoryElements(elements, payload, canManage); }
    catch (error: any) { throw new WhiteboardOperationError("WHITEBOARD_HISTORY_INVALID", error.message, 409); }
    return;
  }
  if (operation.kind === "element.create") {
    const element = payload.element;
    if (!element || typeof element !== "object" || Array.isArray(element) || !String(element.id || "").trim()) throw new WhiteboardOperationError("WHITEBOARD_OPERATION_INVALID", "Create operations require an element with a stable id.");
    const id = String(element.id);
    if (elementIndex(elements, id) >= 0) throw new WhiteboardOperationError("WHITEBOARD_ELEMENT_EXISTS", "The Whiteboard object already exists.", 409, { elementId: id });
    elements.push({ ...element, id });
    return;
  }
  if (["element.move", "element.resize", "element.patch", "element.delete"].includes(operation.kind)) {
    const id = String(payload.id || "").trim();
    if (!id) throw new WhiteboardOperationError("WHITEBOARD_OPERATION_INVALID", `${operation.kind} requires an element id.`);
    const index = elementIndex(elements, id);
    if (index < 0) throw new WhiteboardOperationError("WHITEBOARD_ELEMENT_MISSING", "The Whiteboard object no longer exists.", 409, { elementId: id });
    ensureMutable(elements, [id], canManage);
    if (operation.kind === "element.delete") { elements.splice(index, 1); return; }
    const current = elements[index];
    if (operation.kind === "element.move") {
      const x = payload.x === undefined ? Number(current.x || 0) + Number(payload.dx || 0) : Number(payload.x);
      const y = payload.y === undefined ? Number(current.y || 0) + Number(payload.dy || 0) : Number(payload.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new WhiteboardOperationError("WHITEBOARD_OPERATION_INVALID", "Move coordinates must be finite numbers.");
      elements[index] = { ...current, x, y };
      return;
    }
    if (operation.kind === "element.resize") {
      const patch: Record<string, number> = {};
      for (const key of ["x", "y", "width", "height"] as const) if (payload[key] !== undefined) {
        const value = Number(payload[key]);
        if (!Number.isFinite(value)) throw new WhiteboardOperationError("WHITEBOARD_OPERATION_INVALID", "Resize values must be finite numbers.");
        patch[key] = value;
      }
      elements[index] = { ...current, ...patch };
      return;
    }
    const patch = payload.patch;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new WhiteboardOperationError("WHITEBOARD_OPERATION_INVALID", "Patch operations require an object patch.");
    const { id: _ignored, ...safePatch } = patch;
    elements[index] = { ...current, ...safePatch, id };
    return;
  }
  if (operation.kind === "group.set") {
    const ids = uniqueStrings(Array.isArray(payload.ids) ? payload.ids : []);
    if (!ids.length) throw new WhiteboardOperationError("WHITEBOARD_OPERATION_INVALID", "Group operations require at least one element id.");
    const missingIds = ids.filter((id) => elementIndex(elements, id) < 0);
    if (missingIds.length) throw new WhiteboardOperationError("WHITEBOARD_ELEMENT_MISSING", "One or more Whiteboard objects no longer exist.", 409, { elementIds: missingIds });
    ensureMutable(elements, ids, canManage);
    const groupId = payload.groupId == null ? null : String(payload.groupId).trim() || null;
    for (const id of ids) {
      const index = elementIndex(elements, id);
      elements[index] = { ...elements[index], groupId };
    }
    return;
  }
  if (operation.kind === "batch.transform") {
    const ids = uniqueStrings(Array.isArray(payload.ids) ? payload.ids : []);
    if (!ids.length) throw new WhiteboardOperationError("WHITEBOARD_OPERATION_INVALID", "Batch transforms require at least one element id.");
    const missingIds = ids.filter((id) => elementIndex(elements, id) < 0);
    if (missingIds.length) throw new WhiteboardOperationError("WHITEBOARD_ELEMENT_MISSING", "One or more Whiteboard objects no longer exist.", 409, { elementIds: missingIds });
    ensureMutable(elements, ids, canManage);
    const dx = Number(payload.dx || 0); const dy = Number(payload.dy || 0);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new WhiteboardOperationError("WHITEBOARD_OPERATION_INVALID", "Transform offsets must be finite numbers.");
    for (const id of ids) {
      const index = elementIndex(elements, id);
      elements[index] = { ...elements[index], x: Number(elements[index].x || 0) + dx, y: Number(elements[index].y || 0) + dy };
    }
    return;
  }
  if (operation.kind === "settings.patch") {
    const patch = payload.patch;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new WhiteboardOperationError("WHITEBOARD_OPERATION_INVALID", "Settings operations require an object patch.");
    const allowed = new Set(["name", "description", "projectId", "categories", "labels", "productionLinks", "backgroundColor", "gridColor", "gridStyle", "canvasWidth", "canvasHeight"]);
    for (const [key, value] of Object.entries(patch)) if (allowed.has(key)) state.settings[key] = value;
    return;
  }
  if (operation.kind === "snapshot.restore") {
    if (!canManage) throw new WhiteboardOperationError("WHITEBOARD_RESTORE_REQUIRES_MANAGE", "Restoring a Whiteboard snapshot requires manage access.", 403);
    const snapshot = payload.snapshot;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new WhiteboardOperationError("WHITEBOARD_OPERATION_INVALID", "Snapshot restore operations require a snapshot payload.");
    const restored = snapshot as Record<string, any>;
    const restoredElements = Array.isArray(restored.elements) ? restored.elements : [];
    elements.splice(0, elements.length, ...restoredElements.map((element) => element && typeof element === "object" ? { ...element } : element));
    const restoredSettings = restored.settings && typeof restored.settings === "object" && !Array.isArray(restored.settings) ? restored.settings as Record<string, any> : {};
    const allowed = new Set(["name", "description", "projectId", "backgroundColor", "gridColor", "gridStyle", "canvasWidth", "canvasHeight"]);
    for (const [key, value] of Object.entries(restoredSettings)) if (allowed.has(key)) state.settings[key] = value;
    state.settings.categories = Array.isArray(restored.categories) ? restored.categories : [];
    state.settings.labels = Array.isArray(restored.labels) ? restored.labels : [];
    state.settings.productionLinks = restored.productionLinks && typeof restored.productionLinks === "object" && !Array.isArray(restored.productionLinks) ? restored.productionLinks : {};
  }
}

function snapshotPayload(row: any) {
  return {
    sequence: Number(row.sequence || 0), revision: Number(row.revision || 1),
    elements: parseArray(row.elements), categories: parseArray(row.categories), labels: parseArray(row.labels),
    productionLinks: parseRecord(row.productionLinks), settings: parseRecord(row.settings), createdAt: row.createdAt,
  };
}

export function registerWhiteboardOperationRoutes(deps: ServerRouteRegistrationDeps) {
  const { app, prisma, getCurrentUser, enforceTargetAccess, authorization, collaborationRuntime, serializeWhiteboard, logActivity } = deps;

  async function whiteboardAccess(request: any, reply: any, whiteboardId: string, minimum: "view" | "contribute") {
    const whiteboard = await prisma.whiteboard.findUnique({ where: { id: whiteboardId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
    if (!whiteboard) { reply.code(404).send({ ok: false, code: "WHITEBOARD_NOT_FOUND", error: "Whiteboard not found." }); return null; }
    if (whiteboard.project) {
      if (!(await enforceTargetAccess(request, reply, "whiteboard", whiteboard.id, whiteboard.project, minimum))) return null;
    } else if (!(await authorization.requireTool(request, reply, "whiteboards", minimum === "view" ? "view" : "edit"))) return null;
    return whiteboard;
  }

  async function canManageWhiteboard(request: any, whiteboard: any) {
    const resource = whiteboard.project
      ? { kind: "target", targetKind: "whiteboard", targetId: whiteboard.id, project: whiteboard.project }
      : { kind: "tool", tool: "whiteboards" };
    const decision = await authorization.authorize(request, "manage", resource as any, { minimum: "manage", surface: "whiteboard-operations" });
    return decision.allowed;
  }

  app.get("/api/whiteboards/:whiteboardId/operations", async (request: any, reply: any) => {
    const params = z.object({ whiteboardId: z.string().min(1) }).parse(request.params);
    const query = z.object({ after: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(500).default(250) }).parse(request.query || {});
    const whiteboard = await whiteboardAccess(request, reply, params.whiteboardId, "view"); if (!whiteboard) return;
    const oldest = await prisma.whiteboardOperation.findFirst({ where: { whiteboardId: whiteboard.id }, orderBy: { sequence: "asc" }, select: { sequence: true } });
    const resetRequired = Boolean(oldest && query.after > 0 && query.after < Number(oldest.sequence) - 1);
    const [operations, latestSnapshot] = await Promise.all([
      resetRequired ? Promise.resolve([]) : prisma.whiteboardOperation.findMany({ where: { whiteboardId: whiteboard.id, sequence: { gt: query.after } }, orderBy: { sequence: "asc" }, take: query.limit }),
      resetRequired ? prisma.whiteboardSnapshot.findFirst({ where: { whiteboardId: whiteboard.id }, orderBy: { sequence: "desc" } }) : Promise.resolve(null),
    ]);
    return {
      ok: true,
      currentSequence: Number(whiteboard.operationSequence || 0),
      revision: Number(whiteboard.revision || 1),
      updatedAt: whiteboard.updatedAt,
      resetRequired,
      // A bounded page is not an authoritative full replay. Surface the watermark
      // explicitly so every client can reject a truncated or racing feed.
      returnedThroughSequence: operations.length ? Number(operations[operations.length - 1].sequence) : query.after,
      hasMore: resetRequired || (operations.length ? Number(operations[operations.length - 1].sequence) < Number(whiteboard.operationSequence || 0) : query.after < Number(whiteboard.operationSequence || 0)),
      snapshot: latestSnapshot ? snapshotPayload(latestSnapshot) : null,
      operations: operations.map((operation: any) => ({ id: operation.id, sequence: operation.sequence, actorUserId: operation.actorUserId || null, clientId: operation.clientId || null, kind: operation.kind, targets: parseArray(operation.targets), payload: parseRecord(operation.payload), baseSequence: operation.baseSequence ?? null, createdAt: operation.createdAt })),
    };
  });

  // Saved operation history is scoped to the authenticated author. The log itself
  // remains the canonical sequence and is also used by realtime collaborators.
  app.get("/api/whiteboards/:whiteboardId/history", async (request: any, reply: any) => {
    const params = z.object({ whiteboardId: z.string().min(1) }).parse(request.params);
    const whiteboard = await whiteboardAccess(request, reply, params.whiteboardId, "view"); if (!whiteboard) return;
    const user = await getCurrentUser(request);
    if (!user?.id) return reply.code(401).send({ ok: false, code: "WHITEBOARD_HISTORY_SIGNIN_REQUIRED", error: "Sign in to view your saved edits." });
    const operations = await prisma.whiteboardOperation.findMany({
      where: { whiteboardId: whiteboard.id, actorUserId: user.id, historyBefore: { not: null }, historyAction: null },
      orderBy: { sequence: "desc" }, take: 50,
      select: { id: true, sequence: true, kind: true, targets: true, createdAt: true, historyState: true, historyAnchorSequence: true },
    });
    return { ok: true, entries: operations.map((operation: any) => ({
      id: operation.id, sequence: operation.sequence, kind: operation.kind,
      targets: parseArray(operation.targets), state: operation.historyState, historyAnchorSequence: operation.historyAnchorSequence, createdAt: operation.createdAt,
    })) };
  });

  app.post("/api/whiteboards/:whiteboardId/history/:operationId/:direction", async (request: any, reply: any) => {
    const params = z.object({ whiteboardId: z.string().min(1), operationId: z.string().min(8), direction: z.enum(["undo", "redo"]) }).parse(request.params);
    const accessible = await whiteboardAccess(request, reply, params.whiteboardId, "contribute"); if (!accessible) return;
    const user = await getCurrentUser(request);
    if (!user?.id) return reply.code(401).send({ ok: false, code: "WHITEBOARD_HISTORY_SIGNIN_REQUIRED", error: "Sign in to reverse your saved edits." });
    const canManage = await canManageWhiteboard(request, accessible);
    try {
      const result = await prisma.$transaction(async (tx: any) => {
        const current = await tx.whiteboard.findUnique({ where: { id: params.whiteboardId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
        if (!current) throw new WhiteboardOperationError("WHITEBOARD_NOT_FOUND", "Whiteboard not found.", 404);
        const original = await tx.whiteboardOperation.findUnique({ where: { id: params.operationId } });
        if (!original || original.whiteboardId !== current.id || !original.historyBefore || !original.historyAfter || original.historyAction) {
          throw new WhiteboardOperationError("WHITEBOARD_HISTORY_NOT_FOUND", "This saved change is no longer available for reversal.", 404);
        }
        if (original.actorUserId !== user.id) throw new WhiteboardOperationError("WHITEBOARD_HISTORY_NOT_AUTHOR", "Only the original editor can reverse this change.", 403);
        const desired = params.direction === "undo" ? "applied" : "undone";
        if (original.historyState !== desired) throw new WhiteboardOperationError("WHITEBOARD_HISTORY_STATE", "This change has already been reversed or restored. Refresh history.", 409);
        const anchor = Number(original.historyAnchorSequence ?? original.sequence);
        const oldestRetained = await tx.whiteboardOperation.findFirst({ where: { whiteboardId: current.id }, orderBy: { sequence: "asc" }, select: { sequence: true } });
        if (!oldestRetained || anchor < Number(oldestRetained.sequence) - 1) {
          throw new WhiteboardOperationError("WHITEBOARD_HISTORY_COMPACTED", "History was compacted. This edit cannot be reversed safely.", 409);
        }
        const targets = parseArray(original.targets).map(String);
        if (!targets.length || targets.includes("$document") || targets.includes("$settings")) throw new WhiteboardOperationError("WHITEBOARD_HISTORY_UNSAFE", "This operation cannot be reversed using saved element history.", 409);
        const intervening = await tx.whiteboardOperation.findMany({
          where: { whiteboardId: current.id, sequence: { gt: anchor } },
          orderBy: { sequence: "asc" }, take: 5001,
          select: { sequence: true, targets: true, kind: true },
        });
        // Never infer a collision-free gap from the most recent sequence alone.
        // Log compaction, partial reads or missing sequence numbers must fail closed.
        const fullChain = intervening.length === Number(current.operationSequence || 0) - anchor
          && intervening.every((row: any, index: number) => Number(row.sequence) === anchor + index + 1);
        if (intervening.length > 5000 || !fullChain) {
          throw new WhiteboardOperationError("WHITEBOARD_HISTORY_GAP", "The retained operation log is not complete. Refresh the board.", 409);
        }
        const collision = ensureWhiteboardHistoryNoCollision(targets, intervening);
        if (collision) throw new WhiteboardOperationError("WHITEBOARD_HISTORY_CONFLICT", "Another edit touched this object. Reversing would overwrite newer work.", 409, { conflictingSequence: collision.sequence });
        const payload = parseRecord(params.direction === "undo" ? original.historyBefore : original.historyAfter);
        const expected = parseRecord(params.direction === "undo" ? original.historyAfter : original.historyBefore);
        const state = {
          elements: parseArray(current.elements).map((element: any) => element && typeof element === "object" ? { ...element } : element),
          settings: {} as Record<string, any>,
        };
        // Also detect direct/legacy writes that bypassed the operation feed.
        // Checking only the log is insufficient if a different endpoint edited
        // the element without allocating a sequence number.
        const expectedElements = Array.isArray(expected.elements) ? expected.elements : [];
        const replacementElements = Array.isArray(payload.elements) ? payload.elements : [];
        if (replacementElements.length !== targets.length ||
            new Set(replacementElements.map((element: any) => String(element?.id || ""))).size !== targets.length ||
            replacementElements.some((element: any) => !targets.includes(String(element?.id || "")))) {
          throw new WhiteboardOperationError("WHITEBOARD_HISTORY_TARGETS_CHANGED", "Saved inverse targets no longer match the original operation.", 409);
        }
        if (expectedElements.length !== targets.length || expectedElements.some((element: any) => {
          const actual = state.elements.find((item: any) => item && String(item.id || "") === String(element?.id || ""));
          return !actual || JSON.stringify(actual) !== JSON.stringify(element);
        })) throw new WhiteboardOperationError("WHITEBOARD_HISTORY_STATE_CHANGED", "Whiteboard target state no longer matches the saved edit.", 409);
        const operation = { id: `wbop-hist-${randomUUID()}`, kind: "history.restore", payload } as any;
        applyOperation(state, operation, canManage);
        const nextSequence = Number(current.operationSequence || 0) + 1;
        const changed = await tx.whiteboard.updateMany({
          where: { id: current.id, revision: current.revision, operationSequence: current.operationSequence },
          data: { elements: JSON.stringify(state.elements), operationSequence: nextSequence, revision: { increment: 1 } },
        });
        if (!changed.count) throw new WhiteboardOperationError("WHITEBOARD_HISTORY_RACE", "Whiteboard changed while reversing this edit.", 409);
        await tx.whiteboardOperation.create({ data: {
          id: operation.id, whiteboardId: current.id, sequence: nextSequence, actorUserId: user.id,
          clientId: null, kind: operation.kind, targets: JSON.stringify(targets), payload: JSON.stringify(payload),
          baseSequence: Number(current.operationSequence || 0), historyAction: params.direction, historyOfId: original.id,
        } });
        // History operations participate in the same 50-operation snapshot cadence
        // as ordinary client edits. Otherwise an Undo at an exact boundary could
        // leave the compacted feed without the authoritative checkpoint.
        if (Math.floor(Number(current.operationSequence || 0) / 50) < Math.floor(nextSequence / 50)) {
          await tx.whiteboardSnapshot.upsert({
            where: { whiteboardId_sequence: { whiteboardId: current.id, sequence: nextSequence } },
            create: { whiteboardId: current.id, sequence: nextSequence, revision: Number(current.revision || 1) + 1,
              elements: JSON.stringify(state.elements), categories: current.categories, labels: current.labels,
              productionLinks: current.productionLinks,
              settings: JSON.stringify({ name: current.name, description: current.description, projectId: current.projectId || null,
                backgroundColor: current.backgroundColor, gridColor: current.gridColor, gridStyle: current.gridStyle,
                canvasWidth: current.canvasWidth, canvasHeight: current.canvasHeight }),
            }, update: {},
          });
        }
        const updatedHistory = await tx.whiteboardOperation.updateMany({
          where: { id: original.id, historyState: desired, historyAnchorSequence: original.historyAnchorSequence },
          data: { historyState: params.direction === "undo" ? "undone" : "applied", historyAnchorSequence: nextSequence },
        });
        if (!updatedHistory.count) throw new WhiteboardOperationError("WHITEBOARD_HISTORY_RACE", "Saved history changed during reversal.", 409);
        const whiteboard = await tx.whiteboard.findUniqueOrThrow({ where: { id: current.id }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
        return { whiteboard, nextSequence, operationId: operation.id };
      });
      collaborationRuntime.scheduleBroadcast("whiteboard", params.whiteboardId, true);
      await logActivity?.({ userId: user.id, projectId: result.whiteboard.projectId || null, whiteboardId: result.whiteboard.id,
        type: "whiteboard_saved_history", entityType: "whiteboard", entityId: result.whiteboard.id,
        title: params.direction === "undo" ? "Whiteboard saved edit undone" : "Whiteboard saved edit redone",
        message: `${params.direction} of saved operation ${params.operationId}`,
        metadata: { originalOperationId: params.operationId, historyOperationId: result.operationId, sequence: result.nextSequence },
      });
      return { ok: true, currentSequence: result.nextSequence, whiteboard: serializeWhiteboard(result.whiteboard) };
    } catch (error: any) {
      if (error instanceof WhiteboardOperationError) return reply.code(error.status).send({ ok: false, code: error.code, error: error.message, ...(error.metadata ? { metadata: error.metadata } : {}) });
      throw error;
    }
  });

  app.get("/api/whiteboards/:whiteboardId/snapshots", async (request: any, reply: any) => {
    const params = z.object({ whiteboardId: z.string().min(1) }).parse(request.params);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(request.query || {});
    const whiteboard = await whiteboardAccess(request, reply, params.whiteboardId, "view"); if (!whiteboard) return;
    const snapshots = await prisma.whiteboardSnapshot.findMany({ where: { whiteboardId: whiteboard.id }, orderBy: { sequence: "desc" }, take: query.limit });
    return {
      ok: true,
      currentSequence: Number(whiteboard.operationSequence || 0),
      snapshots: snapshots.map((snapshot: any) => ({ id: snapshot.id, sequence: Number(snapshot.sequence || 0), revision: Number(snapshot.revision || 1), elementCount: parseArray(snapshot.elements).length, createdAt: snapshot.createdAt })),
    };
  });

  app.post("/api/whiteboards/:whiteboardId/snapshots", async (request: any, reply: any) => {
    const params = z.object({ whiteboardId: z.string().min(1) }).parse(request.params);
    const whiteboard = await whiteboardAccess(request, reply, params.whiteboardId, "contribute"); if (!whiteboard) return;
    const state = {
      elements: parseArray(whiteboard.elements),
      categories: parseArray(whiteboard.categories),
      labels: parseArray(whiteboard.labels),
      productionLinks: parseRecord(whiteboard.productionLinks),
      settings: { name: whiteboard.name, description: whiteboard.description, projectId: whiteboard.projectId || null, backgroundColor: whiteboard.backgroundColor, gridColor: whiteboard.gridColor, gridStyle: whiteboard.gridStyle, canvasWidth: whiteboard.canvasWidth, canvasHeight: whiteboard.canvasHeight },
    };
    const snapshot = await prisma.whiteboardSnapshot.upsert({
      where: { whiteboardId_sequence: { whiteboardId: whiteboard.id, sequence: Number(whiteboard.operationSequence || 0) } },
      create: { whiteboardId: whiteboard.id, sequence: Number(whiteboard.operationSequence || 0), revision: Number(whiteboard.revision || 1), elements: JSON.stringify(state.elements), categories: JSON.stringify(state.categories), labels: JSON.stringify(state.labels), productionLinks: JSON.stringify(state.productionLinks), settings: JSON.stringify(state.settings) },
      update: { revision: Number(whiteboard.revision || 1), elements: JSON.stringify(state.elements), categories: JSON.stringify(state.categories), labels: JSON.stringify(state.labels), productionLinks: JSON.stringify(state.productionLinks), settings: JSON.stringify(state.settings) },
    });
    return { ok: true, snapshot: snapshotPayload(snapshot) };
  });

  app.get("/api/whiteboards/:whiteboardId/snapshots/:sequence", async (request: any, reply: any) => {
    const params = z.object({ whiteboardId: z.string().min(1), sequence: z.coerce.number().int().min(0) }).parse(request.params);
    const whiteboard = await whiteboardAccess(request, reply, params.whiteboardId, "view"); if (!whiteboard) return;
    const snapshot = await prisma.whiteboardSnapshot.findUnique({ where: { whiteboardId_sequence: { whiteboardId: whiteboard.id, sequence: params.sequence } } });
    if (!snapshot) return reply.code(404).send({ ok: false, code: "WHITEBOARD_SNAPSHOT_NOT_FOUND", error: "Whiteboard snapshot not found." });
    return { ok: true, snapshot: snapshotPayload(snapshot) };
  });

  app.post("/api/whiteboards/:whiteboardId/snapshots/:sequence/restore", async (request: any, reply: any) => {
    const params = z.object({ whiteboardId: z.string().min(1), sequence: z.coerce.number().int().min(0) }).parse(request.params);
    const accessWhiteboard = await whiteboardAccess(request, reply, params.whiteboardId, "contribute"); if (!accessWhiteboard) return;
    if (!(await canManageWhiteboard(request, accessWhiteboard))) return reply.code(403).send({ ok: false, code: "WHITEBOARD_RESTORE_REQUIRES_MANAGE", error: "Restoring a Whiteboard snapshot requires manage access." });
    const authorizationSnapshot = await prisma.whiteboardSnapshot.findUnique({ where: { whiteboardId_sequence: { whiteboardId: accessWhiteboard.id, sequence: params.sequence } } });
    if (!authorizationSnapshot) return reply.code(404).send({ ok: false, code: "WHITEBOARD_SNAPSHOT_NOT_FOUND", error: "Whiteboard snapshot not found." });
    const snapshotProjectId = String(parseRecord(authorizationSnapshot.settings).projectId || "").trim();
    if (snapshotProjectId && snapshotProjectId !== String(accessWhiteboard.projectId || "")) {
      const destinationProject = await prisma.project.findUnique({ where: { id: snapshotProjectId } });
      if (!destinationProject) return reply.code(404).send({ ok: false, code: "WHITEBOARD_PROJECT_NOT_FOUND", error: "The snapshot destination project no longer exists." });
      if (!(await enforceTargetAccess(request, reply, "whiteboard", accessWhiteboard.id, destinationProject, "contribute"))) return;
    }
    const user = await getCurrentUser(request);
    try {
      const result = await prisma.$transaction(async (tx: any) => {
        const current = await tx.whiteboard.findUnique({ where: { id: params.whiteboardId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
        if (!current) throw new WhiteboardOperationError("WHITEBOARD_NOT_FOUND", "Whiteboard not found.", 404);
        const snapshotRow = await tx.whiteboardSnapshot.findUnique({ where: { whiteboardId_sequence: { whiteboardId: current.id, sequence: params.sequence } } });
        if (!snapshotRow) throw new WhiteboardOperationError("WHITEBOARD_SNAPSHOT_NOT_FOUND", "Whiteboard snapshot not found.", 404);
        const beforeState = {
          elements: parseArray(current.elements), categories: parseArray(current.categories), labels: parseArray(current.labels), productionLinks: parseRecord(current.productionLinks),
          settings: { name: current.name, description: current.description, projectId: current.projectId || null, backgroundColor: current.backgroundColor, gridColor: current.gridColor, gridStyle: current.gridStyle, canvasWidth: current.canvasWidth, canvasHeight: current.canvasHeight },
        };
        await tx.whiteboardSnapshot.upsert({
          where: { whiteboardId_sequence: { whiteboardId: current.id, sequence: Number(current.operationSequence || 0) } },
          create: { whiteboardId: current.id, sequence: Number(current.operationSequence || 0), revision: Number(current.revision || 1), elements: JSON.stringify(beforeState.elements), categories: JSON.stringify(beforeState.categories), labels: JSON.stringify(beforeState.labels), productionLinks: JSON.stringify(beforeState.productionLinks), settings: JSON.stringify(beforeState.settings) },
          update: { revision: Number(current.revision || 1), elements: JSON.stringify(beforeState.elements), categories: JSON.stringify(beforeState.categories), labels: JSON.stringify(beforeState.labels), productionLinks: JSON.stringify(beforeState.productionLinks), settings: JSON.stringify(beforeState.settings) },
        });
        const restoredSnapshot = snapshotPayload(snapshotRow);
        const state = { elements: beforeState.elements.map((element: any) => element && typeof element === "object" ? { ...element } : element), settings: { ...beforeState.settings, categories: beforeState.categories, labels: beforeState.labels, productionLinks: beforeState.productionLinks } };
        const operation = { id: `wbop-restore-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`, kind: "snapshot.restore" as const, payload: { snapshot: restoredSnapshot } };
        applyOperation(state, operation as any, true);
        const nextSequence = Number(current.operationSequence || 0) + 1;
        const nextRevision = Number(current.revision || 1) + 1;
        const updated = await tx.whiteboard.updateMany({
          where: { id: current.id, revision: current.revision, operationSequence: current.operationSequence },
          data: {
            name: state.settings.name, description: state.settings.description, projectId: state.settings.projectId || null, elements: JSON.stringify(state.elements), categories: JSON.stringify(state.settings.categories || []), labels: JSON.stringify(state.settings.labels || []), productionLinks: JSON.stringify(state.settings.productionLinks || {}),
            backgroundColor: state.settings.backgroundColor, gridColor: state.settings.gridColor, gridStyle: state.settings.gridStyle, canvasWidth: state.settings.canvasWidth, canvasHeight: state.settings.canvasHeight, operationSequence: nextSequence, revision: { increment: 1 },
          },
        });
        if (!updated.count) throw new WhiteboardOperationError("WHITEBOARD_OPERATION_RACE", "The Whiteboard changed while the snapshot was being restored. Retry from the latest history.", 409);
        await tx.whiteboardOperation.create({ data: { id: operation.id, whiteboardId: current.id, sequence: nextSequence, actorUserId: user?.id || null, clientId: null, kind: operation.kind, targets: JSON.stringify(["$document"]), payload: JSON.stringify(operation.payload), baseSequence: current.operationSequence } });
        await tx.whiteboardSnapshot.upsert({
          where: { whiteboardId_sequence: { whiteboardId: current.id, sequence: nextSequence } },
          create: { whiteboardId: current.id, sequence: nextSequence, revision: nextRevision, elements: JSON.stringify(state.elements), categories: JSON.stringify(state.settings.categories || []), labels: JSON.stringify(state.settings.labels || []), productionLinks: JSON.stringify(state.settings.productionLinks || {}), settings: JSON.stringify({ name: state.settings.name, description: state.settings.description, projectId: state.settings.projectId || null, backgroundColor: state.settings.backgroundColor, gridColor: state.settings.gridColor, gridStyle: state.settings.gridStyle, canvasWidth: state.settings.canvasWidth, canvasHeight: state.settings.canvasHeight }) },
          update: {},
        });
        const whiteboard = await tx.whiteboard.findUniqueOrThrow({ where: { id: current.id }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
        return { whiteboard, nextSequence, operationId: operation.id };
      });
      collaborationRuntime.scheduleBroadcast("whiteboard", params.whiteboardId, true);
      await logActivity?.({ userId: user?.id || null, projectId: result.whiteboard.projectId || null, whiteboardId: result.whiteboard.id, type: "whiteboard_snapshot_restored", entityType: "whiteboard", entityId: result.whiteboard.id, title: "Whiteboard snapshot restored", message: `Restored sequence ${params.sequence}`, metadata: { restoredSequence: params.sequence, newSequence: result.nextSequence, operationId: result.operationId } });
      return { ok: true, restoredSequence: params.sequence, currentSequence: result.nextSequence, whiteboard: serializeWhiteboard(result.whiteboard) };
    } catch (error: any) {
      if (error instanceof WhiteboardOperationError) return reply.code(error.status).send({ ok: false, code: error.code, error: error.message, ...(error.metadata ? { metadata: error.metadata } : {}) });
      throw error;
    }
  });

  app.post("/api/whiteboards/:whiteboardId/operations", async (request: any, reply: any) => {
    const params = z.object({ whiteboardId: z.string().min(1) }).parse(request.params);
    const body = batchSchema.parse(request.body || {});
    const accessWhiteboard = await whiteboardAccess(request, reply, params.whiteboardId, "contribute"); if (!accessWhiteboard) return;
    const user = await getCurrentUser(request);
    const canManage = await canManageWhiteboard(request, accessWhiteboard);
    const requestedProjectIds = uniqueStrings(body.operations.flatMap((operation) => {
      if (operation.kind === "settings.patch") {
        const patch = operation.payload?.patch;
        if (!patch || typeof patch !== "object" || Array.isArray(patch) || !("projectId" in patch)) return [];
        const value = (patch as Record<string, unknown>).projectId;
        return value == null || String(value).trim() === "" ? [""] : [String(value)];
      }
      if (operation.kind === "snapshot.restore") {
        const snapshot = operation.payload?.snapshot;
        const settings = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? (snapshot as Record<string, any>).settings : null;
        if (!settings || typeof settings !== "object" || Array.isArray(settings) || !("projectId" in settings)) return [];
        const value = (settings as Record<string, unknown>).projectId;
        return value == null || String(value).trim() === "" ? [""] : [String(value)];
      }
      return [];
    }));
    if (requestedProjectIds.some((projectId) => projectId !== String(accessWhiteboard.projectId || ""))) {
      if (!canManage) return reply.code(403).send({ ok: false, code: "WHITEBOARD_PROJECT_MOVE_REQUIRES_MANAGE", error: "Moving a Whiteboard between project scopes requires manage access." });
      for (const projectId of requestedProjectIds) {
        if (!projectId || projectId === String(accessWhiteboard.projectId || "")) continue;
        const destinationProject = await prisma.project.findUnique({ where: { id: projectId } });
        if (!destinationProject) return reply.code(404).send({ ok: false, code: "WHITEBOARD_PROJECT_NOT_FOUND", error: "The destination project does not exist." });
        if (!(await enforceTargetAccess(request, reply, "whiteboard", accessWhiteboard.id, destinationProject, "contribute"))) return;
      }
    }
    const operationIds = body.operations.map((operation) => operation.id);
    if (new Set(operationIds).size !== operationIds.length) return reply.code(400).send({ ok: false, code: "WHITEBOARD_OPERATION_ID_DUPLICATE", error: "Operation ids must be unique within a batch." });

    try {
      const result = await prisma.$transaction(async (tx: any) => {
        const current = await tx.whiteboard.findUnique({ where: { id: params.whiteboardId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
        if (!current) throw new WhiteboardOperationError("WHITEBOARD_NOT_FOUND", "Whiteboard not found.", 404);
        const existing = await tx.whiteboardOperation.findMany({ where: { id: { in: operationIds } }, select: { id: true, whiteboardId: true, sequence: true } });
        const foreign = existing.find((operation: any) => operation.whiteboardId !== current.id);
        if (foreign) throw new WhiteboardOperationError("WHITEBOARD_OPERATION_ID_REUSED", "An operation id already belongs to another Whiteboard.", 409, { operationId: foreign.id });
        const existingIds = new Set(existing.map((operation: any) => String(operation.id)));
        const fresh = body.operations.filter((operation) => !existingIds.has(operation.id));
        if (!fresh.length) return { whiteboard: current, applied: [], reused: true, currentSequence: current.operationSequence };

        if (body.baseSequence > Number(current.operationSequence || 0)) throw new WhiteboardOperationError("WHITEBOARD_SEQUENCE_AHEAD", "The client Whiteboard sequence is ahead of the server.", 409, { currentSequence: current.operationSequence });
        if (body.baseSequence < Number(current.operationSequence || 0)) {
          const oldestRetained = await tx.whiteboardOperation.findFirst({ where: { whiteboardId: current.id }, orderBy: { sequence: "asc" }, select: { sequence: true } });
          if (!oldestRetained || body.baseSequence < Number(oldestRetained.sequence) - 1) {
            throw new WhiteboardOperationError("WHITEBOARD_SEQUENCE_COMPACTED", "The client Whiteboard sequence is older than the retained operation history. Refresh the authoritative snapshot before replaying local changes.", 409, { currentSequence: current.operationSequence, oldestRetainedSequence: oldestRetained?.sequence ?? null });
          }
          const concurrent = await tx.whiteboardOperation.findMany({ where: { whiteboardId: current.id, sequence: { gt: body.baseSequence } }, select: { id: true, sequence: true, targets: true, kind: true }, orderBy: { sequence: "asc" }, take: 5000 });
          const incomingTargets = operationConflictTargets(fresh);
          const incomingDocumentWide = incomingTargets.has("$document");
          const collisions = concurrent.filter((operation: any) => {
            const targets = parseArray(operation.targets).map(String);
            return incomingDocumentWide || targets.includes("$document") || targets.some((target) => incomingTargets.has(target));
          });
          if (collisions.length) throw new WhiteboardOperationError("WHITEBOARD_OPERATION_CONFLICT", "Another collaborator changed the same Whiteboard object. Refresh or replay against the latest state.", 409, { currentSequence: current.operationSequence, conflictingOperations: collisions.slice(0, 25) });
        }

        const state = {
          elements: parseArray(current.elements).map((element) => element && typeof element === "object" ? { ...element } : element),
          settings: {
            name: current.name, description: current.description, projectId: current.projectId || null, categories: parseArray(current.categories), labels: parseArray(current.labels), productionLinks: parseRecord(current.productionLinks),
            backgroundColor: current.backgroundColor, gridColor: current.gridColor, gridStyle: current.gridStyle, canvasWidth: current.canvasWidth, canvasHeight: current.canvasHeight,
          } as Record<string, any>,
        };
        const historyCaptures: Array<ReturnType<typeof captureWhiteboardHistory>> = [];
        for (const operation of fresh) {
          const targets = targetIds(operation);
          const before = state.elements.map((element: any) => element && typeof element === "object" ? { ...element } : element);
          applyOperation(state, operation, canManage);
          historyCaptures.push(user?.id ? captureWhiteboardHistory(operation.kind, targets, before, state.elements) : null);
        }
        const nextSequence = Number(current.operationSequence || 0) + fresh.length;
        const updated = await tx.whiteboard.updateMany({
          where: { id: current.id, revision: current.revision, operationSequence: current.operationSequence },
          data: {
            name: state.settings.name, description: state.settings.description, projectId: state.settings.projectId || null, elements: JSON.stringify(state.elements), categories: JSON.stringify(state.settings.categories || []), labels: JSON.stringify(state.settings.labels || []), productionLinks: JSON.stringify(state.settings.productionLinks || {}),
            backgroundColor: state.settings.backgroundColor, gridColor: state.settings.gridColor, gridStyle: state.settings.gridStyle, canvasWidth: state.settings.canvasWidth, canvasHeight: state.settings.canvasHeight,
            operationSequence: nextSequence, revision: { increment: 1 },
          },
        });
        if (!updated.count) throw new WhiteboardOperationError("WHITEBOARD_OPERATION_RACE", "The Whiteboard changed while this operation batch was being applied. Retry against the latest sequence.", 409);
        await tx.whiteboardOperation.createMany({ data: fresh.map((operation, index) => ({
          id: operation.id, whiteboardId: current.id, sequence: Number(current.operationSequence || 0) + index + 1,
          actorUserId: user?.id || null, clientId: body.clientId || null, kind: operation.kind,
          targets: JSON.stringify(targetIds(operation)), payload: JSON.stringify(operation.payload || {}), baseSequence: body.baseSequence,
          historyBefore: historyCaptures[index]?.before ?? null, historyAfter: historyCaptures[index]?.after ?? null,
        })) });
        const nextRevision = Number(current.revision || 1) + 1;
        const crossedSnapshotBoundary = Math.floor(Number(current.operationSequence || 0) / 50) < Math.floor(nextSequence / 50);
        if (crossedSnapshotBoundary || nextSequence === fresh.length) {
          await tx.whiteboardSnapshot.upsert({ where: { whiteboardId_sequence: { whiteboardId: current.id, sequence: nextSequence } }, create: { whiteboardId: current.id, sequence: nextSequence, revision: nextRevision, elements: JSON.stringify(state.elements), categories: JSON.stringify(state.settings.categories || []), labels: JSON.stringify(state.settings.labels || []), productionLinks: JSON.stringify(state.settings.productionLinks || {}), settings: JSON.stringify({ name: state.settings.name, description: state.settings.description, projectId: state.settings.projectId || null, backgroundColor: state.settings.backgroundColor, gridColor: state.settings.gridColor, gridStyle: state.settings.gridStyle, canvasWidth: state.settings.canvasWidth, canvasHeight: state.settings.canvasHeight }) }, update: {} });
          if (nextSequence > 750) await tx.whiteboardOperation.deleteMany({ where: { whiteboardId: current.id, sequence: { lt: nextSequence - 500 } } });
        }
        const whiteboard = await tx.whiteboard.findUniqueOrThrow({ where: { id: current.id }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
        return { whiteboard, applied: fresh.map((operation, index) => ({ id: operation.id, kind: operation.kind, sequence: Number(current.operationSequence || 0) + index + 1 })), reused: false, currentSequence: nextSequence };
      });

      collaborationRuntime.scheduleBroadcast("whiteboard", params.whiteboardId, true);
      if (!result.reused) await logActivity?.({ userId: user?.id || null, projectId: result.whiteboard.projectId || null, whiteboardId: result.whiteboard.id, type: "whiteboard_operations", entityType: "whiteboard", entityId: result.whiteboard.id, title: "Whiteboard changed", message: `${result.applied.length} collaborative operation${result.applied.length === 1 ? "" : "s"} applied`, metadata: { operationIds: result.applied.map((operation: any) => operation.id), kinds: [...new Set(result.applied.map((operation: any) => operation.kind))], sequence: result.currentSequence } });
      return { ok: true, reused: result.reused, applied: result.applied, currentSequence: result.currentSequence, whiteboard: serializeWhiteboard(result.whiteboard) };
    } catch (error: any) {
      if (error instanceof WhiteboardOperationError) return reply.code(error.status).send({ ok: false, code: error.code, error: error.message, ...(error.metadata ? { metadata: error.metadata } : {}) });
      throw error;
    }
  });
}

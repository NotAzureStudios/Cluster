/**
 * Board List metadata history, persisted with each successful revision CAS.
 * List completion flags affect every Card's lifecycle and remain deliberately
 * non-reversible here. Deletion, creation and reordering are also excluded;
 * those operations must have separate dependency-aware restoration contracts.
 */
export const LIST_HISTORY_FIELDS = ["title", "description", "color", "wipLimit", "collapsed", "assignedUserIds"] as const;
export type ListHistoryField = typeof LIST_HISTORY_FIELDS[number];
const HISTORY_LIMIT_BYTES = 32 * 1024;
const allowed = new Set<string>(LIST_HISTORY_FIELDS);
export class BoardListHistoryError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message); }
}
function parseMembers(raw: unknown): string[] {
  try {
    const value = Array.isArray(raw) ? raw : JSON.parse(String(raw || "[]"));
    if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) throw Error();
    return value;
  } catch { throw new BoardListHistoryError("LIST_HISTORY_CORRUPT", "Column membership data is not valid."); }
}
export function snapshotList(row: Record<string, any>, fields: readonly ListHistoryField[]) {
  return Object.fromEntries(fields.map((key) => [key, key === "assignedUserIds" ? parseMembers(row[key]) : row[key] ?? null]));
}
export function listHistoryCapabilities(row: any, currentRevision: number, actorUserId: string) {
  const owned = Boolean(row && row.actorUserId === actorUserId && row.appliedRevision === currentRevision);
  return { canUndo: owned && ["update", "redo", "reorder", "redo_reorder"].includes(row.action), canRedo: owned && ["undo", "undo_reorder"].includes(row.action) };
}
function parseOperation(row: any): { fields: ListHistoryField[]; before: Record<string, any>; after: Record<string, any> } {
  let fields: string[], before: Record<string, any>, after: Record<string, any>;
  try { fields = JSON.parse(row.fields); before = JSON.parse(row.before); after = JSON.parse(row.after); }
  catch { throw new BoardListHistoryError("LIST_HISTORY_CORRUPT", "Column history could not be decoded."); }
  if (!Array.isArray(fields) || !fields.length || new Set(fields).size !== fields.length || fields.some((key) => !allowed.has(key)) ||
      !before || typeof before !== "object" || Array.isArray(before) || !after || typeof after !== "object" || Array.isArray(after) ||
      fields.some((key) => !(key in before) || !(key in after))) {
    throw new BoardListHistoryError("LIST_HISTORY_CORRUPT", "Column history contains invalid fields.");
  }
  return { fields: fields as ListHistoryField[], before, after };
}
function patchFromSnapshot(snapshot: Record<string, any>, fields: ListHistoryField[]) {
  const patch: Record<string, any> = {};
  for (const key of fields) {
    if (!(key in snapshot)) throw new BoardListHistoryError("LIST_HISTORY_CORRUPT", "Column history is missing a field.");
    const value = snapshot[key];
    if (key === "assignedUserIds") {
      if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) throw new BoardListHistoryError("LIST_HISTORY_CORRUPT", "Column membership history is invalid.");
      patch[key] = JSON.stringify(value);
    } else patch[key] = value;
  }
  return patch;
}
export async function saveListWithHistory(prisma: any, listId: string, revision: number, body: Record<string, any>, actorUserId?: string | null) {
  try { return await prisma.$transaction(async (tx: any) => {
    const beforeRow = await tx.boardList.findUnique({ where: { id: listId } });
    if (!beforeRow || beforeRow.revision !== revision || beforeRow.archived) return { count: 0 };
    const data: Record<string, any> = { revision: { increment: 1 } };
    for (const key of LIST_HISTORY_FIELDS) if (body[key] !== undefined) {
      data[key] = key === "assignedUserIds" ? JSON.stringify(body[key]) : body[key];
    }
    if (body.isDone !== undefined) data.isDone = body.isDone;
    const saved = await tx.boardList.updateMany({ where: { id: listId, revision }, data });
    if (saved.count !== 1) return { count: 0 };
    if (body.isDone !== undefined && body.isDone !== beforeRow.isDone) {
      const now = new Date();
      await tx.card.updateMany({ where: { listId, archived: false },
        data: { completedAt: body.isDone ? now : null, stateEnteredAt: now, revision: { increment: 1 } } });
    }
    const afterRow = await tx.boardList.findUniqueOrThrow({ where: { id: listId } });
    const candidates = LIST_HISTORY_FIELDS.filter((key) => body[key] !== undefined);
    const previous = snapshotList(beforeRow, candidates), next = snapshotList(afterRow, candidates);
    const fields = candidates.filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
    const beforeJson = JSON.stringify(Object.fromEntries(fields.map((key) => [key, previous[key]])));
    const afterJson = JSON.stringify(Object.fromEntries(fields.map((key) => [key, next[key]])));
    const barrier = (body.isDone !== undefined && body.isDone !== beforeRow.isDone) ||
      Buffer.byteLength(beforeJson, "utf8") > HISTORY_LIMIT_BYTES || Buffer.byteLength(afterJson, "utf8") > HISTORY_LIMIT_BYTES;
    if (fields.length || barrier) await tx.boardListSavedOperation.create({ data: {
      listId, actorUserId: actorUserId || null, action: barrier ? "barrier" : "update", appliedRevision: afterRow.revision,
      fields: JSON.stringify(fields), before: barrier ? "{}" : beforeJson, after: barrier ? "{}" : afterJson,
    } });
    return saved;
  }, { isolationLevel: "Serializable" }); }
  catch (error) {
    if ((error as any)?.code === "P2034") return { count: 0 };
    throw error;
  }
}
/** List reorder is a two-target atomic history operation. Both revisions are
 * checked again inside the transaction; an unrelated move breaks reversal. */
export async function swapBoardListsWithHistory(prisma: any, list: any, target: any, actorUserId?: string | null): Promise<boolean> {
  if (!list || !target || list.archived || target.archived || list.id === target.id || list.boardId !== target.boardId ||
      !Number.isSafeInteger(list.position) || !Number.isSafeInteger(target.position)) return false;
  try {
    await prisma.$transaction(async (tx: any) => {
      const first = await tx.boardList.updateMany({ where: { id: list.id, boardId: list.boardId, revision: list.revision, position: list.position },
        data: { position: target.position, revision: { increment: 1 } } });
      if (first.count !== 1) throw new BoardListHistoryError("LIST_HISTORY_RACE", "Column changed during reorder.");
      const second = await tx.boardList.updateMany({ where: { id: target.id, boardId: target.boardId, revision: target.revision, position: target.position },
        data: { position: list.position, revision: { increment: 1 } } });
      if (second.count !== 1) throw new BoardListHistoryError("LIST_HISTORY_RACE", "Neighboring column changed during reorder.");
      await tx.boardListSavedOperation.create({ data: {
        listId: list.id, actorUserId: actorUserId || null, action: "reorder", appliedRevision: list.revision + 1,
        fields: JSON.stringify(["position"]),
        before: JSON.stringify({ position: list.position, partnerId: target.id, partnerRevision: target.revision + 1 }),
        after: JSON.stringify({ position: target.position, partnerId: target.id, partnerRevision: target.revision + 1 }),
      } });
    }, { isolationLevel: "Serializable" });
    return true;
  } catch (error) {
    if (error instanceof BoardListHistoryError && error.code === "LIST_HISTORY_RACE" || (error as any)?.code === "P2034") return false;
    throw error;
  }
}

export async function listBoardListSavedHistory(prisma: any, listId: string, actorUserId: string) {
  const list = await prisma.boardList.findUnique({ where: { id: listId }, select: { revision: true } });
  if (!list) throw new BoardListHistoryError("LIST_NOT_FOUND", "Column no longer exists.", 404);
  const rows = await prisma.boardListSavedOperation.findMany({ where: { listId }, orderBy: { appliedRevision: "desc" }, take: 20,
    select: { id: true, actorUserId: true, action: true, fields: true, appliedRevision: true, sourceOperationId: true, createdAt: true } });
  return { currentRevision: list.revision, ...listHistoryCapabilities(rows[0], list.revision, actorUserId),
    operations: rows.map((row: any) => ({ id: row.id, action: row.action, actorUserId: row.actorUserId,
      fields: JSON.parse(row.fields), appliedRevision: row.appliedRevision,
      sourceOperationId: row.sourceOperationId, createdAt: row.createdAt })) };
}
export async function reverseListSavedOperation(prisma: any, input: { listId: string; actorUserId: string; operationId: string; expectedRevision: number; action: "undo" | "redo" }) {
  try { return await prisma.$transaction(async (tx: any) => {
    const list = await tx.boardList.findUnique({ where: { id: input.listId } });
    if (!list) throw new BoardListHistoryError("LIST_NOT_FOUND", "Column no longer exists.", 404);
    if (list.revision !== input.expectedRevision) throw new BoardListHistoryError("LIST_HISTORY_STALE", "Column changed. Refresh before reversing its saved edit.");
    const row = await tx.boardListSavedOperation.findFirst({ where: { listId: list.id }, orderBy: { appliedRevision: "desc" } });
    if (!row || row.id !== input.operationId || row.actorUserId !== input.actorUserId || row.appliedRevision !== list.revision) {
      throw new BoardListHistoryError("LIST_HISTORY_NOT_REVERSIBLE", "Only your latest uninterrupted column metadata edit can be reversed.");
    }
    if (["reorder", "undo_reorder", "redo_reorder"].includes(row.action)) {
      if (!(input.action === "undo" ? ["reorder", "redo_reorder"].includes(row.action) : row.action === "undo_reorder")) {
        throw new BoardListHistoryError("LIST_HISTORY_WRONG_DIRECTION", "Column ordering is not reversible in this direction.");
      }
      let before: any, after: any;
      try {
        if (JSON.stringify(JSON.parse(row.fields)) !== JSON.stringify(["position"])) throw Error();
        before = JSON.parse(row.before); after = JSON.parse(row.after);
      } catch { throw new BoardListHistoryError("LIST_HISTORY_CORRUPT", "Column ordering history is invalid."); }
      if (!Number.isSafeInteger(before.position) || !Number.isSafeInteger(after.position) ||
          !Number.isSafeInteger(after.partnerRevision) || typeof after.partnerId !== "string" ||
          after.partnerId === list.id || before.partnerId !== after.partnerId) {
        throw new BoardListHistoryError("LIST_HISTORY_CORRUPT", "Column ordering history has invalid targets.");
      }
      const partner = await tx.boardList.findUnique({ where: { id: after.partnerId } });
      if (!partner || partner.boardId !== list.boardId || partner.revision !== after.partnerRevision ||
          partner.position !== before.position || list.position !== after.position) {
        throw new BoardListHistoryError("LIST_HISTORY_DIVERGED", "Another editor changed the adjacent column. Reload before reversing its order.");
      }
      const first = await tx.boardList.updateMany({ where: { id: list.id, boardId: list.boardId, revision: list.revision, position: after.position },
        data: { position: before.position, revision: { increment: 1 } } });
      const second = await tx.boardList.updateMany({ where: { id: partner.id, boardId: partner.boardId, revision: partner.revision, position: partner.position },
        data: { position: after.position, revision: { increment: 1 } } });
      if (first.count !== 1 || second.count !== 1) throw new BoardListHistoryError("LIST_HISTORY_RACE", "Column order changed during reversal.");
      await tx.boardListSavedOperation.create({ data: {
        listId: list.id, actorUserId: input.actorUserId,
        action: input.action === "undo" ? "undo_reorder" : "redo_reorder",
        appliedRevision: list.revision + 1, sourceOperationId: row.sourceOperationId || row.id,
        fields: JSON.stringify(["position"]),
        before: JSON.stringify({ position: after.position, partnerId: partner.id, partnerRevision: partner.revision + 1 }),
        after: JSON.stringify({ position: before.position, partnerId: partner.id, partnerRevision: partner.revision + 1 }),
      } });
      return { listId: list.id, boardId: list.boardId, revision: list.revision + 1, changedFields: ["position"], action: input.action };
    }
    if (!(input.action === "undo" ? ["update", "redo"].includes(row.action) : row.action === "undo")) {
      throw new BoardListHistoryError("LIST_HISTORY_WRONG_DIRECTION", "The latest column edit cannot be reversed in that direction.");
    }
    const { fields, before, after } = parseOperation(row);
    const current = snapshotList(list, fields);
    if (fields.some((field) => JSON.stringify(current[field]) !== JSON.stringify(after[field]))) {
      throw new BoardListHistoryError("LIST_HISTORY_DIVERGED", "Column data has diverged from saved history.");
    }
    const saved = await tx.boardList.updateMany({ where: { id: list.id, revision: list.revision },
      data: { ...patchFromSnapshot(before, fields), revision: { increment: 1 } } });
    if (saved.count !== 1) throw new BoardListHistoryError("LIST_HISTORY_RACE", "Column was edited during history restoration.");
    await tx.boardListSavedOperation.create({ data: {
      listId: list.id, actorUserId: input.actorUserId, action: input.action, appliedRevision: list.revision + 1,
      sourceOperationId: row.sourceOperationId || row.id, fields: JSON.stringify(fields),
      before: JSON.stringify(current), after: JSON.stringify(before),
    } });
    return { listId: list.id, boardId: list.boardId, revision: list.revision + 1, changedFields: fields, action: input.action };
  }, { isolationLevel: "Serializable" }); }
  catch (error) {
    if ((error as any)?.code === "P2034") throw new BoardListHistoryError("LIST_HISTORY_RACE", "Another editor changed this column. Refresh before using saved history.");
    throw error;
  }
}

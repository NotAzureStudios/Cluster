/** Canonical Board column lifecycle. Archiving is non-destructive and never hides active work.
 * Serializable transactions plus revision CAS guard against simultaneous Card mutations.
 * Saved history receives a barrier so pre-archive metadata cannot be reversed after restore.
 */
export class BoardListLifecycleError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message); }
}
export async function transitionBoardListLifecycle(prisma: any, input: {
  listId: string; expectedRevision: number; action: "archive" | "restore"; actorUserId?: string | null;
}) {
  try {
    return await prisma.$transaction(async (tx: any) => {
      const list = await tx.boardList.findUnique({ where: { id: input.listId }, include: { board: true } });
      if (!list) throw new BoardListLifecycleError("LIST_NOT_FOUND", "Column does not exist.", 404);
      if (list.revision !== input.expectedRevision) throw new BoardListLifecycleError("LIST_REVISION_CONFLICT", "Column changed. Refresh before continuing.");
      if (list.board.archived) throw new BoardListLifecycleError("BOARD_ARCHIVED", "Restore the Board before changing columns.");
      const archive = input.action === "archive";
      if (list.archived === archive) throw new BoardListLifecycleError("LIST_ALREADY_IN_STATE", "Column already has the requested state.");
      if (archive) {
        const activeCards = await tx.card.count({ where: { listId: list.id, archived: false } });
        if (activeCards) throw new BoardListLifecycleError("LIST_HAS_ACTIVE_WORK", `Move or archive all ${activeCards} active Cards and Tickets before archiving this column. No work was changed.`);
      }
      const written = await tx.boardList.updateMany({ where: { id: list.id, revision: input.expectedRevision, archived: !archive }, data: { archived: archive, revision: { increment: 1 } } });
      if (written.count !== 1) throw new BoardListLifecycleError("LIST_REVISION_CONFLICT", "Column changed during lifecycle update.");
      await tx.boardListSavedOperation.create({ data: { listId: list.id, actorUserId: input.actorUserId || null, action: "barrier", appliedRevision: input.expectedRevision + 1, fields: "[]", before: "{}", after: "{}" } });
      return tx.boardList.findUniqueOrThrow({ where: { id: list.id } });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if ((error as any)?.code === "P2034") throw new BoardListLifecycleError("LIST_REVISION_CONFLICT", "Column changed concurrently. Refresh before continuing.");
    throw error;
  }
}

/** Permanent deletion is reserved for entirely unused columns. Historical work
 * and saved operations are never silently destroyed by cascading relationships.
 */
export async function permanentlyDeleteUnusedList(prisma: any, input: { listId: string; expectedRevision: number; workspaceId: string; projectId: string; boardId: string }) {
  try {
    return await prisma.$transaction(async (tx: any) => {
      const list = await tx.boardList.findUnique({ where: { id: input.listId } });
      if (!list || list.boardId !== input.boardId || list.revision !== input.expectedRevision) throw new BoardListLifecycleError("LIST_REVISION_CONFLICT", "Column changed. Refresh before deleting.");
      const [cards, history] = await Promise.all([tx.card.count({ where: { listId: list.id } }), tx.boardListSavedOperation.count({ where: { listId: list.id } })]);
      if (cards || history) throw new BoardListLifecycleError("LIST_DELETE_BLOCKED", "This column has Cards, Tickets, archived work or saved history. Archive it instead of deleting it.");
      const removed = await tx.boardList.deleteMany({ where: { id: list.id, revision: input.expectedRevision } });
      if (removed.count !== 1) throw new BoardListLifecycleError("LIST_REVISION_CONFLICT", "Column changed. Refresh before deleting.");
      await tx.syncTombstone.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, parentEntityId: input.boardId, entityType: "list", entityId: list.id } });
      return { ok: true };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if ((error as any)?.code === "P2034") throw new BoardListLifecycleError("LIST_REVISION_CONFLICT", "Column changed during deletion.");
    throw error;
  }
}

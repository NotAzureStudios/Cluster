/**
 * Durable Card edit history. Only metadata PATCH writes participate here: moves,
 * checklist edits, deletions and external side effects are not quietly reversible.
 * All snapshots are server-generated, and apply/undo/redo serialize with a Card
 * revision CAS in the same database transaction as the history record.
 */
export const SAVED_CARD_FIELDS = [
  "title", "description", "priority", "ticketStage", "dueDate", "startDate", "deferredUntil",
  "completionCriteria", "labels", "category", "coverColor", "coverImage",
  "estimatePoints", "memberIds", "watcherIds", "assigneeId", "externalUrl", "archived",
] as const;
export type SavedCardField = typeof SAVED_CARD_FIELDS[number];
export type SavedCardSnapshot = Partial<Record<SavedCardField, any>>;
export type SavedCardAction = "update" | "undo" | "redo" | "barrier";
// Avoid duplicating megabyte-scale image payloads for every revision.
const MAX_SAVED_SNAPSHOT_BYTES = 128 * 1024;
const jsonFields = new Set<SavedCardField>(["labels", "memberIds", "watcherIds"]);
const dateFields = new Set<SavedCardField>(["dueDate", "startDate", "deferredUntil"]);
const savedFields = new Set<string>(SAVED_CARD_FIELDS);

export class SavedCardHistoryError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 409) {
    super(message); this.code = code; this.status = status;
  }
}

function jsonArray(value: unknown) {
  if (Array.isArray(value)) return [...value];
  try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

export function snapshotCardFields(card: Record<string, any>, fields: readonly SavedCardField[]): SavedCardSnapshot {
  const result: SavedCardSnapshot = {};
  for (const field of fields) {
    const value = card[field];
    if (jsonFields.has(field)) result[field] = jsonArray(value);
    else if (dateFields.has(field)) result[field] = value ? new Date(value).toISOString() : null;
    else result[field] = value ?? null;
  }
  return result;
}

export function cardSavedChangedFields(before: SavedCardSnapshot, after: SavedCardSnapshot, fields: readonly SavedCardField[]) {
  return fields.filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
}

export function cardSavedPrismaPatch(snapshot: SavedCardSnapshot, fields: readonly SavedCardField[]): Record<string, any> {
  const data: Record<string, any> = {};
  for (const field of fields) {
    const value = snapshot[field];
    if (value === undefined) throw new SavedCardHistoryError("CARD_HISTORY_INVALID", "The saved operation is missing a field snapshot.");
    data[field] = jsonFields.has(field) ? JSON.stringify(value) : dateFields.has(field) && value ? new Date(value) : value;
  }
  return data;
}

function parseSavedOperation(row: any) {
  if (!row) return null;
  let fields: string[]; let before: Record<string, any>; let after: Record<string, any>;
  try { fields = JSON.parse(row.fields); before = JSON.parse(row.before); after = JSON.parse(row.after); }
  catch { throw new SavedCardHistoryError("CARD_HISTORY_INVALID", "Saved edit history cannot be read safely."); }
  if (!Array.isArray(fields) || !fields.length || new Set(fields).size !== fields.length || fields.some((key) => !savedFields.has(key)) ||
      !before || typeof before !== "object" || Array.isArray(before) || !after || typeof after !== "object" || Array.isArray(after)) {
    throw new SavedCardHistoryError("CARD_HISTORY_INVALID", "Saved edit history has an invalid field set.");
  }
  for (const field of fields) {
    if (!(field in before) || !(field in after)) throw new SavedCardHistoryError("CARD_HISTORY_INVALID", "Saved edit history is incomplete.");
  }
  return { ...row, fields: fields as SavedCardField[], before, after };
}

export function savedCardHistoryCapabilities(latest: any, cardRevision: number, actorUserId: string) {
  const eligible = Boolean(latest && latest.actorUserId === actorUserId && latest.appliedRevision === cardRevision);
  return {
    canUndo: eligible && (latest.action === "update" || latest.action === "redo"),
    canRedo: eligible && latest.action === "undo",
  };
}

export async function commitSavedCardUpdate(prisma: any, cardId: string, expectedRevision: number, data: Record<string, any>, actorUserId?: string | null) {
  return prisma.$transaction(async (tx: any) => {
    const beforeCard = await tx.card.findUnique({ where: { id: cardId } });
    if (!beforeCard || beforeCard.revision !== expectedRevision) return { count: 0 };
    const changedCandidateFields = SAVED_CARD_FIELDS.filter((field) => data[field] !== undefined);
    const before = snapshotCardFields(beforeCard, changedCandidateFields);
    const updated = await tx.card.updateMany({ where: { id: cardId, revision: expectedRevision }, data: { ...data, revision: { increment: 1 } } });
    if (!updated.count) return { count: 0 };
    const afterCard = await tx.card.findUniqueOrThrow({ where: { id: cardId } });
    const after = snapshotCardFields(afterCard, changedCandidateFields);
    const fields = cardSavedChangedFields(before, after, changedCandidateFields);
    if (fields.length) {
      const previous = JSON.stringify(snapshotCardFields(beforeCard, fields));
      const next = JSON.stringify(snapshotCardFields(afterCard, fields));
      const reversible = Buffer.byteLength(previous, "utf8") <= MAX_SAVED_SNAPSHOT_BYTES &&
        Buffer.byteLength(next, "utf8") <= MAX_SAVED_SNAPSHOT_BYTES;
      // Non-reversible saves remain explicit history barriers so the UI cannot
      // imply a prior operation is still undoable after large metadata edits.
      await tx.cardSavedOperation.create({ data: {
        cardId, actorUserId: actorUserId || null, action: reversible ? "update" : "barrier", appliedRevision: afterCard.revision,
        fields: JSON.stringify(fields), before: reversible ? previous : "{}", after: reversible ? next : "{}",
      } });
    }
    return updated;
  });
}

export async function listSavedCardHistory(prisma: any, cardId: string, actorUserId: string) {
  const [card, rows] = await Promise.all([
    prisma.card.findUnique({ where: { id: cardId }, select: { revision: true } }),
    prisma.cardSavedOperation.findMany({ where: { cardId }, orderBy: { appliedRevision: "desc" }, take: 40,
      select: { id: true, actorUserId: true, action: true, fields: true, appliedRevision: true, sourceOperationId: true, createdAt: true } }),
  ]);
  if (!card) throw new SavedCardHistoryError("CARD_NOT_FOUND", "Card not found.", 404);
  const latest = rows[0] || null;
  return { currentRevision: card.revision, ...savedCardHistoryCapabilities(latest, card.revision, actorUserId),
    operations: rows.map((row: any) => ({ id: row.id, actorUserId: row.actorUserId, action: row.action,
      fields: JSON.parse(row.fields), appliedRevision: row.appliedRevision, sourceOperationId: row.sourceOperationId, createdAt: row.createdAt })) };
}

export async function reverseSavedCardOperation(prisma: any, input: {
  cardId: string; actorUserId: string; action: "undo" | "redo"; expectedRevision: number; operationId: string;
}) {
  return prisma.$transaction(async (tx: any) => {
    const card = await tx.card.findUnique({ where: { id: input.cardId } });
    if (!card) throw new SavedCardHistoryError("CARD_NOT_FOUND", "Card no longer exists.", 404);
    if (card.revision !== input.expectedRevision) throw new SavedCardHistoryError("CARD_HISTORY_STALE", "Card changed. Reload the current revision before changing saved history.");
    const row = await tx.cardSavedOperation.findFirst({ where: { cardId: input.cardId }, orderBy: { appliedRevision: "desc" } });
    if (!row || row.id !== input.operationId || row.actorUserId !== input.actorUserId || row.appliedRevision !== card.revision) {
      throw new SavedCardHistoryError("CARD_HISTORY_NOT_REVERSIBLE", "Only your latest uninterrupted saved Card edit can be reversed.");
    }
    if (input.action === "undo" ? !["update", "redo"].includes(row.action) : row.action !== "undo") {
      throw new SavedCardHistoryError("CARD_HISTORY_WRONG_DIRECTION", "This edit is not available for that history action.");
    }
    const operation = parseSavedOperation(row)!;
    const fields: SavedCardField[] = operation.fields;
    const currentValues = snapshotCardFields(card, operation.fields);
    if (fields.some((field: SavedCardField) => JSON.stringify(currentValues[field]) !== JSON.stringify(operation.after[field]))) {
      throw new SavedCardHistoryError("CARD_HISTORY_DIVERGED", "A Card field changed outside this saved operation. No changes were applied.");
    }
    const updated = await tx.card.updateMany({ where: { id: card.id, revision: card.revision },
      data: { ...cardSavedPrismaPatch(operation.before, operation.fields), revision: { increment: 1 } } });
    if (!updated.count) throw new SavedCardHistoryError("CARD_HISTORY_RACE", "Another editor changed the Card during Undo/Redo.");
    await tx.cardSavedOperation.create({ data: {
      cardId: card.id, actorUserId: input.actorUserId, action: input.action, appliedRevision: card.revision + 1,
      sourceOperationId: row.sourceOperationId || row.id, fields: JSON.stringify(operation.fields),
      before: JSON.stringify(currentValues), after: JSON.stringify(operation.before),
    } });
    return { cardId: card.id, revision: card.revision + 1, action: input.action, changedFields: operation.fields,
      previousAssigneeId: card.assigneeId || null,
      assigneeId: operation.fields.includes("assigneeId") ? (operation.before.assigneeId || null) : (card.assigneeId || null) };
  });
}

/** Field-aware, explicit three-way merge for Board Card metadata. Never submits a mutation. */
import type { Card } from "../application/application-models";
import type { BoardCardDraft } from "./board-card-draft-history";

export const BOARD_DRAFT_FIELDS = [
  "title", "description", "priority", "assigneeId", "dueDate", "startDate",
  "deferredUntil", "completionCriteria", "category", "coverColor", "coverImage",
  "estimatePoints", "memberIds", "watching", "labels", "externalUrl",
] as const satisfies ReadonlyArray<keyof BoardCardDraft>;
export type BoardDraftField = typeof BOARD_DRAFT_FIELDS[number];
export type BoardConflictChoice = "mine" | "server";
export type BoardDraftConflict = { field: BoardDraftField; original: unknown; mine: unknown; server: unknown };
export type BoardDraftMerge = { proposed: BoardCardDraft; conflicts: BoardDraftConflict[]; localChanges: BoardDraftField[]; serverChanges: BoardDraftField[] };

function dateInput(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}
export function cardToBoardDraft(card: Card, userId: string): BoardCardDraft {
  return {
    title: card.title || "", description: card.description || "", priority: card.priority || "medium",
    assigneeId: card.assigneeId || "", dueDate: dateInput(card.dueDate),
    startDate: dateInput(card.startDate), deferredUntil: dateInput(card.deferredUntil),
    completionCriteria: card.completionCriteria || "", category: card.category || "",
    coverColor: card.coverColor || "", coverImage: card.coverImage || "",
    estimatePoints: card.estimatePoints == null ? "" : String(card.estimatePoints),
    memberIds: [...(card.memberIds || [])], watching: Boolean(card.watcherIds?.includes(userId)),
    labels: (card.labels || []).join(", "), externalUrl: card.externalUrl || "",
  };
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function cloneFieldValue(value: unknown): unknown { return Array.isArray(value) ? [...value] : value; }
function clone(draft: BoardCardDraft): BoardCardDraft { return { ...draft, memberIds: [...draft.memberIds] }; }
/** Labels and Card membership are unordered sets, not atomic scalar fields.
 * Merge membership against the opened baseline, preserving both independent
 * additions and removals. Keep server display order before local additions.
 * A removed member is not silently reintroduced by the other unchanged copy.
 */
function normalizedSet(field: "labels" | "memberIds", value: unknown): string[] {
  const source = field === "labels" ? String(value || "").split(",") : Array.isArray(value) ? value : [];
  return [...new Set(source.map((item) => String(item).trim()).filter(Boolean))];
}
function changedSet(field: "labels" | "memberIds", from: unknown, to: unknown): boolean {
  const old = new Set(normalizedSet(field, from));
  const next = new Set(normalizedSet(field, to));
  return old.size !== next.size || [...old].some((item) => !next.has(item));
}
function mergeSet(field: "labels" | "memberIds", original: unknown, mine: unknown, latest: unknown): string[] | string {
  const base = new Set(normalizedSet(field, original));
  const local = new Set(normalizedSet(field, mine));
  const remote = new Set(normalizedSet(field, latest));
  const merged = [...new Set([...remote, ...local, ...base])].filter((item) =>
    // Each membership bit is a boolean; a changed side wins over an unchanged
    // side, and concurrent changes to the same bit necessarily converge.
    local.has(item) !== base.has(item) ? local.has(item) : remote.has(item));
  return field === "labels" ? merged.join(", ") : merged;
}
export function reviewBoardCardChanges(original: BoardCardDraft, mine: BoardCardDraft, latest: BoardCardDraft): BoardDraftMerge {
  const proposed = clone(latest);
  const conflicts: BoardDraftConflict[] = [];
  const localChanges: BoardDraftField[] = [];
  const serverChanges: BoardDraftField[] = [];
  for (const field of BOARD_DRAFT_FIELDS) {
    const setField = field === "labels" || field === "memberIds" ? field : null;
    const changedHere = setField ? changedSet(setField, original[field], mine[field]) : !same(mine[field], original[field]);
    const changedThere = setField ? changedSet(setField, original[field], latest[field]) : !same(latest[field], original[field]);
    if (changedHere) localChanges.push(field);
    if (changedThere) serverChanges.push(field);
    if (setField && (changedHere || changedThere)) {
      (proposed as unknown as Record<string, unknown>)[field] = mergeSet(setField, original[field], mine[field], latest[field]);
    } else if (changedHere && changedThere && !same(mine[field], latest[field])) {
      conflicts.push({ field, original: original[field], mine: mine[field], server: latest[field] });
    } else if (changedHere) {
      // Nonoverlapping edits, or both sides already reached the same value.
      (proposed as unknown as Record<string, unknown>)[field] = cloneFieldValue(mine[field]);
    }
  }
  return { proposed, conflicts, localChanges, serverChanges };
}
export function resolveBoardCardChanges(
  review: BoardDraftMerge, choices: Partial<Record<BoardDraftField, BoardConflictChoice>>,
): BoardCardDraft | null {
  if (review.conflicts.some(({ field }) => !choices[field])) return null;
  const resolved = clone(review.proposed);
  for (const conflict of review.conflicts) {
    (resolved as unknown as Record<string, unknown>)[conflict.field] = cloneFieldValue(choices[conflict.field] === "mine" ? conflict.mine : conflict.server);
  }
  return resolved;
}
export function describeBoardDraftValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.map(String).join(", ").slice(0, 260) : "(none)";
  if (value === "" || value == null) return "(empty)";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).slice(0, 260);
}

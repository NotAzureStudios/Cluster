/** Session-only, revision-checked Board move history. Server remains authoritative. */
export type BoardCardMoveEntry = {
  cardId: string;
  title: string;
  fromListId: string;
  fromIndex: number;
  toListId: string;
  toIndex: number;
  /** Server revision after the latest successful operation affecting this card. */
  revision: number;
};
export type BoardCardMoveHistory = { undo: BoardCardMoveEntry[]; redo: BoardCardMoveEntry[] };
export const EMPTY_BOARD_MOVE_HISTORY: BoardCardMoveHistory = { undo: [], redo: [] };
const MAX_MOVES = 30;

export function recordBoardCardMove(history: BoardCardMoveHistory, entry: BoardCardMoveEntry): BoardCardMoveHistory {
  // A new user operation starts a new branch; redo cannot replay an abandoned branch.
  return { undo: [...history.undo, entry].slice(-MAX_MOVES), redo: [] };
}

export function completeBoardCardMove(history: BoardCardMoveHistory, direction: "undo" | "redo", cardId: string, revision: number): BoardCardMoveHistory {
  const source = history[direction];
  const moved = source[source.length - 1];
  if (!moved || moved.cardId !== cardId || !Number.isSafeInteger(revision) || revision <= moved.revision) return history;
  const other = direction === "undo" ? "redo" : "undo";
  const remaining = source.slice(0, -1);
  // Earlier moves of *the same card* need the revision produced by our own later move.
  // Do not adopt a revision returned by an unrelated actor or fetch. The server checks
  // expectedRevision atomically, so remotely edited cards cause a safe conflict.
  const update = (entries: BoardCardMoveEntry[]) => entries.map((entry) => entry.cardId === cardId ? { ...entry, revision } : entry);
  return {
    ...history,
    [direction]: update(remaining),
    [other]: [...update(history[other]), { ...moved, revision }].slice(-MAX_MOVES),
  };
}

export function discardConflictedBoardCard(history: BoardCardMoveHistory, cardId: string): BoardCardMoveHistory {
  return { undo: history.undo.filter((entry) => entry.cardId !== cardId), redo: history.redo.filter((entry) => entry.cardId !== cardId) };
}

/** Session move Undo/Redo uses the revision returned by an online write.
 * Paused or competing queued edits make that revision unsuitable for reversal.
 */
export function canReplayBoardSavedMove(input: {
  connection: "connecting" | "live" | "reconnecting" | "polling" | "offline";
  queuedStatuses: string[]; busy: boolean;
}): boolean {
  return !input.busy && (input.connection === "live" || input.connection === "polling")
    && !input.queuedStatuses.some((status) => ["pending", "replaying", "paused", "failed", "conflict"].includes(status));
}

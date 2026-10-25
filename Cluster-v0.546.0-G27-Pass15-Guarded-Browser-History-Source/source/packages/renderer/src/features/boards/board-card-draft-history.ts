/** Bounded in-editor undo/redo for unsaved Board Card metadata. Not a server revision history. */
export type BoardCardDraft = {
  title: string; description: string; priority: string; assigneeId: string;
  dueDate: string; startDate: string; deferredUntil: string; completionCriteria: string;
  category: string; coverColor: string; coverImage: string; estimatePoints: string;
  memberIds: string[]; watching: boolean; labels: string; externalUrl: string;
};
export type BoardCardDraftHistory = { present: BoardCardDraft; undo: BoardCardDraft[]; redo: BoardCardDraft[] };
const MAX_CARD_DRAFT_STEPS = 40;
function clone(draft: BoardCardDraft): BoardCardDraft { return { ...draft, memberIds: [...draft.memberIds] }; }
function same(a: BoardCardDraft, b: BoardCardDraft) { return JSON.stringify(a) === JSON.stringify(b); }
export function startBoardCardDraftHistory(draft: BoardCardDraft): BoardCardDraftHistory {
  return { present: clone(draft), undo: [], redo: [] };
}
export function recordBoardCardDraft(history: BoardCardDraftHistory, draft: BoardCardDraft): BoardCardDraftHistory {
  if (same(history.present, draft)) return history;
  return { present: clone(draft), undo: [...history.undo, clone(history.present)].slice(-MAX_CARD_DRAFT_STEPS), redo: [] };
}
export function traverseBoardCardDraft(history: BoardCardDraftHistory, direction: 'undo' | 'redo'): BoardCardDraftHistory {
  const stack = history[direction];
  if (!stack.length) return history;
  const other = direction === 'undo' ? 'redo' : 'undo';
  return { ...history, present: clone(stack[stack.length - 1]), [direction]: stack.slice(0, -1),
    [other]: [...history[other], clone(history.present)].slice(-MAX_CARD_DRAFT_STEPS) };
}

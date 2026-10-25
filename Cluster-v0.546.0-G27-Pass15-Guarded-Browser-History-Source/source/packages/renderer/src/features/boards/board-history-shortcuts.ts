/** Board history shortcuts own only the board surface, never a native editor.
 * A card dialog may have focus without a text field; modal history remains
 * local to that dialog, and Board move history must not intercept it. */
export function boardHistoryShortcut(input: {
  key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean;
  shiftKey: boolean; editingText: boolean; inDialog: boolean;
}): 'undo' | 'redo' | null {
  if ((!input.ctrlKey && !input.metaKey) || input.altKey || input.editingText || input.inDialog) return null;
  const key = input.key.toLowerCase();
  if (key === 'z') return input.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !input.shiftKey) return 'redo';
  return null;
}

export function boardHistoryTargetContext(target: Element | null): { editingText: boolean; inDialog: boolean } {
  if (!target || typeof target.closest !== 'function') return { editingText: false, inDialog: false };
  return {
    editingText: Boolean(target.closest('input,textarea,select,[contenteditable],[role="textbox"],[role="combobox"]')),
    inDialog: Boolean(target.closest('[role="dialog"],[aria-modal="true"]')),
  };
}

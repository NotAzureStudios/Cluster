/** Canonical keyboard/availability policy for collaborative Whiteboard history.
 * Browser text editing owns Ctrl/Cmd+Z; server-owned history is only available
 * when local drafts, queued work and remote conflicts have been resolved. */
export function whiteboardHistoryShortcut(input: {
  key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean;
  editingText: boolean;
}): "undo" | "redo" | null {
  if ((!input.ctrlKey && !input.metaKey) || input.altKey || input.editingText) return null;
  const key = input.key.toLowerCase();
  if (key === "z") return input.shiftKey ? "redo" : "undo";
  if (key === "y" && !input.shiftKey) return "redo";
  return null;
}

export function canUseWhiteboardHistory(input: {
  saving: boolean; localCount: number; savedAvailable: boolean;
  localDirty: boolean; pendingRemote: boolean; queuedSync: boolean;
}): boolean {
  if (input.saving) return false;
  if (input.localCount > 0) return true;
  return input.savedAvailable && !input.localDirty && !input.pendingRemote && !input.queuedSync;
}

/** Whiteboard shortcuts only own focus inside their workspace and never steal
 * keys from another modal (including confirmation dialogs and overlays). */
export function whiteboardHistoryTargetContext(target: Element | null): { editingText: boolean; inDialog: boolean; inWorkspace: boolean } {
  if (!target || typeof target.closest !== "function") return { editingText: false, inDialog: false, inWorkspace: false };
  return {
    editingText: Boolean(target.closest('input,textarea,select,[contenteditable],[role="textbox"],[role="combobox"]')),
    inDialog: Boolean(target.closest('[role="dialog"],[aria-modal="true"]')),
    inWorkspace: Boolean(target.closest('.cluster-whiteboard-workspace')),
  };
}

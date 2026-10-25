import { useCallback, useMemo, useRef, useState } from "react";

export type ClusterUndoTransaction = {
  id: string;
  label: string;
  undo: () => void | Promise<void>;
  redo?: () => void | Promise<void>;
};

type ClusterUndoEntry = ClusterUndoTransaction & { createdAt: number };

export function useClusterUndoStack({ limit = 40 }: { limit?: number } = {}) {
  const [undoStack, setUndoStack] = useState<ClusterUndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<ClusterUndoEntry[]>([]);
  const busyRef = useRef(false);

  const push = useCallback((transaction: ClusterUndoTransaction) => {
    if (!transaction.id || !transaction.label || typeof transaction.undo !== "function") return;
    setUndoStack((current) => [...current.filter((entry) => entry.id !== transaction.id), { ...transaction, createdAt: Date.now() }].slice(-Math.max(1, limit)));
    setRedoStack([]);
  }, [limit]);

  const undo = useCallback(async () => {
    if (busyRef.current) return false;
    const entry = undoStack.at(-1);
    if (!entry) return false;
    busyRef.current = true;
    try {
      await entry.undo();
      setUndoStack((current) => current.slice(0, -1));
      if (entry.redo) setRedoStack((current) => [...current, entry].slice(-Math.max(1, limit)));
      return true;
    } finally { busyRef.current = false; }
  }, [limit, undoStack]);

  const redo = useCallback(async () => {
    if (busyRef.current) return false;
    const entry = redoStack.at(-1);
    if (!entry?.redo) return false;
    busyRef.current = true;
    try {
      await entry.redo();
      setRedoStack((current) => current.slice(0, -1));
      setUndoStack((current) => [...current, entry].slice(-Math.max(1, limit)));
      return true;
    } finally { busyRef.current = false; }
  }, [limit, redoStack]);

  const clear = useCallback(() => { setUndoStack([]); setRedoStack([]); }, []);
  const state = useMemo(() => ({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, undoLabel: undoStack.at(-1)?.label || null, redoLabel: redoStack.at(-1)?.label || null }), [redoStack, undoStack]);

  return { ...state, push, undo, redo, clear };
}

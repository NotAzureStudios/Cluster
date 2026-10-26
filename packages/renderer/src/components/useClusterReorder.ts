import { useCallback, useMemo, useState, type DragEvent as ReactDragEvent } from "react";

export type ClusterReorderDropPosition = "before" | "after";

export function useClusterReorder({
  ids,
  onReorder,
  canDrop,
  disabled = false,
}: {
  ids: readonly string[];
  onReorder: (activeId: string, targetId: string, position: ClusterReorderDropPosition) => void;
  canDrop?: (activeId: string, targetId: string, position: ClusterReorderDropPosition) => boolean;
  disabled?: boolean;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [target, setTarget] = useState<{ id: string; position: ClusterReorderDropPosition; valid: boolean } | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const index = useMemo(() => new Map(ids.map((id, itemIndex) => [id, itemIndex])), [ids]);

  const allowed = useCallback((activeId: string, targetId: string, position: ClusterReorderDropPosition) => activeId !== targetId && (canDrop ? canDrop(activeId, targetId, position) : true), [canDrop]);

  const move = useCallback((id: string, delta: -1 | 1) => {
    const current = index.get(id);
    if (current == null) return;
    const targetId = ids[current + delta];
    if (!targetId) return;
    const position: ClusterReorderDropPosition = delta < 0 ? "before" : "after";
    if (!allowed(id, targetId, position)) { setStatusMessage("That item cannot be moved there."); return; }
    onReorder(id, targetId, position);
    setStatusMessage(`Moved item ${delta < 0 ? "earlier" : "later"}.`);
  }, [allowed, ids, index, onReorder]);

  const itemProps = useCallback((id: string) => ({
    draggable: !disabled,
    "data-cluster-dragging": draggingId === id || undefined,
    "data-cluster-drop-target": target?.id === id ? target.position : undefined,
    "data-cluster-drop-valid": target?.id === id ? String(target.valid) : undefined,
    "data-motion-purpose": "layout" as const,
    onDragStart: (event: ReactDragEvent<HTMLElement>) => {
      if (disabled) { event.preventDefault(); return; }
      setDraggingId(id);
      setStatusMessage("Move started. Choose a valid destination or use the move buttons.");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
    },
    onDragOver: (event: ReactDragEvent<HTMLElement>) => {
      if (disabled || !draggingId || draggingId === id) return;
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      const position: ClusterReorderDropPosition = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
      const valid = allowed(draggingId, id, position);
      event.dataTransfer.dropEffect = valid ? "move" : "none";
      setTarget({ id, position, valid });
      setStatusMessage(valid ? `Valid destination ${position} this item.` : "That destination is not allowed.");
    },
    onDragLeave: (event: ReactDragEvent<HTMLElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      if (target?.id === id) setTarget(null);
    },
    onDrop: (event: ReactDragEvent<HTMLElement>) => {
      if (disabled) return;
      event.preventDefault();
      const activeId = draggingId || event.dataTransfer.getData("text/plain");
      const position = target?.id === id ? target.position : "before";
      if (activeId && allowed(activeId, id, position)) {
        onReorder(activeId, id, position);
        setStatusMessage("Move complete.");
      } else {
        setStatusMessage("Move cancelled because that destination is not allowed.");
      }
      setDraggingId(null);
      setTarget(null);
    },
    onDragEnd: () => { setDraggingId(null); setTarget(null); },
  }), [allowed, disabled, draggingId, onReorder, target]);

  return { draggingId, dropTarget: target, statusMessage, itemProps, move };
}

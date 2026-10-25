import { useEffect, useRef, type RefObject } from "react";
import { topFloatingForClusterDialog, topVisibleClusterDialog } from "../core/dialog-focus";

export function useClusterDialogInteraction({
  active = true,
  dialogRef,
  onEscape,
  escapeDisabled = false,
}: {
  active?: boolean;
  dialogRef?: RefObject<HTMLElement | null>;
  onEscape?: () => void;
  escapeDisabled?: boolean;
}) {
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const activeElement = document.activeElement;
    returnFocusRef.current = activeElement instanceof HTMLElement && activeElement !== document.body ? activeElement : null;
    return () => {
      window.setTimeout(() => {
        if (topVisibleClusterDialog()) return;
        const target = returnFocusRef.current;
        returnFocusRef.current = null;
        if (target?.isConnected && !target.hasAttribute("disabled") && target.getAttribute("aria-disabled") !== "true") target.focus();
      }, 0);
    };
  }, [active]);

  useEffect(() => {
    if (!active || !onEscape) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || escapeDisabled) return;
      const topDialog = topVisibleClusterDialog();
      if (dialogRef?.current && topDialog && topDialog !== dialogRef.current) return;
      if (topDialog && topFloatingForClusterDialog(topDialog)) return; // Escape closes the menu first.
      if (event.defaultPrevented) return;
      event.preventDefault();
      onEscape();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [active, dialogRef, escapeDisabled, onEscape]);
}

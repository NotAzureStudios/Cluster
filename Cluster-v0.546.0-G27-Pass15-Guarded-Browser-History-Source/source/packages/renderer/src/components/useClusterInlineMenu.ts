import { useEffect, useRef, type KeyboardEvent } from "react";

/** Native-details menus retain their existing workspace markup while sharing dismissal.
 * Use only for short inline action/navigation menus, not disclosure sections. */
export function useClusterInlineMenu() {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  function dismiss(restoreFocus = false) {
    const element = detailsRef.current;
    if (!element?.open) return;
    element.open = false;
    if (restoreFocus) element.querySelector<HTMLElement>("summary")?.focus();
  }

  useEffect(() => {
    function outside(event: PointerEvent) {
      const element = detailsRef.current;
      if (element?.open && event.target instanceof Node && !element.contains(event.target)) dismiss();
    }
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, []);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== "Escape" || !detailsRef.current?.open) return;
    event.preventDefault();
    event.stopPropagation();
    dismiss(true);
  }
  return { detailsRef, dismiss, onMenuKeyDown };
}

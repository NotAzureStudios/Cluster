export const CLUSTER_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export const CLUSTER_MODAL_SELECTOR = "[role='dialog'][aria-modal='true'], [role='alertdialog'][aria-modal='true']";

export function visibleFocusable(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(CLUSTER_FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.closest("[aria-hidden='true'], [inert]")) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && element.getClientRects().length > 0;
  });
}

/** Resolve a dialog owner through either ordinary ancestry or a body-portaled floating
 * surface. Nested floating controls must keep the modal ownership of their trigger. */
export function resolveClusterModalOwner(anchor: HTMLElement | null): HTMLElement | null {
  const direct = anchor?.closest<HTMLElement>(CLUSTER_MODAL_SELECTOR);
  if (direct) return direct;
  const ownerId = anchor?.closest<HTMLElement>("[data-cluster-floating='true'][data-cluster-modal-owner]")?.dataset.clusterModalOwner;
  if (!ownerId) return null;
  const owner = document.getElementById(ownerId);
  return owner instanceof HTMLElement && owner.matches(CLUSTER_MODAL_SELECTOR) ? owner : null;
}

/** Surface visibility and modality are different: inactive layers must be removed
 * from both the keyboard stack and accessibility tree. */
export function visibleClusterFloatingSurfaces(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-cluster-floating='true']"))
    .filter((surface) => surface.getClientRects().length > 0 && !surface.closest('[inert]') && surface.dataset.clusterModalSuspended !== 'true');
}

export function topVisibleClusterDialog() {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>(CLUSTER_MODAL_SELECTOR))
    .filter((dialog) => dialog.getClientRects().length > 0);
  return dialogs.length ? dialogs[dialogs.length - 1] : null;
}

/** The latest owner-linked floating panel participates in the active modal's focus scope.
 * Floating surfaces remain body-portaled so transformed/clipped dialogs cannot
 * create an incorrect fixed-position containing block. */
export function topFloatingForClusterDialog(dialog: HTMLElement): HTMLElement | null {
  if (!dialog.id) return null;
  const floating = visibleClusterFloatingSurfaces().filter((surface) => surface.dataset.clusterModalOwner === dialog.id);
  return floating[floating.length - 1] || null;
}

export function trapFocusInTopClusterDialog(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const dialog = topVisibleClusterDialog();
  if (!dialog) return;
  // A body-portaled listbox/menu opened inside a modal is logically within it.
  const focusScope = topFloatingForClusterDialog(dialog) || dialog;
  const controls = visibleFocusable(focusScope);
  if (!controls.length) {
    event.preventDefault();
    focusScope.focus({ preventScroll: true });
    return;
  }
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && (document.activeElement === first || !focusScope.contains(document.activeElement))) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && (document.activeElement === last || !focusScope.contains(document.activeElement))) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

/** Keyboard traversal for action menus. The enabled item list is obtained from the live DOM. */
export type ClusterMenuNavigationKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

export function nextMenuFocusIndex(key: ClusterMenuNavigationKey, current: number, count: number): number {
  if (count <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return (current + 1 + count) % count;
  return current < 0 ? count - 1 : (current - 1 + count) % count;
}

export function focusMenuItem(surface: HTMLElement | null, key: string): boolean {
  if (!surface || !["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) return false;
  const items = Array.from(surface.querySelectorAll<HTMLButtonElement>('button:is([role="menuitem"],[role="menuitemradio"]):not(:disabled)'));
  if (items.length === 0) return false;
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = nextMenuFocusIndex(key as ClusterMenuNavigationKey, current, items.length);
  items[next]?.focus({ preventScroll: true });
  return true;
}

/** Keep destructive actions visibly separate, without duplicate/leading separators.
 * Actions remain in their declared order so permissions and context are never reshuffled. */
export function actionMenuSeparatorBefore<T extends { danger?: boolean; separatorBefore?: boolean }>(items: readonly T[], index: number): boolean {
  if (index <= 0 || index >= items.length) return false;
  return items[index].separatorBefore === true || (items[index].danger === true && items[index - 1].danger !== true);
}

/** Pointer movement, not event.movementX (unreliable on touch), cancels long press. */
export function movedBeyondLongPress(origin: { x: number; y: number }, point: { x: number; y: number }, distance = 8): boolean {
  return Math.hypot(point.x - origin.x, point.y - origin.y) > distance;
}

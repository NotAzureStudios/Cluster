/** Board Card multi-selection is additive across filtered views but never
 * extends to unknown/stale Board IDs. No Card data or mutation authority lives
 * in this presentation helper. */
export function pruneBoardSelection(
  selected: ReadonlySet<string>,
  currentBoardCardIds: ReadonlySet<string>,
): Set<string> {
  const removed = [...selected].some((id) => !currentBoardCardIds.has(id));
  if (!removed) return selected as Set<string>;
  return new Set([...selected].filter((id) => currentBoardCardIds.has(id)));
}

export function addVisibleBoardSelection(
  selected: ReadonlySet<string>,
  visibleCardIds: readonly string[],
): Set<string> {
  if (visibleCardIds.every((id) => selected.has(id))) return selected as Set<string>;
  return new Set([...selected, ...visibleCardIds]);
}

export function removeVisibleBoardSelection(
  selected: ReadonlySet<string>,
  visibleCardIds: readonly string[],
): Set<string> {
  const toRemove = new Set(visibleCardIds);
  if (![...selected].some((id) => toRemove.has(id))) return selected as Set<string>;
  return new Set([...selected].filter((id) => !toRemove.has(id)));
}

export function countVisibleBoardSelection(
  selected: ReadonlySet<string>,
  visibleCardIds: readonly string[],
): number {
  let count = 0;
  for (const id of visibleCardIds) if (selected.has(id)) count += 1;
  return count;
}

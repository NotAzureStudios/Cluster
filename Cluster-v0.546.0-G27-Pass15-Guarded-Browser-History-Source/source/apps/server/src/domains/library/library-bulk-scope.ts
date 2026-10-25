/** Bounded, read-only traversal of the objects implicitly affected by a folder operation.
 *  The caller supplies an authorization predicate: descendants are never silently assumed editable.
 */
export type LibraryBulkTreeEntry = { id: string; parentId?: string | null; type: string };
export type LibraryBulkScopeResult<T extends LibraryBulkTreeEntry> = {
  descendants: T[];
  hasRestrictedDescendants: boolean;
  hasProtectedDescendants: boolean;
};
export class LibraryBulkScopeLimitError extends Error {
  constructor() { super("This folder selection is too large to review safely. Select a smaller folder group."); }
}
export async function inspectLibraryBulkScope<T extends LibraryBulkTreeEntry>(
  selected: readonly T[],
  childrenForParents: (parentIds: string[], limit: number) => Promise<readonly T[]>,
  canChange: (item: T) => boolean,
  isProtected: (item: T) => boolean,
  maximum = 5000,
): Promise<LibraryBulkScopeResult<T>> {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new LibraryBulkScopeLimitError();
  const visited = new Set(selected.map((item) => item.id));
  let frontier = selected.filter((item) => item.type === "folder").map((item) => item.id);
  const descendants: T[] = [];
  let hasRestrictedDescendants = false;
  let hasProtectedDescendants = false;
  while (frontier.length) {
    const next: string[] = [];
    for (let start = 0; start < frontier.length; start += 100) {
      const group = frontier.slice(start, start + 100);
      const remaining = maximum - descendants.length;
      const children = await childrenForParents(group, remaining + 1);
      if (children.length > remaining) throw new LibraryBulkScopeLimitError();
      for (const item of children) {
        if (!group.includes(String(item.parentId)) || visited.has(item.id)) continue;
        visited.add(item.id);
        descendants.push(item);
        if (!canChange(item)) hasRestrictedDescendants = true;
        if (isProtected(item)) hasProtectedDescendants = true;
        if (item.type === "folder") next.push(item.id);
        if (descendants.length > maximum) throw new LibraryBulkScopeLimitError();
      }
    }
    frontier = next;
  }
  return { descendants, hasRestrictedDescendants, hasProtectedDescendants };
}

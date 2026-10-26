import type { LibraryItem } from "./library-types";

/**
 * Appends a paged Library result without re-scanning the existing page for every
 * incoming item. Existing object identity is preserved and duplicate ids are
 * ignored in server order.
 */
export function mergeLibraryItems(current: LibraryItem[], incoming: LibraryItem[]) {
  if (!incoming.length) return current;
  if (!current.length) return incoming;
  const seen = new Set(current.map((item) => item.id));
  const merged = [...current];
  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

/** Bounded, collection-revision-bound pagination. No user-owned content in cursors. */
export class LibraryCollectionPageError extends Error {
  readonly code: "LIBRARY_COLLECTION_CURSOR_STALE" | "LIBRARY_COLLECTION_CURSOR_INVALID";
  constructor(code: "LIBRARY_COLLECTION_CURSOR_STALE" | "LIBRARY_COLLECTION_CURSOR_INVALID", message: string) { super(message); this.code = code; }
}

export function libraryCollectionOffset(cursor: string | undefined, revision: number): number {
  if (!cursor) return 0;
  const match = /^v(\d+):o(\d+)$/.exec(cursor);
  if (!match) throw new LibraryCollectionPageError("LIBRARY_COLLECTION_CURSOR_INVALID", "Invalid collection cursor.");
  if (Number(match[1]) !== revision) throw new LibraryCollectionPageError("LIBRARY_COLLECTION_CURSOR_STALE", "Collection changed. Refresh from the first page.");
  const offset = Number(match[2]);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw new LibraryCollectionPageError("LIBRARY_COLLECTION_CURSOR_INVALID", "Collection cursor is out of range.");
  return offset;
}

export function libraryCollectionPage<T>(results: readonly T[], offset: number, limit: number, revision: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 250) {
    throw new LibraryCollectionPageError("LIBRARY_COLLECTION_CURSOR_INVALID", "Invalid collection page.");
  }
  const hasMore = results.length > limit;
  return {
    entries: results.slice(0, limit),
    pagination: { cursor: hasMore ? `v${revision}:o${offset + limit}` : null, hasMore, limit },
  };
}

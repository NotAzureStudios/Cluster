import { decodeCursor, encodeCursor, type CursorPage, type CursorPosition } from "./cursor-pagination.js";

export type AuthorizedCursorPage<T> = CursorPage<T> & {
  scanned: number;
  scanBounded: boolean;
};

/**
 * Fills a permission-filtered keyset page without turning authorization into an
 * offset. The continuation token may advance past invisible records, but never
 * skips a record that passed `isVisible`.
 */
export async function scanAuthorizedCursorPage<T extends Record<string, any>>(input: {
  cursor?: string | null;
  limit: number;
  field: string;
  direction?: "asc" | "desc";
  batchSize?: number;
  maxBatches?: number;
  loadPage: (cursor: CursorPosition | null, limit: number) => Promise<CursorPage<T>>;
  isVisible: (row: T) => boolean | Promise<boolean>;
}): Promise<AuthorizedCursorPage<T>> {
  const limit = Math.max(1, Math.round(input.limit));
  const batchSize = Math.max(limit, Math.min(500, Math.round(input.batchSize || Math.max(limit, 80))));
  const maxBatches = Math.max(1, Math.min(100, Math.round(input.maxBatches || 24)));
  let cursor = decodeCursor(input.cursor);
  let scanned = 0;
  const rows: T[] = [];
  let lastScanned: T | null = null;
  let lastReturned: T | null = null;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const page = await input.loadPage(cursor, batchSize);
    for (const row of page.items) {
      scanned += 1;
      lastScanned = row;
      if (!(await input.isVisible(row))) continue;
      if (rows.length < limit) {
        rows.push(row);
        lastReturned = row;
        continue;
      }
      return {
        items: rows,
        nextCursor: lastReturned ? encodeCursor({ at: lastReturned[input.field], id: String(lastReturned.id) }) : null,
        hasMore: true,
        scanned,
        scanBounded: false,
      };
    }

    if (!page.hasMore || !page.nextCursor) {
      return { items: rows, nextCursor: null, hasMore: false, scanned, scanBounded: false };
    }
    cursor = decodeCursor(page.nextCursor);
  }

  // Permission-sparse datasets are deliberately bounded. Continuing after the
  // last scanned raw row is safe because every skipped row was authorization-
  // checked during this request.
  return {
    items: rows,
    nextCursor: lastScanned ? encodeCursor({ at: lastScanned[input.field], id: String(lastScanned.id) }) : null,
    hasMore: Boolean(lastScanned),
    scanned,
    scanBounded: true,
  };
}

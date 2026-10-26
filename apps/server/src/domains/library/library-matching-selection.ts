/** Server-owned selection of a bounded search result, independent of renderer pagination. */
export type LibraryMatchingItem = { id: string; revision: number };
export type LibraryMatchingSelectionInput<T extends LibraryMatchingItem> = {
  fetchPage: (skip: number, take: number) => Promise<readonly T[]>;
  filterVisible: (rows: readonly T[]) => Promise<readonly T[]>;
  maximumSelected?: number;
};
export class LibraryMatchingSelectionError extends Error {
  readonly code: "LIBRARY_MATCHING_TOO_LARGE" | "LIBRARY_MATCHING_SCAN_LIMIT";
  constructor(code: "LIBRARY_MATCHING_TOO_LARGE" | "LIBRARY_MATCHING_SCAN_LIMIT", maximumSelected = LIBRARY_MATCHING_SELECTION_LIMIT) {
    super(code === "LIBRARY_MATCHING_TOO_LARGE"
      ? `More than ${maximumSelected} accessible Library items match. Narrow the filters and select a smaller result set; nothing was selected.`
      : "Too many Library records must be inspected to select safely. Narrow the filters and try again; nothing was selected.");
    this.code = code;
  }
}
export const LIBRARY_MATCHING_SELECTION_LIMIT = 200;
const SCAN_PAGE_SIZE = 250;
const MAX_SCANNED = 20000;

export async function collectLibraryMatchingSelection<T extends LibraryMatchingItem>(input: LibraryMatchingSelectionInput<T>): Promise<T[]> {
  const maximumSelected = input.maximumSelected ?? LIBRARY_MATCHING_SELECTION_LIMIT;
  if (!Number.isSafeInteger(maximumSelected) || maximumSelected < 1 || maximumSelected > 1000) throw new LibraryMatchingSelectionError("LIBRARY_MATCHING_TOO_LARGE");
  const selected: T[] = [];
  const ids = new Set<string>();
  for (let skip = 0; skip < MAX_SCANNED; skip += SCAN_PAGE_SIZE) {
    const rows = await input.fetchPage(skip, SCAN_PAGE_SIZE);
    if (rows.length > SCAN_PAGE_SIZE) throw new LibraryMatchingSelectionError("LIBRARY_MATCHING_SCAN_LIMIT");
    const visible = await input.filterVisible(rows);
    const rowIds = new Set(rows.map((row) => row.id));
    for (const item of visible) {
      if (!rowIds.has(item.id) || ids.has(item.id) || !Number.isSafeInteger(item.revision) || item.revision < 1) {
        throw new LibraryMatchingSelectionError("LIBRARY_MATCHING_SCAN_LIMIT");
      }
      ids.add(item.id);
      selected.push(item);
      if (selected.length > maximumSelected) throw new LibraryMatchingSelectionError("LIBRARY_MATCHING_TOO_LARGE", maximumSelected);
    }
    if (rows.length < SCAN_PAGE_SIZE) return selected;
  }
  // If we consumed exactly MAX_SCANNED records we cannot claim completeness.
  throw new LibraryMatchingSelectionError("LIBRARY_MATCHING_SCAN_LIMIT");
}

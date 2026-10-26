export type BatchedScanOptions = {
  batchSize?: number;
  label?: string;
};

export async function scanById<T extends { id: string }>(
  fetchPage: (cursor: string | null, take: number) => Promise<T[]>,
  consume: (rows: T[]) => void | Promise<void>,
  options: BatchedScanOptions = {},
) {
  const batchSize = Math.max(50, Math.min(5_000, Math.round(options.batchSize ?? 1_000)));
  let cursor: string | null = null;
  let rowsScanned = 0;
  let pages = 0;
  for (;;) {
    const rows = await fetchPage(cursor, batchSize);
    pages += 1;
    if (!rows.length) break;
    await consume(rows);
    rowsScanned += rows.length;
    const nextCursor = String(rows.at(-1)?.id || "");
    if (!nextCursor || nextCursor === cursor) throw new Error(`${options.label || "Batched scan"} did not advance its cursor.`);
    cursor = nextCursor;
    if (rows.length < batchSize) break;
  }
  return { rowsScanned, pages, batchSize };
}

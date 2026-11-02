/** Cumulative virtual PDF page geometry. Unknown pages use the first page as an estimate;
 * only rendered pages are measured, avoiding document-wide getPage() fanout. */
export type PdfPageDimensions = { width: number; height: number };
export const PDF_PAGE_VERTICAL_CHROME = 38; // paper border, caption, grid gap and article margin

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function pdfPageOffsets(pageCount: number, defaultSize: PdfPageDimensions, measured: Readonly<Record<number, PdfPageDimensions>>, scale: number, rotation: number): number[] {
  const count = Math.max(0, Math.min(10000, Math.trunc(positive(pageCount, 0))));
  const factor = positive(scale, 1);
  const swap = ((rotation % 180) + 180) % 180 !== 0;
  const defaultWidth = positive(defaultSize.width, 612);
  const defaultHeight = positive(defaultSize.height, 792);
  const offsets = new Array<number>(count + 1);
  offsets[0] = 0;
  for (let index = 0; index < count; index += 1) {
    const size = measured[index + 1];
    const width = positive(size?.width, defaultWidth);
    const height = positive(size?.height, defaultHeight);
    const renderHeight = (swap ? width : height) * factor;
    offsets[index + 1] = offsets[index] + Math.max(64, renderHeight + PDF_PAGE_VERTICAL_CHROME);
  }
  return offsets;
}

/** Returns a zero-based page index, including for the final/beyond-the-end offset. */
export function pdfPageIndexAtOffset(offsets: readonly number[], offset: number): number {
  const count = offsets.length - 1;
  if (count <= 0) return 0;
  const value = Number.isFinite(offset) ? Math.max(0, offset) : 0;
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const middle = Math.floor((lo + hi + 1) / 2);
    if (offsets[middle] <= value) lo = middle;
    else hi = middle - 1;
  }
  return Math.min(count - 1, lo);
}

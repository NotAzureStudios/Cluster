/** Bounded, device-authenticated Package byte segments.
 * Not a large-blob store: immutable release artifacts are still held as
 * bounded database bytes and verified in full before a segment is sent.
 */
export const PACKAGE_SEGMENT_BYTES = 4 * 1024 * 1024;

export type PackageSegment = { start: number; end: number; total: number };

export function packageSegment(start: number, end: number, total: number): PackageSegment {
  if (!Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || end < start || end >= total || end - start + 1 > PACKAGE_SEGMENT_BYTES)
    throw new Error("PACKAGE_SEGMENT_INVALID");
  return { start, end, total };
}

export function initialPackageRange(value: unknown, total: number): PackageSegment | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("PACKAGE_SEGMENT_INVALID");
  const match = /^bytes=(0)-(\d{1,12})$/.exec(value);
  if (!match) throw new Error("PACKAGE_SEGMENT_INVALID");
  return packageSegment(0, Number(match[2]), total);
}

/** Reply metadata is common to the initial offer and all authorized resumes. */
export function packageSegmentHeaders(range: PackageSegment) {
  return {
    "Content-Range": `bytes ${range.start}-${range.end}/${range.total}`,
    "Content-Length": String(range.end - range.start + 1),
    "Accept-Ranges": "bytes",
    "X-Cluster-Package-Segment-Bytes": String(PACKAGE_SEGMENT_BYTES),
  };
}

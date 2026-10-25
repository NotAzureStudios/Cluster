/** A percentage is only meaningful if it covers every currently moving job.
 * Browser handed-off downloads have no observable byte progress in Cluster.
 */
export type TransferSummaryUpload = { status: string };
export type TransferSummaryNative = {
  state: string;
  direction: string;
  totalBytes?: number | null;
  transferredBytes?: number | null;
};
const ACTIVE_NATIVE = new Set(["queued", "running", "verifying", "committing"]);
const ACTIVE_UPLOAD = new Set(["pending", "uploading"]);

export function transferProgressSummary(uploads: TransferSummaryUpload[], native: TransferSummaryNative[]) {
  const liveUploads = uploads.filter((entry) => ACTIVE_UPLOAD.has(entry.status));
  const liveNative = native.filter((entry) => ACTIVE_NATIVE.has(entry.state));
  const failedCount = uploads.filter((entry) => entry.status === "failed").length
    + native.filter((entry) => entry.state === "failed").length;
  const pausedCount = uploads.filter((entry) => entry.status === "paused").length
    + native.filter((entry) => entry.state === "paused").length;
  const activeCount = liveUploads.length + liveNative.length;
  const verifyingCount = liveNative.filter((entry) => ["verifying", "committing"].includes(entry.state)).length;
  const uploadingCount = liveUploads.length + liveNative.filter((entry) => entry.direction === "upload").length;
  const downloadingCount = liveNative.filter((entry) => entry.direction === "download").length;
  const allMeasurable = liveUploads.length === 0 && liveNative.length > 0 && liveNative.every((entry) =>
    Number.isSafeInteger(entry.totalBytes) && Number(entry.totalBytes) > 0 &&
    Number.isFinite(entry.transferredBytes) && Number(entry.transferredBytes) >= 0);
  const total = allMeasurable ? liveNative.reduce((sum, entry) => sum + Number(entry.totalBytes), 0) : 0;
  const done = allMeasurable ? liveNative.reduce((sum, entry) => sum + Math.min(Number(entry.totalBytes), Number(entry.transferredBytes)), 0) : 0;
  return {
    activeCount, failedCount, pausedCount, verifyingCount, uploadingCount, downloadingCount,
    percentage: allMeasurable && total > 0 ? Math.max(0, Math.min(100, Math.round(100 * done / total))) : null,
  };
}

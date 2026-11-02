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
const ACTIVE_BROWSER = new Set(["queued", "saving", "retrying", "verifying"]);
export type TransferSummaryBrowser = {
  state: string;
  receivedBytes?: number | null;
  totalBytes?: number | null;
};

export function transferProgressSummary(uploads: TransferSummaryUpload[], native: TransferSummaryNative[], browser: TransferSummaryBrowser[] = []) {
  const liveUploads = uploads.filter((entry) => ACTIVE_UPLOAD.has(entry.status));
  const liveNative = native.filter((entry) => ACTIVE_NATIVE.has(entry.state));
  const liveBrowser = browser.filter((entry) => ACTIVE_BROWSER.has(entry.state));
  const failedCount = uploads.filter((entry) => entry.status === "failed").length
    + native.filter((entry) => entry.state === "failed").length
    + browser.filter((entry) => entry.state === "failed").length;
  const pausedCount = uploads.filter((entry) => entry.status === "paused").length
    + native.filter((entry) => entry.state === "paused").length
    + browser.filter((entry) => entry.state === "paused").length;
  const activeCount = liveUploads.length + liveNative.length + liveBrowser.length;
  const verifyingCount = liveNative.filter((entry) => ["verifying", "committing"].includes(entry.state)).length
    + liveBrowser.filter((entry) => entry.state === "verifying").length;
  const uploadingCount = liveUploads.length + liveNative.filter((entry) => entry.direction === "upload").length;
  const downloadingCount = liveNative.filter((entry) => entry.direction === "download").length + liveBrowser.length;
  const allMeasurable = liveUploads.length === 0 && (liveNative.length + liveBrowser.length) > 0
    && liveNative.every((entry) => Number.isSafeInteger(entry.totalBytes) && Number(entry.totalBytes) > 0
      && Number.isFinite(entry.transferredBytes) && Number(entry.transferredBytes) >= 0)
    && liveBrowser.every((entry) => Number.isSafeInteger(entry.totalBytes) && Number(entry.totalBytes) > 0
      && Number.isFinite(entry.receivedBytes) && Number(entry.receivedBytes) >= 0);
  const total = allMeasurable
    ? liveNative.reduce((sum, entry) => sum + Number(entry.totalBytes), 0)
      + liveBrowser.reduce((sum, entry) => sum + Number(entry.totalBytes), 0) : 0;
  const done = allMeasurable
    ? liveNative.reduce((sum, entry) => sum + Math.min(Number(entry.totalBytes), Number(entry.transferredBytes)), 0)
      + liveBrowser.reduce((sum, entry) => sum + Math.min(Number(entry.totalBytes), Number(entry.receivedBytes)), 0) : 0;
  return {
    activeCount, failedCount, pausedCount, verifyingCount, uploadingCount, downloadingCount,
    percentage: allMeasurable && total > 0 ? Math.max(0, Math.min(100, Math.round(100 * done / total))) : null,
  };
}

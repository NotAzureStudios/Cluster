import type { ClusterDataExportJobStatus } from "@cluster/shared";
import { useState } from "react";
import { downloadAuthenticatedClusterFile } from "../core/browser-download-transfers";
import { API_URL } from "../core/api";
import { useClusterOperationJobStatus } from "./useClusterOperationJobStatus";
import { ClusterButton, ClusterLinkButton } from "./ClusterButton";
import { ClusterOperationFeedback } from "./ClusterOperationFeedback";

function exportDownloadHref(downloadUrl: string) {
  if (!downloadUrl) return "";
  if (/^https?:\/\//i.test(downloadUrl)) return downloadUrl;
  return `${API_URL}${downloadUrl.startsWith("/") ? downloadUrl : `/${downloadUrl}`}`;
}

function sizeLabel(bytes?: number | null) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${Math.round((value / (1024 * 1024)) * 10) / 10} MB`;
}

export function DataExportOperationFeedback({ jobId, onDismiss }: { jobId?: string | null; onDismiss?: () => void }) {
  const { status, requestError } = useClusterOperationJobStatus<ClusterDataExportJobStatus>(jobId, "/api/data-exports/jobs", "Export progress could not be refreshed.");
  const [downloadError, setDownloadError] = useState("");

  if (!jobId) return null;
  const normalized = String(status?.status || "QUEUED").toUpperCase();
  const working = normalized === "QUEUED" || normalized === "RUNNING";
  const succeeded = normalized === "SUCCEEDED";
  const cancelled = normalized === "CANCELLED";
  const state = requestError && !status ? "warning" : succeeded ? "success" : cancelled ? "warning" : working ? "working" : "error";
  const artifact = status?.artifact || null;
  const detailParts = [artifact?.fileName, artifact?.evidence?.rowCount != null ? `${artifact.evidence.rowCount} row${artifact.evidence.rowCount === 1 ? "" : "s"}` : "", sizeLabel(artifact?.sizeBytes)].filter(Boolean);
  const message = requestError && !status
    ? "Export status temporarily unavailable"
    : succeeded
      ? "Export ready"
      : cancelled
        ? "Export cancelled"
        : working
          ? status?.progressMessage || (normalized === "QUEUED" ? "Export queued" : "Generating export")
          : "Export failed";
  const detail = requestError || (succeeded ? detailParts.join(" · ") : status?.error || status?.progressMessage || `Job ${jobId}`);
  const href = artifact?.downloadUrl ? exportDownloadHref(artifact.downloadUrl) : "";

  return <ClusterOperationFeedback state={state} message={message} detail={detail} progress={working ? status?.progress ?? 0 : succeeded ? 100 : null}>
    <div className="button-row">
      {href ? <ClusterLinkButton href={href} download={artifact?.fileName || undefined} size="compact" onClick={(event) => { event.preventDefault(); setDownloadError(""); void downloadAuthenticatedClusterFile({ url: event.currentTarget.href, fileName: artifact?.fileName || "cluster-export" }).catch((error) => setDownloadError(error instanceof Error ? error.message : "Export download failed.")); }}>Download export</ClusterLinkButton> : null}
      {downloadError && <span role="alert" className="cluster-transfer-action-error">{downloadError}</span>}
      {onDismiss && !working ? <ClusterButton type="button" variant="quiet" size="compact" onClick={onDismiss}>Dismiss</ClusterButton> : null}
    </div>
  </ClusterOperationFeedback>;
}

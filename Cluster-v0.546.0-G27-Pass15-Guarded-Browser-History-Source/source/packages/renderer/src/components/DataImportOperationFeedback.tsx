import type { ClusterDataImportJobStatus } from "@cluster/shared";
import { API_URL } from "../core/api";
import { useClusterOperationJobStatus } from "./useClusterOperationJobStatus";
import { ClusterButton, ClusterLinkButton } from "./ClusterButton";
import { ClusterOperationFeedback } from "./ClusterOperationFeedback";

function artifactHref(downloadUrl?: string | null) {
  if (!downloadUrl) return "";
  if (/^https?:\/\//i.test(downloadUrl)) return downloadUrl;
  return `${API_URL}${downloadUrl.startsWith("/") ? downloadUrl : `/${downloadUrl}`}`;
}

export function DataImportOperationFeedback({ jobId, onDismiss }: { jobId?: string | null; onDismiss?: () => void }) {
  const { status, requestError } = useClusterOperationJobStatus<ClusterDataImportJobStatus>(jobId, "/api/data-imports/jobs", "Import progress could not be refreshed.");

  if (!jobId) return null;
  const normalized = String(status?.status || "QUEUED").toUpperCase();
  const working = normalized === "QUEUED" || normalized === "RUNNING";
  const succeeded = normalized === "SUCCEEDED";
  const cancelled = normalized === "CANCELLED";
  const evidence = status?.evidence || null;
  const partial = Boolean(evidence?.partialFailure);
  const state = requestError && !status ? "warning" : succeeded && partial ? "warning" : succeeded ? "success" : cancelled ? "warning" : working ? "working" : "error";
  const message = requestError && !status
    ? "Import status temporarily unavailable"
    : succeeded && partial
      ? "Import completed with issues"
      : succeeded
        ? "Import complete"
        : cancelled
          ? "Import cancelled"
          : working
            ? status?.progressMessage || (normalized === "QUEUED" ? "Import queued" : "Applying import")
            : "Import failed";
  const detail = requestError || (evidence
    ? `${evidence.createdRows} created · ${evidence.updatedRows} updated · ${evidence.skippedRows + evidence.alreadyAppliedRows} unchanged · ${evidence.failedRows} failed`
    : status?.error || status?.progressMessage || `Job ${jobId}`);
  const reportHref = artifactHref(status?.reportArtifact?.downloadUrl);
  const sourceHref = artifactHref(status?.sourceArtifact?.downloadUrl);

  return <ClusterOperationFeedback state={state} message={message} detail={detail} progress={working ? status?.progress ?? 0 : succeeded ? 100 : null}>
    <div className="button-row">
      {reportHref ? <ClusterLinkButton href={reportHref} download={status?.reportArtifact?.fileName || undefined} size="compact">Download report</ClusterLinkButton> : null}
      {sourceHref ? <ClusterLinkButton href={sourceHref} download={status?.sourceArtifact?.fileName || undefined} size="compact" variant="quiet">Source</ClusterLinkButton> : null}
      {onDismiss && !working ? <ClusterButton type="button" variant="quiet" size="compact" onClick={onDismiss}>Dismiss</ClusterButton> : null}
    </div>
  </ClusterOperationFeedback>;
}

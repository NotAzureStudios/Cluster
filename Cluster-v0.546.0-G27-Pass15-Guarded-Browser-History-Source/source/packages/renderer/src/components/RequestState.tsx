import { useState, type ReactNode } from "react";
import { apiErrorPresentation, formatApiErrorDiagnostics } from "../core/api";
import { compactDateTime } from "../core/date-time";
import { copyClusterText } from "../core/clipboard";
import { ClusterButton } from "./ClusterButton";
import { ClusterActionMenu } from "./ClusterContextActions";
import { ClusterStatus, type ClusterStatusTone } from "./ClusterStatus";
import { ClusterEmptyState, type ClusterEmptyStateKind } from "./ClusterEmptyState";
import type { ClusterInteractionState } from "./interaction-state";

type RequestErrorStateProps = {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  retryLabel?: string;
  onReload?: () => void;
  reloadLabel?: string;
  onWorkOffline?: () => void;
  onReview?: () => void;
  reviewLabel?: string;
  compact?: boolean;
  className?: string;
  actions?: ReactNode;
  showDiagnostics?: boolean;
};

export function RequestErrorState({
  error,
  title,
  onRetry,
  retryLabel,
  onReload,
  reloadLabel = "Reload data",
  onWorkOffline,
  onReview,
  reviewLabel = "Review",
  compact = false,
  className = "",
  actions,
  showDiagnostics = true,
}: RequestErrorStateProps) {
  const detail = apiErrorPresentation(error);
  const [copyStatus, setCopyStatus] = useState<"" | "copied" | "failed">("");
  const retryHint = detail.retryAfterSeconds != null && detail.retryAfterSeconds > 0
    ? `Retry after ${detail.retryAfterSeconds} second${detail.retryAfterSeconds === 1 ? "" : "s"}.`
    : null;
  const primaryRetryLabel = retryLabel || (detail.recoveryKind === "refresh" ? "Refresh" : "Retry");
  const occurred = compactDateTime(detail.occurredAt);
  const diagnostics = formatApiErrorDiagnostics(error);

  async function copyDiagnostics() {
    const copied = await copyClusterText(diagnostics);
    setCopyStatus(copied ? "copied" : "failed");
    if (copied) window.setTimeout(() => setCopyStatus(""), 2400);
  }

  const interactionState: ClusterInteractionState = detail.recoveryKind === "review"
    ? "conflict"
    : detail.recoveryKind === "work_offline"
      ? "offline"
      : detail.recoveryKind === "request_access" || detail.recoveryKind === "reauthenticate"
        ? "warning"
        : "error";
  const hasRecoveryActions = Boolean(onRetry || onReload || onWorkOffline || onReview || actions || showDiagnostics);
  return (
    <section data-cluster-state={interactionState} data-error-code={detail.code} data-recovery-kind={detail.recoveryKind}
      className={`cluster-request-state-v394 error state-${interactionState} cluster-error-recovery-v434 ${compact ? "compact" : ""} ${className}`.trim()} role="alert">
      <div className="cluster-request-state-copy-v394">
        <strong>{title || detail.title}</strong>
        <p>{detail.message}</p>
        <small>{retryHint || detail.action}</small>
        {detail.issues.length > 0 && (
          <ul>
            {detail.issues.slice(0, 3).map((issue, index) => <li key={`${issue.path || "issue"}-${index}`}>{issue.path ? `${issue.path}: ` : ""}{issue.message}</li>)}
          </ul>
        )}
        {(detail.operation || occurred) && (
          <div className="cluster-request-state-context-v434" aria-label="Failure context">
            {detail.operation ? <span><b>Operation</b><code>{detail.operation}</code></span> : null}
            {occurred ? <span><b>Occurred</b><time dateTime={detail.occurredAt}>{occurred}</time></span> : null}
          </div>
        )}
      </div>
      <div className="cluster-request-state-meta-v394" aria-label="Error reference">
        <code>{detail.code}</code>
        {detail.status > 0 && <code>HTTP {detail.status}</code>}
        {detail.requestId && <code>request {detail.requestId}</code>}
        {detail.contractVersion && <code>contract {detail.contractVersion}</code>}
      </div>
      {hasRecoveryActions && <div className="button-row compact cluster-error-recovery-actions-v434">
        {onRetry && <ClusterButton variant="secondary" size="compact" onClick={onRetry}>{primaryRetryLabel}</ClusterButton>}
        {onReload && <ClusterButton variant="secondary" size="compact" onClick={onReload}>{reloadLabel}</ClusterButton>}
        {onWorkOffline && <ClusterButton variant="secondary" size="compact" onClick={onWorkOffline}>Work offline</ClusterButton>}
        {onReview && <ClusterButton variant="secondary" size="compact" onClick={onReview}>{reviewLabel}</ClusterButton>}
        {actions}
        {showDiagnostics ? (
          <ClusterActionMenu
            label="Error options"
            triggerLabel="Details"
            items={[{
              id: "copy-diagnostics",
              label: "Copy diagnostics",
              description: "Copy the bounded error code, operation, timestamp, and request reference.",
              icon: "operations",
              onSelect: copyDiagnostics,
            }]}
          />
        ) : null}
        <span className="sr-only" aria-live="polite">{copyStatus === "copied" ? "Error diagnostics copied." : copyStatus === "failed" ? "Could not copy error diagnostics." : ""}</span>
      </div>}
    </section>
  );
}

type RequestEmptyStateProps = {
  title: string;
  description?: string;
  compact?: boolean;
  className?: string;
  actions?: ReactNode;
  kind?: ClusterEmptyStateKind;
  eyebrow?: ReactNode;
};

export function RequestEmptyState({ title, description, compact = false, className = "", actions, kind = "empty", eyebrow }: RequestEmptyStateProps) {
  return <ClusterEmptyState title={title} description={description} compact={compact} className={`cluster-request-state-v394 empty ${className}`.trim()} actions={actions} kind={kind} eyebrow={eyebrow} />;
}

export function RequestStatusLine({ children, tone = "neutral", state = "default" }: { children: ReactNode; tone?: ClusterStatusTone; state?: ClusterInteractionState }) {
  return <ClusterStatus className="cluster-request-status-v394" tone={tone} state={state} role={tone === "danger" || state === "error" || state === "conflict" ? "alert" : "status"}>{children}</ClusterStatus>;
}

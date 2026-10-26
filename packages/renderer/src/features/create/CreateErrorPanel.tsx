import { useState } from "react";
import type { ApiErrorPresentation } from "../../core/api";
import { formatApiErrorPresentationDiagnostics } from "../../core/api";
import { compactDateTime } from "../../core/date-time";
import { copyClusterText } from "../../core/clipboard";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterActionMenu } from "../../components/ClusterContextActions";

export function CreateErrorPanel({ detail, canRepair, busy, onRepair, onIssueFocus }: { detail: ApiErrorPresentation; canRepair: boolean; busy: boolean; onRepair: () => void; onIssueFocus?: (path: string) => void }) {
  const [copyStatus, setCopyStatus] = useState<"" | "copied" | "failed">("");
  const storageFailure = detail.code === "STORAGE_SCHEMA_OUT_OF_DATE" || detail.code === "STORAGE_VERIFY_FAILED";
  async function copyDiagnostics() {
    const copied = await copyClusterText(formatApiErrorPresentationDiagnostics(detail));
    setCopyStatus(copied ? "copied" : "failed");
    if (copied) window.setTimeout(() => setCopyStatus(""), 2400);
  }
  return (
    <section className="create-error-v311 cluster-error-recovery-v434" role="alert" data-error-code={detail.code} data-recovery-kind={detail.recoveryKind}>
      <div className="create-error-copy-v311">
        <span className="create-error-code-v311">{detail.code}</span>
        <div>
          <strong>{detail.title}</strong>
          <p>{detail.message}</p>
          <small>{detail.action}</small>
        </div>
      </div>
      {detail.issues.length > 0 && <ul>{detail.issues.slice(0, 5).map((issue, index) => <li key={`${issue.path || "field"}-${index}`}>{issue.path && onIssueFocus ? <ClusterButton unstyled type="button" className="create-error-issue-link-v495" onClick={() => onIssueFocus(issue.path!)}><b>{issue.path}</b><span>{issue.message}</span></ClusterButton> : <><b>{issue.path || "Field"}</b> {issue.message}</>}</li>)}</ul>}
      {(detail.operation || detail.occurredAt) && <div className="cluster-request-state-context-v434">
        {detail.operation ? <span><b>Operation</b><code>{detail.operation}</code></span> : null}
        <span><b>Occurred</b><time dateTime={detail.occurredAt}>{compactDateTime(detail.occurredAt)}</time></span>
      </div>}
      <footer className="create-error-footer-v311">
        <div className="cluster-request-state-meta-v394">
          {detail.status > 0 && <code>HTTP {detail.status}</code>}
          {detail.requestId && <code>request {detail.requestId}</code>}
        </div>
        <div className="button-row compact">
          {storageFailure && canRepair && <ClusterButton variant="primary" size="compact" busy={busy} busyLabel="Verifying…" onClick={onRepair}>Verify storage</ClusterButton>}
          <ClusterActionMenu label="Create error options" triggerLabel="Details" items={[{
            id: "copy-diagnostics",
            label: "Copy diagnostics",
            description: "Copy the bounded error reference without raw payload data.",
            icon: "operations",
            onSelect: copyDiagnostics,
          }]} />
          <span className="sr-only" aria-live="polite">{copyStatus === "copied" ? "Error diagnostics copied." : copyStatus === "failed" ? "Could not copy error diagnostics." : ""}</span>
        </div>
      </footer>
    </section>
  );
}

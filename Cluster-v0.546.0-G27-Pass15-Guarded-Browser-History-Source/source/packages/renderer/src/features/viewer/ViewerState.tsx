import type { ReactNode } from "react";
import { ClusterIcon } from "../../components/ClusterIcon";
import { InlineLoadingState } from "../../components/LoadingState";

export type ViewerStateTone = "loading" | "empty" | "warning" | "error";

export function ViewerState({
  tone,
  title,
  description,
  compact = false,
  actions,
}: {
  tone: ViewerStateTone;
  title: string;
  description?: ReactNode;
  compact?: boolean;
  actions?: ReactNode;
}) {
  const icon = tone === "error" || tone === "warning" ? "warning" : tone === "empty" ? "file" : null;
  return (
    <section className={`cluster-viewer-state cluster-viewer-state-v498 ${compact ? "compact" : ""} tone-${tone}`.trim()} role={tone === "error" ? "alert" : "status"} aria-live={tone === "error" ? "assertive" : "polite"} aria-busy={tone === "loading" ? "true" : undefined}>
      <div className="cluster-viewer-state-mark-v498" aria-hidden="true">
        {tone === "loading" ? <span className="cluster-viewer-spinner" /> : icon ? <ClusterIcon name={icon} /> : null}
      </div>
      <div className="cluster-viewer-state-copy-v498">
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
        {tone === "loading" ? <InlineLoadingState label={title} lines={2} className="cluster-viewer-state-skeleton-v498" /> : null}
      </div>
      {actions ? <div className="cluster-viewer-state-actions-v498">{actions}</div> : null}
    </section>
  );
}

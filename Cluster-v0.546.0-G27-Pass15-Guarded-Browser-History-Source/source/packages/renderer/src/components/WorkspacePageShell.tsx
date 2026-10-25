import type { ReactNode } from "react";
import { ToolPageHeader, type ToolPageMetric } from "./ToolPageHeader";
import type { ClusterIconName } from "./ClusterIcon";

export function WorkspacePageShell({
  className = "",
  title,
  icon,
  description,
  eyebrow,
  metrics = [],
  actions,
  context,
  children,
}: {
  className?: string;
  title: string;
  icon?: ClusterIconName | null;
  description?: string;
  eyebrow?: string;
  metrics?: ToolPageMetric[];
  actions?: ReactNode;
  context?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`page cluster-tool-page-v228 cluster-page-shell ${className}`.trim()}>
      <ToolPageHeader
        className="cluster-page-header"
        eyebrow={eyebrow}
        title={title}
        icon={icon}
        description={description}
        metrics={metrics}
        actions={actions}
        context={context}
      />
      {children}
    </section>
  );
}

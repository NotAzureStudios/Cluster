import type { CSSProperties, ReactNode } from "react";
import type { ClusterIconName } from "./ClusterIcon";
import { ProjectToolContextBar } from "./ProjectToolContextBar";
import { ToolPageHeader, type ToolPageMetric } from "./ToolPageHeader";

export type ProjectWorkspaceShellProps = {
  className?: string;
  style?: CSSProperties;
  headerClassName?: string;
  eyebrow: string;
  title: string;
  icon?: ClusterIconName | null;
  description?: string;
  metrics?: ToolPageMetric[];
  headerActions?: ReactNode;
  projectName?: string | null;
  projectStatus?: string | null;
  projectStatusTone?: string | null;
  toolLabel: string;
  resourceLabel: string;
  resourceSelector?: ReactNode;
  projectActions?: ReactNode;
  collaboration?: ReactNode;
  notices?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
};

/**
 * Shared shell for project-owned production tools.
 *
 * Boards, Whiteboards, Builds and QA should converge on this surface rather than
 * growing their own header/context/navigation contracts. Phase 1 starts that
 * migration with Boards and Whiteboards while retaining tool-specific canvases.
 */
export function ProjectWorkspaceShell({
  className = "",
  style,
  headerClassName = "",
  eyebrow,
  title,
  icon,
  description,
  metrics = [],
  headerActions,
  projectName,
  projectStatus,
  projectStatusTone = "muted",
  toolLabel,
  resourceLabel,
  resourceSelector,
  projectActions,
  collaboration,
  notices,
  status,
  children,
}: ProjectWorkspaceShellProps) {
  return (
    <section style={style} className={`page project-workspace-shell-v489 ${className}`.trim()}>
      <ToolPageHeader
        className={headerClassName}
        eyebrow={eyebrow}
        title={title}
        icon={icon}
        description={description}
        metrics={metrics}
        actions={headerActions}
      />
      <ProjectToolContextBar
        projectName={projectName}
        projectStatus={projectStatus}
        statusTone={projectStatusTone}
        toolLabel={toolLabel}
        resourceLabel={resourceLabel}
        selector={resourceSelector}
        actions={projectActions}
        collaboration={collaboration}
      />
      {notices}
      {status ? <div className="project-workspace-status-v489" role="status">{status}</div> : null}
      <div className="project-workspace-body-v489">{children}</div>
    </section>
  );
}

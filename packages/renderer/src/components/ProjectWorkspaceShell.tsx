import type { CSSProperties, ReactNode } from "react";
import { ClusterIcon, type ClusterIconName } from "./ClusterIcon";
import type { ToolPageMetric } from "./ToolPageHeader";
import "./project-workspace-shell.css";

export type ProjectWorkspaceShellProps = {
  className?: string;
  style?: CSSProperties;
  /** @deprecated ignored; the header has one layout. */
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
  /** Opens the owning project from the header's project name. */
  onOpenProject?: () => void;
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
 * Shared shell for project-owned tools (Boards, Whiteboards).
 *
 * One 44px header line: project › resource switcher, counts, project links,
 * who is here, then the tool's actions. Everything below it is workspace.
 * Styled only by project-workspace-shell.css (pw-*).
 */
export function ProjectWorkspaceShell({
  className = "",
  style,
  eyebrow,
  title,
  icon,
  metrics = [],
  headerActions,
  projectName,
  projectStatusTone = "muted",
  onOpenProject,
  toolLabel,
  resourceSelector,
  projectActions,
  collaboration,
  notices,
  status,
  children,
}: ProjectWorkspaceShellProps) {
  const project = projectName || eyebrow;
  return (
    <section style={style} className={`page pw ${className}`.trim()}>
      <header className="pw-head" aria-label={`${toolLabel} header`}>
        <h1 className="pw-sr">{title}</h1>
        {onOpenProject && projectName
          ? <button type="button" className="pw-project" onClick={onOpenProject} title={`Open ${projectName}`}><i data-tone={projectStatusTone || undefined} aria-hidden="true" /><span>{project}</span></button>
          : <span className="pw-project pw-project--static"><span>{project}</span></span>}
        <ClusterIcon name="chevron-right" className="pw-sep" aria-hidden="true" />
        {icon ? <ClusterIcon name={icon} className="pw-icon" aria-hidden="true" /> : null}
        <div className="pw-resource">{resourceSelector || <strong>{title}</strong>}</div>
        {metrics.length ? <span className="pw-metrics">{metrics.map((metric) => <span key={metric.label} data-tone={metric.tone && metric.tone !== "neutral" ? metric.tone : undefined}><b>{metric.value}</b>{metric.label}</span>)}</span> : null}
        {projectActions ? <nav className="pw-links" aria-label="Project tools">{projectActions}</nav> : null}
        <span className="pw-end">
          {collaboration ? <span className="pw-live">{collaboration}</span> : null}
          {headerActions}
        </span>
      </header>
      {notices}
      {status ? <div className="pw-status" role="status">{status}</div> : null}
      <div className="pw-body project-workspace-body-v489">{children}</div>
    </section>
  );
}

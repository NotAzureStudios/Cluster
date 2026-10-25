import type { ReactNode } from "react";
import "./project-tool-context-bar.css";

type Props = {
  projectName?: string | null;
  projectStatus?: string | null;
  statusTone?: string | null;
  toolLabel: string;
  resourceLabel: string;
  selector?: ReactNode;
  actions?: ReactNode;
  collaboration?: ReactNode;
};

export function ProjectToolContextBar({ projectName, projectStatus, statusTone = "muted", toolLabel, resourceLabel, selector, actions, collaboration }: Props) {
  return <section className="project-tool-context-v194 cluster-context-bar-v391 panel" aria-label={`${toolLabel} context`}>
    <div className="project-tool-context-main-v194 cluster-context-main-v391">
      <span className={`project-context-dot-v194 ${projectName ? statusTone : "muted"}`} />
      <div>
        <span>{toolLabel}</span>
        <strong>{resourceLabel}</strong>
        <em>{projectName ? `${projectName} · ${projectStatus || "Active"}` : "Studio workspace"}</em>
      </div>
    </div>
    {selector && <div className="project-tool-context-selector-v194 cluster-context-selector-v391">{selector}</div>}
    {actions && <div className="project-tool-context-actions-v194 cluster-context-actions-v391">{actions}</div>}
    {collaboration && <div className="project-tool-context-live-v194">{collaboration}</div>}
  </section>;
}

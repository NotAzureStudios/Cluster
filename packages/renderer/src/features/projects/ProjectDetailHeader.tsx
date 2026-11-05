import { ClusterButton } from "../../components/ClusterButton";
import { ClusterActionMenu } from "../../components/ClusterContextActions";
import { ClusterIcon } from "../../components/ClusterIcon";
import { formatRelativeTime } from "../../core/format";
import { runtimeStyle } from "../../core/runtime-style";
import type { Project } from "../application/application-models";
import { projectStatusLabel, projectStatusMeta } from "./projects-utils";
import { ResourceIdentityMark } from "../../components/ResourceIdentityMark";
import { ProjectWorkspaceNav } from "./ProjectWorkspaceNav";
import type { ProjectWorkspaceMode, ProjectWorkspaceTabId } from "./project-workspace-registry";

export type ProjectDetailTab = {
  id: ProjectWorkspaceTabId;
  label: string;
  detail: string;
  group: ProjectWorkspaceMode;
};

type Props = {
  project: Project;
  typeLabel: string;
  readiness: number;
  teamCount: number;
  primaryBoardId?: string | null;
  tabs: ProjectDetailTab[];
  primaryTabIds?: readonly ProjectWorkspaceTabId[];
  activeTab: ProjectWorkspaceTabId;
  onTabChange: (tab: ProjectWorkspaceTabId) => void;
  onBack: () => void;
  onOpenBoard: (boardId: string) => void;
  onOpenTimeline: () => void;
  onOpenTickets: () => void;
};

export function ProjectDetailHeader({ project, typeLabel, readiness, teamCount, primaryBoardId, tabs, primaryTabIds, activeTab, onTabChange, onBack, onOpenBoard, onOpenTimeline, onOpenTickets }: Props) {
  const status = projectStatusLabel(project);
  const activeSectionLabel = tabs.find((item) => item.id === activeTab)?.label || "Overview";
  const targetDate = project.targetDate
    ? new Date(project.targetDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "Not set";

  return (
    <header className="project-hero-v312 project-hero-v57 project-hero-rc24 project-hero-rc25">
      <div className="project-head-breadcrumb-rc25">
        <ClusterButton variant="quiet" size="compact" className="project-back-v147" onClick={onBack}><ClusterIcon name="chevron-left" /> Projects</ClusterButton>
        <span aria-hidden="true">/</span><span>{typeLabel}</span>
        <span aria-hidden="true">/</span><span aria-current="page" className="project-breadcrumb-current-v11">{activeSectionLabel}</span>
      </div>
      <div className="project-hero-main-rc24 project-hero-main-rc25">
        <div className="project-hero-identity-rc24 project-hero-identity-rc25">
          <span className="project-hero-mark-rc25" aria-hidden="true" style={runtimeStyle({ "--project-detail-accent": project.color || "#57c1ff" })}><ResourceIdentityMark iconId={project.iconId} projectId={project.id} projectType={project.projectType} label={project.name} accentColor={project.color} /></span>
          <div className="project-hero-title-content-rc25">
            <div className="project-hero-title-line-rc25"><h1 title={project.name}>{project.name}</h1><span className={`project-status-pill-v077 ${projectStatusMeta(project).tone}`}>{status}</span></div>
          </div>
        </div>
        <div className="project-hero-actions-rc24">
          {primaryBoardId && <ClusterButton variant="primary" size="compact" onClick={() => onOpenBoard(primaryBoardId)}><ClusterIcon name="project" /> Board</ClusterButton>}
          <ClusterActionMenu label="Project shortcuts" triggerLabel="Open" items={[
            { id: "timeline", label: "Timeline", onSelect: onOpenTimeline },
            { id: "tickets", label: "Tickets", onSelect: onOpenTickets },
          ]} />
        </div>
      </div>
      <div className="project-nav-row-rc25">
        <ProjectWorkspaceNav items={tabs} activeId={activeTab} onChange={onTabChange} primaryIds={primaryTabIds} />
        <details className="project-header-details-rc25">
          <summary>Info <ClusterIcon name="chevron-down" /></summary>
          <div className="project-header-details-menu-rc25">
            <div><span>Type</span><strong>{typeLabel}</strong></div>
            <div><span>Target</span><strong>{targetDate}</strong></div>
            <div><span>Team</span><strong>{teamCount}</strong></div>
            <div><span>Readiness</span><strong>{readiness}%</strong></div>
            <div><span>Updated</span><strong>{project.updatedAt ? formatRelativeTime(project.updatedAt) : "Unknown"}</strong></div>
            {project.priority === "urgent" || project.priority === "high" ? <div><span>Priority</span><strong>{project.priority}</strong></div> : null}
          </div>
        </details>
      </div>
    </header>
  );
}

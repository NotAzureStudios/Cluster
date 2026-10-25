import { ClusterButton } from "../../components/ClusterButton";
import { ClusterActionMenu } from "../../components/ClusterContextActions";
import { ClusterIcon } from "../../components/ClusterIcon";
import { formatRelativeTime } from "../../core/format";
import type { Project } from "../application/application-models";
import { projectStatusLabel, projectStatusMeta } from "./projects-utils";
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
  const targetDate = project.targetDate
    ? new Date(project.targetDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "Not set";

  return (
    <header className="project-hero-v312 project-hero-converged-v495 project-hero-v57">
      <div className="project-header-top-v148 project-header-grid-v57">
        <div className="project-title-stack-v148 project-title-stack-v57">
          <ClusterButton variant="quiet" size="compact" className="project-back-v147" onClick={onBack}>
            <ClusterIcon name="chevron-left" />Projects
          </ClusterButton>
          <div className="project-title-main-v148">
            <div className="project-title-kicker-v57">
              <p className="eyebrow">{typeLabel}</p>
              <span className={`project-status-pill-v077 ${projectStatusMeta(project).tone}`}>{status}</span>
              <span className="project-priority-v57">{project.priority || "medium"}</span>
            </div>
            <h1>{project.name}</h1>
            <p className="muted compact-copy-v147">{project.description || project.objective || "No project brief yet."}</p>
          </div>
        </div>

        <dl className="project-identity-summary-v57" aria-label="Project summary">
          <div><dt>Target</dt><dd>{targetDate}</dd></div>
          <div><dt>Team</dt><dd>{teamCount}</dd></div>
          <div><dt>Setup</dt><dd>{readiness}%</dd></div>
          <div><dt>Updated</dt><dd>{project.updatedAt ? formatRelativeTime(project.updatedAt) : "unknown"}</dd></div>
        </dl>

        <div className="project-hero-actions-v310 project-hero-actions-v57" aria-label="Project actions">
          {primaryBoardId ? (
            <ClusterButton variant="primary" size="compact" onClick={() => onOpenBoard(primaryBoardId)}>
              <ClusterIcon name="project" />Open board
            </ClusterButton>
          ) : null}
          <ClusterActionMenu label="Project workspace shortcuts" triggerLabel="Go to" items={[
            { id: "timeline", label: "Timeline", description: "Open project milestones and schedule", onSelect: onOpenTimeline },
            { id: "tickets", label: "Tickets", description: "Open project-filtered tickets", onSelect: onOpenTickets },
          ]} />
        </div>
      </div>

      <ProjectWorkspaceNav items={tabs} activeId={activeTab} onChange={onTabChange} primaryIds={primaryTabIds} />
    </header>
  );
}

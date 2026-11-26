import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterMiniRing } from "../../components/ClusterVisualMetrics";
import "./project-head.css";
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
  allowCloseout?: boolean;
  onLifecycle?: (action: "complete" | "reopen") => void;
};

/* The project header, two rows: identity and key facts, then the tabs.
   It used to stack four — a breadcrumb repeating the project type and the
   current tab, a title row with a 48px mark, the tab band with an Info
   dropdown, then a presence bar — about 230px before any content. The facts
   from Info sit on the title line as small indicators instead, so nothing is
   hidden behind a click. */
export function ProjectDetailHeader({ project, typeLabel, readiness, teamCount, primaryBoardId, tabs, primaryTabIds, activeTab, onTabChange, onBack, onOpenBoard, onOpenTimeline, onOpenTickets, allowCloseout = false, onLifecycle }: Props) {
  const status = projectStatusLabel(project);
  const statusTone = projectStatusMeta(project).tone;
  const target = project.targetDate ? new Date(project.targetDate) : null;
  const daysToTarget = target ? Math.ceil((target.getTime() - Date.now()) / 86_400_000) : null;
  const targetLabel = target ? target.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
  // Settings is a gear at the end of the tab bar, always visible; Closeout is
  // opened from the menu. Neither competes for a tab slot.
  const hasSettings = tabs.some((item) => item.id === "settings");
  const hasCloseout = allowCloseout;
  const workTabs = tabs.filter((item) => item.id !== "settings");

  return (
    <header className="pj-head">
      <div className="pj-head__row">
        <ClusterIconButton size="compact" className="pj-head__back" label="All projects" onClick={onBack}><ClusterIcon name="chevron-left" /></ClusterIconButton>
        <span className="pj-head__mark" aria-hidden="true" style={runtimeStyle({ "--project-detail-accent": project.color || "#57c1ff" })}><ResourceIdentityMark iconId={project.iconId} projectId={project.id} projectType={project.projectType} label={project.name} accentColor={project.color} /></span>
        <h1 title={project.name}>{project.name}</h1>
        <span className="pj-status" data-tone={statusTone}>{status}</span>
        <ul className="pj-facts" aria-label="Project facts">
          <li title="Type">{typeLabel}</li>
          {targetLabel ? <li title={`Target ${target!.toLocaleDateString()}`} data-tone={daysToTarget != null && daysToTarget < 0 ? "danger" : daysToTarget != null && daysToTarget <= 7 ? "warning" : undefined}><ClusterIcon name="calendar" />{targetLabel}{daysToTarget != null ? <small>{daysToTarget < 0 ? `${-daysToTarget}d late` : daysToTarget === 0 ? "today" : `${daysToTarget}d`}</small> : null}</li> : null}
          <li title={`${teamCount} on the team`}><ClusterIcon name="users" />{teamCount}</li>
          {project.priority === "urgent" || project.priority === "high" ? <li data-tone={project.priority === "urgent" ? "danger" : "warning"}>{project.priority === "urgent" ? "Urgent" : "High priority"}</li> : null}
          {project.updatedAt ? <li className="pj-facts__soft" title={new Date(project.updatedAt).toLocaleString()}>Updated {formatRelativeTime(project.updatedAt)}</li> : null}
        </ul>
        <div className="pj-head__actions">
          {primaryBoardId ? <ClusterButton variant="primary" size="compact" onClick={() => onOpenBoard(primaryBoardId)}><ClusterIcon name="grid" />Board</ClusterButton> : null}
          <ClusterActionMenu label="Go to" iconOnly items={[
            { id: "timeline", label: "Timeline", icon: "timeline", onSelect: onOpenTimeline },
            { id: "tickets", label: "Tickets", icon: "ticket", onSelect: onOpenTickets },
            ...(onLifecycle && !project.archived && project.status !== "cancelled" ? [project.status === "completed"
              ? { id: "reopen", label: "Reopen project", icon: "refresh" as const, separatorBefore: true, onSelect: () => onLifecycle("reopen") }
              : { id: "complete", label: "Mark complete", icon: "check" as const, separatorBefore: true, onSelect: () => onLifecycle("complete") }] : []),
          ]} />
        </div>
      </div>
      <div className="pj-tabbar">
        <ProjectWorkspaceNav items={workTabs} activeId={activeTab} onChange={onTabChange} primaryIds={primaryTabIds} />
        {hasSettings ? <ClusterIconButton size="compact" className="pj-tabbar__settings" label="Project settings" aria-pressed={activeTab === "settings"}
          data-active={activeTab === "settings" || undefined} onClick={() => onTabChange("settings")}><ClusterIcon name="settings" /></ClusterIconButton> : null}
      </div>
    </header>
  );
}

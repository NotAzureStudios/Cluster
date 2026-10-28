import type { KeyboardEvent } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterActionMenu } from "../../components/ClusterContextActions";
import { resolveClusterResourceActions } from "../../core/resource-action-registry";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ResourceIdentityMark } from "../../components/ResourceIdentityMark";
import { isProjectContextScreen, type AppScreen } from "../../core/navigation";
import type { Project } from "../application/application-models";
import { projectHealth } from "../projects/projects-utils";
import { projectTypeBadge } from "../application/modules/project-shell-helpers";

function handleTabKey(event: KeyboardEvent<HTMLButtonElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tablist = event.currentTarget.closest<HTMLElement>("[role='tablist']");
  const tabs = tablist ? Array.from(tablist.querySelectorAll<HTMLButtonElement>("button[role='tab']")) : [];
  if (!tabs.length) return;
  event.preventDefault();
  const currentIndex = tabs.indexOf(event.currentTarget);
  const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[nextIndex]?.focus();
}

export function TaskbarProjectTabs({ projects, openProjectIds, pinnedProjectIds, activeProjectId, screen, canSeeProjects, onOpenProject, onOpenProjects, onOpenMyWork, onToggleProjectPin, onMoveProjectTab, onCloseOtherProjects, onCloseProject }: { projects: Project[]; openProjectIds: string[]; pinnedProjectIds: string[]; activeProjectId?: string | null; screen: AppScreen; canSeeProjects: boolean; onOpenProject: (projectId: string) => void; onOpenProjects: () => void; onOpenMyWork: () => void; onToggleProjectPin: (projectId: string) => void; onMoveProjectTab: (projectId: string, delta: -1 | 1) => void; onCloseOtherProjects: (projectId: string) => void; onCloseProject: (projectId: string) => void }) {
  const pinned = new Set(pinnedProjectIds);
  const openProjects = openProjectIds.map((id) => projects.find((project) => project.id === id)).filter((project): project is Project => Boolean(project)).sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)));

  if (!openProjects.length) {
    return <ClusterButton unstyled type="button" className="cluster-taskbar-projects__empty taskbar-empty-tabs-v073" onClick={canSeeProjects ? onOpenProjects : onOpenMyWork}>Open a project to pin it here</ClusterButton>;
  }

  return <div className="cluster-taskbar-projects">
    <div className="cluster-taskbar-projects__scroll project-tabs-scroll-v047 taskbar-tabs-v073" role="tablist" aria-label="Open project tabs">
      {openProjects.map((project, index) => {
        const active = isProjectContextScreen(screen) && activeProjectId === project.id;
        const health = projectHealth(project);
        const isPinned = pinned.has(project.id);
        const sourceIndex = openProjectIds.indexOf(project.id);
        const tabbable = active || (!isProjectContextScreen(screen) && index === 0);
        return <div key={project.id} className={`cluster-taskbar-project ${active ? "is-active" : ""} ${isPinned ? "is-pinned" : ""}`.trim()} role="presentation">
          <ClusterButton unstyled type="button" className="cluster-taskbar-project__main" role="tab" aria-selected={active} aria-current={active ? "page" : undefined} tabIndex={tabbable ? 0 : -1} onClick={() => onOpenProject(project.id)} onKeyDown={handleTabKey} title={project.name}>
            <span className="cluster-taskbar-project__status" data-tone={health.tone} aria-hidden="true" />
            <span className="cluster-taskbar-project__identity"><ResourceIdentityMark iconId={project.iconId} projectId={project.id} projectType={project.projectType} label={project.name} accentColor={project.color} /></span>
            {isPinned ? <ClusterIcon name="pin" className="cluster-taskbar-project__pin" aria-hidden="true" /> : null}
            <span className="cluster-taskbar-project__title">{project.name}</span>
            <span className="sr-only-v370">Health: {health.label}</span>
          </ClusterButton>
          <div className="cluster-taskbar-project__actions">
            <ClusterActionMenu label={`${project.name} tab actions`} iconOnly className="cluster-taskbar-project__menu" items={resolveClusterResourceActions({ kind: "project", id: project.id }, [
              { id: "pin", resourceKinds: ["project"], allowed: () => true, label: isPinned ? "Unpin tab" : "Pin tab", icon: "pin", onSelect: () => onToggleProjectPin(project.id) },
              { id: "left", resourceKinds: ["project"], allowed: () => true, label: "Move left", icon: "chevron-left", available: () => sourceIndex > 0, unavailableReason: "Already the first tab", onSelect: () => onMoveProjectTab(project.id, -1) },
              { id: "right", resourceKinds: ["project"], allowed: () => true, label: "Move right", icon: "chevron-right", available: () => sourceIndex >= 0 && sourceIndex < openProjectIds.length - 1, unavailableReason: "Already the last tab", onSelect: () => onMoveProjectTab(project.id, 1) },
              { id: "close-others", resourceKinds: ["project"], allowed: () => true, label: "Close other project tabs", icon: "close", available: () => openProjectIds.length > 1, separatorBefore: true, onSelect: () => onCloseOtherProjects(project.id) },
              { id: "close", resourceKinds: ["project"], allowed: () => true, label: "Close tab", icon: "close", onSelect: () => onCloseProject(project.id) },
            ])} />
            <ClusterButton unstyled type="button" className="cluster-taskbar-project__close" aria-label={`Close ${project.name}`} onClick={() => onCloseProject(project.id)}><ClusterIcon name="close" /></ClusterButton>
          </div>
        </div>;
      })}
    </div>
    {openProjects.length > 1 ? <ClusterActionMenu label="Open project tabs" iconOnly align="end" className="cluster-taskbar-projects__overflow" items={openProjects.map((project) => ({ id: project.id, label: project.name, description: `${pinned.has(project.id) ? "Pinned · " : ""}${isProjectContextScreen(screen) && activeProjectId === project.id ? "Current project" : projectTypeBadge(project)}`, icon: "project", onSelect: () => onOpenProject(project.id) }))} /> : null}
  </div>;
}

import { useEffect, useState } from "react";
import { compactDateTime, minutesToHuman } from "../../../core/date-time";
import { ClusterIcon } from "../../../components/ClusterIcon";
import { ClusterButton, ClusterIconButton } from "../../../components/ClusterButton";
import { ClusterTextInput } from "../../../components/ClusterTextInput";
import { ClusterModal } from "../../../components/ClusterModal";
import { LazyFeatureBoundary } from "../../../components/FeatureBoundary";
import type { TimelineWorkspacePageProps } from "../../timeline/TimelineWorkspacePage";
import { projectSourceMeta } from "../../projects/projects-utils";
import { LazyLibraryWorkspacePage, LazyPacketsPage, LazyTimeWorkspacePage } from "../application-entrypoints";
import type { User, Project, Settings, TimeEntry, ClockIntentPayload } from "../application-models";
import { LazyTimelineWorkspacePage } from "./application-foundation";

export function TimelinePage(props: TimelineWorkspacePageProps) {
  return (
    <LazyFeatureBoundary label="Timeline">
      <LazyTimelineWorkspacePage {...props} />
    </LazyFeatureBoundary>
  );
}

export function LibraryPage({ projects, currentUser }: { projects: Project[]; currentUser: User }) {
  return (
    <LazyFeatureBoundary label="Library">
      <LazyLibraryWorkspacePage projects={projects} currentUser={currentUser} />
    </LazyFeatureBoundary>
  );
}

export function PacketsPage({ currentUser, settings, onOpenLibrary, onOpenProject, initialView = "packets" }: { currentUser: User; settings: Settings; onOpenLibrary: (folderId: string) => void; onOpenProject?: (projectId: string) => void; initialView?: "packets" | "records" | "policies" }) {
  return (
    <LazyFeatureBoundary label="Packets">
      <LazyPacketsPage currentUser={currentUser} settings={settings} initialView={initialView} onOpenLibrary={onOpenLibrary} onOpenProject={onOpenProject} />
    </LazyFeatureBoundary>
  );
}

export { CardSelect } from "./application-utility-workspaces";

export function ClockIntentModal({ open, mode, active, projects, title, onTitleChange, projectIds, onProjectIdsChange, busy, onCancel, onConfirm }: { open: boolean; mode: "in" | "out"; active?: TimeEntry | null; projects: Project[]; title: string; onTitleChange: (value: string) => void; projectIds: string[]; onProjectIdsChange: (value: string[]) => void; busy?: boolean; onCancel: () => void; onConfirm: (payload: ClockIntentPayload) => void }) {
  const [projectQuery, setProjectQuery] = useState("");
  useEffect(() => { if (open) setProjectQuery(""); }, [open, mode]);
  if (!open) return null;
  const toggleProject = (projectId: string) => {
    onProjectIdsChange(projectIds.includes(projectId) ? projectIds.filter((id) => id !== projectId) : [...projectIds, projectId]);
  };
  const activeProjects = projects.filter((project) => !project.archived);
  const normalizedProjectQuery = projectQuery.trim().toLowerCase();
  const visibleProjects = normalizedProjectQuery
    ? activeProjects.filter((project) => `${project.name} ${projectSourceMeta(project).label}`.toLowerCase().includes(normalizedProjectQuery))
    : activeProjects;
  const selectedNames = activeProjects.filter((project) => projectIds.includes(project.id)).map((project) => project.name);
  const selectionLabel = !projectIds.length ? "Studio / admin" : projectIds.length === 1 ? selectedNames[0] : `${projectIds.length} projects`;
  return (
    <ClusterModal open onClose={onCancel} busy={Boolean(busy)} backdropClassName="clock-modal-backdrop-v113" className="modal panel clock-intent-modal-v113 clock-intent-modal-v467 clock-intent-modal-v470 pin-protected-modal-v260" labelledBy="clock-intent-title-v470">
        <div className="modal-header clock-modal-header-v113 clock-modal-header-v467 clock-modal-header-v470">
          <div>
            <p className="eyebrow">Time tracking</p>
            <h2 id="clock-intent-title-v470">{mode === "in" ? "Clock in" : "Clock out"}</h2>
            <span>{mode === "in" ? "Choose the work context for this session." : "Confirm the active session before stopping it."}</span>
          </div>
          <ClusterIconButton label="Close" type="button" onClick={onCancel}>
            <ClusterIcon name="close" />
          </ClusterIconButton>
        </div>
        {mode === "in" ? (
          <div className="clock-intent-body-v113 clock-intent-body-v467 clock-intent-body-v470">
            <label className="clock-work-label-v470">
              <span>Work label <em>optional</em></span>
              <ClusterTextInput value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="e.g. Build review, planning, admin" maxLength={160} />
            </label>
            <div className="clock-project-picker-v113 clock-project-picker-v467 clock-project-picker-v470">
              <div className="clock-project-picker-head-v113">
                <div><strong>Project context</strong><small>Select one or more projects, or keep the session studio-wide.</small></div>
                <span>{selectionLabel}</span>
              </div>
              {activeProjects.length > 6 ? <label className="clock-project-search-v475">
                <ClusterIcon name="search" />
                <ClusterTextInput value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} placeholder="Filter projects" aria-label="Filter clock-in projects" />
                {projectQuery ? <ClusterButton type="button" className="" onClick={() => setProjectQuery("")} aria-label="Clear project filter" variant="quiet" size="compact"><ClusterIcon name="close" /></ClusterButton> : null}
              </label> : null}
              <div className="clock-project-options-v470">
                {!normalizedProjectQuery ? <ClusterButton type="button" className={!projectIds.length ? "active" : ""} onClick={() => onProjectIdsChange([])} aria-pressed={!projectIds.length}>
                  <span className="clock-project-icon-v470"><ClusterIcon name="work" /></span>
                  <span><strong>Studio / admin</strong><small>No project attribution</small></span>
                  {!projectIds.length ? <ClusterIcon name="check" /> : null}
                </ClusterButton> : null}
                {visibleProjects.map((project) => (
                  <ClusterButton type="button" key={project.id} className={projectIds.includes(project.id) ? "active" : ""} onClick={() => toggleProject(project.id)} aria-pressed={projectIds.includes(project.id)}>
                    <span className="clock-project-icon-v470"><ClusterIcon name="project" /></span>
                    <span><strong>{project.name}</strong><small>{projectSourceMeta(project).label}</small></span>
                    {projectIds.includes(project.id) ? <ClusterIcon name="check" /> : null}
                  </ClusterButton>
                ))}
                {visibleProjects.length === 0 ? <div className="clock-project-empty-v475"><ClusterIcon name="search" /><span>No projects match “{projectQuery.trim()}”.</span></div> : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="clock-out-panel-v475">
            <div className="clock-out-work-v475"><span className="clock-project-icon-v470"><ClusterIcon name="clock" /></span><div><small>Active session</small><strong>{active?.title || "Clocked work"}</strong><span>{active?.project?.name || "Studio / admin"}</span></div></div>
            <div className="clock-out-summary-v113 clock-out-summary-v470">
              <div><span>Started</span><strong>{active ? compactDateTime(active.startedAt) : "Now"}</strong></div>
              <div><span>Logged</span><strong>{minutesToHuman(active?.computedDurationMinutes || 0)}</strong></div>
              <div><span>Context</span><strong>{active?.card?.title || active?.board?.name || active?.project?.name || "Studio"}</strong></div>
            </div>
          </div>
        )}
        <div className="modal-actions clock-modal-actions-v113 clock-modal-actions-v467 clock-modal-actions-v470">
          <ClusterButton type="button" className="" onClick={onCancel} variant="secondary">Cancel</ClusterButton>
          <ClusterButton type="button" variant={mode === "in" ? "primary" : "danger"} disabled={busy} onClick={() => onConfirm({ title: title.trim() || "Clock in", projectIds })}>
            {busy ? "Working..." : mode === "in" ? "Clock in" : "Clock out"}
          </ClusterButton>
        </div>
    </ClusterModal>
  );
}

export function TimePage({ projects, currentUser }: { projects: Project[]; currentUser: User }) {
  return (
    <LazyFeatureBoundary label="Scheduler">
      <LazyTimeWorkspacePage projects={projects} currentUser={currentUser} />
    </LazyFeatureBoundary>
  );
}


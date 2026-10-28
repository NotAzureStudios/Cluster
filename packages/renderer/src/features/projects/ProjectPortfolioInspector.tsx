import { ClusterButton } from "../../components/ClusterButton";
import { ResourceIdentityMark } from "../../components/ResourceIdentityMark";
import { ClusterIcon, type ClusterIconName } from "../../components/ClusterIcon";
import type { CSSProperties } from "react";
import type { Project, UserActivitySummary, WhiteboardSummary } from "../application/application-models";
import { formatProjectDate, projectScheduleMeta } from "./project-portfolio-model";
import { runtimeStyle } from "../../core/runtime-style";

export function ProjectPortfolioInspector({ project, health, schedule, completeness, source, status, whiteboards, members, checklist, gaps, buildPlan, videoProject = false, onOpenProject, onOpenBoard, onOpenWhiteboard, onOpenTimeline, onOpenBuilds, onOpenActivity, onOpenReports }: {
  project: Project | null;
  health: { label: string; tone: string } | null;
  schedule?: { label: string; tone: string; detail?: string | null } | null;
  completeness: number;
  source: { label: string; icon: ClusterIconName; tone: string } | null;
  status: { tone: string } | null;
  whiteboards: WhiteboardSummary[];
  members: UserActivitySummary[];
  checklist: Array<{ label: string; done: boolean }>;
  gaps: string[];
  buildPlan: Array<{ label: string; status: string }>;
  videoProject?: boolean;
  onOpenProject: (projectId: string) => void;
  onOpenBoard: (boardId: string) => void;
  onOpenWhiteboard: (whiteboardId: string) => void;
  onOpenTimeline: () => void;
  onOpenBuilds: () => void;
  onOpenActivity: () => void;
  onOpenReports: () => void;
}) {
  if (!project) return <aside className="project-inspector-v146"><div className="empty-state flat-empty-v146"><h2>No project selected</h2><p>Select a project from the index.</p></div></aside>;
  const scheduleMeta = schedule || projectScheduleMeta(project, project.archived ? "archived" : String(project.status || "active"));
  const nextAction = scheduleMeta.tone === "danger" ? `Review the overdue target and reset the delivery plan.` : gaps[0] ? gaps[0] : buildPlan.find((item) => item.status === "missing")?.label ? `Set up ${buildPlan.find((item) => item.status === "missing")?.label}.` : "Review the next milestone and keep delivery moving.";
  return (
    <aside className="project-inspector-v146 project-inspector-v310" aria-label="Selected project details" style={runtimeStyle({ "--project-inspector-accent": project.color || "#60a5fa" })}>
      <div className="project-inspector-head-v146"><div className="project-inspector-identity-rc38"><span><ResourceIdentityMark iconId={project.iconId} projectId={project.id} projectType={project.projectType} label={project.name} accentColor={project.color} /></span><h2>{project.name}</h2></div><div className="inspector-badges-v146">{!videoProject && source && <span className={`project-source-pill-v0112 ${source.tone}`}><ClusterIcon name={source.icon} /> {source.label}</span>}{videoProject ? <span className="project-source-pill-v0112 neutral"><ClusterIcon name="video" /> Video</span> : null}{status && <span className={`project-status-pill-v077 ${status.tone}`}>{project.archived ? "Archived" : project.status || "Active"}</span>}</div></div>
      <div className="inspector-progress-v146"><div><span>Readiness</span><strong>{completeness}%</strong></div><div className="completion-meter"><span style={runtimeStyle({ width: `${completeness}%` })} /></div>{health && <em className={`health-pill ${health.tone}`}>{health.label}</em>}</div>
      <section className={`project-next-action-v310 ${scheduleMeta.tone}`}><span>Next step</span><strong>{nextAction}</strong><small>{scheduleMeta.label} · {formatProjectDate(project.targetDate)}</small></section>
      <div className="inspector-actions-v146"><ClusterButton type="button" className="" onClick={() => onOpenProject(project.id)} variant="primary">Open project</ClusterButton>{project.boards[0] && <ClusterButton type="button" className="" onClick={() => onOpenBoard(project.boards[0].id)} variant="secondary">Board</ClusterButton>}{whiteboards[0] && <ClusterButton type="button" className="" onClick={() => onOpenWhiteboard(whiteboards[0].id)} variant="secondary">Whiteboard</ClusterButton>}</div>
      <div className="project-quick-grid-v310 project-quick-grid-v22"><ClusterButton unstyled type="button" onClick={onOpenTimeline}><strong>Timeline</strong></ClusterButton>{!videoProject ? <ClusterButton unstyled type="button" onClick={onOpenBuilds}><strong>Builds</strong></ClusterButton> : <ClusterButton unstyled type="button" onClick={() => onOpenProject(project.id)}><strong>Video Review</strong></ClusterButton>}<ClusterButton unstyled type="button" onClick={onOpenActivity}><strong>Activity</strong></ClusterButton><ClusterButton unstyled type="button" onClick={onOpenReports}><strong>Tickets</strong></ClusterButton></div>
      <div className="inspector-kpis-v146 inspector-kpis-v22"><div><strong>{project.boards.length}</strong><span>Boards</span></div><div><strong>{whiteboards.length}</strong><span>Whiteboards</span></div><div><strong>{members.length}</strong><span>People</span></div>{!videoProject ? <div><strong>{buildPlan.length}</strong><span>Build beats</span></div> : <div><strong>{checklist.filter((item) => item.done).length}/{checklist.length}</strong><span>Setup</span></div>}</div>
      <details className="inspector-section-v146 project-brief-inspector-v307 project-inspector-secondary-v22"><summary>Brief · {project.priority || "medium"}</summary><div className="project-inspector-secondary-body-v22"><p>{project.objective || project.description || "No project objective has been written yet."}</p><div className="project-inspector-tags-v307">{(project.tags || []).slice(0, 6).map((tag) => <span key={tag}>#{tag}</span>)}</div><dl><div><dt>Client</dt><dd>{project.clientName || "Internal"}</dd></div><div><dt>Target</dt><dd>{formatProjectDate(project.targetDate)}</dd></div></dl></div></details>
      {members.length > 0 && <section className="inspector-section-v146"><div className="inspector-section-title-v146"><strong>Project team</strong><span>{members.length}</span></div><div className="project-avatar-stack-v310">{members.slice(0, 7).map((member) => member.avatarUrl ? <img loading="lazy" decoding="async" key={member.id} src={member.avatarUrl} alt={member.displayName || member.username} title={member.displayName || member.username} /> : <span key={member.id} title={member.displayName || member.username}>{(member.displayName || member.username).slice(0, 2).toUpperCase()}</span>)}</div></section>}
      <details className="inspector-section-v146 project-inspector-secondary-v22"><summary>Setup readiness · {checklist.filter((item) => item.done).length}/{checklist.length}</summary><div className="project-inspector-secondary-body-v22"><div className="checklist-grid-v146">{checklist.map((item) => <span key={item.label} className={item.done ? "done" : "missing"}>{item.done ? <ClusterIcon name="check" /> : <ClusterIcon name="minus" />} {item.label}</span>)}</div></div></details>
      {gaps.length > 0 && <section className="inspector-section-v146"><div className="inspector-section-title-v146"><strong>Needs work</strong><span>{gaps.length}</span></div><div className="gap-list-v146">{gaps.slice(0, 5).map((gap) => <em key={gap}>{gap}</em>)}</div></section>}
    </aside>
  );
}

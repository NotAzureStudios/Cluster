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
  if (!project) return <aside className="pl-insp"><p className="pl-insp__empty">Select a project</p></aside>;
  const scheduleMeta = schedule || projectScheduleMeta(project, project.archived ? "archived" : String(project.status || "active"));
  const missingBuild = buildPlan.find((item) => item.status === "missing")?.label;
  const nextAction = scheduleMeta.tone === "danger" ? "Reset the overdue target" : gaps[0] ? gaps[0] : missingBuild ? `Set up ${missingBuild}` : "On track";
  const healthTone = health?.tone === "danger" || health?.tone === "warning" ? health.tone : "good";
  const done = checklist.filter((item) => item.done).length;
  const summary = (project.objective || project.description || "").trim();
  /* Project preview beside the list: identity, readiness, the next step,
     how to get in, then setup and team as indicators. */
  return (
    <aside className="pl-insp" aria-label="Selected project details" style={runtimeStyle({ "--pl-accent": project.color || "#57c1ff" })}>
      <header className="pl-insp__head">
        <span className="pl-card__mark"><ResourceIdentityMark iconId={project.iconId} projectId={project.id} projectType={project.projectType} label={project.name} accentColor={project.color} /></span>
        <div><h2>{project.name}</h2><small>{videoProject ? "Video" : source?.label || "Project"} · {project.archived ? "Archived" : String(project.status || "active").replaceAll("_", " ")}</small></div>
      </header>
      <div className="pl-insp__meter" data-tone={healthTone}>
        <span><strong>{completeness}%</strong> ready</span>
        <i aria-hidden="true"><b style={runtimeStyle({ width: `${completeness}%` })} /></i>
        {health ? <span className="pl-status" data-tone={healthTone}>{health.label}</span> : null}
      </div>
      <div className="pl-insp__next" data-tone={scheduleMeta.tone === "danger" ? "danger" : gaps.length ? "warning" : "good"}>
        <i className="pv-dot" aria-hidden="true" />
        <span><strong>{nextAction}</strong><small><ClusterIcon name="calendar" />{scheduleMeta.label}{project.targetDate ? ` · ${formatProjectDate(project.targetDate)}` : ""}</small></span>
      </div>
      <div className="pl-insp__actions">
        <ClusterButton variant="primary" size="compact" onClick={() => onOpenProject(project.id)}>Open</ClusterButton>
        {project.boards[0] ? <ClusterButton variant="secondary" size="compact" onClick={() => onOpenBoard(project.boards[0].id)}>Board</ClusterButton> : null}
        {whiteboards[0] ? <ClusterButton variant="secondary" size="compact" onClick={() => onOpenWhiteboard(whiteboards[0].id)}>Whiteboard</ClusterButton> : null}
      </div>
      <dl className="pl-insp__stats">
        <div><dt>Boards</dt><dd>{project.boards.length}</dd></div>
        <div><dt>Whiteboards</dt><dd>{whiteboards.length}</dd></div>
        <div><dt>People</dt><dd>{members.length}</dd></div>
        {!videoProject ? <div><dt>Build steps</dt><dd>{buildPlan.length}</dd></div> : null}
      </dl>
      {checklist.length ? <section className="pl-insp__section">
        <h3>Setup <span>{done}/{checklist.length}</span></h3>
        <ul className="pl-insp__check">{checklist.map((item) => <li key={item.label} data-done={item.done || undefined}><ClusterIcon name={item.done ? "check" : "minus"} />{item.label}</li>)}</ul>
      </section> : null}
      {members.length ? <section className="pl-insp__section">
        <h3>Team <span>{members.length}</span></h3>
        <div className="pl-insp__team">{members.slice(0, 10).map((member) => member.avatarUrl ? <img loading="lazy" decoding="async" key={member.id} src={member.avatarUrl} alt={member.displayName || member.username} title={member.displayName || member.username} /> : <span key={member.id} title={member.displayName || member.username}>{(member.displayName || member.username).slice(0, 1).toUpperCase()}</span>)}</div>
      </section> : null}
      {summary || project.clientName || (project.tags || []).length ? <section className="pl-insp__section">
        <h3>Brief</h3>
        {summary ? <p>{summary}</p> : null}
        <dl className="pl-insp__brief"><div><dt>Client</dt><dd>{project.clientName || "Internal"}</dd></div><div><dt>Priority</dt><dd>{project.priority || "medium"}</dd></div></dl>
        {(project.tags || []).length ? <div className="pl-insp__tags">{(project.tags || []).slice(0, 6).map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
      </section> : null}
    </aside>
  );
}

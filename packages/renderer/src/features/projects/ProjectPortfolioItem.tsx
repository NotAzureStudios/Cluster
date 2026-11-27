import type { Project } from "../application/application-models";
import type { MouseEvent } from "react";
import { projectScheduleMeta } from "./project-portfolio-model";
import { runtimeStyle } from "../../core/runtime-style";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ResourceIdentityMark } from "../../components/ResourceIdentityMark";
import { ClusterMiniRing } from "../../components/ClusterVisualMetrics";
import { ClusterRowActions } from "../../components/ClusterContextActions";

export function ProjectPortfolioItem({ project, selected, pinned, density, health, schedule, completeness, stageLabel, statusLabel, typeLabel, gaps, memberCount, fresh = false, onSelect, onInspect, onTogglePin, retiredActions }: {
  retiredActions?: { onRestore: () => void; onDelete?: () => void };
  project: Project;
  selected: boolean;
  pinned: boolean;
  density: "compact" | "comfortable";
  health: { label: string; tone: string };
  schedule?: { label: string; tone: string; detail?: string | null };
  completeness: number;
  stageLabel: string;
  statusLabel: string;
  typeLabel: string;
  gaps: string[];
  memberCount: number;
  fresh?: boolean;
  onSelect: () => void;
  onInspect: (event: MouseEvent<HTMLButtonElement>) => void;
  onTogglePin: () => void;
}) {
  const scheduleMeta = schedule || projectScheduleMeta(project, project.archived ? "archived" : String(project.status || "active"));
  const titleId = `project-portfolio-title-${project.id}`;
  const typeId = `project-portfolio-type-${project.id}`;
  const summaryId = `project-portfolio-summary-${project.id}`;
  // The description doubles as project notes; show its first real line.
  const noteLine = (project.description || "").split("\n").map((line) => line.replace(/^\s*(?:[-*] (?:\[[ xX]\] )?|#{1,3} )/, "").trim()).find(Boolean) || "";
  const summary = density === "comfortable" ? (project.objective || noteLine).trim() : "";
  // Only real problems (blocked, at risk) replace the status; setup nags don't.
  // Problems first; otherwise the pill shows the project's status colour.
  const tone = health.tone === "danger" ? "danger" : project.archived ? "neutral" : ({ on_hold: "warning", paused: "neutral", completed: "accent", cancelled: "danger" } as Record<string, string>)[project.status || ""] || "good";
  const scheduled = Boolean(project.targetDate);
  const scheduleTone = scheduleMeta.tone === "danger" || scheduleMeta.tone === "warning" ? scheduleMeta.tone : undefined;
  const scheduleShort = scheduleMeta.label.replace(/^Due in /, "").replace(/^Overdue by /, "−");
  /* One project: identity, a status chip, then indicators — readiness dial,
     time to target, head count, setup gaps — with the words in tooltips.
     The whole card opens the project; star and details sit on top of it. */
  return (
    <article data-cluster-context-row="true" data-project-id={project.id} className="pl-card" data-selected={selected || undefined} data-pinned={pinned || undefined} data-density={density} style={runtimeStyle({ "--pl-accent": project.color || "#57c1ff" })}>
      <ClusterButton unstyled type="button" className="pl-card__hit" aria-labelledby={typeLabel ? `${titleId} ${typeId}` : titleId} aria-describedby={summary ? summaryId : undefined} onClick={onSelect} title={`Open ${project.name}`} />
      <span className="pl-card__mark"><ResourceIdentityMark iconId={project.iconId} projectId={project.id} projectType={project.projectType} label={project.name} accentColor={project.color} /></span>
      <span className="pl-card__id">
        <strong id={titleId}>{project.name}{fresh ? <i className="pl-card__fresh" title="New activity since you last looked" aria-label="New activity" /> : null}</strong>
        {typeLabel ? <small id={typeId}>{typeLabel}</small> : null}
      </span>
      {summary ? <p id={summaryId} className="pl-card__summary" title={summary}>{summary}</p> : null}
      <span className="pl-status" data-tone={tone} title={health.label}>{health.tone === "danger" ? health.label : statusLabel}</span>
      <ul className="pl-card__facts">
        {scheduled ? <li data-tone={scheduleTone} title={scheduleMeta.detail || scheduleMeta.label}><ClusterIcon name="calendar" />{scheduleShort}</li> : null}
        <li title={`${memberCount} people`}><ClusterIcon name="users" />{memberCount}</li>
        {project.priority === "urgent" || project.priority === "high" ? <li data-tone={project.priority === "urgent" ? "danger" : "warning"} title={`${project.priority} priority`}><ClusterIcon name="spark" />{project.priority === "urgent" ? "Urgent" : "High"}</li> : null}
        {stageLabel ? <li className="pl-card__soft" title={`Stage: ${stageLabel}`}>{stageLabel}</li> : null}
      </ul>
      <span className="pl-card__actions">
        <ClusterRowActions label={`${project.name} actions`}>
          {retiredActions ? <ClusterIconButton label={`Restore ${project.name}`} size="compact" onClick={retiredActions.onRestore}><ClusterIcon name="refresh" /></ClusterIconButton> : null}
          {retiredActions?.onDelete ? <ClusterIconButton label={`Delete ${project.name}`} size="compact" onClick={retiredActions.onDelete}><ClusterIcon name="trash" /></ClusterIconButton> : null}
          <ClusterIconButton label={pinned ? `Unstar ${project.name}` : `Star ${project.name}`} size="compact" selected={pinned} onClick={onTogglePin} className="pl-card__pin"><ClusterIcon name={pinned ? "star-filled" : "star"} /></ClusterIconButton>
          <ClusterIconButton label={`Details for ${project.name}`} size="compact" onClick={onInspect}><ClusterIcon name="panel-open" /></ClusterIconButton>
        </ClusterRowActions>
      </span>
    </article>
  );
}

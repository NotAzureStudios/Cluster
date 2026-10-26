import type { CSSProperties } from "react";
import type { Project } from "../application/application-models";
import { formatProjectDate, projectScheduleMeta } from "./project-portfolio-model";
import { runtimeStyle } from "../../core/runtime-style";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterRowActions } from "../../components/ClusterContextActions";

export function ProjectPortfolioItem({ project, selected, pinned, density, health, schedule, completeness, stageLabel, statusLabel, typeLabel, gaps, memberCount, onSelect, onOpen, onTogglePin }: {
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
  onSelect: () => void;
  onOpen: () => void;
  onTogglePin: () => void;
}) {
  const scheduleMeta = schedule || projectScheduleMeta(project, project.archived ? "archived" : String(project.status || "active"));
  const titleId = `project-portfolio-title-${project.id}`;
  return (
    <article data-cluster-context-row="true" className={`project-row-v146 project-row-v310 project-row-v57 project-row-accessible-v370 ${selected ? "selected" : ""} ${pinned ? "pinned" : ""} density-${density}`} style={runtimeStyle({ "--project-row-accent": project.color || "#60a5fa" })}>
      <ClusterButton unstyled
        type="button"
        className="project-row-select-v370"
        aria-labelledby={titleId}
        aria-pressed={selected}
        onClick={onSelect}
        onDoubleClick={onOpen}
        title={`Select ${project.name}. Double-click to open.`}
      />
      <div className="project-row-main-v146">
        <strong id={titleId}><i className="project-color-v307" style={runtimeStyle({ background: project.color || "#60a5fa" })} aria-hidden="true" />{project.name}</strong>
        <span>{typeLabel} · {stageLabel}</span>
        {density === "comfortable" && <small>{project.objective || project.description || `${project.clientName || "Internal"} project`}</small>}
      </div>
      <div className="project-row-readiness-v310"><div className="project-row-meter-v146" role="progressbar" aria-label={`${project.name} readiness`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={completeness}><span style={runtimeStyle({ width: `${completeness}%` })} /></div><small>{completeness}% ready</small></div>
      <div className="project-row-state-v57">
        <span className="project-status-chip-v57">{statusLabel}</span>
        <span className={`project-schedule-chip-v310 ${scheduleMeta.tone}`} title={scheduleMeta.detail || scheduleMeta.label}>{scheduleMeta.label}</span>
      </div>
      <span className={`health-pill ${health.tone}`}>{health.label}</span>
      <ClusterRowActions label={`${project.name} row actions`}>
        <ClusterIconButton label={pinned ? `Unpin ${project.name}` : `Pin ${project.name}`} size="compact" selected={pinned} onClick={onTogglePin} className={`project-pin-v307 ${pinned ? "active" : ""}`}><ClusterIcon name={pinned ? "star-filled" : "star"} /></ClusterIconButton>
        <ClusterButton size="compact" onClick={onOpen} className="project-row-open-v310">Open</ClusterButton>
      </ClusterRowActions>
      {density === "comfortable" && (
        <div className="project-row-context-v57">
          <span className={`project-row-priority-v307 ${project.priority || "medium"}`}>{project.priority || "medium"} priority</span>
          <span>{memberCount} {memberCount === 1 ? "person" : "people"}</span>
          <span className={gaps.length ? "warning" : "good"}>{gaps.length ? `${gaps.length} setup gap${gaps.length === 1 ? "" : "s"}` : "Setup ready"}</span>
          {project.clientName ? <span>{project.clientName}</span> : null}
          <span>{formatProjectDate(project.targetDate)}</span>
        </div>
      )}
    </article>
  );
}

import type { Project } from "../application/application-models";
import type { MouseEvent } from "react";
import { projectScheduleMeta } from "./project-portfolio-model";
import { runtimeStyle } from "../../core/runtime-style";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ResourceIdentityMark } from "../../components/ResourceIdentityMark";
import { ClusterVisualRing } from "../../components/ClusterVisualMetrics";
import { ClusterRowActions } from "../../components/ClusterContextActions";

export function ProjectPortfolioItem({ project, selected, pinned, density, health, schedule, completeness, stageLabel, statusLabel, typeLabel, gaps, memberCount, onSelect, onInspect, onTogglePin }: {
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
  onInspect: (event: MouseEvent<HTMLButtonElement>) => void;
  onTogglePin: () => void;
}) {
  const scheduleMeta = schedule || projectScheduleMeta(project, project.archived ? "archived" : String(project.status || "active"));
  const titleId = `project-portfolio-title-${project.id}`;
  const typeId = `project-portfolio-type-${project.id}`;
  const summaryId = `project-portfolio-summary-${project.id}`;
  const summary = (project.objective || project.description || "").trim();
  return (
    <article title={`${project.name} · ${typeLabel}`} data-cluster-context-row="true" data-project-id={project.id} className={`project-row-v146 project-row-v310 project-row-v57 project-row-accessible-v370 project-tile-rc25 ${selected ? "selected" : ""} ${pinned ? "pinned" : ""} density-${density}`} style={runtimeStyle({ "--project-row-accent": project.color || "#57c1ff" })}>
      <ClusterButton unstyled type="button" className="project-row-select-v370" aria-labelledby={typeLabel ? `${titleId} ${typeId}` : titleId} aria-describedby={density === "comfortable" && summary ? summaryId : undefined} onClick={onSelect} title={`Open ${project.name}`} />
      <div className="project-tile-head-rc25">
        <span className="project-tile-avatar-rc25"><ResourceIdentityMark iconId={project.iconId} projectId={project.id} projectType={project.projectType} label={project.name} accentColor={project.color} /></span>
        <div className="project-tile-identity-rc25">
          <strong id={titleId}>{project.name}</strong>
          {typeLabel && <span id={typeId} className="project-tile-type-rc25" title={typeLabel}>{typeLabel}</span>}
        </div>
        <ClusterRowActions label={`${project.name} actions`}>
          <ClusterIconButton label={pinned ? `Unstar ${project.name}` : `Star ${project.name}`} size="compact" selected={pinned} onClick={onTogglePin} className={`project-pin-v307 ${pinned ? "active" : ""}`}><ClusterIcon name={pinned ? "star-filled" : "star"} /></ClusterIconButton>
          <ClusterButton size="compact" variant="quiet" onClick={onInspect}>Details</ClusterButton>
        </ClusterRowActions>
      </div>
      {density === "comfortable" && summary && (
        <p id={summaryId} className="project-tile-summary-rc25" title={summary}>{summary}</p>
      )}
      <div className="project-tile-tags-rc25">
        <span className="project-tile-status-rc25">{statusLabel}</span>
        {health.tone !== "good" ? <span className={`project-tile-health-rc25 ${health.tone}`}>{health.label}</span> : null}
        {project.priority === "urgent" || project.priority === "high" ? <span className="project-tile-priority-rc25">{project.priority} priority</span> : null}
        {density === "comfortable" && gaps.length > 0 && (
          <span className="project-tile-gaps-rc25" title={gaps.join(" · ")}>
            {gaps.length} setup gap{gaps.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div className="project-tile-bottom-rc25">
        <div className="project-tile-progress-rc25">
          <ClusterVisualRing label="Ready" percent={completeness} compact tone={completeness < 50 ? "warning" : "accent"} />
        </div>
        <span className="project-tile-members-rc25" title={`${memberCount} assigned people`}><ClusterIcon name="users" /> {memberCount}</span>
      </div>
      {density === "comfortable" && <footer className="project-tile-footer-rc25">
        <span title={scheduleMeta.detail || scheduleMeta.label}><ClusterIcon name="calendar" /> {scheduleMeta.label}</span>
        {stageLabel ? <span title={`Build stage: ${stageLabel}`}>{stageLabel}</span> : null}
      </footer>}
    </article>
  );
}

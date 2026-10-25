import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { useMemo } from "react";
import { controlDateLabel, type ProjectControlRecord, type ProjectRelationship } from "./project-control-model";
import { runtimeStyle } from "../../core/runtime-style";

function timestamp(value?: string | null) {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : null;
}

export function ProjectRoadmapWorkbench({ records, relationships, busy, canManage, onMove, onMaterialize, onSyncTimeline }: {
  records: ProjectControlRecord[];
  relationships: ProjectRelationship[];
  busy: boolean;
  canManage: boolean;
  onMove: (record: ProjectControlRecord, direction: -1 | 1) => void;
  onMaterialize: (record: ProjectControlRecord, target: "ticket" | "timeline") => void;
  onSyncTimeline: () => void;
}) {
  const dated = records.filter((record) => ["phase", "milestone", "deliverable"].includes(record.kind) && (record.startDate || record.dueDate));
  const range = useMemo(() => {
    const starts = dated.map((record) => timestamp(record.startDate || record.dueDate)).filter((value): value is number => value !== null);
    const ends = dated.map((record) => timestamp(record.dueDate || record.startDate)).filter((value): value is number => value !== null);
    const min = starts.length ? Math.min(...starts) : Date.now();
    const max = ends.length ? Math.max(...ends) : min + 86400000;
    return { min, span: Math.max(86400000, max - min) };
  }, [dated]);
  const critical = relationships.filter((item) => item.critical);
  return (
    <div className="project-roadmap-workbench-v315">
      <header><div><strong>Roadmap timeline</strong><span>{dated.length} dated records · {critical.length} critical dependencies</span></div>{canManage ? <ClusterButton type="button" className="" disabled={busy} onClick={onSyncTimeline} variant="quiet" size="compact">Sync all to Timeline</ClusterButton> : <span className="project-permission-badge-v316">Read only</span>}</header>
      {dated.length ? <div className="project-roadmap-gantt-v315">{dated.sort((a, b) => a.sortOrder - b.sortOrder).map((record, index) => {
        const start = timestamp(record.startDate || record.dueDate) || range.min;
        const end = timestamp(record.dueDate || record.startDate) || start;
        const left = Math.max(0, Math.min(98, ((start - range.min) / range.span) * 100));
        const width = Math.max(2, Math.min(100 - left, ((Math.max(end, start + 86400000) - start) / range.span) * 100));
        return <article key={record.id}><div><strong>{record.title}</strong><span>{controlDateLabel(record.startDate || record.dueDate)} → {controlDateLabel(record.dueDate || record.startDate)}</span></div><div className="project-roadmap-track-v315"><i style={runtimeStyle({ left: `${left}%`, width: `${width}%` })}><b>{record.progress}%</b></i></div>{canManage ? <footer><ClusterButton type="button" className="" disabled={index === 0 || busy} onClick={() => onMove(record, -1)} variant="quiet" size="compact" aria-label={`Move ${record.title} up`}><ClusterIcon name="chevron-up" /></ClusterButton><ClusterButton type="button" className="" disabled={index === dated.length - 1 || busy} onClick={() => onMove(record, 1)} variant="quiet" size="compact" aria-label={`Move ${record.title} down`}><ClusterIcon name="chevron-down" /></ClusterButton><ClusterButton type="button" className="" disabled={busy} onClick={() => onMaterialize(record, "ticket")} variant="quiet" size="compact">Create ticket</ClusterButton><ClusterButton type="button" className="" disabled={busy} onClick={() => onMaterialize(record, "timeline")} variant="quiet" size="compact">Timeline</ClusterButton></footer> : null}</article>;
      })}</div> : <p className="muted-copy">Add start or due dates to phases, milestones, and deliverables to build the timeline.</p>}
      {critical.length ? <div className="project-critical-path-v315"><strong>Critical path</strong>{critical.map((item) => <span key={item.id}>{item.relationship.replace(/_/g, " ")} · {item.sourceId.slice(0, 8)} → {item.targetId.slice(0, 8)}</span>)}</div> : null}
    </div>
  );
}

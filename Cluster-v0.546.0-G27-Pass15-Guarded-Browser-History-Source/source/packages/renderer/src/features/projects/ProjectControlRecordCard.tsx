import { ClusterButton } from "../../components/ClusterButton";
import type { User } from "../application/application-models";
import { PROJECT_CONTROL_KIND_META, controlDateLabel, recordIsClosed, recordIsOverdue, type ProjectControlRecord } from "./project-control-model";
import { runtimeStyle } from "../../core/runtime-style";

export function ProjectControlRecordCard({ record, users, childCount = 0, selected = false, onSelect, onEdit, onToggleDone, onDelete, onMaterialize }: {
  record: ProjectControlRecord;
  users: User[];
  childCount?: number;
  selected?: boolean;
  onSelect?: () => void;
  onEdit?: () => void;
  onToggleDone?: () => void;
  onDelete?: () => void;
  onMaterialize?: (target: "ticket" | "timeline") => void;
}) {
  const meta = PROJECT_CONTROL_KIND_META[record.kind];
  const owner = users.find((user) => user.id === record.ownerId);
  const overdue = recordIsOverdue(record);
  const closed = recordIsClosed(record);
  const riskScore = record.kind === "risk" ? Math.max(1, Number(record.probability || 1)) * Math.max(1, Number(record.impact || 1)) : null;
  return (
    <article className={`project-control-card-v313 ${meta.tone} ${selected ? "selected" : ""} ${closed ? "closed" : ""} ${overdue ? "overdue" : ""}`}>
      <header><div><span className={`project-control-kind-v313 ${meta.tone}`}>{meta.label}</span>{record.category ? <span className="project-control-category-v313">{record.category}</span> : null}</div><span className={`project-control-priority-v313 ${record.priority}`}>{record.priority}</span></header>
      <h4>{onSelect ? <ClusterButton unstyled type="button" className="project-control-title-button-v393" onClick={onSelect} aria-pressed={selected}>{record.title}</ClusterButton> : record.title}</h4>
      {record.description ? <p>{record.description}</p> : null}
      {record.linkedEntity ? <div className={`project-control-link-v315 ${record.linkState || "linked"}`}><span>{record.linkedEntity.type.replace(/_/g, " ")}</span><strong>{record.linkedEntity.title}</strong><em>{record.linkedEntity.status}{record.linkedEntity.progress !== null && record.linkedEntity.progress !== undefined ? ` · ${record.linkedEntity.progress}%` : ""}</em></div> : record.linkedEntityId ? <div className="project-control-link-v315 missing"><span>Missing link</span><strong>{record.linkedEntityType}</strong><em>The linked entity no longer exists.</em></div> : null}
      <div className="project-control-card-meta-v313"><span className={overdue ? "danger" : ""}>{record.dueDate ? `${overdue ? "Overdue" : "Due"} ${controlDateLabel(record.dueDate)}` : "No due date"}</span><span>{owner?.displayName || owner?.username || "Unassigned"}</span>{riskScore !== null ? <span className={riskScore >= 12 ? "danger" : riskScore >= 8 ? "warning" : ""}>Risk {riskScore}/25</span> : null}{childCount ? <span>{childCount} linked item{childCount === 1 ? "" : "s"}</span> : null}</div>
      {!['risk','decision','assumption','dependency','change_request','responsibility','saved_view','automation','baseline','budget'].includes(record.kind) ? <div className="project-control-progress-v313"><span style={runtimeStyle({ width: `${closed ? 100 : Math.max(0, Math.min(100, record.progress || 0))}%` })} /><em>{closed ? 100 : record.progress || 0}%</em></div> : null}
      <footer><span className={`project-control-status-v313 ${record.status}`}>{record.status.replace(/_/g, " ")}</span><div>{onMaterialize && !record.linkedEntityId ? <><ClusterButton type="button" className="" onClick={(event) => { event.stopPropagation(); onMaterialize("ticket"); }} variant="quiet" size="compact">Ticket</ClusterButton><ClusterButton type="button" className="" onClick={(event) => { event.stopPropagation(); onMaterialize("timeline"); }} variant="quiet" size="compact">Timeline</ClusterButton></> : null}{onToggleDone ? <ClusterButton type="button" className="" onClick={(event) => { event.stopPropagation(); onToggleDone(); }} variant="quiet" size="compact">{closed ? "Reopen" : "Complete"}</ClusterButton> : null}{onEdit ? <ClusterButton type="button" className="" onClick={(event) => { event.stopPropagation(); onEdit(); }} variant="quiet" size="compact">Edit</ClusterButton> : null}{onDelete ? <ClusterButton type="button" className="" onClick={(event) => { event.stopPropagation(); onDelete(); }} variant="danger" size="compact">Archive</ClusterButton> : null}</div></footer>
    </article>
  );
}

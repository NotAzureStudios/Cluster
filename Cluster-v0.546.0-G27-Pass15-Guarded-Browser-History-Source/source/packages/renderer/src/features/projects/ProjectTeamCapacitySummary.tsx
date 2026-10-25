import { useMemo } from "react";
import type { User } from "../application/application-models";
import { recordIsClosed, recordIsOverdue, type ProjectControlRecord } from "./project-control-model";

export function ProjectTeamCapacitySummary({ records, users }: { records: ProjectControlRecord[]; users: User[] }) {
  const rows = useMemo(() => users.map((user) => {
    const owned = records.filter((record) => record.ownerId === user.id && !["saved_view", "automation", "status_report"].includes(record.kind));
    return { user, active: owned.filter((record) => !recordIsClosed(record)).length, overdue: owned.filter(recordIsOverdue).length, responsibilities: owned.filter((record) => record.kind === "responsibility").length, dueSoon: owned.filter((record) => !recordIsClosed(record) && record.dueDate && new Date(record.dueDate).getTime() <= Date.now() + 7 * 86400000).length };
  }).filter((row) => row.active || row.responsibilities).sort((a, b) => b.overdue - a.overdue || b.active - a.active), [records, users]);
  return <div className="project-team-capacity-v315"><header><strong>Workload and coverage</strong><span>{rows.length} active owners · {records.filter((record) => !record.ownerId && !recordIsClosed(record)).length} unowned records</span></header>{rows.length ? <div>{rows.map((row) => <article key={row.user.id} className={row.overdue ? "danger" : row.active > 8 ? "warning" : "good"}><strong>{row.user.displayName || row.user.username}</strong><span>{row.active} active</span><span>{row.dueSoon} due soon</span><span>{row.overdue} overdue</span><em>{row.responsibilities ? `${row.responsibilities} RACI assignments` : row.active > 8 ? "High load" : "Balanced"}</em></article>)}</div> : <p className="muted-copy">Assign owners to delivery and responsibility records to calculate workload coverage.</p>}</div>;
}

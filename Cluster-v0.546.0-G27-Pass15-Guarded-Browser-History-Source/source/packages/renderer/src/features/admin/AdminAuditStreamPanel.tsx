import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { useEffect, useMemo, useRef, useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { queryApi } from "../../core/api";
import { formatRelativeTime } from "../../core/format";
import type { Project, UserActivitySummary } from "../application/application-models";

type AdminAuditActivityEvent = {
  id: string;
  userId?: string | null;
  projectId?: string | null;
  type: string;
  entityType: string;
  entityId?: string | null;
  title: string;
  message?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  user?: { id: string; username: string; displayName?: string | null } | null;
  project?: { id: string; name: string } | null;
};

function dateBoundary(value: string, endOfDay = false) {
  if (!value) return "";
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function actorLabel(event: AdminAuditActivityEvent) {
  return event.user?.displayName || event.user?.username || (event.userId ? `User ${event.userId.slice(0, 8)}` : "System");
}

export function AdminAuditStreamPanel({ projects, users }: { projects: Project[]; users: UserActivitySummary[] }) {
  const [events, setEvents] = useState<AdminAuditActivityEvent[]>([]);
  const [action, setAction] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const requestSequence = useRef(0);

  async function load(force = false, reset = false) {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setStatus("");
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (!reset && action.trim()) params.set("type", action.trim());
      if (!reset && resourceType.trim()) params.set("entityType", resourceType.trim());
      if (!reset && resourceId.trim()) params.set("entityId", resourceId.trim());
      if (!reset && projectId) params.set("projectId", projectId);
      if (!reset && userId) params.set("userId", userId);
      const fromIso = reset ? "" : dateBoundary(from);
      const toIso = reset ? "" : dateBoundary(to, true);
      if (fromIso) params.set("from", fromIso);
      if (toIso) params.set("to", toIso);
      const result = await queryApi<AdminAuditActivityEvent[]>(`/api/audit/activity?${params.toString()}`, {
        force,
        staleMs: 5_000,
        maxAgeMs: 60_000,
        tags: ["admin", "audit", "activity"],
      });
      if (requestId !== requestSequence.current) return;
      setEvents(result);
      setStatus(`${result.length} audit record${result.length === 1 ? "" : "s"} loaded.`);
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      setEvents([]);
      setStatus(error instanceof Error ? error.message : "Audit activity could not be loaded.");
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }

  useEffect(() => { void load(); return () => { ++requestSequence.current; }; }, []);

  const resourceTypes = useMemo(() => [...new Set(events.map((event) => event.entityType).filter(Boolean))].sort(), [events]);
  const actions = useMemo(() => [...new Set(events.map((event) => event.type).filter(Boolean))].sort(), [events]);

  return <section className="management-panel admin-resource-panel admin-audit-stream-v16c">
    <header className="admin-audit-stream-head-v16c">
      <div>
        <p className="eyebrow">Authoritative evidence</p>
        <h2>Audit activity</h2>
        <p className="muted tight">Admin-only activity evidence from the canonical audit endpoint. Ordinary Activity remains the human workspace history; this stream is for traceability and investigation.</p>
      </div>
      <ClusterButton type="button" variant="secondary" disabled={loading} onClick={() => void load(true)}>{loading ? "Refreshing…" : "Refresh"}</ClusterButton>
    </header>

    <div className="admin-audit-filters-v16c">
      <label><span>Action</span><ClusterNativeSelect value={action} onChange={(event) => setAction(event.target.value)}><option value="">All actions</option>{actions.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</ClusterNativeSelect></label>
      <label><span>Resource</span><ClusterNativeSelect value={resourceType} onChange={(event) => setResourceType(event.target.value)}><option value="">All resources</option>{resourceTypes.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</ClusterNativeSelect></label>
      <label><span>Resource ID</span><ClusterTextInput value={resourceId} onChange={(event) => setResourceId(event.target.value)} placeholder="Exact ID" /></label>
      <label><span>Project</span><ClusterNativeSelect value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</ClusterNativeSelect></label>
      <label><span>Actor</span><ClusterNativeSelect value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">All actors</option>{users.map((user) => <option key={user.id} value={user.id}>{user.displayName || user.username}</option>)}</ClusterNativeSelect></label>
      <label><span>From</span><ClusterTextInput type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label><span>To</span><ClusterTextInput type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <div className="admin-audit-filter-actions-v16c"><ClusterButton type="button" variant="primary" disabled={loading} onClick={() => void load(true)}>Apply filters</ClusterButton><ClusterButton type="button" variant="quiet" onClick={() => { setAction(""); setResourceType(""); setResourceId(""); setProjectId(""); setUserId(""); setFrom(""); setTo(""); void load(true, true); }}>Clear</ClusterButton></div>
    </div>

    {status ? <p className="muted tight admin-audit-status-v16c">{status}</p> : null}
    <div className="admin-audit-list-v16c">
      {events.map((event) => <article key={event.id}>
        <div className="admin-audit-event-main-v16c">
          <div><span className="soft-pill">{event.entityType.replaceAll("_", " ")}</span><strong>{event.title}</strong>{event.message ? <p>{event.message}</p> : null}</div>
          <time dateTime={event.createdAt}>{formatRelativeTime(event.createdAt)}</time>
        </div>
        <dl>
          <div><dt>Action</dt><dd>{event.type.replaceAll("_", " ")}</dd></div>
          <div><dt>Actor</dt><dd>{actorLabel(event)}</dd></div>
          <div><dt>Project</dt><dd>{event.project?.name || (event.projectId ? event.projectId : "Workspace")}</dd></div>
          <div><dt>Resource ID</dt><dd>{event.entityId || "—"}</dd></div>
        </dl>
        {event.metadata && Object.keys(event.metadata).length ? <ClusterDisclosureGroup title="Evidence / metadata"><pre>{JSON.stringify(event.metadata, null, 2)}</pre></ClusterDisclosureGroup> : null}
      </article>)}
      {!loading && !events.length ? <div className="admin-audit-empty-v16c"><strong>No audit activity matches these filters.</strong><span>Broaden the filters or verify that the relevant action emits canonical activity evidence.</span></div> : null}
    </div>
  </section>;
}

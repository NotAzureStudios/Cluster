import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { useEffect, useMemo, useRef, useState } from "react";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { api } from "../../core/api";
import { copyWorkLink } from "../workflow/work-actions";
import "./admin-workflows.css";
import { ageDays, approvalPriority, sortApprovalQueue, type ApprovalItem, type ApprovalSort } from "./admin-approval-queue";

type ApprovalPayload = { requests: ApprovalItem[]; avatarAudits: ApprovalItem[]; warnings?: string[] };
type ProjectOption = { id: string; name: string };
function typeLabel(value: string) {
  if (value === "project_completion") return "Project completion";
  if (value === "time_off") return "Time off";
  if (value === "avatar_change") return "Profile icon";
  if (value === "external_release") return "External release";
  return value.replace(/_/g, " ");
}

function dateLabel(value?: string | null) {
  return value ? new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
}

export function AdminApprovalCenter({ projects = [] }: { projects?: ProjectOption[] }) {
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [typeFilter, setTypeFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [agingOnly, setAgingOnly] = useState(false);
  const [sortMode, setSortMode] = useState<ApprovalSort>("priority");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  // Notes follow approval IDs, never the current queue index.
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busyId, setBusyId] = useState("");
  const decidingRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const targetSequenceRef = useRef(0);
  const readApprovalTarget = () => {
    const inspect = new URL(window.location.href).searchParams.get("inspect") || "";
    return inspect.startsWith("approval:") ? inspect.slice("approval:".length) : "";
  };
  const [targetId, setTargetId] = useState(readApprovalTarget);
  useEffect(() => {
    const syncTarget = () => setTargetId(readApprovalTarget());
    window.addEventListener("cluster:inspector-state-changed", syncTarget);
    window.addEventListener("popstate", syncTarget);
    return () => {
      window.removeEventListener("cluster:inspector-state-changed", syncTarget);
      window.removeEventListener("popstate", syncTarget);
    };
  }, []);
  useEffect(() => {
    const sequence = ++targetSequenceRef.current;
    if (!targetId) return;
    setStatusFilter("all");
    setPriorityFilter("all");
    setTypeFilter("all");
    setProjectFilter("all");
    setAgingOnly(false);
    setQuery("");
    setSelectedId(targetId);
    // The ordinary queue is capped at 500; a permalink must load the exact
    // target independently, including historical and resolved approvals.
    void api<{ approval: ApprovalItem }>(`/api/admin/approvals/${encodeURIComponent(targetId)}`)
      .then(({ approval }) => {
        if (targetSequenceRef.current !== sequence) return;
        setItems((current) => [...current.filter((item) => item.id !== approval.id), approval]);
        setSelectedId(approval.id);
      })
      .catch((error) => {
        if (targetSequenceRef.current !== sequence) return;
        setError(error instanceof Error ? error.message : "Approval is unavailable or you no longer have permission.");
      });
    return () => { targetSequenceRef.current++; };
  }, [targetId]);

  async function load() {
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setError("");
    try {
      const payload = await api<ApprovalPayload>("/api/admin/approvals?status=all&limit=500");
      const next = [...(payload.requests || []), ...(payload.avatarAudits || [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (generation === loadGenerationRef.current) {
        setWarnings(payload.warnings || []);
        setItems((current) => {
          // Keep a separately authenticated permalink result when it is older
          // than the bounded queue, even if queue refresh finishes afterward.
          const pinned = targetId ? current.find((item) => item.id === targetId) : null;
          return pinned && !next.some((item) => item.id === pinned.id) ? [pinned, ...next] : next;
        });
        setSelectedId((current) => current || targetId || next[0]?.id || "");
      }
    } catch (loadError) {
      if (generation === loadGenerationRef.current) {
        // A failed refresh does not prove the pending queue is empty. Keep the
        // last known queue and require a fresh server decision before mutating.
        setError(loadError instanceof Error ? loadError.message : "Approvals failed to refresh. Previous results remain visible.");
      }
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sortApprovalQueue(items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (typeFilter !== "all" && item.type !== typeFilter) return false;
      if (projectFilter !== "all" && item.projectId !== projectFilter) return false;
      if (priorityFilter !== "all" && approvalPriority(item) !== priorityFilter) return false;
      if (agingOnly && (item.status !== "pending" || ageDays(item) < 3)) return false;
      if (needle && ![item.title, item.requestedByName, item.reason, typeLabel(item.type)].filter(Boolean).join(" ").toLowerCase().includes(needle)) return false;
      return true;
    }), sortMode);
  }, [items, statusFilter, typeFilter, projectFilter, priorityFilter, agingOnly, query, sortMode]);

  useEffect(() => {
    // A revoked/deleted permalink must not silently select an unrelated approval.
    if (targetId) return;
    if (visible.length && !visible.some((item) => item.id === selectedId)) setSelectedId(visible[0].id);
  }, [visible, selectedId, targetId]);

  const selected = visible.find((item) => item.id === selectedId) || null;
  const note = selected ? notesById[selected.id] || "" : "";
  const noteDraftCount = Object.values(notesById).filter((value) => Boolean(value.trim())).length;
  useUnsavedChangesGuard({
    dirty: noteDraftCount > 0,
    title: "Discard unsaved approval notes?",
    message: "Some approval decisions have draft notes that have not been submitted.",
  });
  const counts = useMemo(() => ({
    pending: items.filter((item) => item.status === "pending").length,
    urgent: items.filter((item) => item.status === "pending" && approvalPriority(item) === "urgent").length,
    aging: items.filter((item) => item.status === "pending" && ageDays(item) >= 3).length,
    approved: items.filter((item) => item.status === "approved").length,
    rejected: items.filter((item) => item.status === "rejected").length
  }), [items]);
  const types = Array.from(new Set(items.map((item) => item.type))).sort();

  async function discardApprovalDrafts() {
    if (!noteDraftCount) return;
    const confirmed = await confirmCluster({
      title: "Discard approval note drafts?",
      message: "Unsaved decision notes will be cleared from this device. No approvals will be changed.",
      confirmLabel: "Discard drafts",
      tone: "danger",
    });
    if (confirmed) setNotesById({});
  }

  async function decide(item: ApprovalItem, decision: "approved" | "rejected") {
    if (decidingRef.current || item.status !== "pending") return;
    decidingRef.current = true;
    const submittedNote = notesById[item.id]?.trim() || null;
    setBusyId(item.id);
    setMessage("");
    setError("");
    try {
      // External releases and Project closeout have downstream visibility/lifecycle effects.
      if (item.type === "external_release" || item.type === "project_completion") {
        const confirmed = await confirmCluster({
          title: `${decision === "approved" ? "Approve" : "Reject"} ${typeLabel(item.type)}?`,
          message: `${item.title}\nRequester: ${item.requestedByName || "Unknown"}\nThis decision may change access or Project lifecycle state.`,
          confirmLabel: decision === "approved" ? "Approve request" : "Reject request",
          tone: decision === "rejected" ? "danger" : "default",
        });
        if (!confirmed) return;
      }
      // Server enforces one-time pending transitions. Local locking prevents accidental
      // duplicate submissions while React has not yet repainted the button.
      await api(`/api/admin/approvals/${encodeURIComponent(item.id)}/decision`, { method: "POST", body: JSON.stringify({ decision, note: submittedNote }) });
      setNotesById((current) => { const updated = { ...current }; delete updated[item.id]; return updated; });
      setMessage(`${item.title} ${decision}.`);
      // Reconcile the local queue immediately. If the subsequent refresh fails,
      // a resolved request must not remain actionable as if nothing happened.
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: decision } : entry));
      // Continue through the queue instead of leaving the reviewer staring at a
      // resolved card until the next page fetch. The server remains authoritative.
      const nextPending = visible.find((entry) => entry.id !== item.id && entry.status === "pending");
      if (nextPending) setSelectedId(nextPending.id);
      await load();
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "Approval decision failed. Refresh to check its current status.");
    } finally {
      decidingRef.current = false;
      setBusyId("");
    }
  }

  return <section className="admin-approval-center-v249">
    <header className="admin-approval-head-v249"><div><h2>Approvals</h2><span>Completion, time off, profile changes, and external release decisions.</span></div><div className="button-row">{selected && <ClusterButton type="button" variant="secondary" onClick={() => {
      void copyWorkLink({ source: { kind: "approval", id: selected.id, label: selected.title }, navigation: { screen: "admin", inspectScope: "approval", inspectId: selected.id } })
        .then((copied) => setMessage(copied ? "Approval link copied." : "Could not copy approval link."))
        .catch(() => setMessage("Could not copy approval link."));
    }}>Copy link</ClusterButton>}<ClusterButton type="button" className="" onClick={() => void load()} disabled={loading} variant="secondary">{loading ? "Loading" : "Refresh"}</ClusterButton></div></header>
    <div className="admin-approval-metrics-v249">
      <ClusterButton unstyled type="button" className={statusFilter === "pending" ? "active" : ""} onClick={() => { setStatusFilter("pending"); setAgingOnly(false); }}><strong>{counts.pending}</strong><span>Pending</span></ClusterButton>
      <ClusterButton unstyled type="button" className={priorityFilter === "urgent" ? "active attention" : counts.urgent ? "attention" : ""} onClick={() => { setStatusFilter("pending"); setPriorityFilter(priorityFilter === "urgent" ? "all" : "urgent"); setAgingOnly(false); }}><strong>{counts.urgent}</strong><span>Urgent</span></ClusterButton>
      <ClusterButton unstyled type="button" className={agingOnly ? "active attention" : counts.aging ? "attention" : ""} onClick={() => { setStatusFilter("pending"); setPriorityFilter("all"); setAgingOnly((current) => !current); }}><strong>{counts.aging}</strong><span>3+ days</span></ClusterButton>
      <ClusterButton unstyled type="button" className={statusFilter === "approved" ? "active" : ""} onClick={() => { setStatusFilter("approved"); setAgingOnly(false); }}><strong>{counts.approved}</strong><span>Approved</span></ClusterButton>
      <ClusterButton unstyled type="button" className={statusFilter === "rejected" ? "active" : ""} onClick={() => { setStatusFilter("rejected"); setAgingOnly(false); }}><strong>{counts.rejected}</strong><span>Rejected</span></ClusterButton>
    </div>
    <div className="admin-approval-toolbar-v249">
      <ClusterTextInput type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search approvals" aria-label="Search approvals" />
      <ClusterNativeSelect value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setAgingOnly(false); }} aria-label="Approval status"><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="all">All status</option></ClusterNativeSelect>
      <ClusterNativeSelect value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} aria-label="Approval priority"><option value="all">All priorities</option><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></ClusterNativeSelect>
      <ClusterNativeSelect value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Approval type"><option value="all">All types</option>{types.map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}</ClusterNativeSelect>
      <ClusterNativeSelect value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} aria-label="Approval project"><option value="all">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</ClusterNativeSelect>
      <ClusterNativeSelect value={sortMode} onChange={(event) => setSortMode(event.target.value as ApprovalSort)} aria-label="Approval queue order"><option value="priority">Priority then oldest</option><option value="oldest">Oldest first</option><option value="newest">Newest first</option></ClusterNativeSelect>
    </div>
    {error && <div className="error-box slim">{error}</div>}
    {message && <div className="status-box slim">{message}</div>}
    {noteDraftCount > 0 && <div className="button-row"><span className="muted" role="status">{noteDraftCount} unsaved approval note{noteDraftCount === 1 ? "" : "s"} retained across filters</span><ClusterButton type="button" variant="quiet" size="compact" disabled={Boolean(busyId)} onClick={() => void discardApprovalDrafts()}>Discard note drafts</ClusterButton></div>}
    {warnings.length > 0 && <div className="hint-box slim">Some approval sources were unavailable: {warnings.join(" · ")}</div>}
    <div className="admin-approval-queue-tools-v530">
      <span>{visible.length} matching request{visible.length === 1 ? "" : "s"}</span>
      <ClusterButton size="compact" variant="quiet" disabled={visible.length < 2} onClick={() => { const index = visible.findIndex((item) => item.id === selectedId); setSelectedId(visible[(index + 1) % visible.length]?.id || ""); }}>Next in queue</ClusterButton>
    </div>
    <div className="admin-approval-layout-v249">
      <div className="admin-approval-list-v249">
        {visible.length ? visible.map((item) => <ClusterButton unstyled type="button" key={item.id} className={selectedId === item.id ? "active" : ""} onClick={() => setSelectedId(item.id)}><span className={`approval-priority-v249 ${approvalPriority(item)}`}>{approvalPriority(item)}</span><span><strong>{item.title}</strong><em>{typeLabel(item.type)} · {item.requestedByName || "Person"}</em></span><span><b>{ageDays(item)}d</b><em>{item.status}</em></span></ClusterButton>) : <ClusterEmptyState compact kind="filtered" title="No approvals" description="No approval requests match the current filters." />}
      </div>
      <aside className="admin-approval-detail-v249">
        {selected ? <><header><div><span className={`approval-priority-v249 ${approvalPriority(selected)}`}>{approvalPriority(selected)}</span><h3>{selected.title}</h3><em>{typeLabel(selected.type)} · {selected.status}</em></div></header><dl><div><dt>Requested by</dt><dd>{selected.requestedByName || "Person"}</dd></div><div><dt>Requested</dt><dd>{dateLabel(selected.createdAt)} · {ageDays(selected)} day{ageDays(selected) === 1 ? "" : "s"} ago</dd></div>{selected.projectId && <div><dt>Project</dt><dd>{projects.find((project) => project.id === selected.projectId)?.name || selected.projectId}</dd></div>}{selected.startsAt && <div><dt>Dates</dt><dd>{dateLabel(selected.startsAt)} – {dateLabel(selected.endsAt)}</dd></div>}{selected.reason && <div><dt>Reason</dt><dd>{selected.reason}</dd></div>}</dl>{selected.status === "pending" ? <><label><span>Decision note</span><ClusterTextArea value={note} onChange={(event) => setNotesById((current) => ({ ...current, [selected.id]: event.target.value }))} placeholder="Explain the decision when context matters." /></label><div className="button-row"><ClusterButton type="button" className="" disabled={Boolean(busyId)} onClick={() => void decide(selected, "rejected")} variant="secondary">Reject</ClusterButton><ClusterButton type="button" className="" disabled={Boolean(busyId)} onClick={() => void decide(selected, "approved")} variant="primary">Approve</ClusterButton></div></> : <div className={`admin-approval-resolved-v249 ${selected.status}`}>{selected.status}</div>}</> : <ClusterEmptyState compact kind="empty" title="Select an approval" description="Choose a request to review its context and record a decision." />}
      </aside>
    </div>
  </section>;
}

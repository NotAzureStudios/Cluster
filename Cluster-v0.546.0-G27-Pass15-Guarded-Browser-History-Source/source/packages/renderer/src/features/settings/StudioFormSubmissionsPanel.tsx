import { useEffect, useRef, useState } from "react";
import { api, queryApi } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterNativeSelect, ClusterInput, ClusterTextarea } from "../../components/ClusterNativeControls";

type DeadlineStatus = { version: number | null; dueAt: string | null; beforeDue: number; overdue: number; pending: number };

type Submission = {
  id: string;
  formId: string;
  version: number;
  status: string;
  respondentName?: string | null;
  respondentEmail?: string | null;
  submittedAt: string;
  updatedAt: string;
  answers?: Record<string, unknown>;
  fields?: Array<{ id: string; label: string }>;
  reviewNote?: string | null;
  reviewedAt?: string | null;
};
type FormFollowup = { id: string; projectId: string; controlRecordId: string; createdAt: string };
type ProjectOption = { id: string; name: string; status?: string; archived?: boolean };

export function StudioFormSubmissionsPanel({ formId, targetSubmissionId = null, delegatedReview = false }: { formId: string; targetSubmissionId?: string | null; delegatedReview?: boolean; key?: string }) {
  const [items, setItems] = useState<Submission[]>([]);
  const [deadlineStatus, setDeadlineStatus] = useState<DeadlineStatus | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [decision, setDecision] = useState<"under_review" | "approved" | "rejected">("approved");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const detailRequestId = useRef(0);
  const [selectedDetail, setSelectedDetail] = useState<Submission | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRefresh, setDetailRefresh] = useState(0);
  const mutationLock = useRef(false);
  const followupLock = useRef(false);
  const followupRequestSequence = useRef(0);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectCursor, setProjectCursor] = useState<string | null>(null);
  const [loadingMoreProjects, setLoadingMoreProjects] = useState(false);
  const [followups, setFollowups] = useState<FormFollowup[]>([]);
  const [followupProjectId, setFollowupProjectId] = useState("");
  const [followupTitle, setFollowupTitle] = useState("Review follow-up");
  const [followupPriority, setFollowupPriority] = useState<"low" | "medium" | "high" | "urgent">("medium");
  const [followupBusy, setFollowupBusy] = useState(false);
  const [followupError, setFollowupError] = useState("");

  async function fetchPage(nextPage: number, append = false) {
    const request = ++requestId.current;
    try {
      const params = new URLSearchParams({ page: String(nextPage), limit: "25" });
      if (filter !== "all") params.set("status", filter);
      const data = await queryApi<{ submissions: Submission[]; hasMore: boolean }>(`/api/studio-systems/forms/${formId}/submissions?${params}`, { force: true, tags: ["studio-systems", "forms"] });
      if (request !== requestId.current) return;
      setItems((current: Submission[]) => append ? [...current, ...data.submissions.filter((row) => !current.some((item: Submission) => item.id === row.id))] : [
        ...current.filter((row: Submission) => row.id === targetSubmissionId && !data.submissions.some((entry) => entry.id === row.id)), ...data.submissions,
      ]);
      setPage(nextPage);
      setHasMore(data.hasMore);
      if (!append) setDetailRefresh((count) => count + 1);
      setError("");
    } catch (cause) { if (request === requestId.current) setError(cause instanceof Error ? cause.message : "Could not load submissions."); }
  }

  useEffect(() => { setItems([]); setSelectedId(""); setPage(1); void fetchPage(1); return () => { requestId.current += 1; }; }, [formId, filter]);
  useEffect(() => {
    let active = true;
    setDeadlineStatus(null);
    if (delegatedReview) return () => { active = false; };
    void queryApi<DeadlineStatus>(`/api/studio-systems/forms/${encodeURIComponent(formId)}/deadline-status`, { force: true, tags: ["studio-systems", "forms"] })
      .then((state) => { if (active) setDeadlineStatus(state); })
      .catch(() => { if (active) setDeadlineStatus(null); });
    return () => { active = false; };
  }, [formId, delegatedReview]);
  // Resolve deep links by identity only. The ordinary per-response detail path
  // owns the response fetch, even when the page was opened from a notification.
  useEffect(() => {
    if (targetSubmissionId) { setFilter("all"); setSelectedId(targetSubmissionId); }
  }, [formId, targetSubmissionId]);
  useEffect(() => {
    const request = ++detailRequestId.current;
    setSelectedDetail(null);
    if (!selectedId) { setDetailLoading(false); return; }
    let active = true;
    setDetailLoading(true);
    void api<{ submission: Submission }>(`/api/studio-systems/forms/${encodeURIComponent(formId)}/submissions/${encodeURIComponent(selectedId)}`)
      .then(({ submission }) => { if (active && request === detailRequestId.current) { setSelectedDetail(submission); setError(""); } })
      .catch((cause) => { if (active && request === detailRequestId.current) setError(cause instanceof Error ? cause.message : "Response unavailable, changed, or access revoked. Refresh your review queue."); })
      .finally(() => { if (active && request === detailRequestId.current) setDetailLoading(false); });
    return () => { active = false; detailRequestId.current++; };
  }, [formId, selectedId, detailRefresh]);
  const selected = selectedDetail?.id === selectedId ? selectedDetail : null;
  useEffect(() => { setNote(selected?.reviewNote || ""); setDecision("approved"); }, [selectedId, selected?.updatedAt]);
  useEffect(() => {
    const request = ++followupRequestSequence.current;
    setFollowups([]); setProjects([]); setFollowupProjectId(""); setProjectCursor(null);
    setFollowupTitle("Review follow-up"); setFollowupPriority("medium"); setFollowupError("");
    if (!selected?.id || delegatedReview) return;
    let active = true;
    // The Studio Admin sees only Project names for choosing a target. The
    // server checks Project contribute permission again when creating it.
    void Promise.all([
      queryApi<{ items: ProjectOption[]; nextCursor: string | null }>("/api/projects?paged=1&limit=100", { force: true, tags: ["projects"] }),
      api<{ followups: FormFollowup[] }>(`/api/studio-systems/forms/${encodeURIComponent(formId)}/submissions/${encodeURIComponent(selected.id)}/project-followups`),
    ]).then(([projectData, followupData]) => {
      if (!active || request !== followupRequestSequence.current) return;
      setProjects((projectData.items || []).filter((project) => !project.archived && ["active", "on_hold", "on hold"].includes(String(project.status || "").toLowerCase())));
      setProjectCursor(projectData.nextCursor || null);
      setFollowups(followupData.followups || []);
    }).catch((cause) => { if (active && request === followupRequestSequence.current) setFollowupError(cause instanceof Error ? cause.message : "Project follow-ups could not be loaded."); });
    return () => { active = false; followupRequestSequence.current += 1; };
  }, [formId, selected?.id, delegatedReview]);

  async function loadMoreProjects() {
    if (!projectCursor || loadingMoreProjects) return;
    setLoadingMoreProjects(true); setFollowupError("");
    const priorCursor = projectCursor;
    const request = followupRequestSequence.current;
    setProjectCursor(null);
    try {
      const page = await queryApi<{ items: ProjectOption[]; nextCursor: string | null }>(
        `/api/projects?paged=1&limit=100&cursor=${encodeURIComponent(priorCursor)}`, { force: true, tags: ["projects"] });
      if (request !== followupRequestSequence.current) return;
      setProjects((previous) => {
        const seen = new Set(previous.map((item) => item.id));
        return [...previous, ...(page.items || []).filter((item) => !seen.has(item.id) && !item.archived &&
          ["active", "on_hold", "on hold"].includes(String(item.status || "").toLowerCase()))];
      });
      setProjectCursor(page.nextCursor || null);
    } catch (cause) { if (request === followupRequestSequence.current) setFollowupError(cause instanceof Error ? cause.message : "Project list changed. Reload the submission to search again."); }
    finally { setLoadingMoreProjects(false); }
  }

  async function createFollowup() {
    if (!selected || !followupProjectId || !followupTitle.trim() || followupLock.current) return;
    if (selected.status === "submitted") { setFollowupError("Mark this response under review first."); return; }
    followupLock.current = true; setFollowupBusy(true); setFollowupError("");
    const request = followupRequestSequence.current;
    try {
      const created = await api<FormFollowup>(`/api/studio-systems/forms/${encodeURIComponent(formId)}/submissions/${encodeURIComponent(selected.id)}/project-followups`, {
        method: "POST", body: JSON.stringify({ projectId: followupProjectId, expectedUpdatedAt: selected.updatedAt, title: followupTitle.trim(), priority: followupPriority }),
      });
      if (request !== followupRequestSequence.current) return;
      setFollowups((current) => current.some((item) => item.id === created.id) ? current : [created, ...current]);
      setFollowupProjectId("");
    } catch (cause) { if (request === followupRequestSequence.current) setFollowupError(cause instanceof Error ? cause.message : "Could not create Project follow-up. Refresh before retrying."); }
    finally { followupLock.current = false; setFollowupBusy(false); }
  }

  async function review() {
    if (!selected || mutationLock.current || !["submitted", "under_review"].includes(selected.status)) return;
    if (decision === "rejected" && !note.trim()) { setError("A rejection reason is required."); return; }
    mutationLock.current = true; setBusy(true); setError("");
    try {
      await api(`/api/studio-systems/forms/${formId}/submissions/${selected.id}/review`, { method: "PATCH", body: JSON.stringify({ expectedUpdatedAt: selected.updatedAt, status: decision, note }) });
      setSelectedId("");
      await fetchPage(1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Review failed. Refresh the queue before retrying."); }
    finally { mutationLock.current = false; setBusy(false); }
  }

  return <div className="settings-card-v092">
    <div className="settings-card-head-v092"><div><h3>Responses & reviews</h3><p className="muted tight">Applications have a separate review queue. This queue covers ordinary studio forms.</p></div><ClusterButton type="button" size="compact" onClick={() => void fetchPage(1)} disabled={busy}>Refresh</ClusterButton></div>
    {deadlineStatus?.dueAt && <div className="studio-explanation-v272"><strong>Published v{deadlineStatus.version} deadline · {new Date(deadlineStatus.dueAt).toLocaleString()}</strong><span>Reminder activity recorded: {deadlineStatus.beforeDue} due-soon · {deadlineStatus.overdue} overdue{deadlineStatus.pending ? ` · ${deadlineStatus.pending} pending retry` : ""}. Only current published version counts are shown. Delivery is via Inbox; these counts do not imply a message was read.</span></div>}
    <div className="field"><label>Status</label><ClusterNativeSelect value={filter} onChange={(event) => setFilter(event.target.value)} disabled={busy}><option value="all">All</option><option value="submitted">Submitted</option><option value="under_review">Under review</option><option value="approved">Approved</option><option value="rejected">Rejected</option></ClusterNativeSelect></div>
    {error && <div className="error-box" role="alert">{error}</div>}
    <div className="studio-form-review-workbench">
    <div className="studio-form-review-list"><div className="studio-entity-list-v272">{items.map((item) => <ClusterButton key={item.id} type="button" className={selectedId === item.id ? "active" : ""} onClick={() => setSelectedId(item.id)}><span className="studio-entity-list-copy-v272"><strong>{item.respondentName || item.respondentEmail || "Studio member"}</strong><small>{item.status.replaceAll("_", " ")} · v{item.version} · {new Date(item.submittedAt).toLocaleString()}</small></span></ClusterButton>)}</div>
    {!items.length && !error && <p className="muted tight">No submissions match this filter.</p>}
    {hasMore && <ClusterButton type="button" variant="quiet" onClick={() => void fetchPage(page + 1, true)}>Load more</ClusterButton>}
    </div>
    <div className="studio-form-review-detail">
    {detailLoading && <p role="status" className="muted tight">Loading this response securely…</p>}
    {selected && <div className="settings-card-v092"><h4>Response detail</h4><p className="muted tight">Submitted {new Date(selected.submittedAt).toLocaleString()} · Published version {selected.version}</p>
      {(selected.fields || []).map((field) => <div key={field.id} className="field"><strong>{field.label}</strong><p>{Array.isArray((selected.answers || {})[field.id]) ? ((selected.answers || {})[field.id] as unknown[]).join(", ") : typeof (selected.answers || {})[field.id] === "boolean" ? ((selected.answers || {})[field.id] ? "Yes" : "No") : String((selected.answers || {})[field.id] ?? "Not answered")}</p></div>)}
      {selected.reviewNote && <p className="muted tight">Previous reviewer note: {selected.reviewNote}</p>}
      {!delegatedReview && <section className="studio-form-project-handoff" aria-label="Project follow-up">
        <h4>Project follow-up</h4>
        <p className="muted tight">Creates a neutral Project issue. Form answers, respondent identity, and private reviewer notes are never copied to Project work.</p>
        {followups.length > 0 && <div role="status" className="studio-form-handoff-existing">{followups.map((item) => <p key={item.id}>Follow-up created for {projects.find((project) => project.id === item.projectId)?.name || "Project"} · {new Date(item.createdAt).toLocaleString()}</p>)}</div>}
        {followupError && <p role="alert" className="error-box">{followupError}</p>}
        <div className="field"><label htmlFor={`followup-project-${selected.id}`}>Destination Project</label>
          <ClusterNativeSelect id={`followup-project-${selected.id}`} value={followupProjectId} disabled={followupBusy || selected.status === "submitted"} onChange={(event) => setFollowupProjectId(event.target.value)}>
            <option value="">Select an active Project</option>
            {projects.filter((project) => !followups.some((link) => link.projectId === project.id)).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </ClusterNativeSelect>
          {projectCursor && <ClusterButton type="button" size="compact" variant="secondary" disabled={followupBusy || loadingMoreProjects} onClick={() => void loadMoreProjects()}>{loadingMoreProjects ? "Loading Projects…" : "Load more Projects"}</ClusterButton>}</div>
        <div className="field"><label htmlFor={`followup-title-${selected.id}`}>Issue title (non-sensitive)</label>
          <ClusterInput id={`followup-title-${selected.id}`} value={followupTitle} maxLength={180} disabled={followupBusy || selected.status === "submitted"} onChange={(event) => setFollowupTitle(event.target.value)} /></div>
        <div className="field"><label htmlFor={`followup-priority-${selected.id}`}>Priority</label>
          <ClusterNativeSelect id={`followup-priority-${selected.id}`} value={followupPriority} disabled={followupBusy || selected.status === "submitted"} onChange={(event) => setFollowupPriority(event.target.value as typeof followupPriority)}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
          </ClusterNativeSelect></div>
        <ClusterButton type="button" size="compact" disabled={followupBusy || busy || selected.status === "submitted" || !followupProjectId || followupTitle.trim().length < 3} onClick={() => void createFollowup()}>{followupBusy ? "Creating follow-up…" : "Create Project follow-up"}</ClusterButton>
        {selected.status === "submitted" && <p className="muted tight">Move this response into review before creating Project work.</p>}
      </section>}
      {["submitted", "under_review"].includes(selected.status) && <><div className="field"><label>Decision</label><ClusterNativeSelect value={decision} onChange={(event) => setDecision(event.target.value as typeof decision)} disabled={busy}><option value="under_review">Mark under review</option><option value="approved">Approve</option><option value="rejected">Reject</option></ClusterNativeSelect></div><div className="field"><label>Reviewer note {decision === "rejected" ? "(required)" : ""}</label><ClusterTextarea value={note} onChange={(event) => setNote(event.target.value)} disabled={busy} /></div><ClusterButton type="button" variant="primary" disabled={busy || (decision === "rejected" && !note.trim())} onClick={() => void review()}>{busy ? "Saving…" : "Record decision"}</ClusterButton></>}
    </div>}
    </div>
    </div>
  </div>;
}

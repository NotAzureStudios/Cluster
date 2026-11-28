import { useEffect, useRef, useState } from "react";
import { api, queryApi } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { SettingsStateChip, type SettingsStateTone } from "../../components/SettingsStateChip";
import { StudioFormRunner, type StudioFormDocument } from "../studio-systems/StudioFormRunner";
import "./my-forms.css";
import { StudioFormSubmissionsPanel } from "./StudioFormSubmissionsPanel";
import { formInspectorFromSearch } from "../workflow/delegated-form-navigation";

type AvailableForm = StudioFormDocument & {
  acceptingResponses: boolean;
  assigned?: boolean;
  required?: boolean;
  canSubmit: boolean;
  lastSubmission: { id: string; status: string; submittedAt: string; formVersionId: string } | null;
  savedDraft?: { updatedAt: string; stale: boolean } | null;
  dueAt?: string | null;
  dueState?: "none" | "upcoming" | "overdue" | "completed";
};

function personalFormState(item: AvailableForm): {label: string; tone: SettingsStateTone} {
  if (item.dueState === "completed") return {label: "Completed", tone: "success"};
  if (item.dueState === "overdue" && item.acceptingResponses) return {label: "Overdue · submissions open", tone: "warning"};
  if (item.savedDraft?.stale) return {label: "Older draft · review", tone: "warning"};
  if (item.savedDraft) return {label: "Saved draft", tone: "info"};
  if (!item.acceptingResponses || !item.canSubmit) return {label: "Not accepting responses", tone: "neutral"};
  if (item.required) return {label: "Required", tone: "info"};
  return {label: "Available", tone: "neutral"};
}

export function MyFormsPanel() {
  const [forms, setForms] = useState<AvailableForm[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [reviewForms, setReviewForms] = useState<Array<{ id: string; title: string }>>([]);
  const [reviewFormId, setReviewFormId] = useState("");
  const [reviewAssignmentsLoaded, setReviewAssignmentsLoaded] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewLinkError, setReviewLinkError] = useState("");
  const [targetInspector, setTargetInspector] = useState(() => formInspectorFromSearch(window.location.search));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  async function refresh() {
    const request = ++requestId.current;
    setLoading(true);
    setReviewAssignmentsLoaded(false);
    setReviewFormId("");
    setReviewLinkError("");
    // Submission entitlement and reviewer entitlement are independent. Fetch
    // in parallel and render the successful projection when the other fails.
    const [availableResult, reviewsResult] = await Promise.allSettled([
      queryApi<{ forms: AvailableForm[] }>("/api/forms/available", { force: true, tags: ["studio-systems", "forms"] }),
      queryApi<{ forms: Array<{ id: string; title: string }> }>("/api/forms/review-assignments", { force: true, persist: false, staleWhileRevalidate: false }),
    ]);
    if (request !== requestId.current) return;
    if (availableResult.status === "fulfilled") {
      const rows = availableResult.value.forms || [];
      setForms(rows);
      setSelectedId((current) => rows.some((item) => item.form.id === current) ? current : rows[0]?.form.id || "");
      setError("");
    } else {
      setForms([]);
      setSelectedId("");
      setError(availableResult.reason instanceof Error ? availableResult.reason.message : "Unable to load assigned forms.");
    }
    if (reviewsResult.status === "fulfilled") {
      setReviewForms(reviewsResult.value.forms || []);
      setReviewError("");
    } else {
      setReviewForms([]);
      setReviewError("Review assignments could not be verified. Retry to check your access.");
    }
    setReviewAssignmentsLoaded(true);
    setLoading(false);
  }

  useEffect(() => {
    const onInspector = (event: Event) => {
      const selection = (event as CustomEvent<{ scope: string; id: string | null }>).detail;
      if (selection?.scope === "studio-form" || selection?.scope === "form-submission") {
        setTargetInspector(selection.id ? formInspectorFromSearch(`?inspect=${encodeURIComponent(`${selection.scope}:${selection.id}`)}`) : null);
      }
    };
    window.addEventListener("cluster:inspector-state-changed", onInspector);
    return () => window.removeEventListener("cluster:inspector-state-changed", onInspector);
  }, []);
  useEffect(() => { void refresh(); return () => { requestId.current += 1; }; }, []);
  useEffect(() => {
    if (!reviewAssignmentsLoaded || !targetInspector || reviewError) return;
    let active = true;
    setReviewFormId("");
    setReviewLinkError("");
    const openAssigned = (formId: string) => {
      if (!active) return;
      if (reviewForms.some((form) => form.id === formId)) setReviewFormId(formId);
      else setReviewLinkError("This Form review is unavailable or your review assignment has changed.");
    };
    if (targetInspector.scope === "studio-form") openAssigned(targetInspector.id);
    else void queryApi<{ formId: string }>(`/api/studio-systems/submissions/${encodeURIComponent(targetInspector.id)}/target`, {
      force: true, persist: false, staleWhileRevalidate: false,
    }).then(({ formId }) => openAssigned(formId)).catch(() => {
      if (active) setReviewLinkError("This Form response is unavailable or your review assignment has changed.");
    });
    return () => { active = false; };
  }, [reviewAssignmentsLoaded, reviewForms, reviewError, targetInspector?.scope, targetInspector?.id]);
  function chooseReviewForm(formId: string) {
    setReviewFormId((current) => current === formId ? "" : formId);
    setTargetInspector(null);
    const url = new URL(window.location.href);
    const scope = formInspectorFromSearch(url.search);
    if (scope) {
      url.searchParams.delete("inspect");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }
  const selected = forms.find((entry) => entry.form.id === selectedId);

  const due = (item: AvailableForm) => item.dueAt ? new Date(item.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  const todo = forms.filter((item) => item.canSubmit && item.dueState !== "completed");
  const done = forms.filter((item) => !(item.canSubmit && item.dueState !== "completed"));
  const row = (item: AvailableForm) => <button type="button" key={item.form.id} className={`mf-row ${selectedId === item.form.id ? "is-active" : ""}`} onClick={() => setSelectedId(item.form.id!)}>
    <span className="mf-icon" data-tone={personalFormState(item).tone}><ClusterIcon name={item.dueState === "completed" || item.lastSubmission ? "check" : "file"} /></span>
    <span className="mf-copy"><strong>{item.form.title}</strong><small>{item.lastSubmission ? `Sent ${new Date(item.lastSubmission.submittedAt).toLocaleDateString()}` : item.savedDraft ? "Draft saved" : item.dueAt ? `Due ${due(item)}` : item.required ? "Required" : "Optional"}</small></span>
    <SettingsStateChip tone={personalFormState(item).tone}>{personalFormState(item).label}</SettingsStateChip>
  </button>;

  return <section className="mf">
    {error && <div className="error-box" role="alert">{error} <ClusterButton type="button" size="compact" onClick={() => void refresh()}>Retry</ClusterButton></div>}
    {reviewError && <div className="error-box" role="alert">{reviewError}</div>}
    {reviewLinkError && <div className="error-box" role="alert">{reviewLinkError}</div>}
    <div className="mf-body">
      <aside className="mf-list" aria-label="Your forms">
        <h3>To do <small>{todo.length}</small></h3>
        {todo.map(row)}
        {!loading && !todo.length ? <p className="mf-empty">You're all caught up.</p> : null}
        {done.length ? <><h3>Done <small>{done.length}</small></h3>{done.map(row)}</> : null}
        {reviewForms.length ? <><h3>To review <small>{reviewForms.length}</small></h3>{reviewForms.map((form) => <button key={form.id} type="button" className={`mf-row ${reviewFormId === form.id ? "is-active" : ""}`} onClick={() => chooseReviewForm(form.id)}>
          <span className="mf-icon"><ClusterIcon name="users" /></span><span className="mf-copy"><strong>{form.title}</strong><small>Responses to review</small></span>
        </button>)}</> : null}
      </aside>
      <div className="mf-main">
        {reviewFormId ? <StudioFormSubmissionsPanel key={reviewFormId} formId={reviewFormId} targetSubmissionId={targetInspector?.scope === "form-submission" ? targetInspector.id : null} delegatedReview />
        : selected ? <div className="mf-sheet">
          {selected.dueAt ? <p className="mf-due" data-tone={selected.dueState}>{selected.dueState === "completed" ? "Completed" : selected.dueState === "overdue" ? "Overdue" : "Due"} · {new Date(selected.dueAt).toLocaleString()}{selected.dueState === "overdue" && selected.acceptingResponses ? " · late answers are still accepted" : ""}</p> : null}
          {selected.canSubmit ? <StudioFormRunner key={`${selected.form.id}:${selected.version.id}`} document={selected} submitLabel="Submit" submit={(payload) => api(`/api/forms/${selected.form.key}/submissions`, { method: "POST", body: JSON.stringify(payload) })} onSubmitted={() => void refresh()} />
            : <div className="mf-closed"><h3>{selected.form.title}</h3>{selected.form.description ? <p>{selected.form.description}</p> : null}<strong>{selected.lastSubmission ? `Your response: ${selected.lastSubmission.status.replaceAll("_", " ")}` : "Not accepting responses"}</strong>{selected.lastSubmission ? <p>Sent {new Date(selected.lastSubmission.submittedAt).toLocaleString()}.</p> : null}</div>}
        </div>
        : <div className="mf-blank"><ClusterIcon name="file" /><p>{forms.length ? "Pick a form to fill in." : loading ? "Loading…" : "No forms for you right now."}</p></div>}
      </div>
    </div>
  </section>;
}

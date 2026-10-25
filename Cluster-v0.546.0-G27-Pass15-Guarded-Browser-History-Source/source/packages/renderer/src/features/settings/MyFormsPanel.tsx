import { useEffect, useRef, useState } from "react";
import { api, queryApi } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { StudioFormRunner, type StudioFormDocument } from "../studio-systems/StudioFormRunner";
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

  return <section className="settings-section-v092">
    <div className="settings-panel-head-v092"><div><p className="eyebrow">Studio resources</p><h2>My forms</h2><p className="muted tight">Forms currently published to your account. Only you can view your response status here.</p></div><ClusterButton type="button" size="compact" onClick={() => void refresh()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</ClusterButton></div>
    {error && <div className="error-box" role="alert">{error} <ClusterButton type="button" size="compact" onClick={() => void refresh()}>Retry</ClusterButton></div>}
    {!loading && !forms.length && !error && <div className="settings-card-v092"><strong>No forms to complete</strong><p className="muted tight">There are no published forms available to your studio audience. Delegated review assignments appear separately.</p></div>}
    {reviewError && <div className="error-box" role="alert">{reviewError}</div>}
    {reviewLinkError && <div className="error-box" role="alert">{reviewLinkError}</div>}
    {reviewForms.length > 0 && <div className="settings-card-v092"><div className="settings-card-head-v092"><div><h3>Review assignments</h3><p className="muted tight">Private access to selected Forms. You cannot edit form structure or Studio policies here.</p></div></div><div className="button-row">{reviewForms.map((form) => <ClusterButton key={form.id} type="button" variant={reviewFormId === form.id ? "primary" : "secondary"} size="compact" onClick={() => chooseReviewForm(form.id)}>{form.title}</ClusterButton>)}</div>{reviewFormId && <StudioFormSubmissionsPanel key={reviewFormId} formId={reviewFormId} targetSubmissionId={targetInspector?.scope === "form-submission" ? targetInspector.id : null} delegatedReview />}</div>}
    <div className="settings-layout">
      <div className="settings-card-v092"><h3>Available forms</h3><div className="studio-entity-list-v272">{forms.map((item) => <ClusterButton type="button" key={item.form.id} className={selectedId === item.form.id ? "active" : ""} onClick={() => setSelectedId(item.form.id!)}><span className="studio-entity-list-copy-v272"><strong>{item.form.title}</strong><small>{item.lastSubmission ? `${item.lastSubmission.status} · ${new Date(item.lastSubmission.submittedAt).toLocaleDateString()}` : item.savedDraft && item.canSubmit ? item.savedDraft.stale ? "Older saved draft · needs review" : `Saved draft · ${new Date(item.savedDraft.updatedAt).toLocaleDateString()}` : item.dueState === "overdue" ? "Overdue · response still accepted" : item.acceptingResponses ? item.assigned ? `${item.required ? "Assigned · required" : "Assigned · optional"}${item.dueAt ? ` · due ${new Date(item.dueAt).toLocaleDateString()}` : ""}` : "Ready to complete" : "Responses closed"}</small></span></ClusterButton>)}</div></div>
      <div>{selected && <>
        {selected.dueAt && <div className="settings-card-v092" role="status"><strong>{selected.dueState === "completed" ? "Completed" : selected.dueState === "overdue" ? "Form overdue" : "Form deadline"}</strong><p className="muted tight">{new Date(selected.dueAt).toLocaleString()}{selected.dueState === "overdue" && selected.acceptingResponses ? " · Late submissions are still accepted." : ""}</p></div>}
        {selected.canSubmit ? <StudioFormRunner key={`${selected.form.id}:${selected.version.id}`} document={selected} submitLabel="Submit form" submit={(payload) => api(`/api/forms/${selected.form.key}/submissions`, { method: "POST", body: JSON.stringify(payload) })} onSubmitted={() => void refresh()} /> : <div className="settings-card-v092"><h3>{selected.form.title}</h3><p className="muted tight">{selected.form.description}</p><strong>{selected.lastSubmission ? `Latest response: ${selected.lastSubmission.status.replaceAll("_", " ")}` : "Responses are closed"}</strong><p className="muted tight">{selected.lastSubmission ? `Submitted ${new Date(selected.lastSubmission.submittedAt).toLocaleString()}.` : "This form is not accepting responses."}</p></div>}
      </>}</div>
    </div>
  </section>;
}

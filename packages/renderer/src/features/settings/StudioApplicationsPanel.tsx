import { useEffect, useMemo, useRef, useState } from "react";
import { api, queryApi } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterCopyButton } from "../../components/ClusterCopyButton";
import { ClusterInput, ClusterNativeSelect, ClusterTextarea } from "../../components/ClusterNativeControls";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { RequestErrorState } from "../../components/RequestState";
import { openClusterWorkNavigation } from "../workflow/work-navigation";

type MappingCandidate = { fieldId: string; label: string; profileMappingKey: string; value: unknown; allowed: boolean };
type AnswerField = { fieldId: string; label: string; type: string; value: unknown };
type Application = {
  id: string; status: string; updatedAt: string; respondentName?: string | null; respondentEmail?: string | null;
  submittedAt: string; reviewNote?: string | null; convertedUserId?: string | null; convertedAt?: string | null;
  form?: { id?: string; title: string; key: string } | null; answers: Record<string, unknown>;
  answerFields?: AnswerField[]; mappingCandidates: MappingCandidate[];
};
type OnboardingOption = { id: string; label: string };
type FormOption = { id: string; title: string };
type ApplicationPage = { nextCursor: string | null; hasMore: boolean; limit: number };
type CreatedCredential = { id: string; username: string; password: string; onboardingText: string };

function valueText(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value == null || value === "") return "Not provided";
  return String(value);
}

export function StudioApplicationsPanel({ targetApplicationId = null }: { targetApplicationId?: string | null }) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [onboardingOptions, setOnboardingOptions] = useState<OnboardingOption[]>([]);
  const [formOptions, setFormOptions] = useState<FormOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [username, setUsername] = useState("");
  const [onboardingVersionId, setOnboardingVersionId] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [formFilter, setFormFilter] = useState("");
  const [page, setPage] = useState<ApplicationPage>({ nextCursor: null, hasMore: false, limit: 50 });
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [status, setStatus] = useState("");
  const [loadError, setLoadError] = useState<unknown>(null);
  const [busyAction, setBusyAction] = useState<"review" | "convert" | "">("");
  const [loading, setLoading] = useState(false);
  const [credential, setCredential] = useState<CreatedCredential | null>(null);
  const mutationRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const navigationConfirmRef = useRef(false);

  async function load(force = false, cursor: string | null = cursorHistory[pageIndex] || null) {
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      if (statusFilter) params.set("status", statusFilter);
      if (formFilter) params.set("formId", formFilter);
      params.set("limit", "50");
      if (cursor) params.set("cursor", cursor);
      const [response, onboarding, forms] = await Promise.all([
        queryApi<{ applications: Application[]; page: ApplicationPage }>(`/api/studio-systems/applications?${params}`, { staleMs: 5_000, force, tags: ["studio-systems", "applications"] }),
        queryApi<{ plans: Array<{ title: string; status: string; versions?: Array<{ id: string; versionLabel: string; status: string }> }> }>("/api/studio-systems/onboarding", { staleMs: 10_000, force, tags: ["studio-systems", "onboarding"] }),
        queryApi<{ forms: Array<{ id: string; title: string; purpose: string }> }>("/api/studio-systems/forms", { staleMs: 10_000, force, tags: ["studio-systems", "forms"] }),
      ]);
      if (generation !== loadGenerationRef.current) return;
      let next = response.applications || [];
      if (targetApplicationId && !next.some((item) => item.id === targetApplicationId)) {
        // The notification target may be on an older queue page. Resolve it
        // through a fresh authorized detail request, not a cached list entry.
        const pinned = await api<{ application: Application }>(`/api/studio-systems/applications/${encodeURIComponent(targetApplicationId)}`);
        if (generation !== loadGenerationRef.current) return;
        next = [pinned.application, ...next];
      }
      setApplications(next);
      setPage(response.page || { nextCursor: null, hasMore: false, limit: 50 });
      setSelectedId((current) => targetApplicationId && next.some((item) => item.id === targetApplicationId)
        ? targetApplicationId : next.some((item) => item.id === current) ? current : next[0]?.id || "");
      setOnboardingOptions((onboarding.plans || []).flatMap((plan) => plan.status === "active" ? (plan.versions || []).filter((version) => version.status === "published").map((version) => ({ id: version.id, label: `${plan.title} · ${version.versionLabel}` })) : []));
      setFormOptions((forms.forms || []).filter((form) => form.purpose === "application").map((form) => ({ id: form.id, title: form.title })));
    } catch (error) {
      // Keep the last known applications on transient refresh failures.
      if (generation === loadGenerationRef.current) setLoadError(error);
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }
  useEffect(() => {
    setCursorHistory([null]); setPageIndex(0);
    void load(Boolean(targetApplicationId), null);
    return () => { loadGenerationRef.current++; };
  }, [targetApplicationId]);
  const selected = useMemo(() => applications.find((item) => item.id === selectedId) || null, [applications, selectedId]);
  useEffect(() => {
    setNote(selected?.reviewNote || "");
    // Applicant data is never copied to People unless an admin selects each mapping.
    setSelectedFields([]);
    setUsername(""); setOnboardingVersionId("");
  }, [selectedId]);

  const unsavedNote = Boolean(selected && note !== (selected.reviewNote || ""));
  const unsavedConversion = Boolean(selected?.status === "approved" && (username.trim() || onboardingVersionId || selectedFields.length));
  // Also protect the one-time password when the user closes the browser or
  // navigates away through a shared Cluster workspace control.
  useUnsavedChangesGuard({
    dirty: unsavedNote || unsavedConversion || Boolean(credential),
    title: "Leave application review?",
    message: credential
      ? "A one-time account password is still visible and cannot be retrieved later. Copy it before leaving."
      : "Unsaved application notes or account-creation selections will be lost.",
    confirmLabel: "Discard and leave",
  });

  async function confirmReviewNavigation() {
    if (navigationConfirmRef.current || busyAction) return false;
    if (!credential && !unsavedNote && !unsavedConversion) return true;
    navigationConfirmRef.current = true;
    try {
      const warnings = [
        ...(credential ? [`The one-time password for @${credential.username} cannot be recovered after leaving. Copy it first.`] : []),
        ...(unsavedNote ? ["Your unsaved reviewer note will be discarded."] : []),
        ...(unsavedConversion ? ["The drafted username, onboarding choice, and profile field selections will be discarded."] : []),
      ];
      return await confirmCluster({
        title: credential ? "Discard one-time credentials?" : "Discard application changes?",
        message: warnings.join("\n"),
        confirmLabel: "Discard and continue",
        tone: "danger",
      });
    } finally {
      navigationConfirmRef.current = false;
    }
  }
  function discardTransientReview() {
    setCredential(null);
    setNote(selected?.reviewNote || "");
    setUsername("");
    setSelectedFields([]);
    setOnboardingVersionId("");
  }
  async function selectApplication(nextId: string) {
    if (nextId === selectedId || loading || busyAction) return;
    if (!(await confirmReviewNavigation())) return;
    discardTransientReview();
    setSelectedId(nextId);
  }
  async function dismissCredentials() {
    if (!credential || navigationConfirmRef.current) return;
    navigationConfirmRef.current = true;
    try {
      const accepted = await confirmCluster({
        title: "Dismiss one-time password?",
        message: `The temporary password for @${credential.username} cannot be retrieved from this application later. Copy it before dismissing.`,
        confirmLabel: "Dismiss password",
        tone: "danger",
      });
      if (accepted) setCredential(null);
    } finally { navigationConfirmRef.current = false; }
  }
  async function openCreatedPerson() {
    if (!credential || !(await confirmReviewNavigation())) return;
    const id = credential.id;
    discardTransientReview();
    openClusterWorkNavigation({ screen: "people", inspectScope: "person", inspectId: id });
  }

  async function applyFilters() {
    if (busyAction || loading || !(await confirmReviewNavigation())) return;
    discardTransientReview();
    setCursorHistory([null]); setPageIndex(0);
    await load(true, null);
  }
  async function nextPage() {
    if (loading || busyAction || !page.hasMore || !page.nextCursor || !(await confirmReviewNavigation())) return;
    discardTransientReview();
    const nextIndex = pageIndex + 1;
    setCursorHistory((current) => [...current.slice(0, nextIndex), page.nextCursor]);
    setPageIndex(nextIndex);
    await load(true, page.nextCursor);
  }
  async function previousPage() {
    if (loading || busyAction || pageIndex <= 0 || !(await confirmReviewNavigation())) return;
    discardTransientReview();
    const previousIndex = pageIndex - 1;
    setPageIndex(previousIndex);
    await load(true, cursorHistory[previousIndex] || null);
  }

  async function review(nextStatus: "under_review" | "approved" | "rejected") {
    if (!selected || selected.status === "converted" || mutationRef.current) return;
    mutationRef.current = true; setBusyAction("review"); setStatus("");
    const application = selected;
    try {
      await api(`/api/studio-systems/applications/${application.id}/review`, {
        method: "PATCH", body: JSON.stringify({ status: nextStatus, note, expectedUpdatedAt: application.updatedAt }),
      });
      setStatus(`Application ${nextStatus.replace("_", " ")}.`);
      await load(true);
    } catch (error) {
      setStatus(`${error instanceof Error ? error.message : "Review could not be saved."} Your note is preserved. Refresh the application before deciding again.`);
    } finally { mutationRef.current = false; setBusyAction(""); }
  }

  async function convert() {
    if (!selected || selected.status !== "approved" || selected.convertedUserId || !username.trim() || mutationRef.current) return;
    mutationRef.current = true; setBusyAction("convert"); setStatus("");
    const application = selected;
    try {
      const confirmed = await confirmCluster({
        title: "Create member account?",
        message: `Application: ${application.respondentName || application.respondentEmail || application.id}\nUsername: ${username.trim()}\nProfile fields: ${selectedFields.length}\nOnboarding: ${onboardingOptions.find((item) => item.id === onboardingVersionId)?.label || "None"}\nThis creates a new account and can only be performed once.`,
        confirmLabel: "Create person", tone: "default",
      });
      if (!confirmed) return;
      const result = await api<{ user: { id: string; username: string }; temporaryPassword: string; onboarding?: { assigned?: boolean; reason?: string; planTitle?: string } | null }>(`/api/studio-systems/applications/${application.id}/convert`, {
        method: "POST", body: JSON.stringify({ username: username.trim(), selectedFieldIds: selectedFields, onboardingVersionId: onboardingVersionId || null, expectedUpdatedAt: application.updatedAt }),
      });
      const onboardingText = result.onboarding ? result.onboarding.assigned ? `Onboarding assigned: ${result.onboarding.planTitle || "selected plan"}.` : `Onboarding not assigned: ${result.onboarding.reason || "not eligible"}.` : "No onboarding assigned.";
      // Credentials are shown only in this dismissible client state, not status logs or notifications.
      setCredential({ id: result.user.id, username: result.user.username, password: result.temporaryPassword, onboardingText });
      setStatus(`Created @${result.user.username}. Save the one-time password below before dismissing it.`);
      await load(true);
    } catch (error) {
      setStatus(`${error instanceof Error ? error.message : "Person could not be created."} No new password was displayed. Refresh before retrying if the request timed out.`);
    } finally { mutationRef.current = false; setBusyAction(""); }
  }

  if (loadError && !applications.length) return <RequestErrorState error={loadError} title="Applications could not be loaded" onRetry={() => void load(true)} />;
  return <div className="studio-systems-layout-v34f">
    <aside className="studio-systems-list-v34f">
      <div className="studio-explanation-v272"><strong>Applications</strong><span>Review first. Conversion creates a member account, copies only approved profile fields, and may assign published onboarding.</span></div>
      <div className="studio-create-strip-v272 studio-systems-create-v34f">
        <ClusterInput type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search applicant or email" />
        <ClusterNativeSelect value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option><option value="submitted">Submitted</option><option value="under_review">Under review</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="converted">Converted</option></ClusterNativeSelect>
        <ClusterNativeSelect value={formFilter} onChange={(event) => setFormFilter(event.target.value)}><option value="">All application forms</option>{formOptions.map((form) => <option key={form.id} value={form.id}>{form.title}</option>)}</ClusterNativeSelect>
        <ClusterButton type="button" variant="quiet" disabled={Boolean(busyAction) || loading} onClick={() => void applyFilters()}>{loading ? "Loading…" : "Apply filters"}</ClusterButton>
      </div>
      <div className="studio-entity-list-v272">{applications.map((item) => <ClusterButton type="button" key={item.id} disabled={Boolean(busyAction)} className={item.id === selectedId ? "active" : ""} onClick={() => void selectApplication(item.id)}><span className="studio-entity-list-copy-v272"><strong>{item.respondentName || item.respondentEmail || "Unnamed applicant"}</strong><small>{item.form?.title || "Application"} · {item.status.replace("_", " ")}</small></span><span className="studio-entity-list-meta-v272">{new Date(item.submittedAt).toLocaleDateString()}</span></ClusterButton>)}</div>
      <div className="button-row"><ClusterButton type="button" size="compact" variant="quiet" disabled={loading || Boolean(busyAction) || pageIndex === 0} onClick={() => void previousPage()}>Previous</ClusterButton><span>Page {pageIndex + 1}</span><ClusterButton type="button" size="compact" variant="quiet" disabled={loading || Boolean(busyAction) || !page.hasMore} onClick={() => void nextPage()}>Next</ClusterButton></div>
    </aside>
    <section className="studio-systems-editor-v34f">
      {Boolean(loadError) && <div role="alert" className="error-box">The application list could not refresh. Previously loaded data is shown. <ClusterButton size="compact" variant="secondary" disabled={loading} onClick={() => void load(true)}>Retry</ClusterButton></div>}
      {status && <div className="studio-explanation-v272" role="status"><strong>Status</strong><span>{status}</span></div>}
      {credential && <div className="settings-card-v092" role="group" aria-label="New account temporary credentials"><strong>Temporary credentials for @{credential.username}</strong><p>Copy this password now. It is not available from the application record later.</p><code>{credential.password}</code><span>{credential.onboardingText}</span><span>Account starts with member-only access and must change the temporary password on first sign-in. Review any additional permissions separately in People.</span><div className="button-row"><ClusterButton type="button" variant="secondary" onClick={() => void openCreatedPerson()}>Open created Person</ClusterButton><ClusterCopyButton text={credential.id} copiedLabel="Person ID copied">Copy Person ID</ClusterCopyButton><ClusterCopyButton text={credential.password} copiedLabel="Password copied">Copy password</ClusterCopyButton><ClusterButton type="button" variant="quiet" onClick={() => void dismissCredentials()}>Dismiss credentials</ClusterButton></div></div>}
      {selected ? <>
        <header className="studio-entity-editor-head-v272"><div><span className="eyebrow">Application review</span><h3>{selected.respondentName || selected.respondentEmail || "Applicant"}</h3><p>{selected.respondentEmail || "No email mapped"} · {selected.status.replace("_", " ")}</p></div></header>
        <div className="studio-form-field-list-v34f">{(selected.answerFields?.length ? selected.answerFields : Object.entries(selected.answers || {}).map(([fieldId, value]) => ({ fieldId, label: fieldId, type: "unknown", value }))).map((field) => <div className="settings-card-v092" key={field.fieldId}><strong>{field.label}</strong><span>{valueText(field.value)}</span></div>)}</div>
        <label className="field"><span>Review note</span><ClusterTextarea value={note} disabled={selected.status === "converted" || Boolean(busyAction)} onChange={(event) => setNote(event.target.value)} /></label>
        {selected.status !== "converted" && <div className="button-row"><ClusterButton type="button" variant="secondary" disabled={Boolean(busyAction)} onClick={() => void review("under_review")}>Mark under review</ClusterButton><ClusterButton type="button" variant="primary" disabled={Boolean(busyAction)} onClick={() => void review("approved")}>Approve</ClusterButton><ClusterButton type="button" variant="secondary" disabled={Boolean(busyAction)} onClick={() => void review("rejected")}>Reject</ClusterButton></div>}
        {selected.status === "approved" && !selected.convertedUserId && <div className="settings-card-v092"><p className="eyebrow">Application → People</p><h3>Create member account</h3><p className="muted tight">Role is fixed to member. Select each profile field you want to copy; none are preselected. Application fields cannot grant departments, teams, projects, tool permissions, or elevated access. Onboarding obeys the plan audience.</p>
          <label className="field"><span>Username</span><ClusterInput value={username} disabled={Boolean(busyAction)} onChange={(event) => setUsername(event.target.value)} /></label>
          <label className="field"><span>Onboarding after conversion</span><ClusterNativeSelect value={onboardingVersionId} disabled={Boolean(busyAction)} onChange={(event) => setOnboardingVersionId(event.target.value)}><option value="">No onboarding assignment</option>{onboardingOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</ClusterNativeSelect></label>
          {selected.mappingCandidates.map((candidate) => <label className="field" key={candidate.fieldId}><span><ClusterInput type="checkbox" checked={candidate.allowed && selectedFields.includes(candidate.fieldId)} disabled={Boolean(busyAction) || !candidate.allowed} onChange={(event) => setSelectedFields((current) => event.target.checked ? [...new Set([...current, candidate.fieldId])] : current.filter((id) => id !== candidate.fieldId))} /> {candidate.label} → <code>{candidate.profileMappingKey}</code></span><small>{candidate.allowed ? valueText(candidate.value) : "Mapping blocked by the server allowlist."}</small></label>)}
          <ClusterButton type="button" variant="primary" disabled={Boolean(busyAction) || !username.trim()} onClick={() => void convert()}>Create person</ClusterButton>
        </div>}
        {selected.status === "converted" && <div className="studio-explanation-v272"><strong>Converted</strong><span>This application has already created a person account. Further review decisions are disabled.</span>{selected.convertedUserId && <div className="button-row"><ClusterButton type="button" variant="secondary" onClick={() => openClusterWorkNavigation({ screen: "people", inspectScope: "person", inspectId: selected.convertedUserId! })}>Open Person and access</ClusterButton><ClusterCopyButton text={selected.convertedUserId} copiedLabel="Person ID copied">Copy created Person ID</ClusterCopyButton></div>}</div>}
      </> : <div className="settings-card-v092"><strong>No applications found</strong><span>Adjust the filters or wait for a new public application submission.</span></div>}
    </section>
  </div>;
}

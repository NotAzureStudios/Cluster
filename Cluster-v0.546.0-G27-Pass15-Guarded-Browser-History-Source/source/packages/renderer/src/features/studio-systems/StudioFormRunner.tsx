import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect, ClusterTextarea } from "../../components/ClusterNativeControls";
import { api, ApiError } from "../../core/api";
import { visibleStudioFormFieldIds, projectVisibleStudioFormAnswers } from "@cluster/shared";

type StudioFormField = {
  id: string;
  label: string;
  description?: string;
  type: "short_text" | "long_text" | "number" | "date" | "email" | "url" | "select" | "multi_select" | "checkbox" | "radio" | "acknowledgement" | "initials" | "signature";
  required?: boolean;
  options?: string[];
  visibleWhen?: { fieldId: string; equals: string | boolean } | null;
};

type StudioFormVersion = {
  id: string;
  version?: number;
  schema?: { fields?: StudioFormField[] };
  settings?: { confirmationMessage?: string; privacyNotice?: string; allowDrafts?: boolean };
};

type StudioForm = { id?: string; key: string; title: string; description?: string | null };

export type StudioFormDocument = { form: StudioForm; version: StudioFormVersion };
export type StudioFormSubmitResult = { id?: string; submissionId?: string; confirmationMessage?: string; [key: string]: unknown };
type DraftRecord = { formVersionId: string; answers: Record<string, unknown>; revision: number; updatedAt: string; stale: boolean };
type DraftPhase = "off" | "loading" | "ready" | "saving" | "saved" | "error" | "conflict" | "stale";


function present(value: unknown) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value === true || typeof value === "number";
}

export function StudioFormRunner({ document, submit, submitLabel = "Submit", disabled = false, onSubmitted, showHeading = true, drafts = true }: {
  document: StudioFormDocument;
  submit: (payload: { formVersionId: string; answers: Record<string, unknown> }) => Promise<StudioFormSubmitResult>;
  submitLabel?: string;
  disabled?: boolean;
  onSubmitted?: (result: StudioFormSubmitResult) => void;
  showHeading?: boolean;
  /** Public/anonymous applications must set drafts=false. Recovery is authenticated-only. */
  drafts?: boolean;
}) {
  const fields = useMemo(() => document.version.schema?.fields || [], [document.version.id]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const visibleIds = useMemo(() => visibleStudioFormFieldIds(fields, answers), [fields, answers]);
  const activeFields = useMemo(() => fields.filter((field) => visibleIds.has(field.id)), [fields, visibleIds]);
  const [pending, setPending] = useState(false);
  const submissionLock = useRef(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState("");
  const formKey = document.form.key;
  const versionId = document.version.id;
  const draftsEnabled = drafts && document.version.settings?.allowDrafts !== false;
  const draftUrl = `/api/forms/${encodeURIComponent(formKey)}/draft`;
  const [draftPhase, setDraftPhase] = useState<DraftPhase>(draftsEnabled ? "loading" : "off");
  const [draftMessage, setDraftMessage] = useState("");
  const draftRevision = useRef<number | null>(null);
  const savedSnapshot = useRef("{}");
  const savePromise = useRef<Promise<void> | null>(null);
  const generation = useRef(0);
  const [reloadKey, reloadDraft] = useState(0);

  // A draft belongs to one authenticated user AND one published form version. Never
  // hydrate a different revision or silently replace edits after a cross-tab conflict.
  useEffect(() => {
    const current = ++generation.current;
    draftRevision.current = null;
    savedSnapshot.current = "{}";
    setAnswers({}); setError(""); setComplete("");
    if (!draftsEnabled) { setDraftPhase("off"); setDraftMessage(""); return () => { generation.current++; }; }
    setDraftPhase("loading"); setDraftMessage("");
    void api<{ draft: DraftRecord | null }>(draftUrl).then(({ draft }) => {
      if (current !== generation.current) return;
      draftRevision.current = draft?.revision ?? null;
      if (draft?.stale || (draft && draft.formVersionId !== versionId)) {
        setDraftPhase("stale");
        setDraftMessage("A saved response belongs to an older form version. Discard it to start the updated form. It has not been overwritten.");
        return;
      }
      const restored = draft?.answers || {};
      savedSnapshot.current = JSON.stringify(restored);
      setAnswers(restored);
      setDraftPhase(draft ? "saved" : "ready");
    }).catch((cause) => {
      if (current !== generation.current) return;
      setDraftPhase("error");
      setDraftMessage(cause instanceof Error ? cause.message : "Could not recover your draft. Your changes will not be autosaved until recovery succeeds.");
    });
    return () => { generation.current++; };
  }, [draftsEnabled, draftUrl, versionId, reloadKey]);

  useEffect(() => {
    if (!draftsEnabled || !["ready", "saved"].includes(draftPhase) || pending || complete || submissionLock.current) return;
    const snapshot = JSON.stringify(answers);
    if (snapshot === savedSnapshot.current) return;
    const timer = setTimeout(() => {
      if (submissionLock.current || savePromise.current) return;
      const current = generation.current;
      setDraftPhase("saving");
      const operation = api<{ revision: number; updatedAt: string }>(draftUrl, {
        method: "PUT", body: JSON.stringify({ formVersionId: versionId, expectedRevision: draftRevision.current, answers }),
      }).then((response) => {
        if (current !== generation.current) return;
        draftRevision.current = response.revision;
        savedSnapshot.current = snapshot;
        setDraftMessage(""); setDraftPhase("saved");
      }).catch((cause) => {
        if (current !== generation.current) return;
        const conflict = cause instanceof ApiError && ["FORM_DRAFT_CONFLICT", "FORM_VERSION_STALE"].includes(cause.code);
        setDraftPhase(conflict ? "conflict" : "error");
        setDraftMessage(cause instanceof Error ? cause.message : "Draft could not be saved. Your answers remain on this screen.");
      }).finally(() => { if (savePromise.current === operation) savePromise.current = null; });
      savePromise.current = operation;
    }, 850);
    return () => clearTimeout(timer);
  }, [answers, draftPhase, draftsEnabled, draftUrl, versionId, pending, complete]);

  function patch(id: string, value: unknown) {
    setError("");
    setAnswers((current) => ({ ...current, [id]: value }));
  }

  async function discardDraft() {
    if (draftPhase === "loading" || draftPhase === "saving" || pending) return;
    const revision = draftRevision.current;
    try {
      if (revision !== null) await api(draftUrl, { method: "DELETE", body: JSON.stringify({ expectedRevision: revision }) });
      draftRevision.current = null;
      savedSnapshot.current = "{}";
      setAnswers({}); setDraftMessage(""); setDraftPhase("ready");
    } catch (cause) {
      setDraftPhase("conflict");
      setDraftMessage(cause instanceof Error ? cause.message : "Draft changed elsewhere. Reload before discarding it.");
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submissionLock.current || draftPhase === "loading" || draftPhase === "stale" || draftPhase === "conflict") return;
    const missing = activeFields.find((field) => field.required && (["acknowledgement", "checkbox"].includes(field.type) ? answers[field.id] !== true : !present(answers[field.id])));
    if (missing) { setError(`${missing.label} is required.`); return; }
    submissionLock.current = true; setPending(true); setError("");
    try {
      // A pending autosave must settle before the final submission clears the
      // corresponding private draft in the same server transaction.
      if (savePromise.current) await savePromise.current;
      const result = await submit({ formVersionId: versionId, answers: projectVisibleStudioFormAnswers(fields, answers) });
      setComplete(result.confirmationMessage || document.version.settings?.confirmationMessage || "Submitted.");
      try { onSubmitted?.(result); } catch { /* Submission is committed; callback failure cannot make it retryable. */ }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The form could not be submitted."); }
    finally { submissionLock.current = false; setPending(false); }
  }

  if (complete) return <div className="settings-card-v092"><strong>{complete}</strong></div>;

  const fieldsDisabled = disabled || pending || draftPhase === "loading" || draftPhase === "stale";
  return <form className="settings-card-v092" onSubmit={onSubmit}>
    {showHeading && <div><p className="eyebrow">Form</p><h3>{document.form.title}</h3>{document.form.description && <p className="muted tight">{document.form.description}</p>}</div>}
    {activeFields.map((field) => {
      const value = answers[field.id];
      if (field.type === "long_text") return <label className="field" key={field.id}><span>{field.label}{field.required ? " *" : ""}</span>{field.description && <small>{field.description}</small>}<ClusterTextarea value={typeof value === "string" ? value : ""} onChange={(event) => patch(field.id, event.target.value)} disabled={fieldsDisabled} /></label>;
      if (field.type === "select" || field.type === "radio") return <label className="field" key={field.id}><span>{field.label}{field.required ? " *" : ""}</span>{field.description && <small>{field.description}</small>}<ClusterNativeSelect value={typeof value === "string" ? value : ""} onChange={(event) => patch(field.id, event.target.value)} disabled={fieldsDisabled}><option value="">Select…</option>{(field.options || []).map((option) => <option value={option} key={option}>{option}</option>)}</ClusterNativeSelect></label>;
      if (field.type === "multi_select") {
        const selected = Array.isArray(value) ? value.map(String) : [];
        return <fieldset className="settings-card-v092" key={field.id}><legend>{field.label}{field.required ? " *" : ""}</legend>{field.description && <small>{field.description}</small>}{(field.options || []).map((option) => <label key={option}><ClusterInput type="checkbox" checked={selected.includes(option)} disabled={fieldsDisabled} onChange={(event) => patch(field.id, event.target.checked ? [...selected, option] : selected.filter((item) => item !== option))} /><span>{option}</span></label>)}</fieldset>;
      }
      if (field.type === "checkbox" || field.type === "acknowledgement") return <label className="field" key={field.id}><span><ClusterInput type="checkbox" checked={value === true} disabled={fieldsDisabled} onChange={(event) => patch(field.id, event.target.checked)} /> {field.label}{field.required ? " *" : ""}</span>{field.description && <small>{field.description}</small>}</label>;
      const type = field.type === "number" ? "number" : field.type === "email" ? "email" : field.type === "url" ? "url" : field.type === "date" ? "date" : "text";
      return <label className="field" key={field.id}><span>{field.label}{field.required ? " *" : ""}</span>{field.description && <small>{field.description}</small>}<ClusterInput type={type} value={typeof value === "number" || typeof value === "string" ? value : ""} disabled={fieldsDisabled} onChange={(event) => patch(field.id, field.type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value)} /></label>;
    })}
    {draftsEnabled && <div className="settings-inline-note-v272" role="status" aria-live="polite">
      {draftPhase === "loading" ? "Recovering your saved answers…" : null}
      {draftPhase === "saving" ? "Saving draft…" : null}
      {draftPhase === "saved" ? "Draft saved to your studio account." : null}
      {draftPhase === "ready" ? "Your answers will autosave while this form is open." : null}
      {["error", "conflict", "stale"].includes(draftPhase) ? <span>{draftMessage}</span> : null}
      {["error", "conflict", "stale"].includes(draftPhase) && <ClusterButton type="button" size="compact" variant="secondary" onClick={() => reloadDraft((x) => x + 1)}>Reload server draft</ClusterButton>}
      {["ready", "saved", "error", "conflict", "stale"].includes(draftPhase) && draftRevision.current !== null && <ClusterButton type="button" size="compact" variant="quiet" onClick={() => void discardDraft()}>Discard saved draft</ClusterButton>}
    </div>}
    {document.version.settings?.privacyNotice && <p className="muted tight">{document.version.settings.privacyNotice}</p>}
    {error && <div role="alert" className="studio-explanation-v272">{error}</div>}
    <div className="button-row"><ClusterButton type="submit" variant="primary" disabled={fieldsDisabled || draftPhase === "conflict" || !fields.length}>{pending ? "Submitting…" : submitLabel}</ClusterButton></div>
  </form>;
}

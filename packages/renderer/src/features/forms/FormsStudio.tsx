import { useEffect, useMemo, useState } from "react";
import { api, queryApi } from "../../core/api";
import { studioFormSchemaDefinitionSchema, type StudioAudience } from "@cluster/shared";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { StudioAudiencePicker } from "../studio-systems/StudioAudiencePicker";
import { StudioFormSubmissionsPanel } from "../settings/StudioFormSubmissionsPanel";
import { StudioApplicationsPanel } from "../settings/StudioApplicationsPanel";
import { confirmCluster } from "../../components/cluster-dialog-service";

type FieldType = "short_text" | "long_text" | "number" | "date" | "email" | "url" | "select" | "multi_select" | "checkbox" | "radio" | "acknowledgement" | "initials" | "signature";
type Field = { id: string; label: string; description: string; type: FieldType; required: boolean; options: string[]; profileMappingKey?: string | null; visibleWhen?: { fieldId: string; equals: string | boolean } | null };
type Version = { id: string; version: number; status: string; updatedAt?: string; schema?: { fields?: Field[] }; settings?: Record<string, any> };
type Form = { id: string; key: string; title: string; description?: string | null; audience?: StudioAudience; updatedAt?: string; purpose: string; status: string; versions?: Version[] };

const EVERYONE: StudioAudience = { mode: "all", targets: [] };
const TYPES: Array<[FieldType, string]> = [["short_text", "Short answer"], ["long_text", "Paragraph"], ["radio", "Multiple choice"], ["multi_select", "Checkboxes"], ["select", "Dropdown"], ["number", "Number"], ["date", "Date"], ["email", "Email"], ["url", "Link"], ["checkbox", "Yes / no"], ["acknowledgement", "Acknowledgement"], ["initials", "Initials"], ["signature", "Signature"]];
const CHOICE = new Set<FieldType>(["radio", "multi_select", "select"]);
const keyOf = (label: string, index: number) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `q_${index + 1}`;
const slug = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "form";
const published = (form: Form) => (form.versions || []).some((version) => version.status === "published");

/** Forms for managers: list on the left; the open form edits like a document
 *  (questions as cards), with Responses and Settings beside it. */
export function FormsStudio({ applications = false, targetFormId = null, targetSubmissionId = null, targetApplicationId = null }: { applications?: boolean; targetFormId?: string | null; targetSubmissionId?: string | null; targetApplicationId?: string | null }) {
  const [forms, setForms] = useState<Form[]>([]);
  const [selectedId, setSelectedId] = useState<string>(targetFormId || "");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  async function load(force = false) {
    const result = await queryApi<{ forms: Form[] }>("/api/studio-systems/forms", { staleMs: 10_000, force, tags: ["studio-systems", "forms"] });
    setForms(result.forms || []);
  }
  useEffect(() => { void load().catch((error) => setStatus(error instanceof Error ? error.message : "Forms are unavailable.")); }, []);
  useEffect(() => { if (targetFormId) setSelectedId(targetFormId); }, [targetFormId]);
  useEffect(() => {
    if (!targetSubmissionId) return;
    void api<{ formId: string }>(`/api/studio-systems/submissions/${encodeURIComponent(targetSubmissionId)}/target`).then((result) => setSelectedId(result.formId)).catch(() => undefined);
  }, [targetSubmissionId]);

  const scoped = forms.filter((form) => form.status !== "archived" && (applications ? form.purpose === "application" : form.purpose !== "application"));
  const visible = scoped.filter((form) => !query.trim() || form.title.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = scoped.find((form) => form.id === selectedId) || null;

  async function createForm() {
    const title = applications ? "New application" : "Untitled form";
    try {
      const created = await api<Form>("/api/studio-systems/forms", { method: "POST", body: JSON.stringify({ title, key: `${slug(title)}-${Date.now().toString(36)}`, purpose: applications ? "application" : "general", description: "", audience: EVERYONE }) });
      await load(true); setSelectedId(created.id);
    } catch (error) { setStatus(error instanceof Error ? error.message : "The form wasn't created."); }
  }

  return <div className="fs">
    <aside className="fs-list">
      <div className="fs-list__bar">
        <input className="fs-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={applications ? "Search applications" : "Search forms"} aria-label="Search forms" />
        <ClusterButton size="compact" variant="primary" onClick={() => void createForm()}><ClusterIcon name="plus" /> New</ClusterButton>
      </div>
      {applications ? <ClusterButton unstyled type="button" className={`fs-item ${!selected ? "is-active" : ""}`} onClick={() => setSelectedId("")}>
        <span className="fs-item__icon"><ClusterIcon name="users" /></span><span><strong>All applicants</strong><small>Review pipeline</small></span>
      </ClusterButton> : null}
      {visible.map((form) => <ClusterButton unstyled type="button" key={form.id} className={`fs-item ${form.id === selectedId ? "is-active" : ""}`} onClick={() => setSelectedId(form.id)}>
        <span className="fs-item__icon"><ClusterIcon name="file" /></span>
        <span><strong>{form.title}</strong><small>{published(form) ? "Published" : "Draft"} · v{form.versions?.[0]?.version || 0}</small></span>
        <i data-live={published(form) || undefined} />
      </ClusterButton>)}
      {!visible.length ? <p className="fs-empty">{query ? "No matches." : applications ? "No application forms yet." : "No forms yet."}</p> : null}
      {status ? <p className="fs-empty" role="alert">{status}</p> : null}
    </aside>
    <section className="fs-main">
      {selected ? <FormEditor key={selected.id} form={selected} onChanged={() => load(true)} onDeleted={() => { setSelectedId(""); void load(true); }} targetSubmissionId={targetSubmissionId} />
        : applications ? <StudioApplicationsPanel targetApplicationId={targetApplicationId} />
        : <div className="fs-blank"><ClusterIcon name="file" /><p>Pick a form or start a new one.</p><ClusterButton variant="primary" onClick={() => void createForm()}>New form</ClusterButton></div>}
    </section>
  </div>;
}

function FormEditor({ form, onChanged, onDeleted, targetSubmissionId }: { form: Form; onChanged: () => Promise<void>; onDeleted: () => void; targetSubmissionId: string | null }) {
  const latest = form.versions?.[0];
  const [view, setView] = useState<"questions" | "responses" | "settings">(targetSubmissionId ? "responses" : "questions");
  const [title, setTitle] = useState(form.title);
  const [description, setDescription] = useState(form.description || "");
  const [audience, setAudience] = useState<StudioAudience>(form.audience || EVERYONE);
  const [fields, setFields] = useState<Field[]>(() => (latest?.schema?.fields || []).map((field, index) => ({ ...field, id: field.id || keyOf(field.label, index), description: field.description || "", options: field.options || [] })));
  const [settings, setSettings] = useState<Record<string, any>>(() => ({ acceptingResponses: latest?.settings?.acceptingResponses !== false, allowMultipleSubmissions: latest?.settings?.allowMultipleSubmissions === true, confirmationMessage: latest?.settings?.confirmationMessage || "Thanks — your response was recorded.", publicApplication: latest?.settings?.publicApplication === true, notifyAdminsOnSubmission: latest?.settings?.notifyAdminsOnSubmission !== false, privacyNotice: latest?.settings?.privacyNotice || "" }));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const isPublished = published(form);
  const application = form.purpose === "application";

  const touch = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setDirty(true); };
  const patchField = (index: number, patch: Partial<Field>) => { setFields((current) => current.map((field, i) => i === index ? { ...field, ...patch } : field)); setDirty(true); };
  const move = (index: number, delta: number) => { setFields((current) => { const next = [...current]; const [item] = next.splice(index, 1); next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, item); return next; }); setDirty(true); };
  const addField = (type: FieldType = "short_text") => { setFields((current) => [...current, { id: `q_${current.length + 1}`, label: "", description: "", type, required: false, options: CHOICE.has(type) ? ["Option 1"] : [] }]); setDirty(true); };

  async function save(publish: boolean) {
    const normalized = fields.map((field, index) => ({ ...field, label: field.label.trim() || `Question ${index + 1}`, id: field.id.startsWith("q_") && field.label.trim() ? keyOf(field.label, index) : field.id || keyOf(field.label, index), options: field.options.map((option) => option.trim()).filter(Boolean) }));
    const ids = normalized.map((field) => field.id.toLowerCase());
    if (!normalized.length) { setMessage("Add at least one question."); return; }
    if (new Set(ids).size !== ids.length) { setMessage("Two questions have the same wording; make them different."); return; }
    const check = studioFormSchemaDefinitionSchema.safeParse({ fields: normalized });
    if (!check.success) { setMessage(check.error.issues[0]?.message || "A question is incomplete."); return; }
    setBusy(true); setMessage("");
    try {
      if (title.trim() !== form.title || description !== (form.description || "") || JSON.stringify(audience) !== JSON.stringify(form.audience || EVERYONE)) {
        await api(`/api/studio-systems/forms/${form.id}`, { method: "PATCH", body: JSON.stringify({ expectedUpdatedAt: form.updatedAt, title: title.trim() || "Untitled form", description, audience }) });
      }
      const payload = { schema: { fields: normalized }, settings: { allowDrafts: true, ...settings, publicApplication: application && settings.publicApplication } , publish };
      if (latest?.status === "draft" && latest.updatedAt) await api(`/api/studio-systems/forms/${form.id}/versions/${latest.id}`, { method: "PATCH", body: JSON.stringify({ ...payload, expectedUpdatedAt: latest.updatedAt }) });
      else await api(`/api/studio-systems/forms/${form.id}/versions`, { method: "POST", body: JSON.stringify(payload) });
      setDirty(false); setMessage(publish ? "Published." : "Saved.");
      await onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Not saved."); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!(await confirmCluster({ title: `Archive ${form.title}?`, message: "It stops accepting responses. Existing responses are kept.", confirmLabel: "Archive", tone: "danger" }))) return;
    try { await api(`/api/studio-systems/forms/${form.id}`, { method: "PATCH", body: JSON.stringify({ expectedUpdatedAt: form.updatedAt, title: form.title, description: form.description || "", audience: form.audience || EVERYONE, status: "archived" }) }); onDeleted(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Not archived."); }
  }

  const responsesLabel = useMemo(() => application ? "Applicants" : "Responses", [application]);
  return <div className="fe">
    <header className="fe-head">
      <ClusterSegmentedControl value={view} onChange={(value) => setView(value as typeof view)} label="Form views" size="compact"
        options={[{ value: "questions", label: "Questions" }, { value: "responses", label: responsesLabel }, { value: "settings", label: "Settings" }]} />
      <div className="fe-head__end">
        {message ? <span className="fe-msg">{message}</span> : dirty ? <span className="fe-msg">Unsaved changes</span> : null}
        <span className="fe-state" data-live={isPublished || undefined}>{isPublished ? "Published" : "Draft"}</span>
        <ClusterButton size="compact" disabled={busy || !dirty} onClick={() => void save(false)}>Save</ClusterButton>
        <ClusterButton size="compact" variant="primary" busy={busy} onClick={() => void save(true)}>{isPublished ? "Publish changes" : "Publish"}</ClusterButton>
      </div>
    </header>

    {view === "questions" ? <div className="fe-doc">
      <section className="fe-card fe-card--title">
        <input className="fe-title" value={title} onChange={(event) => touch(setTitle)(event.target.value)} placeholder="Form title" aria-label="Form title" />
        <textarea className="fe-desc" value={description} onChange={(event) => touch(setDescription)(event.target.value)} placeholder="Description" rows={2} aria-label="Form description" />
      </section>
      {fields.map((field, index) => <section key={index} className="fe-card">
        <div className="fe-q">
          <input className="fe-q__label" value={field.label} onChange={(event) => patchField(index, { label: event.target.value })} placeholder={`Question ${index + 1}`} aria-label={`Question ${index + 1}`} />
          <select className="fe-q__type" value={field.type} aria-label="Question type" onChange={(event) => { const type = event.target.value as FieldType; patchField(index, { type, options: CHOICE.has(type) && !field.options.length ? ["Option 1"] : field.options }); }}>
            {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <input className="fe-q__help" value={field.description} onChange={(event) => patchField(index, { description: event.target.value })} placeholder="Help text (optional)" aria-label="Help text" />
        {CHOICE.has(field.type) ? <div className="fe-opts">
          {field.options.map((option, optionIndex) => <div key={optionIndex} className="fe-opt">
            <span className="fe-opt__mark" data-type={field.type} />
            <input value={option} onChange={(event) => patchField(index, { options: field.options.map((item, i) => i === optionIndex ? event.target.value : item) })} aria-label={`Option ${optionIndex + 1}`} />
            <button type="button" aria-label="Remove option" onClick={() => patchField(index, { options: field.options.filter((_, i) => i !== optionIndex) })}><ClusterIcon name="close" /></button>
          </div>)}
          <button type="button" className="fe-opt__add" onClick={() => patchField(index, { options: [...field.options, `Option ${field.options.length + 1}`] })}>Add option</button>
        </div> : <div className="fe-preview">{TYPES.find(([value]) => value === field.type)?.[1]}</div>}
        <footer className="fe-q__foot">
          <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}><ClusterIcon name="chevron-up" /></button>
          <button type="button" aria-label="Move down" disabled={index === fields.length - 1} onClick={() => move(index, 1)}><ClusterIcon name="chevron-down" /></button>
          <button type="button" aria-label="Duplicate question" onClick={() => { setFields((current) => [...current.slice(0, index + 1), { ...field, id: `q_${current.length + 1}` }, ...current.slice(index + 1)]); setDirty(true); }}><ClusterIcon name="plus" /></button>
          <button type="button" aria-label="Delete question" onClick={() => { setFields((current) => current.filter((_, i) => i !== index)); setDirty(true); }}><ClusterIcon name="trash" /></button>
          <label className="fe-req"><input type="checkbox" checked={field.required} onChange={(event) => patchField(index, { required: event.target.checked })} /> Required</label>
        </footer>
      </section>)}
      <div className="fe-add">
        <ClusterButton onClick={() => addField()}><ClusterIcon name="plus" /> Add question</ClusterButton>
        <ClusterButton variant="quiet" onClick={() => addField("radio")}>Multiple choice</ClusterButton>
        <ClusterButton variant="quiet" onClick={() => addField("long_text")}>Paragraph</ClusterButton>
      </div>
    </div> : null}

    {view === "responses" ? <div className="fe-panel">{isPublished
      ? application ? <StudioApplicationsPanel targetApplicationId={null} /> : <StudioFormSubmissionsPanel formId={form.id} targetSubmissionId={targetSubmissionId} />
      : <p className="fs-empty">Publish the form to start collecting responses.</p>}</div> : null}

    {view === "settings" ? <div className="fe-doc">
      <section className="fe-card fe-set">
        <h3>Who can fill it</h3>
        <StudioAudiencePicker value={audience} onChange={touch(setAudience)} compact />
        {application ? <label className="fe-check"><input type="checkbox" checked={Boolean(settings.publicApplication)} onChange={(event) => touch(setSettings)({ ...settings, publicApplication: event.target.checked })} /> Show on the public sign-in page (anyone can apply)</label> : null}
      </section>
      <section className="fe-card fe-set">
        <h3>Responses</h3>
        <label className="fe-check"><input type="checkbox" checked={Boolean(settings.acceptingResponses)} onChange={(event) => touch(setSettings)({ ...settings, acceptingResponses: event.target.checked })} /> Accepting responses</label>
        {!application ? <label className="fe-check"><input type="checkbox" checked={Boolean(settings.allowMultipleSubmissions)} onChange={(event) => touch(setSettings)({ ...settings, allowMultipleSubmissions: event.target.checked })} /> Allow more than one response per person</label> : null}
        <label className="fe-check"><input type="checkbox" checked={Boolean(settings.notifyAdminsOnSubmission)} onChange={(event) => touch(setSettings)({ ...settings, notifyAdminsOnSubmission: event.target.checked })} /> Notify admins on each response</label>
        <label className="fe-field"><span>Confirmation message</span><input value={settings.confirmationMessage} onChange={(event) => touch(setSettings)({ ...settings, confirmationMessage: event.target.value })} /></label>
        {application ? <label className="fe-field"><span>Privacy notice</span><textarea rows={3} value={settings.privacyNotice} onChange={(event) => touch(setSettings)({ ...settings, privacyNotice: event.target.value })} /></label> : null}
      </section>
      <section className="fe-card fe-set">
        <h3>Form</h3>
        <p className="fe-muted">Key <code>{form.key}</code> · version {latest?.version || 0}</p>
        <ClusterButton variant="quiet" onClick={() => void remove()}><ClusterIcon name="archive" /> Archive form</ClusterButton>
      </section>
      <p className="fe-muted">Changes here apply when you Save or Publish.</p>
    </div> : null}
  </div>;
}

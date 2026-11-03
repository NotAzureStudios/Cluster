import { useEffect, useMemo, useRef, useState } from "react";
import { STUDIO_FORM_TEMPLATES, studioFormSchemaDefinitionSchema, type StudioAudience } from "@cluster/shared";
import { api, queryApi } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { SettingsStateChip, type SettingsStateTone } from "../../components/SettingsStateChip";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { ClusterInput, ClusterNativeSelect, ClusterTextarea } from "../../components/ClusterNativeControls";
import { RequestErrorState } from "../../components/RequestState";
import { StudioApplicationsPanel } from "./StudioApplicationsPanel";
import { StudioAnnouncementsPanel } from "./StudioAnnouncementsPanel";
import { StudioOnboardingPanel } from "./StudioOnboardingPanel";
import { StudioOffboardingPanel } from "./StudioOffboardingPanel";
import { StudioAccessRenewalsPanel } from "./StudioAccessRenewalsPanel";
import { StudioScopedGrantsPanel } from "./StudioScopedGrantsPanel";
import { StudioManagedPackagesPanel } from "./StudioManagedPackagesPanel";
import { StudioFormSubmissionsPanel } from "./StudioFormSubmissionsPanel";
import { StudioFormAssignmentsPanel } from "./StudioFormAssignmentsPanel";
import { StudioFormReviewersPanel } from "./StudioFormReviewersPanel";
import { StudioAudiencePicker } from "../studio-systems/StudioAudiencePicker";

type FormFieldType = "short_text" | "long_text" | "number" | "date" | "email" | "url" | "select" | "multi_select" | "checkbox" | "radio" | "acknowledgement" | "initials" | "signature";
type FormField = { id: string; label: string; description: string; type: FormFieldType; required: boolean; options: string[]; profileMappingKey?: string | null; visibleWhen?: { fieldId: string; equals: string | boolean } | null };
type FormVersion = { id: string; version: number; status: string; publishedAt?: string | null; schema?: { fields?: FormField[] }; updatedAt?: string; settings?: { publicApplication?: boolean; acceptingResponses?: boolean; privacyNotice?: string; notifyAdminsOnSubmission?: boolean; allowMultipleSubmissions?: boolean; confirmationMessage?: string; allowDrafts?: boolean; dueAt?: string | null; reminderDaysBefore?: number | null; remindWhenOverdue?: boolean } };
type StudioForm = { id: string; key: string; title: string; description?: string | null; audience?: StudioAudience; updatedAt?: string; purpose: string; status: string; versions?: FormVersion[] };
type PolicyVersion = { id: string; version: number; versionLabel: string; status: string; acceptanceMode: string; publishedAt?: string | null; formVersionId?: string | null };
type StudioPolicy = { id: string; key: string; title: string; summary?: string | null; requiredForAccess: boolean; recordAcceptance?: boolean; status: string; versions?: PolicyVersion[] };

const EVERYONE: StudioAudience = { mode: "all", targets: [] };

function toLocalDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  // datetime-local edits in the administrator's local zone; save as an absolute UTC instant.
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}


function slug(value: string, fallback = "form") {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function fieldId(label: string, index: number) {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return base || `field_${index + 1}`;
}

export function StudioSystemsSettingsSection({ targetFormId = null, targetSubmissionId = null, targetApplicationId = null, targetAnnouncementId = null, composeAnnouncement = false, showAnnouncements = false, initialTab = "forms", onTabChange }: { targetFormId?: string | null; targetSubmissionId?: string | null; targetApplicationId?: string | null; targetAnnouncementId?: string | null; composeAnnouncement?: boolean; showAnnouncements?: boolean; initialTab?: string | null; onTabChange?: (tab: string) => void }) {
  const [forms, setForms] = useState<StudioForm[]>([]);
  const [policies, setPolicies] = useState<StudioPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [status, setStatus] = useState("");
  const [tab, setTab] = useState<"forms" | "policies" | "applications" | "announcements" | "onboarding" | "offboarding" | "access" | "grants" | "packages">(initialTab === "policies" || initialTab === "applications" || initialTab === "announcements" ? initialTab : "forms");
  useEffect(() => { if (initialTab === "forms" || initialTab === "policies" || initialTab === "applications" || initialTab === "announcements") setTab(initialTab); }, [initialTab]);
  const [selectedFormId, setSelectedFormId] = useState("");
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const [newForm, setNewForm] = useState({ title: "", key: "", purpose: "general", audience: EVERYONE as StudioAudience });
  const [starterTemplateKey, setStarterTemplateKey] = useState(String(STUDIO_FORM_TEMPLATES[0]?.key || ""));
  const [newPolicy, setNewPolicy] = useState({ title: "", key: "", requiredForAccess: false, recordAcceptance: false, audience: EVERYONE as StudioAudience });
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [formAccess, setFormAccess] = useState({ title: "", description: "", audience: EVERYONE as StudioAudience });
  const [formPublishSettings, setFormPublishSettings] = useState({ publicApplication: false, acceptingResponses: true, privacyNotice: "", notifyAdminsOnSubmission: true, allowMultipleSubmissions: false, confirmationMessage: "Submitted.", dueAtLocal: "", reminderDaysBefore: "", remindWhenOverdue: false });
  const [formBusy, setFormBusy] = useState(false);
  const formMutationLock = useRef(false);
  const [policyDraft, setPolicyDraft] = useState({ versionLabel: "1.0", bodyMarkdown: "", acceptanceMode: "acknowledge", formVersionId: "" });

  async function load(force = false) {
    setLoading(true); setLoadError(null);
    try {
      const [formResponse, policyResponse] = await Promise.all([
        queryApi<{ forms: StudioForm[] }>("/api/studio-systems/forms", { staleMs: 10_000, force, tags: ["studio-systems", "forms"] }),
        queryApi<{ policies: StudioPolicy[] }>("/api/studio-systems/policies", { staleMs: 10_000, force, tags: ["studio-systems", "policies"] }),
      ]);
      setForms(formResponse.forms || []);
      setPolicies(policyResponse.policies || []);
      setSelectedFormId((current) => formResponse.forms.some((item: StudioForm) => item.id === current) ? current : (targetSubmissionId || targetFormId) ? "" : formResponse.forms[0]?.id || "");
      setSelectedPolicyId((current) => policyResponse.policies.some((item) => item.id === current) ? current : policyResponse.policies[0]?.id || "");
    } catch (error) { setLoadError(error); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!targetFormId) return;
    setTab("forms");
    // Do not silently open a different form when the target vanished.
    if (forms.length && !forms.some((item: StudioForm) => item.id === targetFormId)) {
      setSelectedFormId(""); setStatus("Form unavailable or access was revoked. Refresh the Forms workspace.");
    } else setSelectedFormId(targetFormId);
  }, [targetFormId, forms]);
  useEffect(() => {
    if (!targetSubmissionId) return;
    let active = true;
    setTab("forms");
    setSelectedFormId("");
    void api<{ formId: string }>(`/api/studio-systems/submissions/${encodeURIComponent(targetSubmissionId)}/target`)
      .then((result) => { if (active) { setSelectedFormId(result.formId); setStatus(""); } })
      .catch(() => { if (active) { setSelectedFormId(""); setStatus("This form response is unavailable or you no longer have review permission."); } });
    return () => { active = false; };
  }, [targetSubmissionId]);
  useEffect(() => { if (targetApplicationId) setTab("applications"); }, [targetApplicationId]);
  useEffect(() => { if (targetAnnouncementId || composeAnnouncement || showAnnouncements) setTab("announcements"); }, [targetAnnouncementId, composeAnnouncement, showAnnouncements]);
  const selectedForm = forms.find((item) => item.id === selectedFormId) || null;
  const selectedPolicy = policies.find((item) => item.id === selectedPolicyId) || null;
  const publishedFormVersions = useMemo(() => forms.flatMap((form) => (form.versions || []).filter((version) => version.status === "published").map((version) => ({ form, version }))), [forms]);

  useEffect(() => {
    setFormAccess({ title: selectedForm?.title || "", description: selectedForm?.description || "", audience: selectedForm?.audience || EVERYONE });
  }, [selectedFormId, selectedForm?.updatedAt]);

  useEffect(() => {
    const latest = selectedForm?.versions?.[0];
    setFormFields((latest?.schema?.fields || []).map((field, index) => ({ id: field.id || fieldId(field.label || "", index), label: field.label || "", description: field.description || "", type: field.type || "short_text", required: Boolean(field.required), options: field.options || [], profileMappingKey: field.profileMappingKey || null, visibleWhen: field.visibleWhen || null })));
    setFormPublishSettings({ publicApplication: selectedForm?.purpose === "application" && latest?.settings?.publicApplication === true, acceptingResponses: latest?.settings?.acceptingResponses !== false, privacyNotice: latest?.settings?.privacyNotice || "", notifyAdminsOnSubmission: latest?.settings?.notifyAdminsOnSubmission !== false, allowMultipleSubmissions: latest?.settings?.allowMultipleSubmissions === true, confirmationMessage: latest?.settings?.confirmationMessage || "Submitted.", dueAtLocal: toLocalDateTime(latest?.settings?.dueAt), reminderDaysBefore: latest?.settings?.reminderDaysBefore == null ? "" : String(latest.settings.reminderDaysBefore), remindWhenOverdue: latest?.settings?.remindWhenOverdue === true });
  }, [selectedFormId, selectedForm?.purpose, selectedForm?.versions?.[0]?.id, selectedForm?.versions?.[0]?.updatedAt]);

  async function saveFormAccess() {
    if (!selectedForm || formMutationLock.current || !selectedForm.updatedAt) return;
    if (!formAccess.title.trim()) { setStatus("A form title is required."); return; }
    if (formAccess.audience.mode !== "all" && !formAccess.audience.targets.length) { setStatus("Choose audience targets or select Whole studio."); return; }
    formMutationLock.current = true; setFormBusy(true); setStatus("Updating form audience…");
    try {
      await api(`/api/studio-systems/forms/${selectedForm.id}`, { method: "PATCH", body: JSON.stringify({ expectedUpdatedAt: selectedForm.updatedAt, title: formAccess.title, description: formAccess.description, audience: formAccess.audience }) });
      setStatus("Form details and audience updated."); await load(true);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Form access could not be updated."); }
    finally { formMutationLock.current = false; setFormBusy(false); }
  }

  async function createForm() {
    const title = newForm.title.trim(); if (!title) return;
    if (newForm.audience.mode !== "all" && !newForm.audience.targets.length) { setStatus("Choose a form audience target or use Whole studio."); return; }
    setStatus("Creating form…");
    try {
      const created = await api<StudioForm>("/api/studio-systems/forms", { method: "POST", body: JSON.stringify({ title, key: slug(newForm.key || title), purpose: newForm.purpose, description: "", audience: newForm.audience }) });
      setNewForm({ title: "", key: "", purpose: "general", audience: EVERYONE }); setSelectedFormId(created.id); setStatus("Form created."); await load(true);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Form could not be created."); }
  }

  async function createStarterForm() {
    const template = STUDIO_FORM_TEMPLATES.find((item) => item.key === starterTemplateKey); if (!template) return;
    if (newForm.audience.mode !== "all" && !newForm.audience.targets.length) { setStatus("Choose a form audience target or use Whole studio."); return; }
    setStatus("Creating starter form…");
    try {
      const created = await api<StudioForm>("/api/studio-systems/forms/from-template", { method: "POST", body: JSON.stringify({ templateKey: template.key, audience: newForm.audience }) });
      setSelectedFormId(created.id); setStatus(`${template.title} starter created as a draft. Review it before publishing.`); await load(true);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Starter form could not be created."); }
  }

  function addField() {
    const index = formFields.length;
    setFormFields((current) => [...current, { id: `field_${index + 1}`, label: `Field ${index + 1}`, description: "", type: "short_text", required: false, options: [], profileMappingKey: null, visibleWhen: null }]);
  }

  function updateField(index: number, patch: Partial<FormField>) {
    setFormFields((current) => current.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field));
  }

  async function saveFormVersion(publish: boolean) {
    if (!selectedForm || formMutationLock.current) return;
    const normalized = formFields.map((field, index) => ({ ...field, id: field.id.trim() || fieldId(field.label, index), label: field.label.trim() || `Field ${index + 1}`, options: field.options.filter(Boolean) }));
    if (!normalized.length) { setStatus("Add at least one field before saving a version."); return; }
    const keys = normalized.map((field) => field.id.toLowerCase());
    if (new Set(keys).size !== keys.length) { setStatus("Field keys must be unique."); return; }
    const schemaCheck = studioFormSchemaDefinitionSchema.safeParse({ fields: normalized });
    if (!schemaCheck.success) { setStatus(`Cannot save form: ${schemaCheck.error.issues[0]?.message || "invalid field rules"}`); return; }
    const dueAt = selectedForm.purpose !== "application" && formPublishSettings.dueAtLocal
      ? new Date(formPublishSettings.dueAtLocal) : null;
    if (dueAt && !Number.isFinite(dueAt.getTime())) { setStatus("Enter a valid form deadline."); return; }
    const reminderDays = formPublishSettings.reminderDaysBefore === "" ? null : Number(formPublishSettings.reminderDaysBefore);
    if (selectedForm.purpose !== "application" && (!dueAt && (reminderDays != null || formPublishSettings.remindWhenOverdue))) {
      setStatus("Set a deadline before enabling reminders."); return;
    }
    if (reminderDays != null && (!Number.isInteger(reminderDays) || reminderDays < 1 || reminderDays > 30)) {
      setStatus("Due-soon reminders must be 1–30 days before the deadline."); return;
    }
    formMutationLock.current = true; setFormBusy(true); setStatus(publish ? "Publishing form version…" : "Saving draft…");
    const payload = { schema: { fields: normalized }, settings: { allowDrafts: true, allowMultipleSubmissions: formPublishSettings.allowMultipleSubmissions, confirmationMessage: formPublishSettings.confirmationMessage, publicApplication: selectedForm.purpose === "application" && formPublishSettings.publicApplication, acceptingResponses: formPublishSettings.acceptingResponses, privacyNotice: formPublishSettings.privacyNotice, notifyAdminsOnSubmission: formPublishSettings.notifyAdminsOnSubmission,
      dueAt: dueAt ? dueAt.toISOString() : null,
      reminderDaysBefore: dueAt && selectedForm.purpose !== "application" ? reminderDays : null,
      remindWhenOverdue: Boolean(dueAt && selectedForm.purpose !== "application" && formPublishSettings.remindWhenOverdue) } };
    try {
      const latest = selectedForm.versions?.[0];
      if (latest?.status === "draft" && latest.updatedAt) {
        await api(`/api/studio-systems/forms/${selectedForm.id}/versions/${latest.id}`, { method: "PATCH", body: JSON.stringify({ ...payload, publish, expectedUpdatedAt: latest.updatedAt }) });
      } else {
        await api(`/api/studio-systems/forms/${selectedForm.id}/versions`, { method: "POST", body: JSON.stringify({ ...payload, publish }) });
      }
      setStatus(publish ? "Form version published." : "Draft saved."); await load(true);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Form version could not be saved. Refresh before retrying an uncertain request."); }
    finally { formMutationLock.current = false; setFormBusy(false); }
  }

  async function createPolicy() {
    const title = newPolicy.title.trim(); if (!title) return;
    if (newPolicy.audience.mode !== "all" && !newPolicy.audience.targets.length) { setStatus("Choose a policy audience target or use Whole studio."); return; }
    setStatus("Creating policy…");
    try {
      const created = await api<StudioPolicy>("/api/studio-systems/policies", { method: "POST", body: JSON.stringify({ title, key: slug(newPolicy.key || title, "policy"), summary: "", requiredForAccess: newPolicy.requiredForAccess, recordAcceptance: newPolicy.recordAcceptance, audience: newPolicy.audience }) });
      setNewPolicy({ title: "", key: "", requiredForAccess: false, recordAcceptance: false, audience: EVERYONE }); setSelectedPolicyId(created.id); setStatus("Policy created."); await load(true);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Policy could not be created."); }
  }

  async function publishPolicyVersion() {
    if (!selectedPolicy || !policyDraft.bodyMarkdown.trim()) return;
    setStatus("Publishing policy version…");
    try {
      await api(`/api/studio-systems/policies/${selectedPolicy.id}/versions`, { method: "POST", body: JSON.stringify({ versionLabel: policyDraft.versionLabel.trim() || "1.0", bodyMarkdown: policyDraft.bodyMarkdown, acceptanceMode: policyDraft.acceptanceMode, formVersionId: policyDraft.acceptanceMode === "form" ? policyDraft.formVersionId || null : null, publish: true }) });
      setStatus("Policy version published."); setPolicyDraft((current) => ({ ...current, bodyMarkdown: "" })); await load(true);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Policy version could not be published."); }
  }

  // Counts come from immutable version records, not from a successful save
  // toast. Draft identities are never represented as published.
  const formsWithPublishedVersion = forms.filter((item) => (item.versions || []).some((version) => version.status === "published")).length;
  const policiesWithPublishedVersion = policies.filter((item) => (item.versions || []).some((version) => version.status === "published")).length;
  const formTone = (item: StudioForm): SettingsStateTone =>
    (item.versions || []).some((version) => version.status === "published") ? "success" : "neutral";
  const policyTone = (item: StudioPolicy): SettingsStateTone =>
    (item.versions || []).some((version) => version.status === "published") ? "success" : "neutral";

  if (loading && !forms.length && !policies.length) return <div className="settings-card-v092"><span>Loading studio systems…</span></div>;
  if (loadError && !forms.length && !policies.length) return <RequestErrorState error={loadError} title="Studio systems could not be loaded" onRetry={() => void load(true)} />;

  return <div className="studio-systems-v34f">
    <div className="settings-panel-head-v092 studio-section-intro-v272">
      <div><h2 className="studio-systems-heading-visual-v103"><ClusterIcon name={tab === "policies" ? "lock" : tab === "forms" ? "file" : tab === "applications" ? "users" : tab === "announcements" ? "bell" : "settings"} aria-hidden="true" />{tab === "policies" ? "Policies" : tab === "forms" ? "Forms" : tab === "applications" ? "Applications" : tab === "announcements" ? "Announcements" : "Studio systems"}</h2></div>
      <ClusterButton type="button" variant="quiet" size="compact" onClick={() => void load(true)}><ClusterIcon name="refresh" aria-hidden="true" /> Refresh</ClusterButton>
    </div>
    <ClusterSegmentedControl
      value={tab}
      onChange={(value) => { setTab(value); onTabChange?.(value); }}
      label="Studio systems"
      className="studio-systems-tabs-v34f"
      options={[
        { value: "forms", label: "Forms" },
        { value: "policies", label: "Policies" },
        { value: "applications", label: "Applications" },
        { value: "announcements", label: "Announcements" },
        { value: "onboarding", label: "Onboarding" },
        { value: "offboarding", label: "Offboarding" },
        { value: "access", label: "Access renewals" },
        { value: "grants", label: "Scoped grants" },
        { value: "packages", label: "Packages" },
      ]}
    />
    {status && <div className="studio-explanation-v272"><strong><ClusterIcon name="activity" aria-hidden="true" /> Status</strong><span>{status}</span></div>}
    {(tab === "forms" || tab === "policies") && <div className="studio-systems-status-overview-v103" aria-label={tab === "forms" ? "Form publishing summary" : "Policy publishing summary"}>
      <article><div><ClusterIcon name={tab === "forms" ? "file" : "lock"} aria-hidden="true" /><span>{tab === "forms" ? "Forms" : "Policies"}</span></div><strong>{tab === "forms" ? forms.length : policies.length}</strong><SettingsStateChip tone="neutral">Registered</SettingsStateChip></article>
      <article><div><ClusterIcon name="check" aria-hidden="true" /><span>With published versions</span></div><strong>{tab === "forms" ? formsWithPublishedVersion : policiesWithPublishedVersion}</strong><SettingsStateChip tone="success">Version published</SettingsStateChip></article>
      <article><div><ClusterIcon name="note" aria-hidden="true" /><span>No published version</span></div><strong>{tab === "forms" ? forms.length - formsWithPublishedVersion : policies.length - policiesWithPublishedVersion}</strong><SettingsStateChip tone="neutral">Draft or unpublished</SettingsStateChip></article>
    </div>}

    {tab === "forms" && <div className="studio-systems-layout-v34f">
      <aside className="studio-systems-list-v34f">
        <div className="studio-create-strip-v272 studio-systems-create-v34f"><div><strong>New form</strong></div><ClusterNativeSelect value={starterTemplateKey} onChange={(event) => setStarterTemplateKey(event.target.value)}>{STUDIO_FORM_TEMPLATES.map((template) => <option key={template.key} value={template.key}>Starter · {template.title}</option>)}</ClusterNativeSelect><ClusterButton type="button" variant="quiet" disabled={!starterTemplateKey} onClick={() => void createStarterForm()}>Create from starter</ClusterButton><ClusterInput value={newForm.title} onChange={(event) => setNewForm((current) => ({ ...current, title: event.target.value, key: !current.key || current.key === slug(current.title) ? slug(event.target.value) : current.key }))} placeholder="Form name" /><ClusterInput value={newForm.key} onChange={(event) => setNewForm((current) => ({ ...current, key: slug(event.target.value) }))} placeholder="form-key" /><ClusterNativeSelect value={newForm.purpose} onChange={(event) => setNewForm((current) => ({ ...current, purpose: event.target.value }))}><option value="general">General</option><option value="policy">Policy</option><option value="application">Application</option><option value="onboarding">Onboarding</option><option value="access_request">Access request</option><option value="equipment">Equipment</option><option value="incident">Incident</option><option value="completion">Completion</option><option value="release_signoff">Release signoff</option></ClusterNativeSelect><StudioAudiencePicker value={newForm.audience} onChange={(audience) => setNewForm((current) => ({ ...current, audience }))} compact /><ClusterButton type="button" variant="secondary" disabled={!newForm.title.trim()} onClick={() => void createForm()}>Create form</ClusterButton></div>
        <div className="studio-entity-list-v272">{forms.map((form) => <ClusterButton type="button" key={form.id} className={form.id === selectedFormId ? "active" : ""} onClick={() => setSelectedFormId(form.id)}><span className="studio-entity-list-copy-v272"><strong><ClusterIcon name="file" aria-hidden="true" /> {form.title}</strong><small>{form.purpose.replaceAll("_", " ")} · {form.status}</small></span><span className="studio-entity-list-meta-v272"><SettingsStateChip tone={formTone(form)} icon={formTone(form) === "success" ? "check" : "note"}>{formTone(form) === "success" ? "Published version" : "Not published"}</SettingsStateChip><small>{form.versions?.length || 0} versions</small></span></ClusterButton>)}</div>
      </aside>
      <section className="studio-systems-editor-v34f">{selectedForm ? <>
        <header className="studio-entity-editor-head-v272"><div><span className="eyebrow">Reusable form</span><h3><ClusterIcon name="file" aria-hidden="true" /> {selectedForm.title}</h3><p><code>{selectedForm.key}</code> · {selectedForm.purpose.replaceAll("_", " ")}</p><SettingsStateChip tone={formTone(selectedForm)}>{formTone(selectedForm) === "success" ? "A published version exists" : "No published version"}</SettingsStateChip></div><ClusterButton type="button" variant="secondary" disabled={formBusy} onClick={addField}><ClusterIcon name="plus" aria-hidden="true" /> Add field</ClusterButton></header>
        <div className="settings-card-v092"><strong>Form details & assigned audience</strong>
          <div className="field"><label>Title</label><ClusterInput disabled={formBusy} value={formAccess.title} onChange={(event) => setFormAccess((current) => ({ ...current, title: event.target.value }))} /></div>
          <div className="field"><label>Description</label><ClusterTextarea disabled={formBusy} value={formAccess.description} onChange={(event) => setFormAccess((current) => ({ ...current, description: event.target.value }))} /></div>
          <StudioAudiencePicker value={formAccess.audience} onChange={(audience) => setFormAccess((current) => ({ ...current, audience }))} compact />
          <p className="muted tight">Changing the audience immediately changes who can discover and submit this form. Existing responses remain in the administrative review history.</p>
          <ClusterButton type="button" variant="secondary" disabled={formBusy || !selectedForm.updatedAt} onClick={() => void saveFormAccess()}>Save details & audience</ClusterButton>
        </div>
        <div className="studio-form-field-list-v34f">{formFields.map((field, index) => <div className="settings-card-v092 studio-form-field-v34f" key={`${field.id}-${index}`}><div className="studio-form-grid-v272"><div className="field"><label>Label</label><ClusterInput value={field.label} onChange={(event) => updateField(index, { label: event.target.value, id: field.id.startsWith("field_") ? fieldId(event.target.value, index) : field.id })} /></div><div className="field"><label>Key</label><ClusterInput value={field.id} onChange={(event) => updateField(index, { id: fieldId(event.target.value, index) })} /></div><div className="field"><label>Type</label><ClusterNativeSelect value={field.type} onChange={(event) => updateField(index, { type: event.target.value as FormFieldType })}><option value="short_text">Short text</option><option value="long_text">Long text</option><option value="number">Number</option><option value="date">Date</option><option value="email">Email</option><option value="url">URL</option><option value="select">Select</option><option value="multi_select">Multi-select</option><option value="checkbox">Checkbox</option><option value="radio">Radio</option><option value="acknowledgement">Acknowledgement</option><option value="initials">Initials</option><option value="signature">Signature</option></ClusterNativeSelect></div><label className="studio-inline-check-v272"><ClusterInput type="checkbox" checked={field.required} onChange={(event) => updateField(index, { required: event.target.checked })} /> Required</label>{["select", "multi_select", "radio"].includes(field.type) && <div className="field span-2"><label>Options</label><ClusterInput value={field.options.join(", ")} onChange={(event) => updateField(index, { options: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="Option A, Option B" /></div>}<div className="field span-2"><label>Profile mapping key</label><ClusterInput value={field.profileMappingKey || ""} onChange={(event) => updateField(index, { profileMappingKey: event.target.value || null })} placeholder="Optional. Used later by explicit application → People mapping." /></div><div className="field span-2"><label>Show this field only when</label><ClusterNativeSelect value={field.visibleWhen?.fieldId || ""} onChange={(event) => {
          const source = formFields.slice(0, index).find((candidate) => candidate.id === event.target.value);
          updateField(index, { visibleWhen: source ? { fieldId: source.id, equals: ["checkbox", "acknowledgement"].includes(source.type) ? true : (source.options[0] || "") } : null });
        }}><option value="">Always visible</option>{formFields.slice(0, index).filter((source) => ["select", "radio", "multi_select", "checkbox", "acknowledgement"].includes(source.type)).map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}</ClusterNativeSelect></div>
        {field.visibleWhen && <div className="field span-2"><label>Required answer for visibility</label><ClusterNativeSelect value={String(field.visibleWhen.equals)} onChange={(event) => updateField(index, { visibleWhen: { fieldId: field.visibleWhen!.fieldId, equals: ["checkbox", "acknowledgement"].includes(formFields.slice(0, index).find((candidate) => candidate.id === field.visibleWhen?.fieldId)?.type || "") ? event.target.value === "true" : event.target.value } })}>{["checkbox", "acknowledgement"].includes(formFields.slice(0, index).find((candidate) => candidate.id === field.visibleWhen?.fieldId)?.type || "") ? <><option value="true">Checked</option><option value="false">Not checked</option></> : (formFields.slice(0, index).find((candidate) => candidate.id === field.visibleWhen?.fieldId)?.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</ClusterNativeSelect><small>Only an earlier visible answer can show this field. Hidden answers are excluded from final submissions.</small></div>}</div><div className="button-row"><ClusterButton type="button" size="compact" disabled={formBusy || index === 0} onClick={() => setFormFields((current) => { const copy = [...current]; [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]]; return copy; })}>Move up</ClusterButton><ClusterButton type="button" size="compact" disabled={formBusy || index === formFields.length - 1} onClick={() => setFormFields((current) => { const copy = [...current]; [copy[index + 1], copy[index]] = [copy[index], copy[index + 1]]; return copy; })}>Move down</ClusterButton><ClusterButton type="button" size="compact" disabled={formBusy} onClick={() => setFormFields((current) => current.filter((_, fieldIndex) => fieldIndex !== index))}>Remove field</ClusterButton></div></div>)}</div>
        {selectedForm.purpose === "application" && <div className="settings-card-v092"><strong>Public application</strong><label className="studio-inline-check-v272"><ClusterInput type="checkbox" checked={formPublishSettings.publicApplication} onChange={(event) => setFormPublishSettings((current) => ({ ...current, publicApplication: event.target.checked }))} /> Show this form on the signed-out studio cover</label><label className="studio-inline-check-v272"><ClusterInput type="checkbox" checked={formPublishSettings.notifyAdminsOnSubmission} onChange={(event) => setFormPublishSettings((current) => ({ ...current, notifyAdminsOnSubmission: event.target.checked }))} /> Notify studio admins in Inbox when a new application arrives</label></div>}
        <div className="settings-card-v092"><strong>Submission behavior</strong>
          <label className="studio-inline-check-v272"><ClusterInput type="checkbox" checked={formPublishSettings.acceptingResponses} onChange={(event) => setFormPublishSettings((current) => ({ ...current, acceptingResponses: event.target.checked }))} /> Accept submissions</label>
          <label className="studio-inline-check-v272"><ClusterInput type="checkbox" checked={formPublishSettings.allowMultipleSubmissions} onChange={(event) => setFormPublishSettings((current) => ({ ...current, allowMultipleSubmissions: event.target.checked }))} /> Allow repeat submissions</label>
          {selectedForm.purpose !== "application" && <label className="studio-inline-check-v272"><ClusterInput type="checkbox" checked={formPublishSettings.notifyAdminsOnSubmission} onChange={(event) => setFormPublishSettings((current) => ({ ...current, notifyAdminsOnSubmission: event.target.checked }))} /> Notify administrators when a response needs review</label>}
          {selectedForm.purpose !== "application" && <div className="studio-explanation-v272"><strong>Audience deadlines and reminders</strong><span>Everyone in the published audience sees the same deadline. It is informational: late submissions remain allowed until you close responses. Reminders go only to eligible, not-yet-submitted studio members through Inbox.</span></div>}
          {selectedForm.purpose !== "application" && <div className="studio-form-grid-v272">
            <div className="field"><label htmlFor="studio-form-due-at">Form deadline (your local time)</label><ClusterInput id="studio-form-due-at" type="datetime-local" value={formPublishSettings.dueAtLocal} onChange={(event) => setFormPublishSettings((current) => ({ ...current, dueAtLocal: event.target.value, ...(!event.target.value ? { reminderDaysBefore: "", remindWhenOverdue: false } : {}) }))} /><small className="muted">Leave blank for no due date.</small></div>
            <div className="field"><label htmlFor="studio-form-reminder-days">Send a due-soon reminder</label><ClusterNativeSelect id="studio-form-reminder-days" disabled={!formPublishSettings.dueAtLocal} value={formPublishSettings.reminderDaysBefore} onChange={(event) => setFormPublishSettings((current) => ({ ...current, reminderDaysBefore: event.target.value }))}><option value="">No due-soon reminder</option>{[1, 2, 3, 5, 7, 14, 30].map((days) => <option key={days} value={String(days)}>{days} day{days === 1 ? "" : "s"} before due</option>)}</ClusterNativeSelect></div>
            <label className="studio-inline-check-v272 span-2"><ClusterInput type="checkbox" disabled={!formPublishSettings.dueAtLocal} checked={formPublishSettings.remindWhenOverdue} onChange={(event) => setFormPublishSettings((current) => ({ ...current, remindWhenOverdue: event.target.checked }))} /> Send one overdue reminder if still incomplete</label>
          </div>}
          <div className="field"><label>Confirmation message</label><ClusterInput value={formPublishSettings.confirmationMessage} onChange={(event) => setFormPublishSettings((current) => ({ ...current, confirmationMessage: event.target.value }))} /></div>
          {selectedForm.purpose !== "application" && <div className="field"><label>Privacy notice</label><ClusterTextarea value={formPublishSettings.privacyNotice} onChange={(event) => setFormPublishSettings((current) => ({ ...current, privacyNotice: event.target.value }))} /></div>}
        </div>
        <div className="button-row"><ClusterButton type="button" variant="secondary" disabled={!formFields.length || formBusy} onClick={() => void saveFormVersion(false)}>{formBusy ? "Saving…" : "Save draft"}</ClusterButton><ClusterButton type="button" variant="primary" disabled={!formFields.length || formBusy} onClick={() => void saveFormVersion(true)}>{formBusy ? "Saving…" : "Publish new version"}</ClusterButton></div>
        {selectedForm.purpose !== "application" && <StudioFormAssignmentsPanel key={`assign:${selectedForm.id}`} formId={selectedForm.id} />}
        {selectedForm.purpose !== "application" && <StudioFormReviewersPanel key={`review:${selectedForm.id}`} formId={selectedForm.id} />}
        {selectedForm.purpose !== "application" && <StudioFormSubmissionsPanel key={selectedForm.id} formId={selectedForm.id} targetSubmissionId={targetSubmissionId} />}
        {selectedForm.purpose === "application" && <p className="muted tight">Application responses are reviewed in the Applications tab.</p>}
      </> : <div className="settings-card-v092"><strong>No form selected</strong></div>}</section>
    </div>}

    {tab === "policies" && <div className="studio-systems-layout-v34f">
      <aside className="studio-systems-list-v34f"><div className="studio-create-strip-v272 studio-systems-create-v34f"><div><strong>New policy</strong><span>Create the policy identity, then publish immutable content versions.</span></div><ClusterInput value={newPolicy.title} onChange={(event) => setNewPolicy((current) => ({ ...current, title: event.target.value, key: current.key || slug(event.target.value, "policy") }))} placeholder="Policy name" /><ClusterInput value={newPolicy.key} onChange={(event) => setNewPolicy((current) => ({ ...current, key: slug(event.target.value, "policy") }))} placeholder="policy-key" /><label className="studio-inline-check-v272"><ClusterInput type="checkbox" checked={newPolicy.requiredForAccess} onChange={(event) => setNewPolicy((current) => ({ ...current, requiredForAccess: event.target.checked }))} /> Required for access</label><label className="studio-inline-check-v272"><ClusterInput type="checkbox" checked={newPolicy.recordAcceptance} onChange={(event) => setNewPolicy((current) => ({ ...current, recordAcceptance: event.target.checked }))} /> Create Personnel Record evidence on acceptance</label><StudioAudiencePicker value={newPolicy.audience} onChange={(audience) => setNewPolicy((current) => ({ ...current, audience }))} compact /><ClusterButton type="button" variant="secondary" disabled={!newPolicy.title.trim()} onClick={() => void createPolicy()}>Create policy</ClusterButton></div><div className="studio-entity-list-v272">{policies.map((policy) => <ClusterButton type="button" key={policy.id} className={policy.id === selectedPolicyId ? "active" : ""} onClick={() => setSelectedPolicyId(policy.id)}><span className="studio-entity-list-copy-v272"><strong><ClusterIcon name="lock" aria-hidden="true" /> {policy.title}</strong><small>{policy.requiredForAccess ? "Access required" : "Informational"}{policy.recordAcceptance ? " · Record evidence" : ""} · {policy.status}</small></span><span className="studio-entity-list-meta-v272"><SettingsStateChip tone={policyTone(policy)} icon={policyTone(policy) === "success" ? "check" : "note"}>{policyTone(policy) === "success" ? "Published version" : "Not published"}</SettingsStateChip><small>{policy.versions?.length || 0} versions</small></span></ClusterButton>)}</div></aside>
      <section className="studio-systems-editor-v34f">{selectedPolicy ? <><header className="studio-entity-editor-head-v272"><div><span className="eyebrow">Studio policy</span><h3><ClusterIcon name="lock" aria-hidden="true" /> {selectedPolicy.title}</h3><p><code>{selectedPolicy.key}</code>{selectedPolicy.requiredForAccess ? " · blocks access until accepted" : ""}</p><div className="studio-systems-policy-status-v103"><SettingsStateChip tone={policyTone(selectedPolicy)}>{policyTone(selectedPolicy) === "success" ? "Published content exists" : "Unpublished"}</SettingsStateChip><SettingsStateChip tone={selectedPolicy.requiredForAccess ? "warning" : "neutral"} icon={selectedPolicy.requiredForAccess ? "lock" : "file"}>{selectedPolicy.requiredForAccess ? "Acceptance required for access" : "Informational"}</SettingsStateChip></div></div></header><div className="studio-form-grid-v272"><div className="field"><label>Version label</label><ClusterInput value={policyDraft.versionLabel} onChange={(event) => setPolicyDraft((current) => ({ ...current, versionLabel: event.target.value }))} /></div><div className="field"><label>Acceptance</label><ClusterNativeSelect value={policyDraft.acceptanceMode} onChange={(event) => setPolicyDraft((current) => ({ ...current, acceptanceMode: event.target.value }))}><option value="none">Read only</option><option value="acknowledge">Acknowledge</option><option value="initials">Initials</option><option value="signature">Signature</option><option value="form">Knowledge check / form</option></ClusterNativeSelect></div>{policyDraft.acceptanceMode === "form" && <div className="field span-2"><label>Published form version</label><ClusterNativeSelect value={policyDraft.formVersionId} onChange={(event) => setPolicyDraft((current) => ({ ...current, formVersionId: event.target.value }))}><option value="">Choose a form version</option>{publishedFormVersions.map(({ form, version }) => <option key={version.id} value={version.id}>{form.title} · v{version.version}</option>)}</ClusterNativeSelect></div>}<div className="field span-2"><label>Policy body</label><ClusterTextarea value={policyDraft.bodyMarkdown} onChange={(event) => setPolicyDraft((current) => ({ ...current, bodyMarkdown: event.target.value }))} placeholder="Write policy content in Markdown." /></div></div><div className="studio-explanation-v272"><strong>Versioned evidence</strong><span>Published policy content is hashed. Acceptance records keep the exact content hash so a later edit cannot silently rewrite what a person agreed to.</span></div><div className="button-row"><ClusterButton type="button" variant="primary" disabled={!policyDraft.bodyMarkdown.trim() || (policyDraft.acceptanceMode === "form" && !policyDraft.formVersionId)} onClick={() => void publishPolicyVersion()}>Publish policy version</ClusterButton></div></> : <div className="settings-card-v092"><strong>No policy selected</strong></div>}</section>
    </div>}
    {tab === "applications" && <StudioApplicationsPanel targetApplicationId={targetApplicationId} />}
    {tab === "announcements" && <StudioAnnouncementsPanel targetAnnouncementId={targetAnnouncementId} composeAnnouncement={composeAnnouncement} />}
    {tab === "onboarding" && <StudioOnboardingPanel />}
    {tab === "offboarding" && <StudioOffboardingPanel />}
    {tab === "access" && <StudioAccessRenewalsPanel />}
    {tab === "grants" && <StudioScopedGrantsPanel />}
    {tab === "packages" && <StudioManagedPackagesPanel />}
  </div>;
}

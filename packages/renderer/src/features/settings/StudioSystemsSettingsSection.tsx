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

export function StudioSystemsSettingsSection({ targetFormId = null, targetSubmissionId = null, targetApplicationId = null, initialTab = "policies", onTabChange }: { targetFormId?: string | null; targetSubmissionId?: string | null; targetApplicationId?: string | null; initialTab?: string | null; onTabChange?: (tab: string) => void }) {
  const [forms, setForms] = useState<StudioForm[]>([]);
  const [policies, setPolicies] = useState<StudioPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [status, setStatus] = useState("");
  const [tab, setTab] = useState<"forms" | "policies" | "applications" | "onboarding" | "offboarding" | "access" | "grants" | "packages">("policies");
  // Forms and Applications live on the Forms page; Settings keeps the rest.
  useEffect(() => { if (initialTab === "policies") setTab(initialTab); }, [initialTab]);
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
      <div><h2 className="studio-systems-heading-visual-v103"><ClusterIcon name={tab === "policies" ? "lock" : tab === "forms" ? "file" : tab === "applications" ? "users" : "settings"} aria-hidden="true" />{tab === "policies" ? "Policies" : tab === "forms" ? "Forms" : tab === "applications" ? "Applications" : "Studio systems"}</h2></div>
      <ClusterButton type="button" variant="quiet" size="compact" onClick={() => void load(true)}><ClusterIcon name="refresh" aria-hidden="true" /> Refresh</ClusterButton>
    </div>
    <ClusterSegmentedControl
      value={tab}
      onChange={(value) => { setTab(value); onTabChange?.(value); }}
      label="Studio systems"
      className="studio-systems-tabs-v34f"
      options={[
        { value: "policies", label: "Policies" },
        { value: "onboarding", label: "Onboarding" },
        { value: "offboarding", label: "Offboarding" },
        { value: "access", label: "Access renewals" },
        { value: "grants", label: "Scoped grants" },
        { value: "packages", label: "Packages" },
      ]}
    />
    {status && <div className="studio-explanation-v272"><strong><ClusterIcon name="activity" aria-hidden="true" /> Status</strong><span>{status}</span></div>}
    {(tab === "forms" || tab === "policies") && (tab === "forms" ? forms.length : policies.length) > 0 && <div className="st-summary" aria-label={tab === "forms" ? "Form publishing summary" : "Policy publishing summary"}>
      <span><strong>{tab === "forms" ? forms.length : policies.length}</strong> {tab === "forms" ? "forms" : "policies"}</span>
      <span><strong>{tab === "forms" ? formsWithPublishedVersion : policiesWithPublishedVersion}</strong> published</span>
      <span><strong>{tab === "forms" ? forms.length - formsWithPublishedVersion : policies.length - policiesWithPublishedVersion}</strong> draft</span>
    </div>}

    {tab === "policies" && <div className="studio-systems-layout-v34f">
      <aside className="studio-systems-list-v34f"><div className="studio-create-strip-v272 studio-systems-create-v34f"><div><strong>New policy</strong><span>Create the policy identity, then publish immutable content versions.</span></div><ClusterInput value={newPolicy.title} onChange={(event) => setNewPolicy((current) => ({ ...current, title: event.target.value, key: current.key || slug(event.target.value, "policy") }))} placeholder="Policy name" /><ClusterInput value={newPolicy.key} onChange={(event) => setNewPolicy((current) => ({ ...current, key: slug(event.target.value, "policy") }))} placeholder="policy-key" /><label className="studio-inline-check-v272"><ClusterInput type="checkbox" checked={newPolicy.requiredForAccess} onChange={(event) => setNewPolicy((current) => ({ ...current, requiredForAccess: event.target.checked }))} /> Required for access</label><label className="studio-inline-check-v272"><ClusterInput type="checkbox" checked={newPolicy.recordAcceptance} onChange={(event) => setNewPolicy((current) => ({ ...current, recordAcceptance: event.target.checked }))} /> Create Personnel Record evidence on acceptance</label><StudioAudiencePicker value={newPolicy.audience} onChange={(audience) => setNewPolicy((current) => ({ ...current, audience }))} compact /><ClusterButton type="button" variant="secondary" disabled={!newPolicy.title.trim()} onClick={() => void createPolicy()}>Create policy</ClusterButton></div><div className="studio-entity-list-v272">{policies.map((policy) => <ClusterButton type="button" key={policy.id} className={policy.id === selectedPolicyId ? "active" : ""} onClick={() => setSelectedPolicyId(policy.id)}><span className="studio-entity-list-copy-v272"><strong><ClusterIcon name="lock" aria-hidden="true" /> {policy.title}</strong><small>{policy.requiredForAccess ? "Access required" : "Informational"}{policy.recordAcceptance ? " · Record evidence" : ""} · {policy.status}</small></span><span className="studio-entity-list-meta-v272"><SettingsStateChip tone={policyTone(policy)} icon={policyTone(policy) === "success" ? "check" : "note"}>{policyTone(policy) === "success" ? "Published version" : "Not published"}</SettingsStateChip><small>{policy.versions?.length || 0} versions</small></span></ClusterButton>)}</div></aside>
      <section className="studio-systems-editor-v34f">{selectedPolicy ? <><header className="studio-entity-editor-head-v272"><div><span className="eyebrow">Studio policy</span><h3><ClusterIcon name="lock" aria-hidden="true" /> {selectedPolicy.title}</h3><p><code>{selectedPolicy.key}</code>{selectedPolicy.requiredForAccess ? " · blocks access until accepted" : ""}</p><div className="studio-systems-policy-status-v103"><SettingsStateChip tone={policyTone(selectedPolicy)}>{policyTone(selectedPolicy) === "success" ? "Published content exists" : "Unpublished"}</SettingsStateChip><SettingsStateChip tone={selectedPolicy.requiredForAccess ? "warning" : "neutral"} icon={selectedPolicy.requiredForAccess ? "lock" : "file"}>{selectedPolicy.requiredForAccess ? "Acceptance required for access" : "Informational"}</SettingsStateChip></div></div></header><div className="studio-form-grid-v272"><div className="field"><label>Version label</label><ClusterInput value={policyDraft.versionLabel} onChange={(event) => setPolicyDraft((current) => ({ ...current, versionLabel: event.target.value }))} /></div><div className="field"><label>Acceptance</label><ClusterNativeSelect value={policyDraft.acceptanceMode} onChange={(event) => setPolicyDraft((current) => ({ ...current, acceptanceMode: event.target.value }))}><option value="none">Read only</option><option value="acknowledge">Acknowledge</option><option value="initials">Initials</option><option value="signature">Signature</option><option value="form">Knowledge check / form</option></ClusterNativeSelect></div>{policyDraft.acceptanceMode === "form" && <div className="field span-2"><label>Published form version</label><ClusterNativeSelect value={policyDraft.formVersionId} onChange={(event) => setPolicyDraft((current) => ({ ...current, formVersionId: event.target.value }))}><option value="">Choose a form version</option>{publishedFormVersions.map(({ form, version }) => <option key={version.id} value={version.id}>{form.title} · v{version.version}</option>)}</ClusterNativeSelect></div>}<div className="field span-2"><label>Policy body</label><ClusterTextarea value={policyDraft.bodyMarkdown} onChange={(event) => setPolicyDraft((current) => ({ ...current, bodyMarkdown: event.target.value }))} placeholder="Write policy content in Markdown." /></div></div><div className="studio-explanation-v272"><strong>Versioned evidence</strong><span>Published policy content is hashed. Acceptance records keep the exact content hash so a later edit cannot silently rewrite what a person agreed to.</span></div><div className="button-row"><ClusterButton type="button" variant="primary" disabled={!policyDraft.bodyMarkdown.trim() || (policyDraft.acceptanceMode === "form" && !policyDraft.formVersionId)} onClick={() => void publishPolicyVersion()}>Publish policy version</ClusterButton></div></> : <div className="settings-card-v092"><strong>No policy selected</strong></div>}</section>
    </div>}
    {tab === "onboarding" && <StudioOnboardingPanel />}
    {tab === "offboarding" && <StudioOffboardingPanel />}
    {tab === "access" && <StudioAccessRenewalsPanel />}
    {tab === "grants" && <StudioScopedGrantsPanel />}
    {tab === "packages" && <StudioManagedPackagesPanel />}
  </div>;
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, formatApiError } from "../../core/api";
import { requestReauthentication } from "../../core/reauthentication";
import { ClusterButton, ClusterLinkButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { confirmCluster, promptCluster } from "../../components/cluster-dialog-service";
import "./personnel-records.css";

type RecordFieldDefinition = {
  key: string;
  label: string;
  type: "text" | "multiline" | "number" | "date" | "boolean" | "select" | "person" | "url";
  required?: boolean;
  options?: string[];
};

type PersonnelRecordTemplate = {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  fields?: RecordFieldDefinition[];
  requiredAttachments?: string[];
  classification?: string;
  disclosurePolicy?: string;
  retentionDays?: number | null;
  actionType?: string | null;
};

type PersonnelRecordAction = {
  id: string;
  userId: string;
  actionType: string;
  status: string;
  dueAt?: string | null;
  completedAt?: string | null;
};

type PersonnelRecord = {
  id: string;
  templateId?: string | null;
  title: string;
  recordType: string;
  status: string;
  classification: "public" | "internal" | "confidential" | "restricted";
  disclosurePolicy: "internal_only" | "subject_visible" | "subject_action_required";
  accessReasonRequired?: boolean;
  effectiveAt?: string | null;
  finalizedAt?: string | null;
  retentionUntil?: string | null;
  legalHold?: boolean;
  destroyedAt?: string | null;
  destructionReason?: string | null;
  revision: number;
  fields?: Record<string, unknown>;
  template?: PersonnelRecordTemplate | null;
  attachments?: Array<{ id: string; role: string; libraryItemId: string; fileUrl: string; item?: { title?: string; originalName?: string | null; mimeType?: string | null } | null }>;
  actions?: PersonnelRecordAction[];
  amendments?: Array<{ id: string; reason: string; createdAt: string; actor?: { displayName?: string; username?: string } | null }>;
  accessEvents?: Array<{ id: string; action: string; reason?: string | null; allowed: boolean; createdAt: string; actor?: { displayName?: string; username?: string } | null }>;
  createdAt: string;
  updatedAt: string;
};

type RecordDraft = {
  title: string;
  recordType: string;
  classification: PersonnelRecord["classification"];
  disclosurePolicy: PersonnelRecord["disclosurePolicy"];
  accessReasonRequired: boolean;
  effectiveAt: string;
  retentionUntil: string;
  legalHold: boolean;
  fields: Record<string, unknown>;
};

function dateInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

function draftFromRecord(record: PersonnelRecord): RecordDraft {
  return {
    title: record.title,
    recordType: record.recordType,
    classification: record.classification,
    disclosurePolicy: record.disclosurePolicy,
    accessReasonRequired: Boolean(record.accessReasonRequired),
    effectiveAt: dateInput(record.effectiveAt),
    retentionUntil: dateInput(record.retentionUntil),
    legalHold: Boolean(record.legalHold),
    fields: { ...(record.fields || {}) },
  };
}

async function verifiedRecordRequest<T>(path: string, options: RequestInit = {}, reasonRequired = false) {
  let reason = "";
  if (reasonRequired) {
    reason = (await promptCluster({ title: "Personnel Records access reason", message: "Record why you need to access this sensitive personnel record. The reason becomes access evidence.", label: "Business reason", confirmLabel: "Continue" }))?.trim() || "";
    if (!reason) throw new Error("A business reason is required to access this record.");
  }
  const request = () => api<T>(path, { ...options, headers: { ...(options.headers || {}), ...(reason ? { "X-Cluster-Access-Reason": reason } : {}) } });
  try {
    return await request();
  } catch (caught) {
    if (!(caught instanceof ApiError) || !["SECURITY_VERIFICATION_REQUIRED", "PERSONNEL_RECORD_REASON_REQUIRED"].includes(caught.code)) throw caught;
    const payload = caught.payload && typeof caught.payload === "object" ? caught.payload as Record<string, unknown> : {};
    if (!reason && (caught.code === "PERSONNEL_RECORD_REASON_REQUIRED" || payload.reasonRequired === true)) {
      reason = (await promptCluster({ title: "Personnel Records access reason", message: "Record why you need this sensitive personnel record. The reason is preserved in its access history.", label: "Business reason", confirmLabel: "Continue" }))?.trim() || "";
      if (!reason) throw caught;
    }
    const confirmed = await requestReauthentication({
      title: "Confirm Personnel Records access",
      description: "Personnel Records require a fresh identity check before sensitive data can be opened or changed.",
      purpose: "personnel_records",
      passwordAllowed: true,
      pinAllowed: true,
      minimumStrength: "knowledge",
    });
    if (!confirmed) throw caught;
    return request();
  }
}

function RecordFieldEditor({ definition, value, disabled, onChange }: { definition: RecordFieldDefinition; value: unknown; disabled?: boolean; onChange: (value: unknown) => void }) {
  if (definition.type === "boolean") return <label className="records-check-v9e3"><ClusterInput type="checkbox" disabled={disabled} checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /><span>{definition.label}{definition.required ? " *" : ""}</span></label>;
  if (definition.type === "select") return <label className="field"><span>{definition.label}{definition.required ? " *" : ""}</span><ClusterNativeSelect disabled={disabled} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}><option value="">Select…</option>{(definition.options || []).map((option) => <option value={option} key={option}>{option}</option>)}</ClusterNativeSelect></label>;
  if (definition.type === "multiline") return <label className="field"><span>{definition.label}{definition.required ? " *" : ""}</span><ClusterTextArea disabled={disabled} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} /></label>;
  return <label className="field"><span>{definition.label}{definition.required ? " *" : ""}</span><ClusterInput disabled={disabled} type={definition.type === "number" ? "number" : definition.type === "date" ? "date" : definition.type === "url" ? "url" : "text"} value={String(value ?? "")} onChange={(event) => onChange(definition.type === "number" ? (event.target.value === "" ? "" : Number(event.target.value)) : event.target.value)} /></label>;
}

export function PersonnelRecordsPanel({ subjectUserId, canManage = false, compact = false }: { subjectUserId?: string; canManage?: boolean; compact?: boolean }) {
  const adminMode = Boolean(canManage && subjectUserId);
  const [records, setRecords] = useState<PersonnelRecord[]>([]);
  const [templates, setTemplates] = useState<PersonnelRecordTemplate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<PersonnelRecord | null>(null);
  const [draft, setDraft] = useState<RecordDraft | null>(null);
  const [status, setStatus] = useState("Loading records…");
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = adminMode
        ? await api<{ records: PersonnelRecord[] }>(`/api/admin/people/${encodeURIComponent(subjectUserId!)}/records`)
        : await api<{ records: PersonnelRecord[] }>("/api/my-records");
      setRecords(result.records || []);
      setSelectedId((current) => current && result.records.some((row) => row.id === current) ? current : result.records[0]?.id || "");
      setStatus(result.records.length ? `${result.records.length} record${result.records.length === 1 ? "" : "s"}` : "No records");
      if (adminMode) {
        const templateResult = await api<{ templates: PersonnelRecordTemplate[] }>("/api/personnel-record-templates");
        setTemplates(templateResult.templates || []);
      }
    } catch (caught) {
      setStatus(formatApiError(caught));
    }
  }, [adminMode, subjectUserId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let active = true;
    if (!selectedId) { setSelected(null); setDraft(null); return; }
    const summary = records.find((row) => row.id === selectedId) || null;
    const open = async () => {
      try {
        const result = await verifiedRecordRequest<{ record: PersonnelRecord }>(`/api/personnel-records/${encodeURIComponent(selectedId)}`, {}, Boolean(summary?.accessReasonRequired));
        if (!active) return;
        setSelected(result.record);
        setDraft(draftFromRecord(result.record));
        setStatus("");
      } catch (caught) {
        if (!active) return;
        setSelected(summary);
        setDraft(summary ? draftFromRecord(summary) : null);
        setStatus(formatApiError(caught));
      }
    };
    void open();
    return () => { active = false; };
  }, [records, selectedId]);

  const fieldDefinitions = useMemo(() => selected?.template?.fields || [], [selected]);

  async function createRecord() {
    if (!subjectUserId || working) return;
    const templateId = templates.length ? (await promptCluster({ title: "Create personnel record", message: "Enter a template key or leave blank for an untemplated record.", label: "Template key", placeholder: templates.map((item) => item.key).slice(0, 5).join(", "), confirmLabel: "Continue" }))?.trim() || "" : "";
    const template = templates.find((item) => item.key === templateId || item.id === templateId) || null;
    const title = (await promptCluster({ title: "Record title", message: "Use a specific title that will remain meaningful in the person's official record history.", label: "Title", initialValue: template?.name || "", confirmLabel: "Create draft" }))?.trim();
    if (!title) return;
    setWorking(true);
    try {
      const result = await verifiedRecordRequest<{ record: PersonnelRecord }>("/api/admin/personnel-records", { method: "POST", body: JSON.stringify({ subjectUserId, templateId: template?.id || null, title, recordType: template?.key || "general", fields: {} }) });
      await load();
      setSelectedId(result.record.id);
    } catch (caught) { setStatus(formatApiError(caught)); }
    finally { setWorking(false); }
  }

  async function saveRecord() {
    if (!selected || !draft || !adminMode || working) return;
    let amendmentReason: string | undefined;
    if (["finalized", "amended"].includes(selected.status)) {
      amendmentReason = (await promptCluster({ title: "Amend official record", message: "Finalized records are immutable without an amendment reason. Cluster will preserve the previous snapshot.", label: "Amendment reason", confirmLabel: "Save amendment" }))?.trim() || undefined;
      if (!amendmentReason) return;
    }
    setWorking(true);
    try {
      const result = await verifiedRecordRequest<{ record: PersonnelRecord }>(`/api/admin/personnel-records/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...draft, effectiveAt: draft.effectiveAt || null, retentionUntil: draft.retentionUntil || null, expectedRevision: selected.revision, amendmentReason }),
      }, Boolean(selected.accessReasonRequired));
      setSelected(result.record); setDraft(draftFromRecord(result.record)); await load(); setStatus("Record saved.");
    } catch (caught) { setStatus(formatApiError(caught)); }
    finally { setWorking(false); }
  }

  async function finalizeRecord() {
    if (!selected || working) return;
    if (!(await confirmCluster({ title: "Finalize personnel record?", message: "Finalizing makes future changes amendments with preserved before/after evidence.", confirmLabel: "Finalize" }))) return;
    setWorking(true);
    try {
      const result = await verifiedRecordRequest<{ record: PersonnelRecord }>(`/api/admin/personnel-records/${selected.id}/finalize`, { method: "POST", body: "{}" }, Boolean(selected.accessReasonRequired));
      setSelected(result.record); setDraft(draftFromRecord(result.record)); await load(); setStatus("Record finalized.");
    } catch (caught) { setStatus(formatApiError(caught)); }
    finally { setWorking(false); }
  }

  async function attachLibraryItem() {
    if (!selected || working) return;
    const libraryItemId = (await promptCluster({ title: "Attach Library evidence", message: "Enter the Library item ID. Once attached, normal Library access is blocked and Personnel Records policy becomes authoritative.", label: "Library item ID", confirmLabel: "Attach" }))?.trim();
    if (!libraryItemId) return;
    const role = (await promptCluster({ title: "Attachment role", message: "Describe what this item represents in the record.", label: "Role", initialValue: "evidence", confirmLabel: "Attach" }))?.trim() || "evidence";
    setWorking(true);
    try {
      await verifiedRecordRequest(`/api/admin/personnel-records/${selected.id}/attachments`, { method: "POST", body: JSON.stringify({ libraryItemId, role }) }, Boolean(selected.accessReasonRequired));
      const result = await verifiedRecordRequest<{ record: PersonnelRecord }>(`/api/personnel-records/${selected.id}`, {}, Boolean(selected.accessReasonRequired));
      setSelected(result.record); setDraft(draftFromRecord(result.record)); setStatus("Attachment protected by Personnel Records policy.");
    } catch (caught) { setStatus(formatApiError(caught)); }
    finally { setWorking(false); }
  }

  async function destroyRecord() {
    if (!selected || working) return;
    setWorking(true);
    try {
      const preview = await verifiedRecordRequest<{ eligible: boolean; blockers: Array<{ message: string }>; impact: { attachments: number; amendments: number; actions: number } }>(`/api/admin/personnel-records/${selected.id}/destruction-preview`, {}, Boolean(selected.accessReasonRequired));
      if (!preview.eligible) { setStatus(preview.blockers.map((item) => item.message).join(" ")); return; }
      const reason = (await promptCluster({ title: "Destroy personnel record", message: `This creates an auditable tombstone and removes governed payloads, ${preview.impact.attachments} attachment link(s), ${preview.impact.amendments} amendment snapshot(s), and ${preview.impact.actions} pending action(s).`, label: "Destruction reason", confirmLabel: "Continue", tone: "danger" }))?.trim();
      if (!reason || reason.length < 10) return;
      const confirmed = await confirmCluster({ title: "Confirm record destruction", message: "Retention and legal-hold rules will be rechecked inside the transaction. This operation cannot restore the destroyed record payload.", confirmLabel: "Destroy record", tone: "danger" });
      if (!confirmed) return;
      await verifiedRecordRequest(`/api/admin/personnel-records/${selected.id}/destroy`, { method: "POST", body: JSON.stringify({ reason, expectedRevision: selected.revision }) }, Boolean(selected.accessReasonRequired));
      await load(); setStatus("Record payload destroyed; audit tombstone preserved.");
    } catch (caught) { setStatus(formatApiError(caught)); }
    finally { setWorking(false); }
  }

  async function completeAction(action: PersonnelRecordAction) {
    if (!selected || working) return;
    const confirmed = await confirmCluster({ title: `${action.actionType.replace(/_/g, " ")} record?`, message: "This completion is recorded as action evidence on the personnel record.", confirmLabel: "Complete action" });
    if (!confirmed) return;
    setWorking(true);
    try {
      await verifiedRecordRequest(`/api/personnel-records/${selected.id}/actions/${action.id}/complete`, { method: "POST", body: JSON.stringify({ evidence: { completedFrom: "my_records" } }) }, Boolean(selected.accessReasonRequired));
      const result = await verifiedRecordRequest<{ record: PersonnelRecord }>(`/api/personnel-records/${selected.id}`, {}, Boolean(selected.accessReasonRequired));
      setSelected(result.record); setStatus("Record action completed.");
    } catch (caught) { setStatus(formatApiError(caught)); }
    finally { setWorking(false); }
  }

  return <section className={`personnel-records-v9e3 ${compact ? "compact" : ""}`}>
    <header className="records-toolbar-v9e3">
      <div><h3>Records</h3><p>{adminMode ? "Personnel evidence and acknowledgements." : "Your disclosed records and pending actions."}</p></div>
      {adminMode && <ClusterButton variant="primary" size="compact" disabled={working} onClick={() => void createRecord()}>Create record</ClusterButton>}
    </header>
    {status && <div className="records-status-v9e3">{status}</div>}
    {!records.length ? <ClusterEmptyState compact kind="empty" icon="user" title="No personnel records" description={adminMode ? "Create a governed record when official evidence needs to be retained for this person." : "No records are currently disclosed to you."} /> : <div className="records-layout-v9e3">
      <aside className="records-list-v9e3" aria-label="Personnel records">{records.map((record) => <ClusterButton unstyled type="button" className={record.id === selectedId ? "active" : ""} key={record.id} onClick={() => setSelectedId(record.id)}><strong>{record.title}</strong><span>{record.recordType} · {record.status}</span><small>{record.classification} · updated {formatDate(record.updatedAt)}</small></ClusterButton>)}</aside>
      <div className="records-detail-v9e3">{selected && draft ? <>
        <header><div><span className={`records-classification-v9e3 ${selected.classification}`}>{selected.classification}</span><h3>{selected.title}</h3><p>{selected.template?.description || selected.recordType}</p></div><div className="button-row">{adminMode && <><ClusterButton size="compact" variant="secondary" disabled={working} onClick={() => void attachLibraryItem()}>Attach Library item</ClusterButton>{selected.status === "draft" && <ClusterButton size="compact" variant="secondary" disabled={working} onClick={() => void finalizeRecord()}>Finalize</ClusterButton>}<ClusterButton size="compact" variant="primary" disabled={working || selected.status === "destroyed"} onClick={() => void saveRecord()}>Save</ClusterButton></>}</div></header>
        <div className="records-governance-grid-v9e3">
          <label className="field"><span>Title</span><ClusterInput disabled={!adminMode || selected.status === "destroyed"} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label className="field"><span>Record type</span><ClusterInput disabled value={draft.recordType} /></label>
          <label className="field"><span>Classification</span><ClusterNativeSelect disabled={!adminMode || selected.status === "destroyed"} value={draft.classification} onChange={(event) => setDraft({ ...draft, classification: event.target.value as RecordDraft["classification"] })}>{["public","internal","confidential","restricted"].map((value) => <option value={value} key={value}>{value}</option>)}</ClusterNativeSelect></label>
          <label className="field"><span>Disclosure</span><ClusterNativeSelect disabled={!adminMode || selected.status === "destroyed"} value={draft.disclosurePolicy} onChange={(event) => setDraft({ ...draft, disclosurePolicy: event.target.value as RecordDraft["disclosurePolicy"] })}><option value="internal_only">Internal only</option><option value="subject_visible">Visible to subject</option><option value="subject_action_required">Subject action required</option></ClusterNativeSelect></label>
          <label className="field"><span>Effective date</span><ClusterInput type="date" disabled={!adminMode || selected.status === "destroyed"} value={draft.effectiveAt} onChange={(event) => setDraft({ ...draft, effectiveAt: event.target.value })} /></label>
          <label className="field"><span>Retention through</span><ClusterInput type="date" disabled={!adminMode || selected.status === "destroyed"} value={draft.retentionUntil} onChange={(event) => setDraft({ ...draft, retentionUntil: event.target.value })} /></label>
          {adminMode && <label className="records-check-v9e3"><ClusterInput type="checkbox" checked={draft.legalHold} onChange={(event) => setDraft({ ...draft, legalHold: event.target.checked })} /><span>Legal / administrative hold</span></label>}
          {adminMode && <label className="records-check-v9e3"><ClusterInput type="checkbox" checked={draft.accessReasonRequired} onChange={(event) => setDraft({ ...draft, accessReasonRequired: event.target.checked })} /><span>Require business reason on access</span></label>}
        </div>
        {fieldDefinitions.length > 0 && <section className="records-fields-v9e3"><header><h4>Record fields</h4><span>{fieldDefinitions.filter((field) => field.required).length} required</span></header><div>{fieldDefinitions.map((definition) => <RecordFieldEditor key={definition.key} definition={definition} value={draft.fields[definition.key]} disabled={!adminMode || selected.status === "destroyed"} onChange={(value) => setDraft({ ...draft, fields: { ...draft.fields, [definition.key]: value } })} />)}</div></section>}
        {selected.attachments?.length ? <section className="records-section-v9e3"><header><h4>Attachments</h4><span>{selected.attachments.length} governed item{selected.attachments.length === 1 ? "" : "s"}</span></header>{selected.attachments.map((attachment) => <div className="records-row-v9e3" key={attachment.id}><div><strong>{attachment.item?.originalName || attachment.item?.title || attachment.libraryItemId}</strong><span>{attachment.role}</span></div><ClusterLinkButton href={attachment.fileUrl} target="_blank" rel="noreferrer" size="compact" variant="quiet">Open</ClusterLinkButton></div>)}</section> : null}
        {selected.actions?.length ? <section className="records-section-v9e3"><header><h4>Actions</h4><span>{selected.actions.filter((action) => action.status !== "completed").length} pending</span></header>{selected.actions.map((action) => <div className="records-row-v9e3" key={action.id}><div><strong>{action.actionType.replace(/_/g, " ")}</strong><span>{action.status}{action.dueAt ? ` · due ${formatDate(action.dueAt)}` : ""}</span></div>{!adminMode && action.status !== "completed" && <ClusterButton size="compact" variant="primary" disabled={working} onClick={() => void completeAction(action)}>Complete</ClusterButton>}</div>)}</section> : null}
        {adminMode && selected.amendments?.length ? <section className="records-section-v9e3"><header><h4>Amendment history</h4><span>{selected.amendments.length}</span></header>{selected.amendments.slice(0, 20).map((amendment) => <div className="records-row-v9e3" key={amendment.id}><div><strong>{amendment.reason}</strong><span>{amendment.actor?.displayName || amendment.actor?.username || "System"} · {formatDate(amendment.createdAt)}</span></div></div>)}</section> : null}
        {adminMode && selected.status !== "destroyed" && <section className="records-danger-v9e3"><div><strong>Destroy payload</strong><span>Blocked by active retention or legal hold.</span></div><ClusterButton size="compact" variant="danger" disabled={working} onClick={() => void destroyRecord()}>Destroy payload</ClusterButton></section>}
        {selected.status === "destroyed" && <div className="records-destroyed-v9e3"><strong>Destroyed record tombstone</strong><span>{selected.destructionReason || "Payload destroyed under retention policy."}</span></div>}
      </> : <ClusterEmptyState compact kind="empty" icon="user" title="Select a record" description="Choose a record to inspect its governed details." />}</div>
    </div>}
  </section>;
}


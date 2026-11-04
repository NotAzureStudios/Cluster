import { useMemo, useState } from "react";
import type { User } from "../application/application-models";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect } from "../../components/ClusterNativeControls";

type EditableField = "username" | "displayName" | "preferredName" | "email" | "title" | "department" | "workLocation" | "employmentType";
type HoursField = "capacityHours" | "minimumHours";
type Draft = Record<EditableField | HoursField, string>;
const TEXT_FIELDS: EditableField[] = ["username", "displayName", "preferredName", "email", "title", "department", "workLocation", "employmentType"];

function fromProfile(profile: User): Draft {
  return {
    username: profile.username || "",
    displayName: profile.displayName || "",
    preferredName: profile.preferredName || "",
    email: profile.email || "",
    title: profile.title || "",
    department: profile.department || "",
    workLocation: profile.workLocation || "",
    employmentType: profile.employmentType || "",
    capacityHours: profile.capacityHours == null ? "" : String(profile.capacityHours),
    minimumHours: profile.minimumHours == null ? "" : String(profile.minimumHours),
  };
}

/**
 * The admin editor is a bounded, revision-checked profile edit.
 * Lifecycle, role grants, credentials, access expiry, and recovery are kept in
 * the existing separately authorized flows, never mixed into a profile save.
 */
export function PeopleUserEditor({
  person, departmentNames, onSave, onCancel, onOpenAccess,
}: {
  person: User;
  departmentNames: string[];
  onSave: (changes: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  onOpenAccess: () => void;
}) {
  const initial = useMemo(() => fromProfile(person), [person.id]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const departmentOptions = useMemo(() => [...new Set([person.department || "", ...departmentNames].filter(Boolean))].sort((a, b) => a.localeCompare(b)), [person.department, departmentNames]);
  const changed = [...TEXT_FIELDS, "capacityHours", "minimumHours"].filter((key) => draft[key] !== initial[key]);
  const dirty = changed.length > 0;
  function update(key: keyof Draft, value: string) { setDraft((old) => ({ ...old, [key]: value })); setError(""); }
  function cancel() {
    if (saving) return;
    if (dirty && !window.confirm("Discard unsaved user changes?")) return;
    onCancel();
  }
  async function save() {
    if (saving || !dirty) return;
    if (draft.username.trim().length < 3) { setError("Username must contain at least three characters."); return; }
    if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) { setError("Enter a valid email address."); return; }
    for (const key of ["capacityHours", "minimumHours"] as const) {
      if (draft[key] && (!/^\d+$/.test(draft[key]) || Number(draft[key]) > 168)) { setError("Weekly hours must be whole numbers between 0 and 168."); return; }
    }
    const capacity = draft.capacityHours === "" ? null : Number(draft.capacityHours);
    const minimum = draft.minimumHours === "" ? null : Number(draft.minimumHours);
    if (capacity !== null && minimum !== null && minimum > capacity) {
      setError("Minimum hours cannot exceed capacity hours.");
      return;
    }
    const changes: Record<string, unknown> = { expectedProfileRevision: person.profileRevision || 1 };
    for (const key of changed) {
      if (key === "capacityHours" || key === "minimumHours") changes[key] = draft[key] === "" ? null : Number(draft[key]);
      else changes[key] = draft[key].trim() || (key === "username" ? person.username : null);
    }
    setSaving(true);
    setError("");
    try {
      await onSave(changes);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not save this user.";
      setError(/PROFILE_REVISION_CONFLICT|409|changed since it was opened/i.test(message)
        ? "This profile was changed elsewhere. Close the editor, reload the profile and review the newer values before retrying."
        : message);
    } finally { setSaving(false); }
  }
  const field = (key: EditableField, label: string, placeholder = "") => (
    <label className="people-user-editor-field-v106" key={key}>
      <span>{label}</span>
      <ClusterInput value={draft[key]} disabled={saving} placeholder={placeholder} maxLength={key === "username" ? 32 : 160} onChange={(event) => update(key, event.target.value)} />
    </label>
  );
  const hoursField = (key: HoursField, label: string) => (
    <label className="people-user-editor-field-v106" key={key}>
      <span>{label}</span>
      <ClusterInput type="number" value={draft[key]} disabled={saving} min={0} max={168} step={1} placeholder="Not set" onChange={(event) => update(key, event.target.value)} />
    </label>
  );
  return <section className="people-user-editor-v106" aria-label={`Edit user ${person.displayName || person.username}`}>
    <header className="people-user-editor-head-v106">
      <div>
        <p className="eyebrow">Account administration</p>
        <h3>Edit user</h3>
        <p>Change identity and work details in one save. Access and recovery have separate controls.</p>
      </div>
      <ClusterButton size="compact" variant="quiet" type="button" onClick={cancel} disabled={saving}>Close</ClusterButton>
    </header>
    <div className="people-user-editor-section-v106">
      <h4>Identity</h4>
      <div className="people-user-editor-grid-v106">
        {field("displayName", "Display name")}
        {field("preferredName", "Preferred name")}
        {field("username", "Username")}
        {field("email", "Work email", "name@example.com")}
      </div>
    </div>
    <div className="people-user-editor-section-v106">
      <h4>Organization</h4>
      <div className="people-user-editor-grid-v106">
        {field("title", "Job title")}
        <label className="people-user-editor-field-v106">
          <span>Department</span>
          <ClusterNativeSelect value={draft.department} disabled={saving} onChange={(event) => update("department", event.target.value)}>
            <option value="">No department</option>
            {departmentOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </ClusterNativeSelect>
          <small>Managed departments only. Create new ones in People → Organization.</small>
        </label>
        {field("workLocation", "Work location")}
        {field("employmentType", "Employment type")}
        {hoursField("capacityHours", "Capacity (hours/week)")}
        {hoursField("minimumHours", "Minimum (hours/week)")}
      </div>
    </div>
    <div className="people-user-editor-section-v106 people-user-editor-access-v106">
      <div><h4>Access & security</h4><p>Workspace role: <strong>{person.workspaceRole || "member"}</strong>. Account state: <strong>{String(person.accountState || "ACTIVE").replaceAll("_", " ")}</strong>. Role grants, access expiry, suspension and credential recovery are handled separately.</p></div>
      <ClusterButton type="button" size="compact" variant="secondary" disabled={saving} onClick={onOpenAccess}>Open access settings</ClusterButton>
    </div>
    {error && <p className="people-user-editor-error-v106" role="alert">{error}</p>}
    <footer className="people-user-editor-actions-v106">
      <span role="status">{dirty ? `${changed.length} unsaved field${changed.length === 1 ? "" : "s"}` : "No unsaved changes"}</span>
      <ClusterButton type="button" variant="quiet" disabled={saving} onClick={cancel}>Cancel</ClusterButton>
      <ClusterButton type="button" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save user"}</ClusterButton>
    </footer>
  </section>;
}

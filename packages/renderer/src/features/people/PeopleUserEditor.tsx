import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "../application/application-models";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect, ClusterTextarea } from "../../components/ClusterNativeControls";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { PeopleRoleAssignmentPanel } from "./PeopleRoleAssignmentPanel";

import { changedPeopleEditorFields, preparePeopleEditorPatch, type PeopleEditorDraft, type PeopleEditorTextField } from "./people-user-editor-draft";

function fromProfile(profile: User): PeopleEditorDraft {
  return {
    username: profile.username || "",
    employeeNumber: profile.employeeNumber || "",
    displayName: profile.displayName || "",
    legalName: profile.legalName || "",
    preferredName: profile.preferredName || "",
    pronouns: profile.pronouns || "",
    email: profile.email || "",
    phoneNumber: profile.phoneNumber || "",
    timezone: profile.timezone || "",
    title: profile.title || "",
    department: profile.department || "",
    managerUserId: profile.managerUserId || (profile as User & { manager?: { id: string } | null }).manager?.id || "",
    workLocation: profile.workLocation || "",
    employmentType: profile.employmentType || "",
    startDate: profile.startDate?.slice(0, 10) || "",
    notes: profile.notes || "",
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
  person, departmentNames, managerOptions, onSave, onRoleChange, actorId, onCancel, onOpenAccess, onDirtyChange,
}: {
  person: User;
  departmentNames: string[];
  managerOptions: Array<{ id: string; label: string }>;
  onSave: (changes: Record<string, unknown>) => Promise<User>;
  onRoleChange: (role: string, expectedProfileRevision: number) => Promise<void>;
  actorId: string;
  onCancel: () => void;
  onOpenAccess: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [initial, setInitial] = useState<PeopleEditorDraft>(() => fromProfile(person));
  // The opened revision is the edit precondition. Do not adopt a newer
  // background-refreshed profileRevision while retaining an old draft.
  const openedRevision = useRef(person.profileRevision || 1);
  const [draft, setDraft] = useState<PeopleEditorDraft>(() => fromProfile(person));
  const [saving, setSaving] = useState(false);
  const [roleDirty, setRoleDirty] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const departmentOptions = useMemo(() => [...new Set([person.department || "", ...departmentNames].filter(Boolean))].sort((a, b) => a.localeCompare(b)), [person.department, departmentNames]);
  const changed = changedPeopleEditorFields(draft, initial);
  const profileDirty = changed.length > 0;
  const dirty = profileDirty || roleDirty;
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  function update(key: keyof PeopleEditorDraft, value: string) { setDraft((old) => ({ ...old, [key]: value })); setError(""); setSuccess(""); }
  async function cancel() {
    if (saving) return;
    if (dirty && !(await confirmCluster({
      title: "Discard user changes?",
      message: "You have unsaved changes to this user. Discard them?",
      confirmLabel: "Discard changes",
      tone: "danger",
    }))) return;
    onCancel();
  }
  async function save() {
    if (saving || !profileDirty) return;
    let changes: Record<string, unknown>;
    try {
      changes = preparePeopleEditorPatch(draft, initial, openedRevision.current, person.username);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid profile details.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const refreshed = await onSave(changes);
      if (refreshed.id !== person.id || !Number.isInteger(refreshed.profileRevision) || (refreshed.profileRevision || 0) < 1) {
        throw new Error("Details were saved, but the latest revision could not be confirmed. Reopen the editor before making another change.");
      }
      const latest = fromProfile(refreshed);
      openedRevision.current = refreshed.profileRevision!;
      setInitial(latest);
      setDraft(latest);
      setSuccess(roleDirty ? "Details saved. You can apply the selected role now." : "User details saved.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not save this user.";
      setError(/PROFILE_REVISION_CONFLICT|409|changed since it was opened/i.test(message)
        ? "This profile was changed elsewhere. Close the editor, reload the profile and review the newer values before retrying."
        : message);
    } finally { setSaving(false); }
  }
  const field = (key: PeopleEditorTextField, label: string, placeholder = "") => (
    <label className="people-user-editor-field-v106" key={key}>
      <span>{label}</span>
      <ClusterInput value={draft[key]} disabled={saving} placeholder={placeholder} maxLength={key === "username" ? 32 : key === "employeeNumber" ? 80 : key === "phoneNumber" ? 60 : 160} onChange={(event) => update(key, event.target.value)} />
    </label>
  );
  const hoursField = (key: "capacityHours" | "minimumHours", label: string) => (
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
        
      </div>
      <ClusterButton size="compact" variant="quiet" type="button" onClick={() => void cancel()} disabled={saving}>Close</ClusterButton>
    </header>
    <div className="people-user-editor-section-v106">
      <h4>Identity</h4>
      <div className="people-user-editor-grid-v106">
        {field("displayName", "Display name")}
        {field("preferredName", "Preferred name")}
        {field("username", "Username")}
        {field("employeeNumber", "Employee number")}
        {field("legalName", "Legal name")}
        {field("pronouns", "Pronouns")}
      </div>
    </div>
    <div className="people-user-editor-section-v106">
      <h4>Contact & location</h4>
      <div className="people-user-editor-grid-v106">
        {field("email", "Work email", "name@example.com")}
        {field("phoneNumber", "Phone number")}
        {field("timezone", "Time zone", "America/New_York")}
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
          
        </label>
        <label className="people-user-editor-field-v106">
          <span>Reports to</span>
          <ClusterNativeSelect value={draft.managerUserId} disabled={saving} onChange={(event) => update("managerUserId", event.target.value)}>
            <option value="">No manager</option>
            {draft.managerUserId && !managerOptions.some((entry) => entry.id === draft.managerUserId) && <option value={draft.managerUserId} disabled>Unavailable or outside your workspace</option>}
            {managerOptions.filter((entry) => entry.id !== person.id).map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </ClusterNativeSelect>
          
        </label>
        {field("workLocation", "Work location")}
        {field("employmentType", "Employment type")}
        <label className="people-user-editor-field-v106">
          <span>Employment start date</span>
          <ClusterInput type="date" value={draft.startDate} disabled={saving} onChange={(event) => update("startDate", event.target.value)} />
        </label>
        {hoursField("capacityHours", "Capacity (hours/week)")}
        {hoursField("minimumHours", "Minimum (hours/week)")}
      </div>
    </div>
    <div className="people-user-editor-section-v106">
      <h4>Internal notes</h4>
      <label className="people-user-editor-field-v106">
        <span>Administrative notes</span>
        <ClusterTextarea value={draft.notes} disabled={saving} maxLength={4000} rows={3} placeholder="Private management notes" onChange={(event) => update("notes", event.target.value)} />
        <small>Do not store passwords or access tokens.</small>
      </label>
    </div>
    <PeopleRoleAssignmentPanel person={person} actorId={actorId} profileDirty={profileDirty || saving} onChange={onRoleChange} onDirtyChange={setRoleDirty} />
    <div className="people-user-editor-section-v106 people-user-editor-access-v106">
      <div><h4>Access & security</h4><p>Role: <strong>{person.workspaceRole || "member"}</strong> · State: <strong>{String(person.accountState || "ACTIVE").replaceAll("_", " ")}</strong></p></div>
      <ClusterButton type="button" size="compact" variant="secondary" disabled={saving} onClick={onOpenAccess}>Open access settings</ClusterButton>
    </div>
    {error && <p className="people-user-editor-error-v106" role="alert">{error}</p>}
    {success && <p className="people-user-editor-status-v11" role="status">{success}</p>}
    <footer className="people-user-editor-actions-v106">
      <span role="status">{profileDirty ? `${changed.length} unsaved field${changed.length === 1 ? "" : "s"}${roleDirty ? " · role selected separately" : ""}` : roleDirty ? "Role change pending" : "No unsaved changes"}</span>
      <ClusterButton type="button" variant="quiet" disabled={saving} onClick={cancel}>Cancel</ClusterButton>
      <ClusterButton type="button" variant="primary" disabled={!profileDirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save user"}</ClusterButton>
    </footer>
  </section>;
}

import { useEffect, useState } from "react";
import type { User } from "../application/application-models";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { api, queryApi } from "../../core/api";

type RolePreview = { ready: boolean; blockers: string[]; from: string; to: { id: string; label: string; privileged: boolean } | null; expectedProfileRevision: number; workspaceRoleOnly: boolean; notice: string };

type RoleCatalog = {
  actorRole: string;
  workspaceId: string;
  roles: Array<{ id: string; label: string; enabled: boolean; privileged: boolean; members: number }>;
};

/**
 * A sensitive membership operation, deliberately independent of profile edits.
 * The server is the final authority for workspace scope, active role catalog,
 * protected owner/admin transitions and the last-owner safety invariant.
 */
export function PeopleRoleAssignmentPanel({
  person, actorId, profileDirty, onChange, onDirtyChange,
}: {
  person: User;
  actorId: string;
  profileDirty: boolean;
  onChange: (role: string, expectedProfileRevision: number) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const currentRole = person.workspaceRole || "member";
  const [savedRole, setSavedRole] = useState(currentRole);
  const [draftRole, setDraftRole] = useState(currentRole);
  const [catalog, setCatalog] = useState<RoleCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [preview, setPreview] = useState<RolePreview | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const roleDirty = draftRole !== savedRole;

  useEffect(() => {
    setSavedRole(currentRole);
    setDraftRole(currentRole);
    setPreview(null);
    setPreviewKey("");
  }, [currentRole, person.id]);

  useEffect(() => {
    onDirtyChange(roleDirty);
    return () => onDirtyChange(false);
  }, [onDirtyChange, roleDirty]);

  useEffect(() => {
    let cancelled = false;
    void queryApi<RoleCatalog>("/api/admin/users/assignable-roles", {
      staleMs: 15_000, maxAgeMs: 60_000, tags: ["roles", "users", "people"],
    }).then((result) => {
      if (!cancelled) { setCatalog(result); setLoading(false); }
    }).catch((cause: unknown) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : "Unable to load roles.");
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const self = person.id === actorId;
  const next = catalog?.roles.find((role) => role.id === draftRole);
  const privilegedChange = ["owner", "admin"].includes(savedRole) || Boolean(next?.privileged);
  const ownerRequired = privilegedChange && catalog?.actorRole !== "owner";
  const disabled = !roleDirty || !next?.enabled || !catalog || busy || loading || self || profileDirty || ownerRequired;
  const currentPreviewKey = JSON.stringify([person.id, draftRole, savedRole, person.profileRevision || 1]);
  const reviewed = preview?.ready === true && previewKey === currentPreviewKey;
  async function reviewChange() {
    if (disabled || previewBusy) return;
    const key = currentPreviewKey;
    setPreviewBusy(true); setPreview(null); setPreviewKey(""); setError(""); setSuccess("");
    try {
      const result = await api<RolePreview>(`/api/admin/users/${encodeURIComponent(person.id)}/role-preview`, {
        method: "POST",
        body: JSON.stringify({ role: draftRole, expectedProfileRevision: person.profileRevision || 1 }),
      });
      setPreview(result);
      setPreviewKey(key);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not review the role change.");
    } finally { setPreviewBusy(false); }
  }

  async function apply() {
    if (disabled || !next || !reviewed || previewBusy) return;
    if (!(await confirmCluster({
      title: "Change workspace role?",
      message: `Change ${person.displayName || person.username} from ${savedRole} to ${next.label}? This changes effective permissions and will be recorded in security history.`,
      confirmLabel: "Change role",
      tone: "danger",
    }))) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await onChange(next.id, person.profileRevision || 1);
      setSavedRole(next.id);
      setDraftRole(next.id);
      setSuccess(`Workspace role changed to ${next.label}.`);
      setPreview(null); setPreviewKey("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not change workspace role.";
      setError(/PROFILE_REVISION_CONFLICT|ROLE_PROFILE_REVISION_REQUIRED|changed since it was opened/i.test(message)
        ? "The account changed elsewhere. Reload the profile before retrying."
        : message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="people-user-editor-section-v106 people-role-assignment-v11" aria-label="Workspace role assignment">
    <h4>Workspace role</h4>
    <div className="people-role-assignment-actions-v11">
      <label className="people-user-editor-field-v106">
        <span>Assigned role</span>
        <ClusterNativeSelect value={draftRole} disabled={busy || loading || self || !catalog} onChange={(event) => { setDraftRole(event.target.value); setPreview(null); setPreviewKey(""); setError(""); setSuccess(""); }}>
          {!catalog?.roles.some((role) => role.id === draftRole) && <option value={draftRole} disabled>{draftRole} (unavailable)</option>}
          {(catalog?.roles || []).map((role) => <option key={role.id} value={role.id} disabled={!role.enabled || (role.privileged && catalog?.actorRole !== "owner" && role.id !== savedRole)}>
            {role.label}{role.enabled ? "" : " (disabled)"}
          </option>)}
        </ClusterNativeSelect>
      </label>
      <div className="people-role-assignment-buttons-v11">
        {roleDirty && <ClusterButton type="button" size="compact" variant="quiet" disabled={busy} onClick={() => { setDraftRole(savedRole); setPreview(null); setPreviewKey(""); setError(""); }}>Revert selection</ClusterButton>}
        <ClusterButton type="button" size="compact" variant="secondary" disabled={disabled || previewBusy} onClick={() => void reviewChange()}>{previewBusy ? "Reviewing…" : "Review role change"}</ClusterButton>
        {reviewed && <ClusterButton type="button" size="compact" variant="primary" disabled={disabled || previewBusy} onClick={() => void apply()}>{busy ? "Updating…" : "Apply role change"}</ClusterButton>}
      </div>
    </div>
    {(self || ownerRequired || (profileDirty && roleDirty)) && <small role="status">{self
      ? "You cannot change your own role. Another authorized administrator must do it."
      : ownerRequired
        ? "Only a workspace owner can change administrator or owner roles."
        : "Save profile details first. Your role selection will remain here."}</small>}
    {preview && previewKey === currentPreviewKey && <div className="people-role-review-v11" role="group" aria-label="Role transition review">
      <strong>{preview.from} → {preview.to?.label || draftRole}</strong>
      {preview.blockers.map((item) => <p role="alert" key={item}>{item}</p>)}
      <small>{preview.notice}</small>
      <small>{preview.ready ? "Server preflight passed. The change will be rechecked at submission." : "Resolve the blockers before applying."}</small>
    </div>}
    {error && <p className="people-user-editor-error-v106" role="alert">{error}</p>}
    {success && <p className="people-user-editor-status-v11" role="status">{success}</p>}
  </section>;
}

import { useEffect, useState } from "react";
import type { User } from "../application/application-models";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { queryApi } from "../../core/api";

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
  const roleDirty = draftRole !== savedRole;

  useEffect(() => {
    setSavedRole(currentRole);
    setDraftRole(currentRole);
  }, [currentRole]);

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

  async function apply() {
    if (disabled || !next) return;
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
    <p>Roles determine access. Assignment is a separate, audited security operation.</p>
    <div className="people-role-assignment-actions-v11">
      <label className="people-user-editor-field-v106">
        <span>Assigned role</span>
        <ClusterNativeSelect value={draftRole} disabled={busy || loading || self || !catalog} onChange={(event) => { setDraftRole(event.target.value); setError(""); setSuccess(""); }}>
          {!catalog?.roles.some((role) => role.id === draftRole) && <option value={draftRole} disabled>{draftRole} (unavailable)</option>}
          {(catalog?.roles || []).map((role) => <option key={role.id} value={role.id} disabled={!role.enabled || (role.privileged && catalog?.actorRole !== "owner" && role.id !== savedRole)}>
            {role.label}{role.enabled ? "" : " (disabled)"} · {role.members} members
          </option>)}
        </ClusterNativeSelect>
      </label>
      <ClusterButton type="button" size="compact" variant="secondary" disabled={disabled} onClick={() => void apply()}>{busy ? "Updating…" : "Apply role change"}</ClusterButton>
    </div>
    <small>{self ? "You cannot change your own workspace role." : profileDirty ? "Save identity and employment changes before changing access." : ownerRequired ? "Only a workspace owner may assign or remove privileged roles." : "Role names and permission rules are edited in Roles & Permissions."}</small>
    {error && <p className="people-user-editor-error-v106" role="alert">{error}</p>}
    {success && <p className="people-user-editor-status-v11" role="status">{success}</p>}
  </section>;
}

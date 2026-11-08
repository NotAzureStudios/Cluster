import { useEffect, useRef, useState } from "react";
import type { User } from "../application/application-models";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { api, queryApi } from "../../core/api";
import { TOOL_PERMISSION_OPTIONS } from "../../core/permissions";
import "./people-role-impact-preview.css";

type RoleCatalog = {
  actorRole: string;
  workspaceId: string;
  roles: Array<{ id: string; label: string; enabled: boolean; privileged: boolean; members: number }>;
};
type RolePreview = {
  ok: boolean;
  canApply: boolean;
  blockers: Array<{ code: string; message: string }>;
  targetUserId: string;
  profileRevision: number;
  from: { id: string; label: string };
  to: { id: string; label: string } | null;
  roleTools: Array<{ tool: string; before: string; after: string }>;
  changedToolCount: number;
  reviewedAt: string;
  warning: string;
  commitPolicy: string;
};

const toolLabel = (tool: string) => TOOL_PERMISSION_OPTIONS.find((item) => item.key === tool)?.label || tool;

/**
 * Role changes remain independent of profile updates. Server preflight is
 * read-only; real changes still use optimistic revision checks and the
 * workspace-scoped transaction lock for last-owner protection.
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
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<{ key: string; data: RolePreview } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const previewSequenceRef = useRef(0);
  const roleDirty = draftRole !== savedRole;
  const previewKey = JSON.stringify([person.id, actorId, savedRole, draftRole, person.profileRevision || 1]);
  const currentKeyRef = useRef(previewKey);
  currentKeyRef.current = previewKey;

  useEffect(() => {
    setSavedRole(currentRole);
    setDraftRole(currentRole);
  }, [person.id, currentRole]);

  useEffect(() => {
    ++previewSequenceRef.current;
    setPreview(null);
    setPreviewError("");
    setChecking(false);
  }, [previewKey]);
  useEffect(() => () => { ++previewSequenceRef.current; }, []);

  useEffect(() => {
    onDirtyChange(roleDirty);
    return () => onDirtyChange(false);
  }, [onDirtyChange, roleDirty]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void queryApi<RoleCatalog>("/api/admin/users/assignable-roles", {
      staleMs: 15_000, maxAgeMs: 60_000, tags: ["roles", "users", "people"],
    }).then((result) => {
      if (!cancelled) { setCatalog(result); setLoading(false); }
    }).catch((cause: unknown) => {
      if (!cancelled) { setError(cause instanceof Error ? cause.message : "Unable to load roles."); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [actorId]);

  const self = person.id === actorId;
  const next = catalog?.roles.find((role) => role.id === draftRole);
  const privilegedChange = ["owner", "admin"].includes(savedRole) || Boolean(next?.privileged);
  const ownerRequired = privilegedChange && catalog?.actorRole !== "owner";
  const cannotReview = !roleDirty || !next?.enabled || !catalog || busy || loading || self || profileDirty || checking;
  const reviewed = preview?.key === previewKey ? preview.data : null;
  const disabled = cannotReview || !reviewed?.canApply || reviewed.profileRevision !== (person.profileRevision || 1);

  async function reviewRoleChange() {
    if (cannotReview || !next) return;
    const key = previewKey;
    const requestId = ++previewSequenceRef.current;
    setChecking(true); setPreview(null); setPreviewError(""); setError(""); setSuccess("");
    try {
      const result = await api<RolePreview>(`/api/admin/users/${encodeURIComponent(person.id)}/role-change-preview`, {
        method: "POST",
        body: JSON.stringify({ role: next.id }),
      });
      if (requestId !== previewSequenceRef.current || key !== currentKeyRef.current) return;
      if (!result.ok || result.targetUserId !== person.id || result.to?.id !== next.id)
        throw new Error("The role preview does not match this account and selection.");
      setPreview({ key, data: result });
    } catch (cause) {
      if (requestId === previewSequenceRef.current && key === currentKeyRef.current)
        setPreviewError(cause instanceof Error ? cause.message : "Could not review role policy.");
    } finally {
      if (requestId === previewSequenceRef.current) setChecking(false);
    }
  }

  async function apply() {
    if (disabled || !next || !reviewed) return;
    if (!(await confirmCluster({
      title: "Apply reviewed workspace role?",
      message: `Change ${person.displayName || person.username} from ${reviewed.from.label} to ${next.label}? The Server preview found ${reviewed.changedToolCount} role-policy tool difference${reviewed.changedToolCount === 1 ? "" : "s"}. Effective access and scoped grants remain independently enforced.`,
      confirmLabel: "Apply role change",
      tone: "danger",
    }))) return;
    // A selection or account revision could have changed while the confirmation
    // dialog was open; do not apply the old preview to a new person.
    if (previewKey !== currentKeyRef.current || reviewed.profileRevision !== (person.profileRevision || 1)) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      await onChange(next.id, reviewed.profileRevision);
      setSavedRole(next.id);
      setDraftRole(next.id);
      setPreview(null);
      setSuccess(`Workspace role changed to ${next.label}.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not change workspace role.";
      setError(/PROFILE_REVISION_CONFLICT|ROLE_PROFILE_REVISION_REQUIRED|changed since it was opened/i.test(message)
        ? "The account changed elsewhere. Reload the profile before retrying."
        : message);
      setPreview(null);
    } finally { setBusy(false); }
  }

  return <section className="people-user-editor-section-v106 people-role-assignment-v11" aria-label="Workspace role assignment">
    <h4>Workspace role</h4>
    <div className="people-role-assignment-actions-v11">
      <label className="people-user-editor-field-v106">
        <span>Assigned role</span>
        <ClusterNativeSelect value={draftRole} disabled={busy || loading || self || !catalog || checking}
          onChange={(event) => { setDraftRole(event.target.value); setError(""); setSuccess(""); }}>
          {!catalog?.roles.some((role) => role.id === draftRole) && <option value={draftRole} disabled>{draftRole} (unavailable)</option>}
          {(catalog?.roles || []).map((role) => <option key={role.id} value={role.id} disabled={!role.enabled || (role.privileged && catalog?.actorRole !== "owner" && role.id !== savedRole)}>
            {role.label}{role.enabled ? "" : " (disabled)"}
          </option>)}
        </ClusterNativeSelect>
      </label>
      <div className="people-role-assignment-buttons-v11">
        {roleDirty && <ClusterButton type="button" size="compact" variant="quiet" disabled={busy || checking} onClick={() => { setDraftRole(savedRole); setError(""); }}>Revert selection</ClusterButton>}
        {roleDirty && <ClusterButton type="button" size="compact" variant="secondary" disabled={cannotReview}
          onClick={() => void reviewRoleChange()}>{checking ? "Checking…" : "Review role impact"}</ClusterButton>}
        <ClusterButton type="button" size="compact" variant="primary" disabled={disabled}
          onClick={() => void apply()}>{busy ? "Updating…" : "Apply reviewed role"}</ClusterButton>
      </div>
    </div>
    {(self || ownerRequired || (profileDirty && roleDirty)) && <small role="status">{self
      ? "You cannot change your own role. Another authorized administrator must do it."
      : ownerRequired
        ? "Only a workspace owner can change administrator or owner roles."
        : "Save profile details first. Your role selection will remain here."}</small>}
    {roleDirty && !reviewed && !checking && !previewError && !error && !self && <small role="status">Review the role change with the Server before applying it.</small>}
    {checking && <p className="people-role-impact-note-v11" role="status">Checking current role policy and owner protections…</p>}
    {previewError && <p className="people-user-editor-error-v106" role="alert">{previewError}</p>}
    {reviewed && <div className="people-role-impact-v11" aria-label="Role change policy comparison">
      <div className="people-role-impact-heading-v11"><strong>{reviewed.canApply ? "Review passed" : "Role change blocked"}</strong><small>{reviewed.from.label} → {reviewed.to?.label || draftRole} · {reviewed.changedToolCount} tool differences</small></div>
      {reviewed.blockers.map((blocker) => <p key={blocker.code} className="people-user-editor-error-v106" role="alert">{blocker.message}</p>)}
      {reviewed.changedToolCount > 0 && <details><summary>Inspect {reviewed.changedToolCount} role-policy tool differences</summary>
        <ul>{reviewed.roleTools.filter((entry) => entry.before !== entry.after).map((entry) =>
          <li key={entry.tool}><span>{toolLabel(entry.tool)}</span><small>{entry.before} → {entry.after}</small></li>)}</ul>
      </details>}
      <p className="people-role-impact-note-v11">{reviewed.warning}</p>
      <small>{reviewed.commitPolicy}</small>
    </div>}
    {error && <p className="people-user-editor-error-v106" role="alert">{error}</p>}
    {success && <p className="people-user-editor-status-v11" role="status">{success}</p>}
  </section>;
}

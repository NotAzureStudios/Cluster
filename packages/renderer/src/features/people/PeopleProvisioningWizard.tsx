import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { canChooseStudioRole, type StudioAssignableRoleChoice } from "./people-role-choice";

export type ProvisioningDraft = {
  username: string; displayName: string; email: string;
  accountType: string; accessExpiresAt: string; role: string;
};

type Preview = {
  ready: boolean;
  blockers: string[];
  identity: { accountType: string; expiresAt: string | null };
  role: { id: string; label: string; privileged: boolean; enabled: boolean } | null;
  firstSignIn: string;
  projectGrants: string;
  permissions: string;
  notice: string;
};

type RoleCatalog = { actorRole: string; roles: StudioAssignableRoleChoice[] };
type Step = "identity" | "access" | "review";

export function PeopleProvisioningWizard({
  draft, patch, catalog, roleLoading, roleError, busy,
  blocker, submissionError, onCreate,
}: {
  draft: ProvisioningDraft;
  patch: (changes: Partial<ProvisioningDraft>) => void;
  catalog: RoleCatalog | null;
  roleLoading: boolean;
  roleError: string;
  busy: boolean;
  blocker: string;
  submissionError: string;
  onCreate: () => void;
}) {
  const [step, setStep] = useState<Step>("identity");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const snapshot = JSON.stringify([draft.accountType, draft.accessExpiresAt, draft.role]);
  const reviewed = step === "review" && snapshot === previewKey && preview?.ready === true;
  const identityValid = draft.username.trim().length >= 3 && draft.username.trim().length <= 32
    && (!draft.email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()));
  const selectedRole = catalog?.roles.find((role) => role.id === draft.role);
  const roleValid = canChooseStudioRole(selectedRole, catalog?.actorRole);
  const external = ["contractor", "client", "guest"].includes(draft.accountType);

  useEffect(() => {
    // A revised role, account type or expiry invalidates the server preflight.
    setPreview(null);
    setPreviewKey("");
    setPreviewError("");
    setReviewAcknowledged(false);
  }, [snapshot]);

  async function review() {
    if (previewBusy || busy || blocker || roleError || roleLoading || !catalog) return;
    setPreviewBusy(true);
    setPreviewError("");
    setPreview(null);
    const requestKey = snapshot;
    try {
      const result = await api<Preview>("/api/admin/users/provisioning-preview", {
        method: "POST",
        body: JSON.stringify({
          accountType: draft.accountType, role: draft.role,
          accessExpiresAt: draft.accessExpiresAt ? new Date(`${draft.accessExpiresAt}T23:59:59`).toISOString() : null,
        }),
      });
      // React rerender invalidates reviews on edits; never reuse another draft's decision.
      setPreview(result);
      setPreviewKey(requestKey);
      setReviewAcknowledged(false);
      setStep("review");
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Could not verify account policy. Retry.");
    } finally {
      setPreviewBusy(false);
    }
  }

  return <div className="people-provisioning-wizard-v11">
    <nav className="people-provisioning-steps-v11" aria-label="Account provisioning progress">
      {(["identity", "access", "review"] as const).map((item, index) =>
        <span key={item} aria-current={step === item ? "step" : undefined}>
          <strong>{index + 1}</strong> {item === "identity" ? "Identity" : item === "access" ? "Access" : "Review"}
        </span>)}
    </nav>
    {step === "identity" && <div className="people-admin-create-grid-v536">
      <label className="field"><span>Username</span><ClusterTextInput autoFocus maxLength={32} autoCapitalize="none" spellCheck={false} value={draft.username} onChange={(event) => patch({ username: event.target.value })} placeholder="username" /></label>
      <label className="field"><span>Display name</span><ClusterTextInput value={draft.displayName} onChange={(event) => patch({ displayName: event.target.value })} placeholder="Display name" /></label>
      <label className="field"><span>Email (optional)</span><ClusterTextInput type="email" value={draft.email} onChange={(event) => patch({ email: event.target.value })} placeholder="name@example.com" /></label>
      <div className="people-provisioning-actions-v11"><ClusterButton type="button" variant="primary" disabled={!identityValid || busy} onClick={() => setStep("access")}>Continue to access</ClusterButton></div>
      {!identityValid && <small role="status">A username needs 3–32 characters. An entered email must have a valid address format.</small>}
    </div>}
    {step === "access" && <div className="people-admin-create-grid-v536">
      <label className="field"><span>Account type</span><ClusterNativeSelect value={draft.accountType} onChange={(event) => patch({ accountType: event.target.value })}><option value="employee">Employee</option><option value="contractor">Contractor</option><option value="client">Client</option><option value="guest">Guest</option></ClusterNativeSelect></label>
      <label className="field"><span>Workspace role</span><ClusterNativeSelect value={draft.role} disabled={busy || roleLoading || !catalog} onChange={(event) => patch({ role: event.target.value })}>
        {!catalog?.roles.some((role) => role.id === draft.role) && <option value={draft.role} disabled>{draft.role} (unavailable)</option>}
        {(catalog?.roles || []).map((role) => <option key={role.id} value={role.id} disabled={!canChooseStudioRole(role, catalog.actorRole)}>{role.label}{role.enabled ? "" : " (disabled)"}</option>)}
      </ClusterNativeSelect></label>
      <label className="field"><span>Access expires {external ? "(required)" : "(optional)"}</span><ClusterInput type="date" value={draft.accessExpiresAt} onChange={(event) => patch({ accessExpiresAt: event.target.value })} /></label>
      <p className="people-provisioning-note-v11">Role and identity type do not grant Project or Library access by themselves. Scoped grants require separate approval.</p>
      {roleError && <p role="alert">{roleError}</p>}
      {blocker && <small role="status">{blocker}</small>}
      {previewError && <p className="people-user-editor-error-v106" role="alert">{previewError}</p>}
      <div className="people-provisioning-actions-v11">
        <ClusterButton type="button" variant="quiet" disabled={busy || previewBusy} onClick={() => setStep("identity")}>Back</ClusterButton>
        <ClusterButton type="button" variant="primary" disabled={busy || previewBusy || roleLoading || !roleValid || Boolean(roleError) || Boolean(blocker)} onClick={() => void review()}>{previewBusy ? "Checking…" : "Review account"}</ClusterButton>
      </div>
    </div>}
    {step === "review" && <div className="people-provisioning-review-v11">
      <h4>Confirm account details</h4>
      <dl>
        <div><dt>Account</dt><dd>{draft.displayName || draft.username} (@{draft.username})</dd></div>
        <div><dt>Identity type</dt><dd>{draft.accountType}</dd></div>
        <div><dt>Workspace role</dt><dd>{preview?.role?.label || draft.role}{preview?.role?.privileged ? " · Privileged" : ""}</dd></div>
        <div><dt>Expiration</dt><dd>{draft.accessExpiresAt || "No expiry"}</dd></div>
        <div><dt>First sign-in</dt><dd>Must change temporary password</dd></div>
        <div><dt>Project access</dt><dd>Requires separate, reviewed grants</dd></div>
      </dl>
      <p className="people-provisioning-note-v11">{preview?.notice || "The server's provisioning policy must be verified before creating this account."}</p>
      {preview?.blockers.map((message, index) => <p role="alert" key={index}>{message}</p>)}
      {!reviewed && <p role="status">The review is out of date or blocked. Return to access settings and review again.</p>}
      <label className="people-provisioning-ack-v11"><ClusterInput type="checkbox" checked={reviewAcknowledged} onChange={(event) => setReviewAcknowledged(event.target.checked)} /><span>I reviewed the identity, role and access requirements.</span></label>
      {submissionError && <p className="people-user-editor-error-v106" role="alert">{submissionError}</p>}
      <div className="people-provisioning-actions-v11">
        <ClusterButton type="button" variant="quiet" disabled={busy} onClick={() => { setReviewAcknowledged(false); setStep("access"); }}>Back to access</ClusterButton>
        <ClusterButton type="button" variant="primary" disabled={busy || !reviewed || !reviewAcknowledged || Boolean(blocker)} onClick={onCreate}>{busy ? "Creating…" : "Create account"}</ClusterButton>
      </div>
    </div>}
  </div>;
}

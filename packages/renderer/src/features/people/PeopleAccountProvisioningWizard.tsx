import { useEffect, useRef, useState } from "react";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { TOOL_PERMISSION_OPTIONS } from "../../core/permissions";
import { canChooseStudioRole, type StudioAssignableRoleChoice } from "./people-role-choice";
import { validatePeopleAccountCreation } from "./people-account-creation-validation";
import "./people-account-provisioning-wizard.css";

export type ProvisioningDraft = {
  username: string;
  displayName: string;
  email: string;
  accountType: string;
  accessExpiresAt: string;
  role: string;
};
type ProvisioningReview = {
  ok: boolean;
  canCreate: boolean;
  reviewedAt: string;
  username: string;
  accountType: string;
  accessExpiresAt: string | null;
  role: { id: string; label: string; privileged: boolean } | null;
  initialAccountState: string;
  credentialMethod: string;
  blockers: Array<{ code: string; message: string }>;
  toolPermissions: Array<{ tool: string; level: string }>;
  limitations: string[];
};
type RoleCatalog = { actorRole: string; roles: StudioAssignableRoleChoice[] };
type Stage = "identity" | "access" | "review";
const STEPS: Array<{ id: Stage; label: string }> = [
  { id: "identity", label: "Identity" },
  { id: "access", label: "Starting access" },
  { id: "review", label: "Review & create" },
];

function previewPayload(draft: ProvisioningDraft) {
  const expiry = draft.accessExpiresAt ? new Date(`${draft.accessExpiresAt}T23:59:59`) : null;
  return {
    username: draft.username.trim(),
    displayName: draft.displayName.trim() || null,
    email: draft.email.trim() || null,
    accountType: draft.accountType,
    accessExpiresAt: expiry && Number.isFinite(expiry.getTime()) ? expiry.toISOString() : draft.accessExpiresAt || null,
    role: draft.role,
  };
}
const permissionLabel = (key: string) => TOOL_PERMISSION_OPTIONS.find((item) => item.key === key)?.label || key.replaceAll(/([A-Z])/g, " $1");
const visibleLevels = ["manage", "edit", "view", "none"] as const;

export function PeopleAccountProvisioningWizard({
  draft, onPatch, roleCatalog, rolesLoading, rolesError, creating, actionError, onCreate, onCancel,
}: {
  draft: ProvisioningDraft;
  onPatch: (changes: Partial<ProvisioningDraft>) => void;
  roleCatalog: RoleCatalog | null;
  rolesLoading: boolean;
  rolesError: string;
  creating: boolean;
  actionError: string;
  onCreate: () => Promise<void>;
  onCancel: () => void;
}) {
  const [stage, setStage] = useState<Stage>("identity");
  const [preview, setPreview] = useState<{ signature: string; result: ProvisioningReview } | null>(null);
  const [checking, setChecking] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const previewSequenceRef = useRef(0);
  const selectedRole = roleCatalog?.roles.find((role) => role.id === draft.role);
  const roleAssignable = canChooseStudioRole(selectedRole, roleCatalog?.actorRole);
  const validation = validatePeopleAccountCreation(draft, roleAssignable);
  const identityError = validation.username || validation.email || validation.accessExpiresAt || "";
  const accessError = validation.role || rolesError || (rolesLoading || !roleCatalog ? "Workspace roles are not loaded yet." : "");
  // The signature covers the complete POST body; changing any meaningful field
  // invalidates the previously reviewed server response.
  const signature = JSON.stringify(previewPayload(draft));
  const latestSignatureRef = useRef(signature);
  latestSignatureRef.current = signature;
  const readyReview = preview?.signature === signature ? preview.result : null;
  const canSubmit = stage === "review" && !creating && !checking &&
    !identityError && !accessError && readyReview?.canCreate === true;

  useEffect(() => {
    ++previewSequenceRef.current;
    setPreview(null);
    setPreviewError("");
    setChecking(false);
  }, [signature]);
  useEffect(() => () => { ++previewSequenceRef.current; }, []);

  async function reviewWithServer() {
    if (identityError) { setStage("identity"); return; }
    if (accessError) { setStage("access"); return; }
    const requestId = ++previewSequenceRef.current;
    const body = previewPayload(draft);
    const requestSignature = JSON.stringify(body);
    setStage("review");
    setPreview(null);
    setPreviewError("");
    setChecking(true);
    try {
      const result = await api<ProvisioningReview>("/api/admin/users/provisioning-preview", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (requestId !== previewSequenceRef.current || requestSignature !== latestSignatureRef.current) return;
      if (!result.ok) throw new Error("The account preflight returned no review.");
      setPreview({ signature: requestSignature, result });
    } catch (error) {
      if (requestId === previewSequenceRef.current && requestSignature === latestSignatureRef.current) {
        setPreviewError(error instanceof Error ? error.message : "Could not check account provisioning.");
      }
    } finally {
      if (requestId === previewSequenceRef.current) setChecking(false);
    }
  }

  async function commit() {
    if (!canSubmit || !readyReview || preview?.signature !== latestSignatureRef.current) return;
    await onCreate(); // Server performs all checks again. The review does not reserve anything.
  }

  const roleLabel = selectedRole?.label || draft.role;
  const grouped = Object.fromEntries(visibleLevels.map((level) =>
    [level, (readyReview?.toolPermissions || []).filter((entry) => entry.level === level)]
  )) as Record<string, Array<{ tool: string; level: string }>>;
  const other = (readyReview?.toolPermissions || []).filter((entry) => !visibleLevels.includes(entry.level as typeof visibleLevels[number]));

  return <section className="people-account-wizard-v11 panel" aria-label="Create Cluster account">
    <header className="people-account-wizard-heading-v11">
      <div><h2>Create account</h2><p>Set up an identity, choose starting access, and review before creation.</p></div>
      <ClusterButton type="button" variant="quiet" size="compact" disabled={creating} onClick={onCancel}>Close</ClusterButton>
    </header>
    <ol className="people-account-wizard-progress-v11" aria-label="Provisioning steps">
      {STEPS.map((item, index) => <li key={item.id} aria-current={item.id === stage ? "step" : undefined}>
        <span>{index + 1}</span>{item.label}
      </li>)}
    </ol>

    {stage === "identity" && <div className="people-account-wizard-fields-v11">
      <label className="field"><span>Username</span><ClusterTextInput autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={32} value={draft.username} onChange={(event) => onPatch({ username: event.target.value })} placeholder="example.user" />
        {validation.username && <small className="people-account-wizard-field-error-v11">{validation.username}</small>}</label>
      <label className="field"><span>Display name</span><ClusterTextInput value={draft.displayName} maxLength={160} onChange={(event) => onPatch({ displayName: event.target.value })} placeholder="Name shown to teammates" /></label>
      <label className="field"><span>Email (optional)</span><ClusterTextInput type="email" autoComplete="off" value={draft.email} onChange={(event) => onPatch({ email: event.target.value })} placeholder="name@example.com" />
        {validation.email && <small className="people-account-wizard-field-error-v11">{validation.email}</small>}</label>
      <label className="field"><span>Account type</span>
        <ClusterNativeSelect value={draft.accountType} onChange={(event) => onPatch({ accountType: event.target.value })}>
          <option value="employee">Employee</option><option value="contractor">Contractor</option>
          <option value="client">Client</option><option value="guest">Guest</option>
        </ClusterNativeSelect>
        <small>Account type describes the person's identity. Role permissions are separate.</small></label>
      <label className="field"><span>Access expiration</span><ClusterInput type="date" value={draft.accessExpiresAt} onChange={(event) => onPatch({ accessExpiresAt: event.target.value })} />
        <small>{draft.accountType === "employee" ? "Optional for employees." : "Required for temporary and external accounts."}</small>
        {validation.accessExpiresAt && <small className="people-account-wizard-field-error-v11">{validation.accessExpiresAt}</small>}</label>
    </div>}

    {stage === "access" && <div className="people-account-wizard-access-v11">
      <label className="field"><span>Workspace role</span>
        <ClusterNativeSelect value={draft.role} disabled={rolesLoading || !roleCatalog || creating} onChange={(event) => onPatch({ role: event.target.value })}>
          {!roleCatalog?.roles.some((role) => role.id === draft.role) && <option value={draft.role} disabled>{draft.role} (unavailable)</option>}
          {(roleCatalog?.roles || []).map((role) => <option value={role.id} key={role.id}
            disabled={!canChooseStudioRole(role, roleCatalog?.actorRole)}>{role.label}{role.enabled ? "" : " (disabled)"}</option>)}
        </ClusterNativeSelect>
        {accessError && <small className="people-account-wizard-field-error-v11" role="status">{accessError}</small>}
      </label>
      <div className="people-account-wizard-note-v11">
        <strong>{selectedRole?.privileged ? "Privileged workspace role" : `Starting role: ${roleLabel}`}</strong>
        <p>{selectedRole?.privileged ? "Only a workspace owner may assign this role. A privileged role may manage workspace-wide operations." : "The Server will evaluate this role and the identity type before the account can be created."}</p>
      </div>
      <div className="people-account-wizard-note-v11">
        <strong>Project, Library and team access</strong>
        <p>No individual Project grant or team membership is assigned by this form. Those require their own approved workflows. Resource-specific restrictions still apply.</p>
      </div>
    </div>}

    {stage === "review" && <div className="people-account-wizard-review-v11">
      <dl className="people-account-wizard-summary-v11">
        <div><dt>Identity</dt><dd><strong>{draft.displayName.trim() || draft.username.trim()}</strong><small>@{draft.username.trim()}{draft.email ? ` · ${draft.email.trim()}` : ""}</small></dd></div>
        <div><dt>Account type</dt><dd>{draft.accountType}</dd></div>
        <div><dt>Starting role</dt><dd>{roleLabel}</dd></div>
        <div><dt>Expiration</dt><dd>{draft.accessExpiresAt || "No expiry"}</dd></div>
        <div><dt>First sign-in</dt><dd>One-time password; member sets a permanent password</dd></div>
      </dl>
      {checking && <p className="people-account-wizard-note-v11" role="status">Checking identity and role policy with the Server…</p>}
      {previewError && <p className="people-account-wizard-field-error-v11" role="alert">{previewError}</p>}
      {readyReview && <section className="people-account-wizard-policy-v11" aria-label="Server access preflight">
        <div className="people-account-wizard-policy-head-v11">
          <strong>{readyReview.canCreate ? "Preflight passed" : "Creation blocked"}</strong>
          <small>Checked {new Date(readyReview.reviewedAt).toLocaleTimeString()}</small>
        </div>
        {readyReview.blockers.map((blocker) => <p key={blocker.code} className="people-account-wizard-field-error-v11" role="alert">{blocker.message}</p>)}
        {readyReview.role && <p className="people-account-wizard-preview-caption-v11">Configured initial tool levels for {readyReview.role.label} ({readyReview.accountType}). This is not an effective-access grant.</p>}
        <div className="people-account-wizard-permission-counts-v11">
          {visibleLevels.map((level) => <div key={level}><strong>{grouped[level].length}</strong><span>{level === "none" ? "No tool access" : `${level[0].toUpperCase()}${level.slice(1)}`}</span></div>)}
        </div>
        {readyReview.toolPermissions.length > 0 && <details>
          <summary>Review all starting tool levels</summary>
          <ul>{readyReview.toolPermissions.map((item) => <li key={item.tool}><span>{permissionLabel(item.tool)}</span><strong>{item.level}</strong></li>)}</ul>
          {other.length > 0 && <small>{other.length} tools use custom permission levels.</small>}
        </details>}
        <p className="people-account-wizard-preview-caption-v11">Preflight does not reserve a username. The Server rechecks permissions and policy when you create the account.</p>
        <details className="people-account-wizard-limitations-v11"><summary>What this account does not receive automatically</summary>
          <ul>{readyReview.limitations.map((text) => <li key={text}>{text}</li>)}</ul>
        </details>
      </section>}
    </div>}

    {actionError && <p className="people-account-wizard-field-error-v11" role="alert">{actionError}</p>}
    <footer className="people-account-wizard-actions-v11">
      {stage !== "identity" && <ClusterButton type="button" variant="secondary" disabled={creating || checking}
        onClick={() => setStage(stage === "review" ? "access" : "identity")}>Back</ClusterButton>}
      {stage === "identity" && <ClusterButton type="button" variant="primary" disabled={Boolean(identityError) || creating}
        onClick={() => setStage("access")}>Next: Starting access</ClusterButton>}
      {stage === "access" && <ClusterButton type="button" variant="primary" disabled={Boolean(accessError) || Boolean(identityError) || creating}
        onClick={() => void reviewWithServer()}>Review with Server</ClusterButton>}
      {stage === "review" && <>
        <ClusterButton type="button" variant="secondary" disabled={checking || creating} onClick={() => void reviewWithServer()}>{checking ? "Checking…" : "Refresh preflight"}</ClusterButton>
        <ClusterButton type="button" variant="primary" disabled={!canSubmit} onClick={() => void commit()}>{creating ? "Creating…" : "Create account"}</ClusterButton>
      </>}
    </footer>
  </section>;
}

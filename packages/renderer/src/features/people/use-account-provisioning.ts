import { useEffect, useRef, useState } from "react";
import { api, queryApi } from "../../core/api";
import { reconcileAfterCommit } from "../../core/post-commit-reconciliation";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { canChooseStudioRole, type StudioAssignableRoleChoice } from "./people-role-choice";
import { validatePeopleAccountCreation, firstPeopleAccountCreateError } from "./people-account-creation-validation";
import type { ProvisioningDraft } from "./PeopleAccountProvisioningWizard";
import { displayUserName } from "./people-utils";

/* Account creation, in one place. Admin → Users uses it; People sends
   admins there to add someone. The rules it keeps:
   - one create at a time (a gate ref, not just a disabled button);
   - a temporary password is only shown to the session that created it;
   - once the POST commits, nothing invites a retry of the POST: a failed
     onboarding assignment or a failed refresh is reported as a follow-up
     on the existing account. */

export type CreateRoleCatalog = { actorRole: string; workspaceId: string; roles: StudioAssignableRoleChoice[] };
type CreatedAccount = { id: string; username: string; displayName?: string | null; temporaryPassword: string };

const EMPTY_DRAFT: ProvisioningDraft = { username: "", displayName: "", email: "", accountType: "employee", accessExpiresAt: "", role: "member", onboardingVersionId: "" };

export function useAccountProvisioning({ enabled, currentUserId, onCreated, onStatus }: {
  enabled: boolean;
  currentUserId: string;
  /** After the account exists: refresh lists etc. A throw is reported as a warning, never as a failed create. */
  onCreated?: (created: CreatedAccount) => Promise<unknown>;
  onStatus?: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<ProvisioningDraft>(EMPTY_DRAFT);
  const [error, setError] = useState("");
  const [roleCatalog, setRoleCatalog] = useState<CreateRoleCatalog | null>(null);
  const [rolesError, setRolesError] = useState("");
  const [rolesLoading, setRolesLoading] = useState(false);
  const [issuedCredential, setIssuedCredential] = useState<{ username: string; temporaryPassword: string } | null>(null);
  const [onboardingFollowup, setOnboardingFollowup] = useState<{ userId: string; versionId: string; message: string } | null>(null);
  const [onboardingRetryBusy, setOnboardingRetryBusy] = useState(false);
  const gateRef = useRef(false);
  const scopeRef = useRef(currentUserId);
  scopeRef.current = currentUserId;
  const status = (message: string) => onStatus?.(message);

  // A different signed-in user never inherits the previous one's handoff.
  useEffect(() => {
    setIssuedCredential(null);
    setOnboardingFollowup(null);
  }, [currentUserId]);

  useEffect(() => {
    if (!enabled || !open) { setRoleCatalog(null); setRolesError(""); return; }
    let cancelled = false;
    setRolesLoading(true);
    setRolesError("");
    void queryApi<CreateRoleCatalog>("/api/admin/users/assignable-roles", {
      force: true, staleMs: 0, persist: false, tags: ["roles", "users", "people"],
    }).then((result) => {
      if (cancelled) return;
      setRoleCatalog(result);
      const canAssign = (id: string) => result.roles.some((role) => role.id === id && canChooseStudioRole(role, result.actorRole));
      setDraft((current) => canAssign(current.role) ? current : { ...current, role: "member" });
    }).catch((cause: unknown) => {
      if (!cancelled) { setRoleCatalog(null); setRolesError(cause instanceof Error ? cause.message : "Could not load workspace roles."); }
    }).finally(() => { if (!cancelled) setRolesLoading(false); });
    return () => { cancelled = true; };
  }, [enabled, open, currentUserId]);

  const creationRole = roleCatalog?.roles.find((role) => role.id === draft.role);
  const blocker = firstPeopleAccountCreateError(validatePeopleAccountCreation(draft, canChooseStudioRole(creationRole, roleCatalog?.actorRole)));
  const dirty = Boolean(draft.username.trim() || draft.displayName.trim() || draft.email.trim() || draft.accessExpiresAt || draft.onboardingVersionId || draft.accountType !== "employee" || draft.role !== "member");
  const { confirmDiscard } = useUnsavedChangesGuard({
    dirty: enabled && open && dirty,
    title: "Discard account draft?",
    message: "The new account has not been created. Closing will discard the entered information.",
  });

  function patch(changes: Partial<ProvisioningDraft>) {
    setDraft((current) => ({ ...current, ...changes }));
    setError("");
  }

  async function setOpenGuarded(next: boolean) {
    if (busy) return;
    if (!next && open && dirty && !(await confirmDiscard())) return;
    if (!next) { setDraft(EMPTY_DRAFT); setError(""); }
    setOpen(next);
  }

  async function create() {
    if (!enabled || gateRef.current) return;
    const username = draft.username.trim();
    const onboardingVersionId = draft.onboardingVersionId;
    if (blocker || rolesLoading || rolesError || !roleCatalog) {
      setError(blocker || rolesError || "Workspace roles are still loading.");
      return;
    }
    gateRef.current = true;
    const scope = currentUserId;
    setBusy(true);
    setError("");
    setOnboardingFollowup(null);
    status("Creating account…");
    try {
      const created = await api<CreatedAccount>("/api/users", {
        method: "POST",
        body: JSON.stringify({
          username,
          displayName: draft.displayName.trim() || null,
          email: draft.email.trim() || null,
          accountType: draft.accountType,
          accessExpiresAt: draft.accessExpiresAt ? new Date(`${draft.accessExpiresAt}T23:59:59`).toISOString() : null,
          role: draft.role,
        }),
      });
      if (scopeRef.current !== scope) return; // Never show another session's credential.
      setIssuedCredential({ username: created.username, temporaryPassword: created.temporaryPassword });
      setDraft(EMPTY_DRAFT);
      setOpen(false);
      status(`Account created for ${displayUserName(created)}. Copy the temporary password before leaving this view.`);
      if (onboardingVersionId) {
        try {
          await api(`/api/studio-systems/onboarding/versions/${encodeURIComponent(onboardingVersionId)}/assign-person`, {
            method: "POST", body: JSON.stringify({ userId: created.id }),
          });
          if (scopeRef.current === scope) status("Account created and onboarding assigned. Complete the private credential handoff.");
        } catch (cause) {
          if (scopeRef.current === scope) {
            const message = cause instanceof Error ? cause.message : "Onboarding could not be assigned.";
            setOnboardingFollowup({ userId: created.id, versionId: onboardingVersionId, message });
            status("Account created. Onboarding assignment needs a separate retry; do not create another account.");
          }
        }
      }
      // Creation already committed. A failed follow-up read must never invite a retry
      // of the POST or falsely claim that the account was not created.
      if (onCreated) {
        const refreshWarning = await reconcileAfterCommit(() => onCreated(created));
        if (refreshWarning && scopeRef.current === scope) status(`Account created for ${displayUserName(created)}, but the list did not refresh. The temporary password above remains valid. ${refreshWarning}`);
      }
    } catch (cause) {
      if (scopeRef.current === scope) {
        const message = cause instanceof Error ? cause.message : "Account creation failed.";
        setError(message);
        status(message);
      }
    } finally {
      gateRef.current = false;
      if (scopeRef.current === scope) setBusy(false);
    }
  }

  async function retryOnboarding() {
    if (!enabled || !onboardingFollowup || onboardingRetryBusy) return;
    const current = onboardingFollowup;
    setOnboardingRetryBusy(true);
    try {
      await api(`/api/studio-systems/onboarding/versions/${encodeURIComponent(current.versionId)}/assign-person`, {
        method: "POST", body: JSON.stringify({ userId: current.userId }),
      });
      if (scopeRef.current === currentUserId) {
        setOnboardingFollowup((state) => state?.userId === current.userId && state.versionId === current.versionId ? null : state);
        status("Onboarding assigned to the existing account. No duplicate account was created.");
      }
    } catch (cause) {
      if (scopeRef.current === currentUserId) {
        const message = cause instanceof Error ? cause.message : "Onboarding assignment still unavailable.";
        setOnboardingFollowup((state) => state?.userId === current.userId && state.versionId === current.versionId ? { ...state, message } : state);
      }
    } finally { setOnboardingRetryBusy(false); }
  }

  return {
    open, setOpen: setOpenGuarded, busy, draft, patch, error, create,
    roleCatalog, rolesLoading, rolesError,
    issuedCredential, dismissCredential: () => setIssuedCredential(null),
    onboardingFollowup, onboardingRetryBusy, retryOnboarding,
  };
}

import { useEffect, useId, useRef, useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterCopyButton } from "../../components/ClusterCopyButton";
import { ClusterInput } from "../../components/ClusterNativeControls";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { formatAccountFirstSignInGuide } from "./account-first-sign-in-guide";
import "./account-credential-handoff.css";

/** A deliberate one-time handoff. Credentials are held in account-scoped React
 * state only, never in local storage, a URL, a notification or analytics. */
export function AccountCredentialHandoff({
  username, temporaryPassword, onDismiss,
}: {
  username: string;
  temporaryPassword: string;
  onDismiss: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [handoffAcknowledged, setHandoffAcknowledged] = useState(false);
  useUnsavedChangesGuard({ dirty: true, title: "Leave one-time password handoff?", message: "This temporary password is only shown once. Copy it before leaving." });
  const titleId = useId();
  const descriptionId = useId();
  const signInUrl = typeof window === "undefined" ? "" :
    ["http:", "https:"].includes(window.location.protocol) ? window.location.origin + "/" : "";
  const instructions = formatAccountFirstSignInGuide({ username, temporaryPassword, signInUrl });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  return <dialog ref={dialogRef} className="people-credential-handoff-v11"
    aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={(event) => event.preventDefault()}
    onClose={onDismiss}>
    <div className="people-credential-handoff-head-v11">
      <span className="eyebrow">Account provisioned</span>
      <h2 id={titleId}>Finish the account handoff</h2>
      <p id={descriptionId}>Copy the temporary password and share it privately. The member must change it at first sign-in.</p>
    </div>
    <div className="people-credential-handoff-details-v11">
      <div><span>Username</span><strong>{username}</strong></div>
      <div><span>Temporary password</span><code>{temporaryPassword}</code></div>
    </div>
    <p className="people-credential-handoff-warning-v11" role="note">This password cannot be retrieved after closing. Use account recovery if it is lost. First sign-in may also require MFA setup.</p>
    <label className="people-credential-handoff-confirm-v11">
      <ClusterInput type="checkbox" checked={handoffAcknowledged} onChange={(event) => setHandoffAcknowledged(event.target.checked)} />
      <span>I have securely copied or recorded the temporary password.</span>
    </label>
    <div className="people-credential-handoff-actions-v11">
      <ClusterCopyButton text={instructions} variant="primary" copiedLabel="Instructions copied">Copy sign-in instructions</ClusterCopyButton>
      <ClusterCopyButton text={temporaryPassword} variant="secondary" copiedLabel="Password copied">Copy password</ClusterCopyButton>
      <ClusterButton type="button" variant="secondary" disabled={!handoffAcknowledged} onClick={() => dialogRef.current?.close()}>Finish handoff</ClusterButton>
    </div>
  </dialog>;
}
